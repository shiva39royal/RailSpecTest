import fs from 'fs';
import {
  CadDocumentData,
  ComponentRelationship,
  DocumentMetadata,
  ExtractedComponent,
  ExtractionSettings,
  KavachTableId,
  TableRowRecord,
  UploadedDrawing,
  ValidationIssue,
} from '../src/types/project';
import {
  KAVACH_SPEC_TABLES,
  createEmptyMetadata,
  createEmptyTables,
} from '../src/spec/kavachSpecSchema';
import {
  assignGroupedTable1Sno,
  classifySignalByStrictRules,
  deriveMovementAuthorityFromExitAspect,
  isCellEmpty,
  normalizeComponentByPrefix,
  parseRfidSequence,
  recalculateDependentTables,
  validateKavachDataset,
} from '../src/engine/kavachEngine';
import { parseDwgBuffer, parseDxfBuffer } from './cadParser';
import {
  extractComponentsFromCad,
  type DeterministicCadExtraction,
} from './cadComponentExtractor';
import { extractPdfPageAsCadDocument, getPdfPageMetadata } from './pdfProcessor';

export interface ExtractionRequestPayload {
  drawing: UploadedDrawing;
  filePath: string;
  companionDrawings?: Array<{ drawing: UploadedDrawing; filePath: string }>;
  pageNumber?: number;
  pageRange?: string;
  settings: ExtractionSettings;
}

export interface ExtractionResultPayload {
  extractionSummary: string;
  missingCompanionInfo: string[];
  metadata: DocumentMetadata;
  components: ExtractedComponent[];
  relationships: ComponentRelationship[];
  tables: Record<KavachTableId, TableRowRecord[]>;
  validationIssues: ValidationIssue[];
}

function parseTargetPageNumber(pageNumber?: number, pageRange?: string): number {
  if (typeof pageNumber === 'number' && Number.isFinite(pageNumber) && pageNumber >= 1) {
    return Math.floor(pageNumber);
  }
  if (pageRange) {
    const m = pageRange.match(/(\d+)/);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n >= 1) return n;
    }
  }
  return 1;
}

function clusterTable1RowsByRoute(rows: TableRowRecord[]): TableRowRecord[] {
  const buckets = new Map<string, TableRowRecord[]>();
  const order: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const entry = (row.cells.entrySignal || '').trim().toUpperCase();
    const exit = (row.cells.exitSignal || '').trim().toUpperCase();
    const sec = (row.cells.sectionType || '').trim().toUpperCase();
    const line = (row.cells.line || '').trim().toUpperCase();
    const sigType = (row.cells.signalType || '').trim().toUpperCase();
    const key = entry && exit ? `${entry}||${exit}||${sec}||${line}||${sigType}` : `__row_${i}`;

    let list = buckets.get(key);
    if (!list) {
      list = [];
      buckets.set(key, list);
      order.push(key);
    }
    list.push(row);
  }

  const clustered: TableRowRecord[] = [];
  for (const key of order) {
    clustered.push(...(buckets.get(key) || []));
  }
  return clustered;
}

function stripDisallowedTins(rawTins: string, disallowed: Set<string>): string {
  if (!rawTins || rawTins.trim() === '-' || disallowed.size === 0) return rawTins;
  const kept = rawTins
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter((tok) => tok && tok !== '-' && !disallowed.has(tok.toUpperCase()));
  return kept.length > 0 ? kept.join(', ') : '-';
}

