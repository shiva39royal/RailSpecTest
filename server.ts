import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { parseDwgBuffer, parseDxfBuffer } from './server/cadParser';
import { runDynamicExtraction } from './server/extractionService';
import { getPdfPageContentBounds, type PdfContentBounds } from './server/pdfProcessor';
import {
  DEFAULT_EXTRACTION_SETTINGS,
  KAVACH_SPEC_TABLES,
  SPEC_DOCUMENT_INFO,
} from './src/spec/kavachSpecSchema';
import type { DrawingFormat, UploadedDrawing, WorkspaceProject } from './src/types/project';

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = process.cwd();
const UPLOADS_DIR = path.resolve(ROOT_DIR, 'data', 'uploads');
const PROJECTS_DIR = path.resolve(ROOT_DIR, 'data', 'projects');
const PUBLIC_ASSETS_DIR = path.resolve(ROOT_DIR, 'public', 'assets', 'aistudio');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(PROJECTS_DIR, { recursive: true });

// In-memory registry of uploaded drawing metadata & file paths (also persisted to disk)
const DRAWINGS_META_FILE = path.resolve(UPLOADS_DIR, '_drawings_index.json');
const drawingRegistry = new Map<string, { drawing: UploadedDrawing; filePath: string }>();
const pdfBoundsCache = new Map<string, PdfContentBounds>();

function loadDrawingRegistry() {
  if (!fs.existsSync(DRAWINGS_META_FILE)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(DRAWINGS_META_FILE, 'utf8'));
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (item?.drawing?.id && item?.filePath && fs.existsSync(item.filePath)) {
          drawingRegistry.set(item.drawing.id, item);
        }
      }
    }
  } catch {
    // ignore corrupt index
  }
}

function saveDrawingRegistry() {
  const entries = Array.from(drawingRegistry.values()).map((entry) => ({
    // Store lightweight index without huge cadData arrays duplicated on disk if large; keep full in memory
    filePath: entry.filePath,
    drawing: {
      ...entry.drawing,
      cadData: undefined,
    },
  }));
  fs.writeFileSync(DRAWINGS_META_FILE, JSON.stringify(entries, null, 2));
}

loadDrawingRegistry();

function safeResolveInDir(baseDir: string, fileName: string): string {
  const safeName = path.basename(fileName);
  const resolved = path.resolve(baseDir, safeName);
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw new Error('Invalid file path');
  }
  return resolved;
}

/**
 * Resolves a drawing entry reliably across server restarts and container reloads:
 * 1) Checks in-memory drawingRegistry
 * 2) Reloads _drawings_index.json from disk
 * 3) Auto-rehydrates bundled RDSO Spec PDF for drw_spec_* IDs
 * 4) Scans UPLOADS_DIR for <drawingId>.(dwg|dxf|pdf) on disk
 */
