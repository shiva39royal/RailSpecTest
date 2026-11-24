import {
  DocumentMetadata,
  ExtractedComponent,
  ExtractionSettings,
  KavachTableId,
  TableRowRecord,
  ValidationIssue,
} from '../types/project';
import { KAVACH_SPEC_TABLES, KAVACH_TABLE_MAP } from '../spec/kavachSpecSchema';

export function stripSignalQualifier(raw: string): string {
  return String(raw || '')
    .replace(/\([^)]*\)/g, '')
    .trim();
}

export function isLoopLineName(line?: string): boolean {
  return /\bLOOP\b/i.test(String(line || ''));
}

export interface StrictSignalClassification {
  startsWithS: boolean;
  kind: 'inner_distant' | 'distant' | 'calling_on' | 'shunt' | 'other';
  sectionType: 'Absolute Block' | 'Station Section';
  signalType: string;
  isLoopLine: boolean;
}

/**
 * Applies the strict signalling rules:
 * - Signals start with "S"
 * - Ends with "ID" (checked before "D") -> Inner Distant, Absolute Block
 * - Ends with "D" -> Distant, Absolute Block
 * - Ends with "A" -> Calling-on, Station Section
 * - All remaining signals -> Station Section; Loop lines -> Starter / Adv Starter; Main line -> Home Signal
 */
export function classifySignalByStrictRules(
  entrySignal: string,
  line?: string,
  existingSignalType?: string
): StrictSignalClassification {
  const base = stripSignalQualifier(entrySignal).toUpperCase();
  const loopLine = isLoopLineName(line);
  const startsWithS = /^S[A-Z0-9/-]*/i.test(base);

  if (/^SH[\s-]?\d+/i.test(base)) {
    return {
      startsWithS: false,
      kind: 'shunt',
      sectionType: 'Station Section',
      signalType: 'Shunt',
      isLoopLine: loopLine,
    };
  }

  // Check "ID" BEFORE "D"
  if (/ID$/i.test(base) || /\/ID\d*$/i.test(base)) {
    return {
      startsWithS,
      kind: 'inner_distant',
      sectionType: 'Absolute Block',
      signalType: 'Inner Distant',
      isLoopLine: loopLine,
    };
  }

  if (/D$/i.test(base) || /\/D\d*$/i.test(base)) {
    return {
      startsWithS,
      kind: 'distant',
      sectionType: 'Absolute Block',
      signalType: 'Distant',
      isLoopLine: loopLine,
    };
  }

  if (/A$/i.test(base) || /^C[-]?\d+[A-Z]?$/i.test(base)) {
    return {
      startsWithS,
      kind: 'calling_on',
      sectionType: 'Station Section',
      signalType: 'Calling-on',
      isLoopLine: loopLine,
    };
  }

  if (loopLine) {
    const existingUpper = String(existingSignalType || '').trim().toUpperCase();
    const isAdv = existingUpper === 'ADV STARTER' || existingUpper === 'ADVANCE STARTER' || existingUpper === 'ADV. STARTER';
    return {
      startsWithS,
      kind: 'other',
      sectionType: 'Station Section',
      signalType: isAdv ? 'Adv Starter' : 'Starter',
      isLoopLine: true,
    };
  }

  return {
    startsWithS,
    kind: 'other',
    sectionType: 'Station Section',
    signalType: 'Home Signal',
    isLoopLine: false,
  };
}

export function getSignalTypeChoicesForRow(entrySignal: string, line?: string): string[] {
  const cls = classifySignalByStrictRules(entrySignal, line);
  if (cls.kind === 'other' && cls.isLoopLine) {
    return ['Starter', 'Adv Starter'];
  }
  return ['Home Signal', 'Distant', 'Inner Distant', 'Calling-on', 'Starter', 'Adv Starter'];
}

/**
 * Enforces strict component prefix rules:
 * - Starts with "R-" -> rfid_tag (RFID Tags)
 * - Starts with "P-" -> point (Pointers / Points)
 */
export function normalizeComponentByPrefix(comp: ExtractedComponent): ExtractedComponent {
  const lbl = String(comp.label || '').trim();
  const upper = lbl.toUpperCase();
  if (/^R[-]?\d{2,4}/i.test(upper)) {
    return {
      ...comp,
      category: 'rfid_tag',
      subType: comp.subType && !/infrastructure/i.test(comp.subType) ? comp.subType : 'RFID Tag',
    };
  }
  if (/^(?:P-|PT|POINT|[I|]?N-?\d+)/i.test(upper)) {
    return {
      ...comp,
      category: 'point',
      subType: comp.subType && !/infrastructure/i.test(comp.subType) ? comp.subType : 'Pointer (Point)',
    };
  }
  if (/^(?:S|SH|GS|C|IB)\d+/i.test(upper)) {
    return {
      ...comp,
      category: 'signal',
      subType: comp.subType && !/infrastructure/i.test(comp.subType) ? comp.subType : 'Signal',
    };
  }
  if (/^(?:\d+[A-Z]?T|\d+AC|DP[-\s]?\d+)/i.test(upper)) {
    return {
      ...comp,
      category: 'track_circuit',
      subType: comp.subType && !/infrastructure/i.test(comp.subType) ? comp.subType : 'Track Circuit',
    };
  }
  if (/^LC/i.test(upper)) {
    return {
      ...comp,
      category: 'lc_gate',
      subType: comp.subType && !/infrastructure/i.test(comp.subType) ? comp.subType : 'Level Crossing Gate',
    };
  }
  return comp;
}

export interface ParsedTagLink {
  distance: number;
  tagId: string;
}

export interface ParsedGradientSegment {
  direction: 'R' | 'F' | 'LEVEL';
  slope: number; // denominator g in "1 in g" (0 for LEVEL)
  length: number;
}

export interface ParsedPsrTuple {
  type: string;
  speed: number;
  length: number;
}

export const TABLE1_COMMON_MERGE_KEYS = [
  'sNo',
  'entrySignal',
  'exitSignal',
  'sectionType',
  'line',
  'signalType',
] as const;