function sanitizeExtractedTables(
  tables: Record<KavachTableId, TableRowRecord[]>
): Record<KavachTableId, TableRowRecord[]> {
  const blockSectionTins = new Set<string>();
  for (const row of tables.table2_block_section) {
    const tin = (row.cells.blockSectionTin || '').trim().toUpperCase();
    if (tin && tin !== '-') blockSectionTins.add(tin);
  }

  // Expand compound aspectExit entries (e.g. "Green / Double Yellow") into individual aspect rows
  // and derive Movement Authority (Exit Green -> 4, Double Yellow -> 3, Yellow -> 2, Red/Nil/Blank/- -> 1)
  const expandedT1: TableRowRecord[] = [];
  for (const row of tables.table1_control) {
    const rawExit = (row.cells.aspectExit || '').trim();
    if (rawExit.includes('/')) {
      const parts = rawExit.split('/').map((p) => p.trim()).filter(Boolean);
      parts.forEach((part, subIdx) => {
        const nextMa = deriveMovementAuthorityFromExitAspect(part);
        const nextCells: Record<string, string> = {
          ...row.cells,
          aspectExit: part,
          movementAuthority: nextMa,
        };
        const nextMeta = { ...row.cellMeta };
        nextMeta.aspectExit = {
          source: 'calculated',
          originalValue: part,
          trace: 'Split compound aspect exit into individual aspect row',
        };
        nextMeta.movementAuthority = {
          source: 'calculated',
          originalValue: nextMa,
          trace: `Movement Authority ${nextMa} derived from Exit Aspect "${part}"`,
        };
        expandedT1.push({
          ...row,
          rowId: `${row.rowId}_asp${subIdx}`,
          cells: nextCells,
          cellMeta: nextMeta,
        });
      });
    } else {
      const nextMa = deriveMovementAuthorityFromExitAspect(rawExit);
      const nextCells: Record<string, string> = {
        ...row.cells,
        movementAuthority: nextMa,
      };
      const nextMeta = { ...row.cellMeta };
      nextMeta.movementAuthority = {
        source: 'calculated',
        originalValue: nextMa,
        trace: `Movement Authority ${nextMa} derived from Exit Aspect "${rawExit || 'Nil'}"`,
      };
      expandedT1.push({
        ...row,
        cells: nextCells,
        cellMeta: nextMeta,
      });
    }
  }

  const signalFootTagMap = new Map<string, string>();
  const strictNormalizedT1 = expandedT1.map((row) => {
    const entryRaw = (row.cells.entrySignal || '').trim();
    const nextCells = { ...row.cells };
    const nextMeta = { ...row.cellMeta };

    if (entryRaw) {
      const strict = classifySignalByStrictRules(
        entryRaw,
        nextCells.line,
        nextCells.signalType
      );
      nextCells.sectionType = strict.sectionType;
      nextMeta.sectionType = {
        source: 'calculated',
        originalValue: strict.sectionType,
        trace: `Strict rule: ${strict.sectionType}`,
      };
      nextCells.signalType = strict.signalType;
      nextMeta.signalType = {
        source: 'calculated',
        originalValue: strict.signalType,
        trace: `Strict rule: ${strict.signalType}`,
      };
    }

    return { ...row, cells: nextCells, cellMeta: nextMeta };
  });

  const clusteredT1 = clusterTable1RowsByRoute(strictNormalizedT1).map((row) => {
    const entry = (row.cells.entrySignal || '').trim().toUpperCase();
    const footTag = (row.cells.entryFootTag || '').trim().toUpperCase();
    if (entry && footTag) signalFootTagMap.set(entry, footTag);

    const sigType = (row.cells.signalType || '').toLowerCase();
    const isCallingOn = sigType.includes('calling');
    const nextCells = { ...row.cells };
    const nextMeta = { ...row.cellMeta };

    if (isCallingOn) {
      if (nextCells.tinsFree && nextCells.tinsFree !== '-') {
        nextCells.tinsFree = '-';
        nextMeta.tinsFree = {
          source: 'calculated',
          trace: 'Calling-On signals do not prove TINs per Cl. I.2.11.12',
        };
      }
    } else if (blockSectionTins.size > 0 && nextCells.tinsFree && nextCells.tinsFree !== '-') {
      const cleaned = stripDisallowedTins(nextCells.tinsFree, blockSectionTins);
      if (cleaned !== nextCells.tinsFree) {
        nextCells.tinsFree = cleaned;
        nextMeta.tinsFree = {
          source: 'calculated',
          trace: 'Excluded Block Section TIN per Cl. I.2.11.12',
        };
      }
    }

    return { ...row, cells: nextCells, cellMeta: nextMeta };
  });

  const sanitizedT6 = tables.table6_tsl_control.map((row) => {
    const nextCells = { ...row.cells };
    const nextMeta = { ...row.cellMeta };

    const aspectEntry = (nextCells.aspectEntry || '').trim();
    if (aspectEntry && !/^(red\/blank|blank)$/i.test(aspectEntry)) {
      nextCells.aspectEntry = /^blank$/i.test(aspectEntry) ? 'Blank' : 'Red/Blank';
      nextMeta.aspectEntry = {
        source: 'calculated',
        trace: 'Enforced RDSO TSL Entry Signal aspect per Cl. I.2.12.10',
      };
    }

    const exit = (nextCells.tslExitSignal || '').trim().toUpperCase();
    const exitFootTag = signalFootTagMap.get(exit);
    if (exitFootTag && nextCells.enRouteTags) {
      const links = parseRfidSequence(nextCells.enRouteTags);
      if (links.some((l) => l.tagId.toUpperCase() === exitFootTag)) {
        const filtered = links.filter((l) => l.tagId.toUpperCase() !== exitFootTag);
        nextCells.enRouteTags =
          filtered.length > 0
            ? filtered.map((l) => `(${l.distance}, ${l.tagId})`).join(', ')
            : '-';
        nextMeta.enRouteTags = {
          source: 'calculated',
          trace: `Excluded Exit Signal foot tag (${exitFootTag}) per Cl. I.2.12.16`,
        };
      }
    }

    if (blockSectionTins.size > 0 && nextCells.tinsFree && nextCells.tinsFree !== '-') {
      const cleaned = stripDisallowedTins(nextCells.tinsFree, blockSectionTins);
      if (cleaned !== nextCells.tinsFree) {
        nextCells.tinsFree = cleaned;
        nextMeta.tinsFree = {
          source: 'calculated',
          trace: 'Excluded Block Section TIN per Cl. I.2.12.14',
        };
      }
    }

    return { ...row, cells: nextCells, cellMeta: nextMeta };
  });

  return {
    ...tables,
    table1_control: assignGroupedTable1Sno(clusteredT1),
    table6_tsl_control: sanitizedT6,
  };
}