function resolveDrawingEntry(
  drawingId: string
): { drawing: UploadedDrawing; filePath: string } | undefined {
  if (!drawingId || drawingId.length > 80 || !/^[a-zA-Z0-9_-]+$/.test(drawingId)) {
    return undefined;
  }

  const existing = drawingRegistry.get(drawingId);
  if (existing && fs.existsSync(existing.filePath)) {
    return existing;
  }

  // Reload persisted index from disk in case it was updated before restart
  loadDrawingRegistry();
  const reloaded = drawingRegistry.get(drawingId);
  if (reloaded && fs.existsSync(reloaded.filePath)) {
    return reloaded;
  }

  // Rehydrate bundled RDSO Reference Spec PDF automatically
  if (drawingId.startsWith('drw_spec_')) {
    try {
      const specPdfPath = safeResolveInDir(PUBLIC_ASSETS_DIR, 'Railway_Spec_d97cd2c7.pdf');
      if (fs.existsSync(specPdfPath)) {
        const stat = fs.statSync(specPdfPath);
        const drawing: UploadedDrawing = {
          id: drawingId,
          fileName: 'RDSO_SPN_196_2020_KAVACH_Spec_Amdt6.pdf',
          format: 'PDF',
          sizeBytes: stat.size,
          uploadedAt: new Date(stat.mtimeMs).toISOString(),
          role: 'primary_layout',
          validationStatus: 'valid',
          validationNotes: ['Rehydrated RDSO/SPN/196/2020 V4.0 Amdt-6 PDF (39 pages).'],
          pageCount: 39,
          fileUrl: `/api/drawings/${drawingId}/file`,
          pdfMetadata: { pageCount: 39, title: 'RDSO KAVACH Control Table Guidelines' },
        };
        const recovered = { drawing, filePath: specPdfPath };
        drawingRegistry.set(drawingId, recovered);
        saveDrawingRegistry();
        return recovered;
      }
    } catch {
      // fall through
    }
  }

  // Rehydrate directly from stored binary file on disk in UPLOADS_DIR
  const candidateFormats: Array<{ ext: string; format: DrawingFormat }> = [
    { ext: 'dwg', format: 'DWG' },
    { ext: 'dxf', format: 'DXF' },
    { ext: 'pdf', format: 'PDF' },
  ];
  for (const cand of candidateFormats) {
    try {
      const candidatePath = safeResolveInDir(UPLOADS_DIR, `${drawingId}.${cand.ext}`);
      if (fs.existsSync(candidatePath)) {
        const stat = fs.statSync(candidatePath);
        const pageCount =
          cand.format === 'PDF' ? estimatePdfPageCount(fs.readFileSync(candidatePath)) : 1;
        const drawing: UploadedDrawing = {
          id: drawingId,
          fileName: `${drawingId}.${cand.ext}`,
          format: cand.format,
          sizeBytes: stat.size,
          uploadedAt: new Date(stat.mtimeMs).toISOString(),
          role: 'primary_layout',
          validationStatus: 'valid',
          validationNotes: [`Recovered ${cand.format} drawing from server storage.`],
          pageCount,
          fileUrl: `/api/drawings/${drawingId}/file`,
        };
        const recovered = { drawing, filePath: candidatePath };
        drawingRegistry.set(drawingId, recovered);
        saveDrawingRegistry();
        return recovered;
      }
    } catch {
      // ignore invalid path
    }
  }

  return undefined;
}

function detectDrawingFormat(fileName: string, buffer: Buffer): {
  format: DrawingFormat | null;
  validationStatus: 'valid' | 'warning' | 'error';
  notes: string[];
} {
  const ext = path.extname(fileName).toLowerCase();
  const headerAscii = buffer.subarray(0, 64).toString('latin1');
  const notes: string[] = [];

  // PDF magic bytes: %PDF-
  if (headerAscii.startsWith('%PDF-')) {
    const pdfVersionMatch = headerAscii.match(/^%PDF-(\d+\.\d+)/);
    notes.push(`Validated PDF signature (${pdfVersionMatch ? `PDF ${pdfVersionMatch[1]}` : 'PDF'}).`);
    if (ext !== '.pdf') notes.push('File extension did not match PDF header; identified by magic bytes.');
    return { format: 'PDF', validationStatus: 'valid', notes };
  }

  // AutoCAD DWG magic bytes: AC10xx (R12 through R2024+)
  if (/^AC10\d{2}/.test(headerAscii)) {
    const verCode = headerAscii.slice(0, 6);
    notes.push(`Validated binary AutoCAD DWG header (${verCode}).`);
    return { format: 'DWG', validationStatus: 'valid', notes };
  }

  // DXF check: ASCII DXF contains SECTION / HEADER / ENTITIES / EOF markers, or Binary DXF header
  const sampleText = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8');
  if (
    headerAscii.startsWith('AutoCAD Binary DXF') ||
    (ext === '.dxf' && (sampleText.includes('SECTION') || sampleText.includes('ENTITIES') || sampleText.includes('0\n') || sampleText.includes('0\r\n'))) ||
    (sampleText.includes('SECTION') && sampleText.includes('HEADER') && sampleText.includes('999') === false)
  ) {
    if (headerAscii.startsWith('AutoCAD Binary DXF')) {
      notes.push('Detected Binary DXF format; ASCII DXF is recommended for full vector inspection.');
      return { format: 'DXF', validationStatus: 'warning', notes };
    }
    notes.push('Validated ASCII DXF structure.');
    return { format: 'DXF', validationStatus: 'valid', notes };
  }

  if (ext === '.dwg') {
    notes.push('File has .dwg extension but non-standard header bytes; attempting LibreDWG recovery.');
    return { format: 'DWG', validationStatus: 'warning', notes };
  }
  if (ext === '.dxf') {
    notes.push('File has .dxf extension; attempting DXF parse.');
    return { format: 'DXF', validationStatus: 'warning', notes };
  }
  if (ext === '.pdf') {
    notes.push('File has .pdf extension but missing %PDF- header.');
    return { format: null, validationStatus: 'error', notes };
  }

  notes.push(`Unsupported file format (${ext || 'unknown'}). Upload DWG, DXF, or PDF drawings.`);
  return { format: null, validationStatus: 'error', notes };
}

