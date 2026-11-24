import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import type {
  CadDocumentData,
  CadEntity,
  CadPoint,
  DocumentMetadata,
  KavachTableId,
  TableRowRecord,
} from '../src/types/project';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface PdfContentBounds {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  // PDF user-space coordinates (origin bottom-left, Y-up)
  llx: number;
  lly: number;
  urx: number;
  ury: number;
  // Top-left viewport-space coordinates (origin top-left, Y-down) for Canvas / PDF.js
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  trimmedRatio: number;
}

export interface PdfCadExtractionResult {
  cadData: CadDocumentData;
  bounds: PdfContentBounds;
  textCount: number;
  vectorPathCount: number;
  isToc?: boolean;
  tocMetadata?: Partial<DocumentMetadata>;
  tocTables?: Record<KavachTableId, TableRowRecord[]>;
}

type Matrix6 = [number, number, number, number, number, number];

function multiplyMatrix(m1: Matrix6, m2: Matrix6): Matrix6 {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function applyMatrix(m: Matrix6, x: number, y: number): CadPoint {
  return {
    x: Math.round((m[0] * x + m[2] * y + m[4]) * 100) / 100,
    y: Math.round((m[1] * x + m[3] * y + m[5]) * 100) / 100,
  };
}

function parseRgbArgsToHex(args: any): string {
  if (!Array.isArray(args) || args.length === 0) return '#0f172a';
  if (typeof args[0] === 'string' && args[0].startsWith('#')) return args[0];
  if (args.length >= 3) {
    const r = Number(args[0]);
    const g = Number(args[1]);
    const b = Number(args[2]);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      const scale = r <= 1 && g <= 1 && b <= 1 ? 255 : 1;
      const toHex = (v: number) =>
        Math.max(0, Math.min(255, Math.round(v * scale)))
          .toString(16)
          .padStart(2, '0');
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
  }
  return '#0f172a';
}

function sampleCubicBezier(
  p0: CadPoint,
  p1: CadPoint,
  p2: CadPoint,
  p3: CadPoint,
  steps = 4
): CadPoint[] {
  const pts: CadPoint[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x =
      mt * mt * mt * p0.x +
      3 * mt * mt * t * p1.x +
      3 * mt * t * t * p2.x +
      t * t * t * p3.x;
    const y =
      mt * mt * mt * p0.y +
      3 * mt * mt * t * p1.y +
      3 * mt * t * t * p2.y +
      t * t * t * p3.y;
    pts.push({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
  }
  return pts;
}

/**
 * Inspects a PDF page's exact MediaBox/CropBox dimensions using pdfjs-dist (100% offline).
 */
async function getPdfPageDimensions(
  pdfPath: string,
  pageNumber: number
): Promise<{ pageCount: number; pageWidth: number; pageHeight: number }> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await loadingTask.promise;
  try {
    const safePage = Math.max(1, Math.min(pageNumber, doc.numPages));
    const page = await doc.getPage(safePage);
    const vp = page.getViewport({ scale: 1 });
    return {
      pageCount: doc.numPages,
      pageWidth: vp.width,
      pageHeight: vp.height,
    };
  } finally {
    try {
      if (typeof doc?.destroy === 'function') {
        await doc.destroy();
      } else if (typeof loadingTask?.destroy === 'function') {
        await loadingTask.destroy();
      }
    } catch {
      // ignore cleanup error
    }
  }
}

function resolvePythonBinary(): string {
  const candidates = [
    process.env.PYTHON_PATH,
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python310', 'python.exe'),
    'python',
    'python3',
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (path.isAbsolute(c) && fs.existsSync(c)) {
      return c;
    }
  }
  return 'python';
}

/**
 * Computes the exact tight vector/raster ink bounding box (drawing border extent) of a PDF page
 * using PyMuPDF (100% offline, native Python vector inspection, zero Ghostscript dependency).
 * Trims blank outer margins while preserving a clean margin border.
 */
export async function getPdfPageContentBounds(
  pdfPath: string,
  pageNumber = 1
): Promise<PdfContentBounds> {
  const safePage = Math.max(1, Math.floor(pageNumber));

  // 1. High-fidelity PyMuPDF ink bounds calculation (fast, accurate, no Ghostscript dependency)
  try {
    const pythonBin = resolvePythonBinary();
    const workerScript = path.join(__dirname, 'pdfOcrWorker.py');
    const { stdout } = await execFileAsync(
      pythonBin,
      [workerScript, pdfPath, String(safePage), '--bounds'],
      { timeout: 10000, maxBuffer: 1024 * 1024 }
    );
    const parsed = JSON.parse(stdout.trim());
    if (
      parsed &&
      typeof parsed.llx === 'number' &&
      typeof parsed.urx === 'number' &&
      typeof parsed.pageWidth === 'number' &&
      typeof parsed.pageHeight === 'number'
    ) {
      const pageWidth = Math.max(1, parsed.pageWidth);
      const pageHeight = Math.max(1, parsed.pageHeight);
      const llx = Math.max(0, parsed.llx);
      const lly = Math.max(0, parsed.lly);
      const urx = Math.min(pageWidth, parsed.urx);
      const ury = Math.min(pageHeight, parsed.ury);

      const cropWidth = Math.max(10, urx - llx);
      const cropHeight = Math.max(10, ury - lly);
      const cropX = llx;
      const cropY = Math.max(0, pageHeight - ury);
      const trimmedRatio = 1 - (cropWidth * cropHeight) / Math.max(1, pageWidth * pageHeight);

      return {
        pageNumber: safePage,
        pageWidth,
        pageHeight,
        llx,
        lly,
        urx,
        ury,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        trimmedRatio: Math.max(0, Math.min(1, trimmedRatio)),
      };
    }
  } catch {
    // If Python worker is temporarily unavailable, fall back cleanly to native PDF dimensions via pdfjs
  }

  // 2. Clean fallback to native PDF page dimensions via pdfjs-dist
  const meta = await getPdfPageDimensions(pdfPath, safePage);
  const pageWidth = Math.max(1, meta.pageWidth);
  const pageHeight = Math.max(1, meta.pageHeight);

  return {
    pageNumber: safePage,
    pageWidth,
    pageHeight,
    llx: 0,
    lly: 0,
    urx: pageWidth,
    ury: pageHeight,
    cropX: 0,
    cropY: 0,
    cropWidth: pageWidth,
    cropHeight: pageHeight,
    trimmedRatio: 0,
  };
}

export async function extractPdfPageAsCadDocument(
  pdfPath: string,
  pageNumber = 1
): Promise<PdfCadExtractionResult> {
  const safePage = Math.max(1, Math.floor(pageNumber));

  // 1. High-fidelity PyMuPDF + OCR engine (handles scanned bitmaps, SHX stroked vector text, ink bounds & TOC tables)
  const tempOut = path.join(
    os.tmpdir(),
    `ocr_out_${Date.now()}_${Math.random().toString(36).slice(2)}.json`
  );
  try {
    const workerScript = path.join(__dirname, 'pdfOcrWorker.py');
    const pythonBin = resolvePythonBinary();
    await execFileAsync(pythonBin, [workerScript, pdfPath, String(safePage), tempOut], {
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (fs.existsSync(tempOut)) {
      const raw = fs.readFileSync(tempOut, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.cadData && (parsed.textCount > 0 || parsed.isToc)) {
        return parsed as PdfCadExtractionResult;
      }
    }
  } catch (workerErr) {
    console.warn('[pdfOcrWorker fallback to pdfjs]', (workerErr as Error).message);
  } finally {
    if (fs.existsSync(tempOut)) {
      try {
        fs.unlinkSync(tempOut);
      } catch { }
    }
  }

  const bounds = await getPdfPageContentBounds(pdfPath, safePage);

  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await loadingTask.promise;

  try {
    const pageIdx = Math.max(1, Math.min(safePage, doc.numPages));
    const page = await doc.getPage(pageIdx);
    const vp = page.getViewport({ scale: 1 });
    const [tc, opList] = await Promise.all([page.getTextContent(), page.getOperatorList()]);

    const entities: CadEntity[] = [];
    const textAnnotations: CadDocumentData['textAnnotations'] = [];
    let seq = 1;

    // 1. Extract all native PDF vector text annotations with spatial coordinates
    for (const raw of tc.items || []) {
      const s = typeof raw.str === 'string' ? raw.str.trim() : '';
      if (!s) continue;
      const tr = Array.isArray(raw.transform) ? raw.transform : [1, 0, 0, 1, 0, 0];
      const x = Math.round(tr[4] * 100) / 100;
      const y = Math.round(tr[5] * 100) / 100;
      const height = Math.max(1, Math.round(Math.hypot(tr[2], tr[3]) * 100) / 100);
      const id = `pdf_txt_${seq++}`;

      textAnnotations.push({
        id,
        text: s,
        x,
        y,
        layer: 'PDF_TEXT',
        height,
      });
      entities.push({
        id,
        type: 'TEXT',
        layer: 'PDF_TEXT',
        color: '#0f172a',
        center: { x, y },
        text: s,
        height,
      });
    }

    // 2. Parse native PDF vector paths (constructPath) while maintaining CTM & stroke/fill colors
    const OPS = pdfjs.OPS || {};
    const fillOps = new Set<number>([
      OPS.fill,
      OPS.eoFill,
      OPS.fillStroke,
      OPS.eoFillStroke,
      OPS.closeFillStroke,
      OPS.closeEOFillStroke,
    ]);

    let ctm: Matrix6 = [1, 0, 0, 1, 0, 0];
    let strokeColor = '#0f172a';
    let fillColor = '#0f172a';
    const stateStack: Array<{ ctm: Matrix6; strokeColor: string; fillColor: string }> = [];
    let vectorPathCount = 0;

    const fnArray: number[] = opList?.fnArray || [];
    const argsArray: any[] = opList?.argsArray || [];

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const args = argsArray[i];

      if (fn === OPS.save) {
        stateStack.push({ ctm: [...ctm] as Matrix6, strokeColor, fillColor });
      } else if (fn === OPS.restore) {
        const prev = stateStack.pop();
        if (prev) {
          ctm = prev.ctm;
          strokeColor = prev.strokeColor;
          fillColor = prev.fillColor;
        }
      } else if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
        ctm = multiplyMatrix(ctm, [
          Number(args[0]) || 0,
          Number(args[1]) || 0,
          Number(args[2]) || 0,
          Number(args[3]) || 0,
          Number(args[4]) || 0,
          Number(args[5]) || 0,
        ]);
      } else if (fn === OPS.setStrokeRGBColor) {
        strokeColor = parseRgbArgsToHex(args);
      } else if (fn === OPS.setFillRGBColor) {
        fillColor = parseRgbArgsToHex(args);
      } else if (fn === OPS.constructPath && Array.isArray(args)) {
        // pdfjs-dist v6 format: args = [drawOp, [Float32Array], minMax]
        const drawOp = typeof args[0] === 'number' ? args[0] : OPS.stroke;
        const isFilled = fillOps.has(drawOp);
        const color = isFilled ? fillColor : strokeColor;
        const packed = Array.isArray(args[1]) ? args[1][0] : args[1];

        if (packed && typeof packed.length === 'number') {
          let subPts: CadPoint[] = [];
          let closed = false;

          const flushSubpath = () => {
            if (subPts.length < 2) {
              subPts = [];
              closed = false;
              return;
            }
            vectorPathCount++;
            const id = `pdf_vec_${seq++}`;
            if (subPts.length === 2 && !closed) {
              entities.push({
                id,
                type: 'LINE',
                layer: 'PDF_VECTOR',
                color,
                points: subPts,
              });
            } else if (isFilled && subPts.length >= 3) {
              entities.push({
                id,
                type: 'SOLID',
                layer: 'PDF_VECTOR',
                color,
                points: subPts,
                closed: true,
                solidFill: true,
              });
            } else {
              entities.push({
                id,
                type: 'LWPOLYLINE',
                layer: 'PDF_VECTOR',
                color,
                points: subPts,
                closed,
              });
            }
            subPts = [];
            closed = false;
          };

          let idx = 0;
          while (idx < packed.length) {
            const cmd = packed[idx++];
            if (cmd === 0) {
              // moveTo(x, y)
              flushSubpath();
              const x = packed[idx++];
              const y = packed[idx++];
              if (Number.isFinite(x) && Number.isFinite(y)) {
                subPts.push(applyMatrix(ctm, x, y));
              }
            } else if (cmd === 1) {
              // lineTo(x, y)
              const x = packed[idx++];
              const y = packed[idx++];
              if (Number.isFinite(x) && Number.isFinite(y)) {
                subPts.push(applyMatrix(ctm, x, y));
              }
            } else if (cmd === 2) {
              // curveTo(cp1x, cp1y, cp2x, cp2y, x, y)
              const cp1x = packed[idx++];
              const cp1y = packed[idx++];
              const cp2x = packed[idx++];
              const cp2y = packed[idx++];
              const x = packed[idx++];
              const y = packed[idx++];
              if (subPts.length > 0 && Number.isFinite(x) && Number.isFinite(y)) {
                const p0 = subPts[subPts.length - 1];
                const p1 = applyMatrix(ctm, cp1x, cp1y);
                const p2 = applyMatrix(ctm, cp2x, cp2y);
                const p3 = applyMatrix(ctm, x, y);
                subPts.push(...sampleCubicBezier(p0, p1, p2, p3, 4));
              }
            } else if (cmd === 3) {
              // quadraticCurveTo(cpx, cpy, x, y)
              const cpx = packed[idx++];
              const cpy = packed[idx++];
              const x = packed[idx++];
              const y = packed[idx++];
              if (subPts.length > 0 && Number.isFinite(x) && Number.isFinite(y)) {
                const p0 = subPts[subPts.length - 1];
                const pc = applyMatrix(ctm, cpx, cpy);
                const p3 = applyMatrix(ctm, x, y);
                subPts.push(
                  { x: Math.round(((p0.x + 2 * pc.x + p3.x) / 4) * 100) / 100, y: Math.round(((p0.y + 2 * pc.y + p3.y) / 4) * 100) / 100 },
                  p3
                );
              }
            } else if (cmd === 4) {
              // closePath
              closed = true;
              flushSubpath();
            } else {
              break;
            }
          }
          flushSubpath();
        }
      }
    }

    const minX = bounds.llx;
    const minY = bounds.lly;
    const maxX = Math.max(bounds.llx + 10, bounds.urx || vp.width);
    const maxY = Math.max(bounds.lly + 10, bounds.ury || vp.height);

    const cadData: CadDocumentData = {
      format: 'DXF',
      cadVersion: `PDF Vector Page ${pageIdx}`,
      units: 'pt',
      bounds: {
        minX,
        minY,
        maxX,
        maxY,
        width: Math.max(10, maxX - minX),
        height: Math.max(10, maxY - minY),
      },
      layers: [
        { name: 'PDF_VECTOR', color: '#0f172a', visible: true, entityCount: vectorPathCount },
        { name: 'PDF_TEXT', color: '#0f172a', visible: true, entityCount: textAnnotations.length },
      ],
      layouts: [{ name: `Page ${pageIdx}`, entityCount: entities.length }],
      entities,
      textAnnotations,
      blockNames: [],
      totalEntityCount: entities.length,
      parseWarnings: [],
    };

    return {
      cadData,
      bounds,
      textCount: textAnnotations.length,
      vectorPathCount,
    };
  } finally {
    try {
      if (typeof doc?.destroy === 'function') {
        await doc.destroy();
      } else if (typeof loadingTask?.destroy === 'function') {
        await loadingTask.destroy();
      }
    } catch {
      // ignore cleanup error
    }
  }
}