export const TABLE1_COMMON_MERGE_KEY_SET = new Set<string>(TABLE1_COMMON_MERGE_KEYS);

/**
 * RDSO Movement Authority calculation from Exit Signal Aspect:
 * - Exit Green -> MA = 4
 * - Exit Double Yellow -> MA = 3
 * - Exit Yellow -> MA = 2
 * - Exit Blank / - / Red / Nil -> MA = 1
 */
export function deriveMovementAuthorityFromExitAspect(exitAspect: string | undefined): string {
  const norm = (exitAspect || '').trim().toLowerCase();
  if (norm.includes('green')) return '4';
  if (norm.includes('double yellow')) return '3';
  if (norm.includes('yellow')) return '2';
  return '1';
}

export interface Table1MergeGroupInfo {
  isGroupStart: boolean;
  rowSpan: number;
  groupIndex: number;
  groupRowIds: string[];
}

function table1GroupSignature(row: TableRowRecord): string | null {
  const entry = (row.cells.entrySignal || '').trim().toUpperCase();
  const exit = (row.cells.exitSignal || '').trim().toUpperCase();
  if (!entry || !exit) return null;
  const sec = (row.cells.sectionType || '').trim().toUpperCase();
  const line = (row.cells.line || '').trim().toUpperCase();
  const sigType = (row.cells.signalType || '').trim().toUpperCase();
  return `${entry}||${exit}||${sec}||${line}||${sigType}`;
}

/**
 * Computes consecutive route groups for Table 1 (merging S. No., Entry Signal,
 * Exit Signal, Section Type, Line, and Signal Type when identical across consecutive aspect rows).
 */
export function getTable1MergeGroups(rows: TableRowRecord[]): Table1MergeGroupInfo[] {
  const result: Table1MergeGroupInfo[] = new Array(rows.length);
  let i = 0;
  let groupIndex = 0;

  while (i < rows.length) {
    const sig = table1GroupSignature(rows[i]);
    let span = 1;
    if (sig !== null) {
      while (i + span < rows.length && table1GroupSignature(rows[i + span]) === sig) {
        span++;
      }
    }
    const groupRowIds = rows.slice(i, i + span).map((r) => r.rowId);
    for (let k = 0; k < span; k++) {
      result[i + k] = {
        isGroupStart: k === 0,
        rowSpan: k === 0 ? span : 0,
        groupIndex,
        groupRowIds,
      };
    }
    groupIndex++;
    i += span;
  }

  return result;
}

/**
 * Assigns a single shared sequential S. No. per consecutive route group in Table 1,
 * reducing total S. No. count to match unique routes rather than aspect rows.
 */
export function assignGroupedTable1Sno(rows: TableRowRecord[]): TableRowRecord[] {
  const groups = getTable1MergeGroups(rows);
  return rows.map((row, idx) => {
    if (row.cellMeta.sNo?.source === 'manual') return row;
    const targetSno = String(groups[idx].groupIndex + 1);
    if (row.cells.sNo === targetSno) return row;
    return {
      ...row,
      cells: { ...row.cells, sNo: targetSno },
      cellMeta: {
        ...row.cellMeta,
        sNo: {
          source: 'calculated',
          originalValue: targetSno,
          trace: 'Grouped route S. No. across identical Entry/Exit/Section/Line/SignalType',
        },
      },
    };
  });
}

const TABLE1_WITHIN_GROUP_MERGE_KEYS = new Set<string>([
  'aspectEntry',
  'pointsNormal',
  'pointsReverse',
  'trackCircuitUp',
  'tinsFree',
  'tinsOverlap',
  'entryFootTag',
  'enRouteTags',
  'distanceMeters',
  'authorizedSpeedOs',
]);

function normTable1CellVal(val: string | undefined): string {
  const s = (val ?? '').trim();
  return s === '' ? '-' : s.replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Computes RDSO Page 16/17 style vertical rowSpan merging for Table 1 preview and PDF/Excel export:
 * - Common route columns (S. No., Entry/Exit Signal, Section Type, Line, Signal Type) span the whole route group.
 * - Route-invariant and consecutive matching columns (Aspects of Entry Signal, Points, Track Circuit,
 *   TINs, Check RFID Sequence, Distance, Authorized Speed in OS) merge across consecutive identical rows
 *   within the same route group.
 */
export function getTable1PreviewSpan(
  rows: TableRowRecord[],
  rowIdx: number,
  colKey: string,
  mergeGroups: Table1MergeGroupInfo[]
): { skip: boolean; rowSpan: number } {
  const grp = mergeGroups[rowIdx];
  if (!grp) return { skip: false, rowSpan: 1 };

  if (TABLE1_COMMON_MERGE_KEY_SET.has(colKey)) {
    return grp.isGroupStart
      ? { skip: false, rowSpan: grp.rowSpan }
      : { skip: true, rowSpan: 0 };
  }

  if (!TABLE1_WITHIN_GROUP_MERGE_KEYS.has(colKey)) {
    return { skip: false, rowSpan: 1 };
  }

  const curVal = normTable1CellVal(rows[rowIdx]?.cells[colKey]);
  if (
    rowIdx > 0 &&
    mergeGroups[rowIdx - 1]?.groupIndex === grp.groupIndex &&
    normTable1CellVal(rows[rowIdx - 1]?.cells[colKey]) === curVal
  ) {
    return { skip: true, rowSpan: 0 };
  }

  let span = 1;
  while (
    rowIdx + span < rows.length &&
    mergeGroups[rowIdx + span]?.groupIndex === grp.groupIndex &&
    normTable1CellVal(rows[rowIdx + span]?.cells[colKey]) === curVal
  ) {
    span++;
  }
  return { skip: false, rowSpan: span };
}

/**
 * Parses "(0, R-514), (199, R-516), (218, R-518-F)" into structured tag links.
 */
export function parseRfidSequence(raw: string): ParsedTagLink[] {
  if (!raw || raw.trim() === '-' || raw.trim() === '') return [];
  const results: ParsedTagLink[] = [];
  const regex = /\(\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([^)]+?)\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    const dist = Number.parseFloat(match[1]);
    const tagId = match[2].trim();
    if (!Number.isNaN(dist) && tagId) {
      results.push({ distance: dist, tagId });
    }
  }
  return results;
}