function estimatePdfPageCount(buffer: Buffer): number {
  const str = buffer.toString('latin1');
  const matches = str.match(/\/Type\s*\/Page\b(?!s)/g);
  return matches && matches.length > 0 ? matches.length : 1;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB max engineering drawing
  },
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception — server kept alive]', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection — server kept alive]', reason);
});

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '120mb' }));
  app.use(express.urlencoded({ limit: '120mb', extended: true }));

  // 0. Lightweight Health & Wake-Up Probe (always JSON, never cached)
  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.json({ ok: true, ts: Date.now() });
  });

  // 1. Health & Spec Metadata
  app.get('/api/spec', (_req, res) => {
    res.json({
      spec: SPEC_DOCUMENT_INFO,
      tables: KAVACH_SPEC_TABLES,
      defaultSettings: DEFAULT_EXTRACTION_SETTINGS,
    });
  });

  // 2. Upload & Validate Drawing (DWG, DXF, PDF)
  app.post(
    '/api/drawings/upload',
    (req, res, next) => {
      upload.single('file')(req, res, (err: any) => {
        if (!err) return next();
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
              error: 'Drawing file exceeds the 100 MB maximum upload limit.',
            });
          }
          return res.status(400).json({ error: `Upload error: ${err.message}` });
        }
        return res.status(500).json({
          error: `Upload middleware error: ${err?.message || 'Unable to receive file.'}`,
        });
      });
    },
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: 'No drawing file was received.' });
        }

        const originalName = req.file.originalname.replace(/[^\w.\- ()]/g, '_');
        const role = (req.body?.role as UploadedDrawing['role']) || 'primary_layout';
        const detection = detectDrawingFormat(originalName, req.file.buffer);

        if (!detection.format) {
          return res.status(400).json({
            error: detection.notes.join(' '),
          });
        }

        const drawingId = `drw_${crypto.randomUUID().slice(0, 12)}`;
        const storedExt = detection.format.toLowerCase();
        const storedFileName = `${drawingId}.${storedExt}`;
        const storedPath = safeResolveInDir(UPLOADS_DIR, storedFileName);
        fs.writeFileSync(storedPath, req.file.buffer);

        let cadData: UploadedDrawing['cadData'] | undefined;
        let pageCount = 1;
        const validationNotes = [...detection.notes];
        let validationStatus = detection.validationStatus;

        if (detection.format === 'DXF') {
          try {
            cadData = parseDxfBuffer(req.file.buffer);
            pageCount = Math.max(1, cadData.layouts.length);
            validationNotes.push(
              `Parsed ${cadData.totalEntityCount.toLocaleString()} CAD entities across ${cadData.layers.length} layers and ${cadData.textAnnotations.length} text annotations.`
            );
            if (cadData.parseWarnings.length > 0) {
              validationNotes.push(...cadData.parseWarnings);
            }
          } catch (err) {
            fs.unlinkSync(storedPath);
            return res.status(422).json({
              error: `DXF parsing failed: ${(err as Error).message}`,
            });
          }
        } else if (detection.format === 'DWG') {
          try {
            cadData = await parseDwgBuffer(req.file.buffer);
            pageCount = Math.max(1, cadData.layouts.length);
            validationNotes.push(
              `Decoded DWG (${cadData.cadVersion}) with ${cadData.totalEntityCount.toLocaleString()} entities, ${cadData.layers.length} layers, and ${cadData.textAnnotations.length} text annotations.`
            );
            if (cadData.totalEntityCount === 0 && !cadData.svgFallback) {
              validationStatus = 'warning';
              validationNotes.push('No vector entities were found in Model Space; inspect drawing or convert to DXF.');
            }
          } catch (err) {
            fs.unlinkSync(storedPath);
            return res.status(422).json({
              error: `DWG decoding failed: ${(err as Error).message}`,
            });
          }
        }

        let pdfContentBounds: PdfContentBounds | undefined;
        if (detection.format === 'PDF') {
          pageCount = estimatePdfPageCount(req.file.buffer);
          try {
            pdfContentBounds = await getPdfPageContentBounds(storedPath, 1);
            pdfBoundsCache.set(`${drawingId}:1`, pdfContentBounds);
            const trimmedPct = Math.round(pdfContentBounds.trimmedRatio * 100);
            validationNotes.push(
              `Detected ${pageCount} PDF sheet${pageCount > 1 ? 's' : ''}. Tight drawing border: ${Math.round(pdfContentBounds.cropWidth)}×${Math.round(pdfContentBounds.cropHeight)} pt${trimmedPct > 15 ? ` (${trimmedPct}% blank outer margin trimmed automatically)` : ''}.`
            );
          } catch {
            validationNotes.push(`Detected ${pageCount} PDF sheet${pageCount > 1 ? 's' : ''}. Ready for high-DPI vector inspection.`);
          }
        }

        const drawing: UploadedDrawing = {
          id: drawingId,
          fileName: originalName,
          format: detection.format,
          sizeBytes: req.file.size,
          uploadedAt: new Date().toISOString(),
          role,
          validationStatus,
          validationNotes,
          pageCount,
          fileUrl: `/api/drawings/${drawingId}/file`,
          cadData,
          pdfMetadata:
            detection.format === 'PDF'
              ? {
                pageCount,
                width: pdfContentBounds?.pageWidth,
                height: pdfContentBounds?.pageHeight,
                contentBounds: pdfContentBounds,
              }
              : undefined,
        };

        drawingRegistry.set(drawingId, { drawing, filePath: storedPath });
        saveDrawingRegistry();

        return res.json({ drawing });
      } catch (err) {
        return res.status(500).json({
          error: `Upload processing error: ${(err as Error).message}`,
        });
      }
    });

  // 3. Register the attached RDSO Reference Specification PDF (strictly on explicit user click to inspect or test)
  app.post('/api/drawings/load-spec-pdf', (_req, res) => {
    try {
      const specPdfPath = safeResolveInDir(PUBLIC_ASSETS_DIR, 'Railway_Spec_d97cd2c7.pdf');
      if (!fs.existsSync(specPdfPath)) {
        return res.status(404).json({ error: 'Reference specification PDF asset not found.' });
      }
      const buffer = fs.readFileSync(specPdfPath);
      const drawingId = `drw_spec_${crypto.randomUUID().slice(0, 8)}`;
      const pageCount = estimatePdfPageCount(buffer);

      const drawing: UploadedDrawing = {
        id: drawingId,
        fileName: 'RDSO_SPN_196_2020_KAVACH_Spec_Amdt6.pdf',
        format: 'PDF',
        sizeBytes: buffer.byteLength,
        uploadedAt: new Date().toISOString(),
        role: 'primary_layout',
        validationStatus: 'valid',
        validationNotes: [
          'Loaded RDSO/SPN/196/2020 V4.0 Amdt-6 PDF (39 pages).',
          'Navigate to any layout sheet (e.g., Page 15 or Page 35) in Drawing Viewer before running extraction.',
        ],
        pageCount: Math.max(pageCount, 39),
        fileUrl: `/api/drawings/${drawingId}/file`,
        pdfMetadata: { pageCount: Math.max(pageCount, 39), title: 'RDSO KAVACH Control Table Guidelines' },
      };

      drawingRegistry.set(drawingId, { drawing, filePath: specPdfPath });
      saveDrawingRegistry();
      return res.json({ drawing });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // 4. Stream Original Binary Drawing File (for PDF.js lossless rendering or download)
  app.get('/api/drawings/:id/file', (req, res) => {
    const entry = resolveDrawingEntry(req.params.id);
    if (!entry || !fs.existsSync(entry.filePath)) {
      return res.status(404).json({ error: 'Drawing file not found.' });
    }
    const mimeMap: Record<DrawingFormat, string> = {
      PDF: 'application/pdf',
      DXF: 'application/dxf',
      DWG: 'application/acad',
    };
    res.setHeader('Content-Type', mimeMap[entry.drawing.format] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${entry.drawing.fileName}"`);
    return fs.createReadStream(entry.filePath).pipe(res);
  });

  // 5. Re-fetch CAD geometry if needed after reload
  app.get('/api/drawings/:id/cad', async (req, res) => {
    const entry = resolveDrawingEntry(req.params.id);
    if (!entry || !fs.existsSync(entry.filePath)) {
      return res.status(404).json({ error: 'Drawing not found.' });
    }
    if (entry.drawing.cadData) {
      return res.json({ cadData: entry.drawing.cadData });
    }
    try {
      const buf = fs.readFileSync(entry.filePath);
      if (entry.drawing.format === 'DXF') {
        entry.drawing.cadData = parseDxfBuffer(buf);
      } else if (entry.drawing.format === 'DWG') {
        entry.drawing.cadData = await parseDwgBuffer(buf);
      }
      return res.json({ cadData: entry.drawing.cadData || null });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // 5b. Compute & return exact tight drawing-border bounding box for any PDF page
  app.get('/api/drawings/:id/pdf-bounds', async (req, res) => {
    const entry = resolveDrawingEntry(req.params.id);
    if (!entry || !fs.existsSync(entry.filePath) || entry.drawing.format !== 'PDF') {
      return res.status(404).json({ error: 'PDF drawing not found.' });
    }
    const pageNum = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const cacheKey = `${entry.drawing.id}:${pageNum}`;
    const cached = pdfBoundsCache.get(cacheKey);
    if (cached) {
      return res.json({ bounds: cached });
    }
    try {
      const bounds = await getPdfPageContentBounds(entry.filePath, pageNum);
      pdfBoundsCache.set(cacheKey, bounds);
      return res.json({ bounds });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // 6. Offline Deterministic Extraction Endpoint (triggered ONLY when user clicks "Start Extraction")
  app.post('/api/extract', async (req, res) => {
    try {
      const {
        drawingId,
        companionDrawingIds = [],
        fallbackDrawing,
        pageNumber = 1,
        pageRange = '',
        settings = DEFAULT_EXTRACTION_SETTINGS,
      } = req.body || {};

      if (!drawingId || typeof drawingId !== 'string') {
        return res.status(400).json({ error: 'A valid drawingId is required to start extraction.' });
      }

      let primaryEntry = resolveDrawingEntry(drawingId);
      if (!primaryEntry || !fs.existsSync(primaryEntry.filePath)) {
        // Fallback when ephemeral container storage restarted but client already has parsed CAD data
        const hasFallbackCad = Boolean(
          fallbackDrawing && typeof fallbackDrawing === 'object' && fallbackDrawing.cadData
        );
        if (fallbackDrawing && hasFallbackCad) {
          primaryEntry = {
            drawing: fallbackDrawing as UploadedDrawing,
            filePath: '',
          };
        } else {
          return res.status(404).json({
            code: 'DRAWING_NOT_FOUND',
            error: 'Uploaded drawing file is no longer in server memory. Please re-upload the drawing.',
          });
        }
      }

      // Hydrate cadData if it was dropped across server restarts
      if (
        !primaryEntry.drawing.cadData &&
        primaryEntry.filePath &&
        fs.existsSync(primaryEntry.filePath) &&
        (primaryEntry.drawing.format === 'DXF' || primaryEntry.drawing.format === 'DWG')
      ) {
        const buf = fs.readFileSync(primaryEntry.filePath);
        primaryEntry.drawing.cadData =
          primaryEntry.drawing.format === 'DXF' ? parseDxfBuffer(buf) : await parseDwgBuffer(buf);
      }

      const companions = Array.isArray(companionDrawingIds)
        ? companionDrawingIds
          .map((cid: string) => resolveDrawingEntry(cid))
          .filter((e): e is { drawing: UploadedDrawing; filePath: string } => Boolean(e && fs.existsSync(e.filePath)))
        : [];

      const result = await runDynamicExtraction({
        drawing: primaryEntry.drawing,
        filePath: primaryEntry.filePath,
        companionDrawings: companions,
        pageNumber: typeof pageNumber === 'number' ? pageNumber : Number.parseInt(String(pageNumber), 10) || 1,
        pageRange: typeof pageRange === 'string' ? pageRange : '',
        settings: { ...DEFAULT_EXTRACTION_SETTINGS, ...settings },
      });

      return res.json(result);
    } catch (err) {
      const message = (err as Error).message || 'Unexpected error during extraction.';
      console.error('[Extraction Error]', err);
      return res.status(500).json({ error: message });
    }
  });

  // 7. Workspace Project Persistence (Save / List / Load / Delete)
  app.get('/api/projects', (_req, res) => {
    try {
      const files = fs.readdirSync(PROJECTS_DIR).filter((f) => f.endsWith('.json'));
      const projects = files
        .map((f) => {
          try {
            const p = JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, f), 'utf8'));
            const totalRows = p.tables
              ? Object.values(p.tables).reduce(
                  (sum: number, r: any) => sum + (Array.isArray(r) ? r.length : 0),
                  0
                )
              : 0;
            return {
              id: p.id,
              name: p.name,
              updatedAt: p.updatedAt,
              stationName: p.metadata?.stationName || '',
              stationId: p.metadata?.stationId || '',
              drawingCount: p.drawings?.length || 0,
              totalRows,
              componentsCount: Array.isArray(p.components) ? p.components.length : 0,
              isSavedForPreview: Boolean(p.isSavedForPreview),
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      return res.json({ projects });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Bulk delete or clear all projects (supports both DELETE and POST)
  const handleBulkDeleteProjects = (req: express.Request, res: express.Response) => {
    try {
      const { ids } = (req.body || {}) as { ids?: string[] };
      if (Array.isArray(ids) && ids.length > 0) {
        for (const id of ids) {
          const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
          const target = safeResolveInDir(PROJECTS_DIR, `${safeId}.json`);
          if (fs.existsSync(target)) {
            fs.unlinkSync(target);
          }
        }
        return res.json({ deletedCount: ids.length, ids });
      }
      // Clear all saved projects
      const files = fs.readdirSync(PROJECTS_DIR).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        fs.unlinkSync(path.join(PROJECTS_DIR, file));
      }
      return res.json({ deletedCount: files.length, clearedAll: true });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  };

  app.delete('/api/projects', handleBulkDeleteProjects);
  app.post('/api/projects/delete', handleBulkDeleteProjects);
  app.post('/api/projects/clear-all', handleBulkDeleteProjects);

  // Single project deletion (supports both DELETE and POST)
  const handleSingleDeleteProject = (req: express.Request, res: express.Response) => {
    try {
      const projectId = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '');
      const targetPath = safeResolveInDir(PROJECTS_DIR, `${projectId}.json`);
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
      return res.json({ deleted: true, id: projectId });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  };

  app.delete('/api/projects/:id', handleSingleDeleteProject);
  app.post('/api/projects/:id/delete', handleSingleDeleteProject);

  app.post('/api/projects/:id', (req, res) => {
    try {
      const projectId = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '');
      if (!projectId) return res.status(400).json({ error: 'Invalid project ID.' });
      const payload = req.body as WorkspaceProject;
      if (!payload || typeof payload !== 'object') {
        return res.status(400).json({ error: 'Invalid project payload.' });
      }
      // Strip heavy cadData entity arrays when writing workspace JSON (can be re-fetched via /api/drawings/:id/cad)
      const storable: WorkspaceProject = {
        ...payload,
        id: projectId,
        updatedAt: new Date().toISOString(),
        drawings: (payload.drawings || []).map((d) => ({
          ...d,
          cadData: undefined,
        })),
      };
      const targetPath = safeResolveInDir(PROJECTS_DIR, `${projectId}.json`);
      fs.writeFileSync(targetPath, JSON.stringify(storable, null, 2));
      return res.json({ saved: true, updatedAt: storable.updatedAt });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/projects/:id', (req, res) => {
    try {
      const projectId = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '');
      const targetPath = safeResolveInDir(PROJECTS_DIR, `${projectId}.json`);
      if (!fs.existsSync(targetPath)) {
        return res.status(404).json({ error: 'Project not found.' });
      }
      const project = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
      return res.json({ project });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Guarantee every /api/* route returns JSON (never HTML <!doctype from Vite SPA fallback)
  app.all('/api/*', (req, res) => {
    return res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
  });

  app.use(
    '/api',
    (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error('[API Error]', err);
      const status = typeof err?.status === 'number' ? err.status : 500;
      return res.status(status).json({
        error: err?.message || 'Unexpected server error while processing API request.',
      });
    }
  );

  // Static / Vite middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
        watch: null,
      },
      appType: 'spa',
    });

    // Serve a zero-WebSocket /@vite/client shim when HMR is disabled so the browser
    // and any Web Workers (e.g. pdfjs-dist) never attempt an orphaned HMR WebSocket
    // connection or throw HTMLElement ReferenceErrors in Worker contexts.
    const NO_WS_VITE_CLIENT_SHIM = `
const sheetsMap = new Map();

export function updateStyle(id, content) {
  if (typeof document === 'undefined') return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  }
  style.textContent = content;
}

export function removeStyle(id) {
  if (typeof document === 'undefined') return;
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}

export function createHotContext() {
  const noop = () => {};
  return {
    data: {},
    accept: noop,
    acceptExports: noop,
    dispose: noop,
    prune: noop,
    invalidate: noop,
    on: noop,
    off: noop,
    send: noop,
  };
}

export function injectQuery(url) {
  return url;
}

const BaseHTMLElement = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};
export class ErrorOverlay extends BaseHTMLElement {}
`;

    app.get('/@vite/client', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(NO_WS_VITE_CLIENT_SHIM);
    });

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(ROOT_DIR, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  function listenOnPort(portToTry: number, maxAttempts = 10) {
    const serverInstance = app.listen(portToTry, '0.0.0.0', () => {
      console.log(`RailSpec KAVACH Studio running on http://0.0.0.0:${portToTry}`);
    });
    serverInstance.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE' && maxAttempts > 0) {
        console.warn(`Port ${portToTry} is in use, trying port ${portToTry + 1}...`);
        listenOnPort(portToTry + 1, maxAttempts - 1);
      } else {
        console.error('Server error:', err);
      }
    });
  }

  listenOnPort(PORT);
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