async function resolveCadDocumentOffline(
  drawing: UploadedDrawing,
  filePath: string,
  targetPage: number
): Promise<{
  cadData: CadDocumentData;
  sourceLabel: string;
  vectorSummary: string;
  isToc?: boolean;
  tocMetadata?: Partial<DocumentMetadata>;
  tocTables?: Record<KavachTableId, TableRowRecord[]>;
}> {
  if (drawing.format === 'PDF') {
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(
        `PDF file "${drawing.fileName}" is no longer available on disk. Please re-upload the drawing.`
      );
    }
    const pdfResult = await extractPdfPageAsCadDocument(filePath, targetPage);
    if (pdfResult.textCount === 0 && !pdfResult.isToc) {
      throw new Error(
        `Page ${targetPage} of "${drawing.fileName}" is a scanned/rasterized image with 0 embedded vector text annotations. Offline extraction parses native vector geometry and text directly (no external AI or OCR required). Please upload a vector DWG, DXF, or vector-based PDF layout sheet (e.g., Page 15 of the RDSO Reference Spec PDF).`
      );
    }
    return {
      cadData: pdfResult.cadData,
      sourceLabel: `${drawing.fileName} (Page ${targetPage})`,
      vectorSummary: `${pdfResult.textCount} native PDF text items & ${pdfResult.vectorPathCount} vector primitives`,
      isToc: Boolean(pdfResult.isToc),
      tocMetadata: pdfResult.tocMetadata,
      tocTables: pdfResult.tocTables,
    };
  }

  // DWG / DXF
  let cadData = drawing.cadData;
  if (!cadData && filePath && fs.existsSync(filePath)) {
    const buf = fs.readFileSync(filePath);
    cadData = drawing.format === 'DXF' ? parseDxfBuffer(buf) : await parseDwgBuffer(buf);
  }
  if (!cadData) {
    throw new Error(
      `No vector CAD data available for "${drawing.fileName}". Please re-upload the DWG or DXF file.`
    );
  }
  return {
    cadData,
    sourceLabel: drawing.fileName,
    vectorSummary: `${cadData.totalEntityCount.toLocaleString()} CAD entities, ${cadData.layers.length} layers, & ${cadData.textAnnotations.length} text annotations`,
  };
}

/**
 * Extracts optional metadata hints (Division, Section, SIP/TOC Ref, Drawing No, Speed)
 * and structured TOC table rows from attached companion sheets purely offline.
 */