export function sumRfidSequenceDistance(raw: string): number | null {
  const links = parseRfidSequence(raw);
  if (links.length === 0) return null;
  return Math.round(links.reduce((acc, item) => acc + item.distance, 0) * 100) / 100;
}

/**
 * Parses engineering gradient tuples such as:
 * "(R 1 in 150, 297), (Level, 552), (F 1 in 150, 174)"
 * or "(1 in -1000, 190), (1 in 150, 700)"
 */
export function parseEngineeringGradients(raw: string): ParsedGradientSegment[] {
  if (!raw || raw.trim() === '-' || raw.trim() === '') return [];
  const segments: ParsedGradientSegment[] = [];
  const tupleRegex = /\(\s*([^,()]+?)\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m)?\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = tupleRegex.exec(raw)) !== null) {
    const gradExpr = match[1].trim();
    const length = Number.parseFloat(match[2]);
    if (Number.isNaN(length) || length <= 0) continue;

    if (/^level$/i.test(gradExpr)) {
      segments.push({ direction: 'LEVEL', slope: 0, length });
      continue;
    }

    // Match "R 1 in 260", "F 1 in 150", "1 in -488", "1 in 180"
    const slopeMatch = gradExpr.match(/^(R|F)?\s*1\s*in\s*([+-]?[0-9]+(?:\.[0-9]+)?)$/i);
    if (slopeMatch) {
      const dirLetter = slopeMatch[1]?.toUpperCase();
      const rawSlope = Number.parseFloat(slopeMatch[2]);
      if (!Number.isNaN(rawSlope) && rawSlope !== 0) {
        const direction: 'R' | 'F' =
          dirLetter === 'R'
            ? 'R'
            : dirLetter === 'F'
              ? 'F'
              : rawSlope < 0
                ? 'F'
                : 'R';
        segments.push({ direction, slope: Math.abs(rawSlope), length });
      }
    }
  }
  return segments;
}

/**
 * Computes Average Gradient per RDSO Cl. I.2.12.3(b):
 * Groups consecutive same-direction slopes (R, LEVEL, F) and applies:
 * G = sum(d_i) / sum(d_i / g_i)
 */
export function computeAverageGradients(
  segments: ParsedGradientSegment[]
): Array<{ label: string; length: number }> {
  if (segments.length === 0) return [];
  const bands: Array<{ direction: 'R' | 'F' | 'LEVEL'; items: ParsedGradientSegment[] }> = [];

  for (const seg of segments) {
    const prev = bands[bands.length - 1];
    if (prev && prev.direction === seg.direction) {
      prev.items.push(seg);
    } else {
      bands.push({ direction: seg.direction, items: [seg] });
    }
  }

  return bands.map((band) => {
    const totalLen = Math.round(band.items.reduce((acc, s) => acc + s.length, 0) * 100) / 100;
    if (band.direction === 'LEVEL') {
      return { label: 'LEVEL', length: totalLen };
    }
    const denom = band.items.reduce((acc, s) => acc + s.length / s.slope, 0);
    const avgG = denom > 0 ? Math.round(totalLen / denom) : 0;
    return {
      label: `${band.direction} 1 in ${avgG}`,
      length: totalLen,
    };
  });
}

/**
 * Parses PSR tuples like "(U, 110, 307), (U, 30, 818)" or "(110, U, 360), (90-A, 60-B, 65-C, 80)"
 */
export function parsePsrTuples(raw: string): ParsedPsrTuple[] {
  if (!raw || raw.trim() === '-' || raw.trim() === '') return [];
  const tuples: ParsedPsrTuple[] = [];
  const regex = /\(\s*([^()]+?)\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    const parts = match[1].split(',').map((p) => p.trim());
    if (parts.length < 3) continue;
    const lastNum = Number.parseFloat(parts[parts.length - 1]);
    if (Number.isNaN(lastNum)) continue;

    // Standard Table 4 format: (U, 110, 1023)
    const maybeSpeed = Number.parseFloat(parts[1]);
    if (/^[UABC]$/i.test(parts[0]) && !Number.isNaN(maybeSpeed)) {
      tuples.push({ type: parts[0].toUpperCase(), speed: maybeSpeed, length: lastNum });
    } else {
      // Table 7 TSL format: (110, U, 360) or (90-A, 60-B, 65-C, 80)
      const firstSpeed = Number.parseFloat(parts[0]);
      tuples.push({
        type: parts.slice(0, parts.length - 1).join(', '),
        speed: Number.isNaN(firstSpeed) ? 0 : firstSpeed,
        length: lastNum,
      });
    }
  }
  return tuples;
}

export function sumPsrLength(raw: string): number | null {
  const tuples = parsePsrTuples(raw);
  if (tuples.length === 0) return null;
  return Math.round(tuples.reduce((acc, t) => acc + t.length, 0) * 100) / 100;
}

export function parseNumericValue(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.-]/g, '').trim();
  if (!cleaned) return null;
  const num = Number.parseFloat(cleaned);
  return Number.isNaN(num) ? null : num;
}

/**
 * Checks if a cell value is functionally empty / missing (not intentionally "-").
 */
export function isCellEmpty(val: string | undefined): boolean {
  if (val === undefined || val === null) return true;
  const trimmed = val.trim();
  return trimmed === '' || trimmed === '?' || /^missing$/i.test(trimmed) || /^tbd$/i.test(trimmed);
}

/**
 * Applies deterministic RDSO calculations and dependency propagation across all 7 tables
 * WITHOUT overwriting manually verified user overrides unless recalculating derived fields.
 */
export function recalculateDependentTables(
  tables: Record<KavachTableId, TableRowRecord[]>,
  settings: ExtractionSettings,
  metadata: DocumentMetadata
): Record<KavachTableId, TableRowRecord[]> {
  // Expand compound aspectExit entries (e.g. "Green / Double Yellow") into individual aspect rows
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
        movementAuthority:
          row.cellMeta?.movementAuthority?.source === 'manual'
            ? row.cells.movementAuthority || nextMa
            : nextMa,
      };
      expandedT1.push({
        ...row,
        cells: nextCells,
        cellMeta: { ...row.cellMeta },
      });
    }
  }

  const next: Record<KavachTableId, TableRowRecord[]> = {
    table1_control: expandedT1,
    table2_block_section: tables.table2_block_section.map((r) => ({
      ...r,
      cells: { ...r.cells },
      cellMeta: { ...r.cellMeta },
    })),
    table3_shunting_limit: tables.table3_shunting_limit.map((r) => ({
      ...r,
      cells: { ...r.cells },
      cellMeta: { ...r.cellMeta },
    })),
    table4_track_profile: tables.table4_track_profile.map((r) => ({
      ...r,
      cells: { ...r.cells },
      cellMeta: { ...r.cellMeta },
    })),
    table5_tsr_route: tables.table5_tsr_route.map((r) => ({
      ...r,
      cells: { ...r.cells },
      cellMeta: { ...r.cellMeta },
    })),
    table6_tsl_control: tables.table6_tsl_control.map((r) => ({
      ...r,
      cells: { ...r.cells },
      cellMeta: { ...r.cellMeta },
    })),
    table6b_tsl_block: tables.table6b_tsl_block.map((r) => ({
      ...r,
      cells: { ...r.cells },
      cellMeta: { ...r.cellMeta },
    })),
    table7_tsl_track_profile: tables.table7_tsl_track_profile.map((r) => ({
      ...r,
      cells: { ...r.cells },
      cellMeta: { ...r.cellMeta },
    })),
  };

  // Build map of LSS A-Tag corrections from Table 2
  const lssCorrectionMap = new Map<string, number>();
  for (const row of next.table2_block_section) {
    const lss = (row.cells.lssSignal || '').trim();
    const corr = parseNumericValue(row.cells.absLocationCorrection);
    if (lss && corr !== null) {
      lssCorrectionMap.set(lss.toUpperCase(), corr);
    }
  }

  // Build map of Route -> Distance from Table 1 & apply deterministic Section/Signal Type rules when blank
  const routeDistanceMap = new Map<string, number>();
  for (const row of next.table1_control) {
    const entry = (row.cells.entrySignal || '').trim();
    const exit = (row.cells.exitSignal || '').trim();
    // Columns 4 & 6 – Strict Signal, Section Type, and Signal Type rules (non-manual cells auto-update on edits):
    // Only D and ID signals are Absolute Block; all remaining are Station Section.
    // Loop line remaining signals -> Starter / Adv Starter; Main line remaining signals -> Home Signal.
    if (entry) {
      const cls = classifySignalByStrictRules(entry, row.cells.line, row.cells.signalType);

      if (row.cellMeta.sectionType?.source !== 'manual') {
        row.cells.sectionType = cls.sectionType;
        row.cellMeta.sectionType = {
          source: 'calculated',
          trace:
            cls.sectionType === 'Absolute Block'
              ? `Absolute Block rule for Distant/Inner Distant signal "${entry}"`
              : `Station Section rule for signal "${entry}"`,
        };
      }

      if (row.cellMeta.signalType?.source !== 'manual') {
        row.cells.signalType = cls.signalType;
        row.cellMeta.signalType = {
          source: 'calculated',
          trace: `Derived Signal Type "${cls.signalType}" from "${entry}" and Line "${row.cells.line || '-'}"`,
        };
      }
    }

    const tagSum = sumRfidSequenceDistance(row.cells.enRouteTags || '');
    const currentDist = parseNumericValue(row.cells.distanceMeters);

    // Auto-fill distanceMeters if empty and tag sequence exists (non-manual)
    if (currentDist === null && tagSum !== null && row.cellMeta.distanceMeters?.source !== 'manual') {
      row.cells.distanceMeters = String(Math.round(tagSum));
      row.cellMeta.distanceMeters = {
        source: 'calculated',
        trace: 'Summed from Check RFID Sequence linking distances (Cl. I.2.11.15)',
      };
    }

    const effectiveDist = parseNumericValue(row.cells.distanceMeters);
    if (entry && exit && effectiveDist !== null) {
      routeDistanceMap.set(`${entry.toUpperCase()}->${exit.toUpperCase()}`, effectiveDist);
    }

    // Auto-update Movement Authority from Exit Aspect if non-manual
    if (row.cellMeta.movementAuthority?.source !== 'manual') {
      const derivedMa = deriveMovementAuthorityFromExitAspect(row.cells.aspectExit);
      if (row.cells.movementAuthority !== derivedMa) {
        row.cells.movementAuthority = derivedMa;
        row.cellMeta.movementAuthority = {
          source: 'calculated',
          trace: `Derived Movement Authority (${derivedMa}) from Exit Aspect "${row.cells.aspectExit || 'Nil'}"`,
        };
      }
    }
  }

  // Assign grouped route-level S. No. across consecutive identical Table 1 route rows
  next.table1_control = assignGroupedTable1Sno(next.table1_control);

  // Sync Table 2 LSS distance from Table 1 if Table 2 distance wasn't manually edited
  for (const row of next.table2_block_section) {
    const lss = (row.cells.lssSignal || '').trim().toUpperCase();
    if (!lss) continue;
    const matchingT1 = next.table1_control.find(
      (r) =>
        (r.cells.entrySignal || '').trim().toUpperCase() === lss &&
        (r.cells.sectionType || '').toLowerCase().includes('block')
    );
    if (
      matchingT1 &&
      !isCellEmpty(matchingT1.cells.distanceMeters) &&
      row.cellMeta.distanceMeters?.source !== 'manual' &&
      isCellEmpty(row.cells.distanceMeters)
    ) {
      row.cells.distanceMeters = matchingT1.cells.distanceMeters;
      row.cellMeta.distanceMeters = {
        source: 'calculated',
        trace: `Synced from Table 1 LSS route (${matchingT1.cells.entrySignal} -> ${matchingT1.cells.exitSignal})`,
      };
    }
  }

  // Table 4: Average Gradient calculation & Turnout Length formula (Cl. I.2.12.1 & I.2.12.3(b))
  for (const row of next.table4_track_profile) {
    const engGrad = row.cells.engineeringGradient || '';
    const segments = parseEngineeringGradients(engGrad);
    if (segments.length > 0) {
      const avgBands = computeAverageGradients(segments);
      if (row.cellMeta.averageGradient?.source !== 'manual') {
        row.cells.averageGradient = avgBands.map((b) => b.label).join(', ');
        row.cellMeta.averageGradient = {
          source: 'calculated',
          trace: 'Harmonic average G = D / sum(d_i / g_i) per Cl. I.2.12.3(b)',
        };
      }
      if (row.cellMeta.gradientLength?.source !== 'manual') {
        row.cells.gradientLength = avgBands.map((b) => String(b.length)).join(', ');
        row.cellMeta.gradientLength = {
          source: 'calculated',
          trace: 'Segment lengths summed per average gradient zone',
        };
      }
    }

    // Calculate Turnout Length for station entry when turnoutStartDist & route distance exist
    const entry = (row.cells.entrySignal || '').trim().toUpperCase();
    const exit = (row.cells.exitSignal || '').trim().toUpperCase();
    const routeDist = routeDistanceMap.get(`${entry}->${exit}`);
    const toStart = parseNumericValue(row.cells.turnoutStartDist);
    const toSpeed = parseNumericValue(row.cells.turnoutSpeedKmph);

    if (
      routeDist !== undefined &&
      toStart !== null &&
      toSpeed !== null &&
      isCellEmpty(row.cells.turnoutLength) &&
      row.cellMeta.turnoutLength?.source !== 'manual'
    ) {
      const calcLen = Math.max(0, Math.round(routeDist - toStart + settings.stationEntryTurnoutBufferM));
      row.cells.turnoutLength = String(calcLen);
      row.cellMeta.turnoutLength = {
        source: 'calculated',
        trace: `Entry turnout length = (${routeDist} - ${toStart}) + ${settings.stationEntryTurnoutBufferM}m (Cl. I.2.12.1(iii))`,
      };
    }

    // Populate baseline PSR if empty AND route distance is known (splitting at turnout length when applicable)
    const sectionSpeed = parseNumericValue(metadata.sectionSpeedKmph) || settings.defaultSectionSpeedKmph;
    const toLen = parseNumericValue(row.cells.turnoutLength);
    if (
      isCellEmpty(row.cells.psrTuples) &&
      routeDist !== undefined &&
      row.cellMeta.psrTuples?.source !== 'manual'
    ) {
      if (toSpeed !== null && toLen !== null && toLen > 0 && toLen < routeDist) {
        const remDist = Math.round((routeDist - toLen) * 100) / 100;
        row.cells.psrTuples = `(U, ${toSpeed}, ${toLen}), (U, ${sectionSpeed}, ${remDist})`;
        row.cellMeta.psrTuples = {
          source: 'calculated',
          trace: `Derived turnout-split PSR (${toSpeed} kmph for ${toLen}m + ${sectionSpeed} kmph for ${remDist}m); verify against Gradient/PSR sheet`,
        };
      } else {
        row.cells.psrTuples = `(U, ${sectionSpeed}, ${routeDist})`;
        row.cellMeta.psrTuples = {
          source: 'calculated',
          trace: `Derived uniform PSR from Section Speed (${sectionSpeed} kmph) and Route Distance (${routeDist} m); verify against Gradient/PSR sheet`,
        };
      }
    }
  }

  // Table 5: TSR Route cumulative offset along shared OHE Line (Cl. I.2.12.6.6)
  let currentOheLine = '';
  let cumulativeDist = 0;
  for (const row of next.table5_tsr_route) {
    const oheLine = (row.cells.oheLine || '').trim();
    const entry = (row.cells.entrySignal || '').trim().toUpperCase();
    const exit = (row.cells.exitSignal || '').trim().toUpperCase();
    const segDist = routeDistanceMap.get(`${entry}->${exit}`) ?? 0;

    if (oheLine && oheLine !== currentOheLine) {
      currentOheLine = oheLine;
      cumulativeDist = 0;
    }

    if (
      isCellEmpty(row.cells.entrySignalDistFromStart) &&
      row.cellMeta.entrySignalDistFromStart?.source !== 'manual'
    ) {
      row.cells.entrySignalDistFromStart = String(Math.round(cumulativeDist));
      row.cellMeta.entrySignalDistFromStart = {
        source: 'calculated',
        trace: 'Cumulative distance from OHE Line Start RFID Tag (Cl. I.2.12.6.6)',
      };
    }

    cumulativeDist += segDist;
  }

  // Table 7: TSL Average Gradient calculation & uniform PSR baseline
  const tslDistanceMap = new Map<string, number>();
  for (const row of next.table6_tsl_control) {
    const te = (row.cells.tslEntrySignal || '').trim().toUpperCase();
    const tx = (row.cells.tslExitSignal || '').trim().toUpperCase();
    const td = parseNumericValue(row.cells.distanceMeters);
    if (te && tx && td !== null) {
      tslDistanceMap.set(`${te}->${tx}`, td);
    }
  }
  const sectionSpeedTsl = parseNumericValue(metadata.sectionSpeedKmph) || settings.defaultSectionSpeedKmph;
  for (const row of next.table7_tsl_track_profile) {
    const segments = parseEngineeringGradients(row.cells.engineeringGradient || '');
    if (segments.length > 0) {
      const avgBands = computeAverageGradients(segments);
      if (row.cellMeta.averageGradient?.source !== 'manual') {
        row.cells.averageGradient = avgBands.map((b) => b.label).join(', ');
        row.cellMeta.averageGradient = {
          source: 'calculated',
          trace: 'Harmonic average gradient in TSL direction (Cl. I.2.12.3(b))',
        };
      }
      if (row.cellMeta.gradientLength?.source !== 'manual') {
        row.cells.gradientLength = avgBands.map((b) => String(b.length)).join(', ');
        row.cellMeta.gradientLength = {
          source: 'calculated',
          trace: 'TSL gradient segment length sum',
        };
      }
    }

    const te = (row.cells.tslEntrySignal || '').trim().toUpperCase();
    const tx = (row.cells.tslExitSignal || '').trim().toUpperCase();
    const tslDist = tslDistanceMap.get(`${te}->${tx}`);
    const toSpeed = parseNumericValue(row.cells.turnoutSpeedKmph);
    const toLen = parseNumericValue(row.cells.turnoutLength);
    if (
      isCellEmpty(row.cells.psrTuples) &&
      tslDist !== undefined &&
      row.cellMeta.psrTuples?.source !== 'manual'
    ) {
      if (toSpeed !== null && toLen !== null && toLen > 0 && toLen < tslDist) {
        const remDist = Math.round((tslDist - toLen) * 100) / 100;
        row.cells.psrTuples = `(${toSpeed}, U, ${toLen}), (${sectionSpeedTsl}, U, ${remDist})`;
      } else {
        row.cells.psrTuples = `(${sectionSpeedTsl}, U, ${tslDist})`;
      }
      row.cellMeta.psrTuples = {
        source: 'calculated',
        trace: `Derived uniform TSL PSR from Section Speed (${sectionSpeedTsl} kmph) and TSL Distance (${tslDist} m); verify against Gradient/PSR sheet`,
      };
    }
  }

  return next;
}