async function scanCompanionHintsOffline(
  companions: Array<{ drawing: UploadedDrawing; filePath: string }>
): Promise<{
  hints: Partial<DocumentMetadata>;
  companionTables: Record<KavachTableId, TableRowRecord[]>;
}> {
  const hints: Partial<DocumentMetadata> = {};
  const companionTables: Record<KavachTableId, TableRowRecord[]> = createEmptyTables();

  for (const comp of companions) {
    let textCorpus = '';
    try {
      if (comp.drawing.format === 'PDF' && comp.filePath && fs.existsSync(comp.filePath)) {
        const pdf = await extractPdfPageAsCadDocument(comp.filePath, 1);
        textCorpus = pdf.cadData.textAnnotations.map((t) => t.text).join('\n');

        // Merge structured TOC tables from companion sheet if present
        if (pdf.tocTables) {
          for (const [tId, rows] of Object.entries(pdf.tocTables)) {
            const tableKey = tId as KavachTableId;
            if (Array.isArray(rows) && rows.length > 0 && companionTables[tableKey]) {
              companionTables[tableKey].push(...rows);
            }
          }
        }

        // Merge metadata extracted from companion TOC if present
        if (pdf.tocMetadata) {
          if (pdf.tocMetadata.stationName && !hints.stationName) hints.stationName = pdf.tocMetadata.stationName;
          if (pdf.tocMetadata.stationId && !hints.stationId) hints.stationId = pdf.tocMetadata.stationId;
          if (pdf.tocMetadata.division && !hints.division) hints.division = pdf.tocMetadata.division;
          if (pdf.tocMetadata.section && !hints.section) hints.section = pdf.tocMetadata.section;
          if (pdf.tocMetadata.sipRef && !hints.sipRef) hints.sipRef = pdf.tocMetadata.sipRef;
          if (pdf.tocMetadata.tocRef && !hints.tocRef) hints.tocRef = pdf.tocMetadata.tocRef;
        }
      } else if (comp.drawing.cadData) {
        textCorpus = comp.drawing.cadData.textAnnotations.map((t) => t.text).join('\n');
      } else if (comp.filePath && fs.existsSync(comp.filePath)) {
        const buf = fs.readFileSync(comp.filePath);
        const parsed =
          comp.drawing.format === 'DXF' ? parseDxfBuffer(buf) : await parseDwgBuffer(buf);
        textCorpus = parsed.textAnnotations.map((t) => t.text).join('\n');
      }
    } catch {
      continue;
    }

    if (!textCorpus) continue;

    if (!hints.division) {
      const m = textCorpus.match(/DIVISION\s*[:\-]\s*([A-Z0-9 .\-/]{2,40})/i);
      if (m) hints.division = m[1].trim();
    }
    if (!hints.section) {
      const m = textCorpus.match(/SECTION\s*[:\-]\s*([A-Z0-9 .\-/]{2,50})/i);
      if (m) hints.section = m[1].trim();
    }
    if (!hints.sectionSpeedKmph) {
      const m = textCorpus.match(/(?:SECTION\s*SPEED|MAX\.?\s*SPEED)\s*[:\-]?\s*(\d{2,3})\s*(?:KMPH|KM\/H)?/i);
      if (m) hints.sectionSpeedKmph = m[1];
    }
    if (!hints.drawingNo) {
      const m = textCorpus.match(/(?:DRG\.?\s*NO\.?|DRAWING\s*NO\.?)\s*[:\-]\s*([A-Z0-9._\-/]{3,40})/i);
      if (m) hints.drawingNo = m[1].trim();
    }
    if (comp.drawing.role === 'sip_toc') {
      if (!hints.sipRef) hints.sipRef = comp.drawing.fileName;
      if (!hints.tocRef) hints.tocRef = comp.drawing.fileName;
    }
  }
  return { hints, companionTables };
}

/**
 * 100% Offline Deterministic KAVACH Extraction Engine.
 * Parses native DWG, DXF, and Vector PDF geometry + spatial text locally on the server
 * with zero external AI models and zero API keys required.
 */