/**
 * Runs complete RDSO/SPN/196/2020 Version 4.0 Annexure-I Amdt-6 validation across metadata and all 7 tables.
 */
export function validateKavachDataset(
  metadata: DocumentMetadata,
  tables: Record<KavachTableId, TableRowRecord[]>,
  settings: ExtractionSettings
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  let issueIdx = 1;
  const pushIssue = (issue: Omit<ValidationIssue, 'id'>) => {
    issues.push({ id: `val_${issueIdx++}`, ...issue });
  };

  // 1. Document Metadata Checks (Cl. I.2.11.1 & Cl. I.2.9)
  const requiredMeta: Array<{
    key: keyof DocumentMetadata;
    label: string;
    clause: string;
    severity: 'error' | 'warning';
  }> = [
    { key: 'stationName', label: 'Station Name', clause: 'Cl. I.2.11.1', severity: 'error' },
    { key: 'stationId', label: 'Station ID', clause: 'Cl. I.2.11.1', severity: 'error' },
    { key: 'division', label: 'Division', clause: 'Cl. I.2.11.1', severity: 'warning' },
    { key: 'section', label: 'Section', clause: 'Cl. I.2.11.1', severity: 'warning' },
    { key: 'versionControl', label: 'Version Control (X.Y.Z)', clause: 'Cl. I.2.9', severity: 'error' },
  ];
  for (const item of requiredMeta) {
    const val = String(metadata[item.key] ?? '').trim();
    if (!val) {
      pushIssue({
        severity: item.severity,
        tableId: 'metadata',
        columnKey: item.key,
        clauseRef: item.clause,
        ruleName: item.severity === 'warning' ? 'Title Block Header Field Pending' : 'Missing Sheet Header Field',
        message: `${item.label} is not printed in the uploaded drawing title block; enter it in Header Metadata before final issue.`,
      });
    }
  }
  if (metadata.versionControl && !/^\d+\.\d+\.\d+$/.test(metadata.versionControl.trim())) {
    pushIssue({
      severity: 'warning',
      tableId: 'metadata',
      columnKey: 'versionControl',
      clauseRef: 'Cl. I.2.9',
      ruleName: 'Version Control Format',
      message: `Version Control "${metadata.versionControl}" should follow X.Y.Z format (KAVACH.Layout.Review).`,
      suggestedValue: '1.0.0',
    });
  }

  // Build lookup tables for cross-table invariants
  const blockSectionTins = new Set<string>();
  const lssCorrections = new Map<string, number>();
  const lssDistances = new Map<string, number>();

  for (const row of tables.table2_block_section) {
    const tin = (row.cells.blockSectionTin || '').trim().toUpperCase();
    if (tin && tin !== '-') blockSectionTins.add(tin);
    const lss = (row.cells.lssSignal || '').trim().toUpperCase();
    const corr = parseNumericValue(row.cells.absLocationCorrection);
    const dist = parseNumericValue(row.cells.distanceMeters);
    if (lss && corr !== null) lssCorrections.set(lss, Math.abs(corr));
    if (lss && dist !== null) lssDistances.set(lss, dist);
  }

  const routeDistanceMap = new Map<string, number>();
  const signalFootTagMap = new Map<string, string>();

  // 2. Mandatory Field Checks across all tables (except empty optional tables)
  for (const specTable of KAVACH_SPEC_TABLES) {
    const rows = tables[specTable.id] || [];
    for (const row of rows) {
      for (const col of specTable.columns) {
        const val = row.cells[col.key];
        if (col.mandatory && isCellEmpty(val)) {
          // Derived gradient columns cannot be computed until Engineering Gradient (GRADIENT_PLAN) is provided
          const isDerivedFromMissingGradient =
            (col.key === 'averageGradient' || col.key === 'gradientLength') &&
            isCellEmpty(row.cells.engineeringGradient);
          if (isDerivedFromMissingGradient) {
            // Already flagged once on engineeringGradient as a companion-sheet warning; skip redundant error
            continue;
          }

          // Companion-sheet fields get warning so user knows why it's missing rather than fabricated
          const isCompanionField =
            col.sourceDoc === 'GRADIENT_PLAN' ||
            col.sourceDoc === 'OHE_LAYOUT' ||
            col.sourceDoc === 'SIP_TOC' ||
            col.sourceDoc === 'ADJACENT_KAVACH' ||
            (specTable.id === 'table6_tsl_control' && col.key === 'trackCircuitUp');

          if (!isCompanionField || settings.flagMissingCompanionData) {
            pushIssue({
              severity: isCompanionField ? 'warning' : 'error',
              tableId: specTable.id,
              rowId: row.rowId,
              columnKey: col.key,
              clauseRef: col.clauseRef,
              ruleName: isCompanionField ? 'Companion Sheet Value Required' : 'Mandatory Field Missing',
              message: `${specTable.shortTitle} (${row.cells.entrySignal || row.cells.lssSignal || row.cells.tslEntrySignal || row.cells.rfidTagNo || row.rowId}): "${col.label}" is empty${isCompanionField ? ` (requires ${(col.sourceDoc === 'RFID_LAYOUT' ? 'SIP_TOC' : col.sourceDoc).replace('_', ' ')})` : ''}.`,
            });
          }
        }
      }
    }
  }

  // 3. Table 1 Specific Mathematical & RDSO Rule Checks
  for (const row of tables.table1_control) {
    const entry = (row.cells.entrySignal || '').trim();
    const exit = (row.cells.exitSignal || '').trim();
    const footTag = (row.cells.entryFootTag || '').trim();
    if (entry && footTag) signalFootTagMap.set(entry.toUpperCase(), footTag.toUpperCase());

    const statedDist = parseNumericValue(row.cells.distanceMeters);
    if (entry && exit && statedDist !== null) {
      routeDistanceMap.set(`${entry.toUpperCase()}->${exit.toUpperCase()}`, statedDist);
    }

    // Rule 3a: Tag-Sequence Distance Conservation
    const seq = row.cells.enRouteTags || '';
    const tagSum = sumRfidSequenceDistance(seq);
    if (tagSum !== null && statedDist !== null) {
      const aTagCorr = lssCorrections.get(entry.toUpperCase()) ?? 0;
      const diffDirect = Math.abs(tagSum - statedDist);
      const diffPlus = Math.abs(tagSum + aTagCorr - statedDist);
      const diffMinus = Math.abs(tagSum - aTagCorr - statedDist);
      const minDiff = Math.min(diffDirect, diffPlus, diffMinus);

      if (minDiff > settings.distanceToleranceMeters) {
        pushIssue({
          severity: 'error',
          tableId: 'table1_control',
          rowId: row.rowId,
          columnKey: 'distanceMeters',
          clauseRef: 'Cl. I.2.11.14–15',
          ruleName: 'Tag-Sequence Distance Mismatch',
          message: `Route ${entry} -> ${exit}: Sum of RFID linking distances is ${tagSum}m${aTagCorr ? ` (A-Tag correction ±${aTagCorr}m)` : ''}, but Distance Entry to Exit is ${statedDist}m (delta ${Math.round(minDiff)}m).`,
          suggestedValue: String(Math.round(tagSum)),
        });
      }
    }

    // Rule 3b: Entry Signal Foot Tag must start sequence at distance 0
    const parsedLinks = parseRfidSequence(seq);
    if (parsedLinks.length > 0 && footTag) {
      const firstLink = parsedLinks[0];
      if (firstLink.distance !== 0 || firstLink.tagId.toUpperCase() !== footTag.toUpperCase()) {
        pushIssue({
          severity: 'warning',
          tableId: 'table1_control',
          rowId: row.rowId,
          columnKey: 'enRouteTags',
          clauseRef: 'Cl. I.2.11.14(ii)',
          ruleName: 'Entry Foot Tag Origin Rule',
          message: `Route ${entry} -> ${exit}: Check RFID Sequence should begin with (0, ${footTag}) per Amdt-3 Cl. I.2.11.14.`,
        });
      }
    }

    // Rule 3c: Block Section TIN must NEVER be proved in TINs Requires Free (Cl. I.2.11.12)
    const tinsFree = (row.cells.tinsFree || '').toUpperCase();
    for (const blockTin of blockSectionTins) {
      if (tinsFree.includes(blockTin)) {
        pushIssue({
          severity: 'error',
          tableId: 'table1_control',
          rowId: row.rowId,
          columnKey: 'tinsFree',
          clauseRef: 'Cl. I.2.11.12',
          ruleName: 'Block Section TIN Prohibited',
          message: `Route ${entry} -> ${exit}: Block Section TIN "${blockTin}" shall NOT be proved in "TINs Requires Free".`,
        });
      }
    }

    // Rule 3d: Calling-On Signal must NOT prove TINs (Cl. I.2.11.12)
    const sigType = (row.cells.signalType || '').toLowerCase();
    if (sigType.includes('calling')) {
      const hasTins = tinsFree && tinsFree !== '-' && tinsFree !== 'NIL';
      if (hasTins) {
        pushIssue({
          severity: 'error',
          tableId: 'table1_control',
          rowId: row.rowId,
          columnKey: 'tinsFree',
          clauseRef: 'Cl. I.2.11.12',
          ruleName: 'Calling-On TIN Proving Prohibited',
          message: `Calling-On signal ${entry} -> ${exit}: TINs shall NOT be proved for Calling-On signals.`,
          suggestedValue: '-',
        });
      }
    }
  }

  // 4. Table 2 Cross-Table Checks (LSS Distance consistency with Table 1)
  for (const row of tables.table2_block_section) {
    const lss = (row.cells.lssSignal || '').trim();
    const t2Dist = parseNumericValue(row.cells.distanceMeters);
    const matchingT1 = tables.table1_control.find(
      (r) =>
        (r.cells.entrySignal || '').trim().toUpperCase() === lss.toUpperCase() &&
        (r.cells.sectionType || '').toLowerCase().includes('block')
    );
    if (matchingT1 && t2Dist !== null) {
      const t1Dist = parseNumericValue(matchingT1.cells.distanceMeters);
      if (t1Dist !== null && Math.abs(t1Dist - t2Dist) > settings.distanceToleranceMeters) {
        pushIssue({
          severity: 'error',
          tableId: 'table2_block_section',
          rowId: row.rowId,
          columnKey: 'distanceMeters',
          clauseRef: 'Cl. I.2.11.18.1(ii)',
          ruleName: 'Cross-Table LSS Distance Mismatch',
          message: `LSS ${lss}: Table 2 distance (${t2Dist}m) does not match Table 1 LSS route distance (${t1Dist}m).`,
          suggestedValue: String(t1Dist),
        });
      }
    }
  }

  // 5. Table 4 Track Profile Mathematical Invariants
  for (const row of tables.table4_track_profile) {
    const entry = (row.cells.entrySignal || '').trim();
    const exit = (row.cells.exitSignal || '').trim();
    const routeDist = routeDistanceMap.get(`${entry.toUpperCase()}->${exit.toUpperCase()}`);

    // Rule 5a: PSR Length Conservation
    const psrSum = sumPsrLength(row.cells.psrTuples || '');
    if (psrSum !== null && routeDist !== undefined && Math.abs(psrSum - routeDist) > settings.distanceToleranceMeters) {
      pushIssue({
        severity: 'error',
        tableId: 'table4_track_profile',
        rowId: row.rowId,
        columnKey: 'psrTuples',
        clauseRef: 'Cl. I.2.12.2',
        ruleName: 'PSR Length Conservation',
        message: `Route ${entry} -> ${exit}: Sum of PSR segment lengths (${psrSum}m) does not equal Entry-to-Exit distance (${routeDist}m).`,
      });
    }

    // Rule 5b: Engineering Gradient Length Conservation & <= 31 segments rule
    const gradSegments = parseEngineeringGradients(row.cells.engineeringGradient || '');
    if (gradSegments.length > 0) {
      const gradSum = Math.round(gradSegments.reduce((acc, g) => acc + g.length, 0) * 100) / 100;
      if (routeDist !== undefined && Math.abs(gradSum - routeDist) > settings.distanceToleranceMeters) {
        pushIssue({
          severity: 'error',
          tableId: 'table4_track_profile',
          rowId: row.rowId,
          columnKey: 'engineeringGradient',
          clauseRef: 'Cl. I.2.12.3(a)',
          ruleName: 'Gradient Length Conservation',
          message: `Route ${entry} -> ${exit}: Sum of Engineering Gradient lengths (${gradSum}m) does not equal route distance (${routeDist}m).`,
        });
      }
      const avgBands = computeAverageGradients(gradSegments);
      if (avgBands.length > settings.maxAverageGradientsPerRoute) {
        pushIssue({
          severity: 'error',
          tableId: 'table4_track_profile',
          rowId: row.rowId,
          columnKey: 'averageGradient',
          clauseRef: 'Cl. I.2.12.3(b)(v)',
          ruleName: 'Max Average Gradient Limit',
          message: `Route ${entry} -> ${exit}: Has ${avgBands.length} average gradients; maximum allowed is ${settings.maxAverageGradientsPerRoute}.`,
        });
      }
    }

    // Rule 5c: Turnout Entry +30m Formula Verification
    const toStart = parseNumericValue(row.cells.turnoutStartDist);
    const toLen = parseNumericValue(row.cells.turnoutLength);
    if (toStart !== null && toLen !== null && routeDist !== undefined) {
      const expectedEntryLen = Math.round(routeDist - toStart + settings.stationEntryTurnoutBufferM);
      if (Math.abs(toLen - expectedEntryLen) > settings.distanceToleranceMeters) {
        pushIssue({
          severity: 'warning',
          tableId: 'table4_track_profile',
          rowId: row.rowId,
          columnKey: 'turnoutLength',
          clauseRef: 'Cl. I.2.12.1(iii)',
          ruleName: 'Turnout Length Formula Check',
          message: `Route ${entry} -> ${exit}: Turnout length is ${toLen}m; for station entry (${routeDist} - ${toStart} + ${settings.stationEntryTurnoutBufferM}m) expected ${expectedEntryLen}m (verify if separate turnout/loop speeds apply).`,
          suggestedValue: String(expectedEntryLen),
        });
      }
    }
  }

  // 6. Table 6 TSL Compliance Checks (Cl. I.2.12.10 – I.2.12.16)
  for (const row of tables.table6_tsl_control) {
    const entry = (row.cells.tslEntrySignal || '').trim();
    const exit = (row.cells.tslExitSignal || '').trim();
    const aspectEntry = (row.cells.aspectEntry || '').trim();
    if (aspectEntry && !/^(red\/blank|blank)$/i.test(aspectEntry)) {
      pushIssue({
        severity: 'error',
        tableId: 'table6_tsl_control',
        rowId: row.rowId,
        columnKey: 'aspectEntry',
        clauseRef: 'Cl. I.2.12.10',
        ruleName: 'TSL Entry Aspect Constraint',
        message: `TSL Route ${entry} -> ${exit}: Aspect of Entry Signal must be "Red/Blank" or "Blank", found "${aspectEntry}".`,
        suggestedValue: 'Red/Blank',
      });
    }

    // Rule 6b: Exit Signal Foot Tag MUST BE EXCLUDED from TSL Check RFID Sequence (Cl. I.2.12.16)
    const exitFootTag = signalFootTagMap.get(exit.toUpperCase());
    const tslLinks = parseRfidSequence(row.cells.enRouteTags || '');
    if (exitFootTag && tslLinks.some((l) => l.tagId.toUpperCase() === exitFootTag)) {
      pushIssue({
        severity: 'error',
        tableId: 'table6_tsl_control',
        rowId: row.rowId,
        columnKey: 'enRouteTags',
        clauseRef: 'Cl. I.2.12.16',
        ruleName: 'TSL Exit Signal Foot Tag Exclusion',
        message: `TSL Route ${entry} -> ${exit}: Exit Signal foot tag (${exitFootTag}) MUST NOT be included in Check RFID Sequence.`,
      });
    }

    // Rule 6c: Block Section TIN must not be proved in TSL TINs Requires Free
    const tinsFree = (row.cells.tinsFree || '').toUpperCase();
    for (const blockTin of blockSectionTins) {
      if (tinsFree.includes(blockTin)) {
        pushIssue({
          severity: 'error',
          tableId: 'table6_tsl_control',
          rowId: row.rowId,
          columnKey: 'tinsFree',
          clauseRef: 'Cl. I.2.12.14',
          ruleName: 'TSL Block Section TIN Prohibited',
          message: `TSL Route ${entry} -> ${exit}: Block Section TIN "${blockTin}" shall NOT be proved.`,
        });
      }
    }
  }

  return issues;
}

export function getTableDef(tableId: KavachTableId) {
  return KAVACH_TABLE_MAP[tableId];
}