export async function runDynamicExtraction(
  req: ExtractionRequestPayload
): Promise<ExtractionResultPayload> {
  const targetPage = parseTargetPageNumber(req.pageNumber, req.pageRange);
  const resolvedDoc = await resolveCadDocumentOffline(
    req.drawing,
    req.filePath,
    targetPage
  );
  const { cadData, sourceLabel, vectorSummary } = resolvedDoc;

  // Run deterministic offline CAD/PDF vector extraction
  const detResult: DeterministicCadExtraction = extractComponentsFromCad(
    cadData,
    sourceLabel,
    req.settings
  );

  // Scan any attached companion sheets purely offline for supplemental metadata references and tables
  const companionData =
    req.companionDrawings && req.companionDrawings.length > 0
      ? await scanCompanionHintsOffline(req.companionDrawings)
      : { hints: {}, companionTables: createEmptyTables() };
  const companionHints = companionData.hints;
  const companionTables = companionData.companionTables;

  // Hydrate DocumentMetadata cleanly
  const emptyMeta = createEmptyMetadata();
  const hints = detResult.metadataHints || {};
  const primaryTocMeta = resolvedDoc.tocMetadata || {};
  const pdfHeaderMeta =
    req.drawing.format === 'PDF' && req.filePath && fs.existsSync(req.filePath)
      ? await getPdfPageMetadata(req.filePath, targetPage)
      : null;

  const metadata: DocumentMetadata = {
    ...emptyMeta,
    stationName: String(
      hints.stationName || primaryTocMeta.stationName || companionHints.stationName || pdfHeaderMeta?.stationName || ''
    ).trim(),
    stationCode: String(
      hints.stationCode || primaryTocMeta.stationCode || companionHints.stationCode || pdfHeaderMeta?.stationCode || ''
    ).trim(),
    stationId: String(
      hints.stationId || primaryTocMeta.stationId || companionHints.stationId || pdfHeaderMeta?.stationId || ''
    ).trim(),
    stationKm: String(
      hints.stationKm || primaryTocMeta.stationKm || companionHints.stationKm || pdfHeaderMeta?.stationKm || ''
    ).trim(),
    division: String(
      hints.division || primaryTocMeta.division || companionHints.division || pdfHeaderMeta?.division || ''
    ).trim(),
    section: String(
      hints.section || primaryTocMeta.section || companionHints.section || pdfHeaderMeta?.section || ''
    ).trim(),
    sectionSpeedKmph: String(hints.sectionSpeedKmph || companionHints.sectionSpeedKmph || '').trim(),
    versionControl: String(hints.versionControl || emptyMeta.versionControl).trim(),
    sipRef: String(hints.sipRef || primaryTocMeta.sipRef || companionHints.sipRef || '').trim(),
    tocRef: String(hints.tocRef || primaryTocMeta.tocRef || companionHints.tocRef || '').trim(),
    rfidLayoutRef: String(hints.rfidLayoutRef || sourceLabel).trim(),
    drawingNo: String(hints.drawingNo || companionHints.drawingNo || '').trim(),
    signalsOverrideNotRequiredAtZeroSpeed: String(
      hints.signalsOverrideNotRequiredAtZeroSpeed || ''
    ).trim(),
    authorizedSpeedOnDetectionInOs: String(
      hints.authorizedSpeedOnDetectionInOs || ''
    ).trim(),
    preparedBy: String(hints.preparedBy || '').trim(),
    checkedBy: String(hints.checkedBy || '').trim(),
    revisions: [
      {
        revNo: '0',
        description: `Initial offline deterministic extraction from ${sourceLabel}`,
        date: new Date().toISOString().slice(0, 10),
      },
    ],
  };

  if (metadata.stationCode && !metadata.tableDocNo) {
    metadata.tableDocNo = `${metadata.stationCode}-KAVACH-CT-01`;
  }

  // Combine tables deterministically:
  // Use verified companion TOC tables when available for Table 1, Table 4, Table 6, Table 7,
  // while retaining CAD-generated rows for Tables 2, 3, 5, 6B or whenever companion table is empty.
  const baseTables: Record<KavachTableId, TableRowRecord[]> = createEmptyTables();
  const primaryTocTables = resolvedDoc.tocTables;

  for (const t of KAVACH_SPEC_TABLES) {
    const cadRows = detResult.tables[t.id] || [];
    const compRows = companionTables[t.id] || [];
    const directTocRows = primaryTocTables?.[t.id] || [];

    if (compRows.length > 0) {
      baseTables[t.id] = compRows;
    } else if (cadRows.length > 0) {
      baseTables[t.id] = cadRows;
    } else if (directTocRows.length > 0) {
      baseTables[t.id] = directTocRows;
    } else {
      baseTables[t.id] = [];
    }
  }

  // Normalize component classifications strictly by RDSO prefixes
  const componentsMap = new Map<string, ExtractedComponent>();
  for (const c of detResult.components || []) {
    const norm = normalizeComponentByPrefix(c);
    componentsMap.set(norm.label.toUpperCase(), norm);
  }

  // Ensure any signals mentioned in the active Table 1 exist in components list
  for (const row of baseTables.table1_control) {
    const entrySig = (row.cells.entrySignal || '').trim();
    const exitSig = (row.cells.exitSignal || '').trim();
    const footTag = (row.cells.entryFootTag || '').trim();
    if (entrySig && !componentsMap.has(entrySig.toUpperCase())) {
      componentsMap.set(entrySig.toUpperCase(), {
        id: `sig_toc_${componentsMap.size + 1}`,
        label: entrySig,
        category: 'signal',
        subType: (row.cells.signalType || 'Signal').trim(),
        direction: 'Unknown',
        layer: 'TOC_VERIFIED',
        properties: {},
        relatedIds: [],
        confidence: 1.0,
        sourceTrace: 'Verified from Table of Control companion sheet',
      });
    }
    if (exitSig && exitSig !== '-' && !componentsMap.has(exitSig.toUpperCase())) {
      componentsMap.set(exitSig.toUpperCase(), {
        id: `sig_toc_${componentsMap.size + 1}`,
        label: exitSig,
        category: 'signal',
        subType: 'Signal',
        direction: 'Unknown',
        layer: 'TOC_VERIFIED',
        properties: {},
        relatedIds: [],
        confidence: 1.0,
        sourceTrace: 'Verified from Table of Control companion sheet',
      });
    }
    if (footTag && footTag !== '-' && !componentsMap.has(footTag.toUpperCase())) {
      componentsMap.set(footTag.toUpperCase(), {
        id: `rfid_toc_${componentsMap.size + 1}`,
        label: footTag,
        category: 'rfid_tag',
        subType: 'Signal Foot Tag (S)',
        direction: 'Unknown',
        layer: 'TOC_VERIFIED',
        properties: {},
        relatedIds: [],
        confidence: 1.0,
        sourceTrace: 'Verified from Table of Control companion sheet',
      });
    }
  }

  const components: ExtractedComponent[] = Array.from(componentsMap.values());
  const relationships: ComponentRelationship[] = [...(detResult.relationships || [])];

  // If CAD generated 0 relationships but Table 1 has routes, create signal_route relationships from Table 1!
  if (relationships.filter((r) => r.type === 'signal_route').length === 0 && baseTables.table1_control.length > 0) {
    const seenRelKeys = new Set<string>();
    let relIdSeq = relationships.length + 1;
    for (const row of baseTables.table1_control) {
      const entry = (row.cells.entrySignal || '').trim();
      const exit = (row.cells.exitSignal || '').trim();
      if (!entry || !exit || exit === '-') continue;
      const key = `${entry.toUpperCase()}->${exit.toUpperCase()}`;
      if (seenRelKeys.has(key)) continue;
      seenRelKeys.add(key);

      const entryComp = componentsMap.get(entry.toUpperCase());
      const exitComp = componentsMap.get(exit.toUpperCase());
      relationships.push({
        id: `rel_t1_${relIdSeq++}`,
        type: 'signal_route',
        fromId: entryComp?.id || `sig_${entry}`,
        fromLabel: entry,
        toId: exitComp?.id || `sig_${exit}`,
        toLabel: exit,
        description: `Route ${entry} → ${exit} on ${row.cells.line || 'Track'}${row.cells.distanceMeters ? ` (${row.cells.distanceMeters}m)` : ''}: Tags [${row.cells.enRouteTags || '-'}]`,
      });
    }
  }

  // Enforce strict RDSO invariants, recalculations, and audit validation offline
  const sanitizedTables = sanitizeExtractedTables(baseTables);
  const calculatedTables = recalculateDependentTables(sanitizedTables, req.settings, metadata);
  const validationIssues = validateKavachDataset(metadata, calculatedTables, req.settings);

  const signalCount = components.filter((c) => c.category === 'signal').length;
  const tagCount = components.filter((c) => c.category === 'rfid_tag').length;
  const pointCount = components.filter((c) => c.category === 'point').length;
  const tinCount = components.filter((c) => c.category === 'tin').length;
  const totalTableRows = KAVACH_SPEC_TABLES.reduce(
    (sum, t) => sum + (calculatedTables[t.id]?.length || 0),
    0
  );

  const stationLabel = metadata.stationName
    ? `${metadata.stationName}${metadata.stationId ? ` (ID ${metadata.stationId})` : ''}`
    : sourceLabel;

  const extractionSummary =
    `Offline deterministic extraction completed for ${stationLabel} from ${vectorSummary}. ` +
    `Detected ${components.length} components (${signalCount} signals, ${tagCount} RFID tags, ${pointCount} points, ${tinCount} TINs), ` +
    `mapped ${relationships.length} forward/reverse signal routes, and generated ${totalTableRows} rows across all RDSO KAVACH tables.`;

  return {
    extractionSummary,
    missingCompanionInfo: detResult.missingCompanionInfo || [],
    metadata,
    components,
    relationships,
    tables: calculatedTables,
    validationIssues,
  };
}
