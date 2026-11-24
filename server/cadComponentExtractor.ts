import type {
  CadDocumentData,
  CadPoint,
  ComponentRelationship,
  DocumentMetadata,
  ExtractedComponent,
  ExtractionSettings,
  KavachTableId,
  TableRowRecord,
} from '../src/types/project';
import {
  KAVACH_SPEC_TABLES,
  createEmptyMetadata,
  createEmptyTables,
} from '../src/spec/kavachSpecSchema';
import {
  classifySignalByStrictRules,
  deriveMovementAuthorityFromExitAspect,
  isCellEmpty,
} from '../src/engine/kavachEngine';

export interface DeterministicCadExtraction {
  metadataHints: Partial<DocumentMetadata>;
  components: ExtractedComponent[];
  relationships: ComponentRelationship[];
  tables: Record<KavachTableId, TableRowRecord[]>;
  corridorSummaryText: string;
  missingCompanionInfo: string[];
}

interface DetectedRfidTag {
  id: string;
  label: string;
  x: number;
  y: number;
  layer: string;
  facing: 'RIGHT' | 'LEFT' | 'UNKNOWN';
  directionLabel: 'Nominal' | 'Reverse' | 'Unknown';
  roleCode: 'S' | 'N' | 'T' | 'G' | 'L' | 'A' | 'X' | 'U';
  roleName: string;
  chainageKm?: string;
  absMeters?: number;
  // Adjustment (A-Tag) dual-chainage metadata: LOC.1 & LOC.2
  loc1Meters?: number;
  loc2Meters?: number;
  loc1Km?: string;
  loc2Km?: string;
  directionResetNote?: string;
  isFoulingMark: boolean;
  isDotted: boolean;
  blockSource?: string;
}

interface DetectedSignal {
  id: string;
  label: string;
  rawLabel: string;
  x: number;
  y: number;
  layer: string;
  blockSource?: string;
  aspects: string[]; // e.g., ['Green', 'Double Yellow', 'Yellow', 'Red']
  aspectPatternText: string;
  facing: 'RIGHT' | 'LEFT' | 'UNKNOWN';
  directionLabel: 'Nominal' | 'Reverse' | 'Unknown';
  line: string;
  sectionType: 'Absolute Block' | 'Station Section';
  signalType: string;
  footTag?: DetectedRfidTag;
  callingOnLabel?: string;
  isDotted: boolean;
  isShunt: boolean;
  isCallingOn: boolean;
  isLss: boolean;
  stationTag?: string; // adjacent station name if dotted boundary signal
}

interface SimpleItem {
  id: string;
  label: string;
  x: number;
  y: number;
  layer: string;
  subType: string;
  blockSource?: string;
}

interface StationAnchor {
  name: string;
  stationId?: string;
  stationKm?: string;
  x: number;
  y: number;
  isMain: boolean;
}

function makeTableRow(
  tableId: KavachTableId,
  rowIndex: number,
  values: Record<string, string>,
  calculatedKeys: Set<string>,
  sourceTrace: string
): TableRowRecord {
  const specDef = KAVACH_SPEC_TABLES.find((t) => t.id === tableId)!;
  const cells: Record<string, string> = {};
  const cellMeta: TableRowRecord['cellMeta'] = {};

  for (const col of specDef.columns) {
    const raw = (values[col.key] ?? '').trim();
    cells[col.key] = raw;
    if (isCellEmpty(raw)) {
      cellMeta[col.key] = { source: 'missing' };
    } else {
      cellMeta[col.key] = {
        source: calculatedKeys.has(col.key) ? 'calculated' : 'extracted',
        originalValue: raw,
        trace: sourceTrace,
      };
    }
  }

  return {
    rowId: `${tableId}_cad_r${rowIndex + 1}_${Date.now().toString(36)}`,
    cells,
    cellMeta,
    sourceTrace,
  };
}

function normalizeLineName(raw: string): string {
  const clean = raw.replace(/\s+/g, ' ').trim().toUpperCase();
  if (!clean) return 'MAIN LINE';
  if (clean === 'DOWN MAIN LINE' || clean === 'DN MAIN LINE' || clean === 'DN MAIN' || clean === 'DOWN MAIN') {
    return 'DN MAIN LINE';
  }
  if (clean === 'UP MAIN LINE' || clean === 'UP MAIN') {
    return 'UP MAIN LINE';
  }
  return clean;
}

function classifySignalType(label: string, blockSource: string | undefined, line: string): {
  signalType: string;
  sectionType: 'Absolute Block' | 'Station Section';
  isShunt: boolean;
  isCallingOn: boolean;
  isLss: boolean;
} {
  const upper = label.toUpperCase();
  const blk = (blockSource || '').toUpperCase();
  const isAdvHint = blk.includes('ADVANCE STARTER') || blk.includes('LSS') || /\bLSS\b|ADV/i.test(upper);

  if (/^SH[\s-]?\d+/i.test(upper) || blk.includes('SHUNT')) {
    return {
      signalType: 'Shunt',
      sectionType: 'Station Section',
      isShunt: true,
      isCallingOn: false,
      isLss: false,
    };
  }

  const strict = classifySignalByStrictRules(
    label,
    line,
    isAdvHint ? 'Adv Starter' : undefined
  );

  return {
    signalType: strict.signalType,
    sectionType: strict.sectionType,
    isShunt: strict.kind === 'shunt',
    isCallingOn: strict.kind === 'calling_on',
    isLss: isAdvHint || strict.signalType === 'Adv Starter',
  };
}

/**
 * Dynamically derives Entry -> Exit aspect combinations ONLY from the actual
 * drawn aspect capabilities of the Entry Signal and Exit Signal (never a fixed constant!).
 * Generates separate rows for each distinct Exit Signal aspect capability with
 * Movement Authority: Exit Green -> 4, Exit Double Yellow -> 3, Exit Yellow -> 2, Exit Red/Nil/Blank/- -> 1.
 */
function deriveDynamicAspectPairs(
  entry: DetectedSignal,
  exit: DetectedSignal | null
): Array<{ aspectEntry: string; aspectExit: string; osSpeed: string; ma: string }> {
  if (entry.isCallingOn) {
    const exitAsp = exit ? (exit.aspects.includes('Red') ? 'Red' : 'Nil') : 'Nil';
    return [
      {
        aspectEntry: 'Miniature',
        aspectExit: exitAsp,
        osSpeed: '15',
        ma: deriveMovementAuthorityFromExitAspect(exitAsp),
      },
    ];
  }

  const entryHas = (a: string) => entry.aspects.some((x) => x.toLowerCase() === a.toLowerCase());
  const exitHas = (a: string) => Boolean(exit?.aspects.some((x) => x.toLowerCase() === a.toLowerCase()));
  const pairs: Array<{ aspectEntry: string; aspectExit: string; osSpeed: string; ma: string }> = [];

  const isLoopRoute =
    entry.line.toUpperCase().includes('LOOP') ||
    entry.signalType === 'Starter' ||
    entry.signalType === 'Adv Starter';
  const normalOs = isLoopRoute ? '30' : 'MPS';

  const addPair = (aspEntry: string, aspExit: string, osSpd: string) => {
    pairs.push({
      aspectEntry: aspEntry,
      aspectExit: aspExit,
      osSpeed: osSpd,
      ma: deriveMovementAuthorityFromExitAspect(aspExit),
    });
  };

  if (entryHas('Green')) {
    if (!exit) {
      addPair('Green', '-', normalOs);
    } else {
      let added = false;
      if (exitHas('Green')) {
        addPair('Green', 'Green', normalOs);
        added = true;
      }
      if (exitHas('Double Yellow')) {
        addPair('Green', 'Double Yellow', normalOs);
        added = true;
      }
      if (!added) {
        if (exitHas('Yellow')) {
          addPair('Green', 'Yellow', normalOs);
        } else {
          addPair('Green', exitHas('Red') ? 'Red' : 'Nil', normalOs);
        }
      }
    }
  }

  if (entryHas('Double Yellow')) {
    if (!exit) {
      addPair('Double Yellow', '-', normalOs);
    } else {
      let added = false;
      if (exitHas('Double Yellow')) {
        addPair('Double Yellow', 'Double Yellow', normalOs);
        added = true;
      }
      if (exitHas('Yellow')) {
        addPair('Double Yellow', 'Yellow', normalOs);
        added = true;
      }
      if (!added) {
        if (exitHas('Green')) {
          addPair('Double Yellow', 'Green', normalOs);
        } else {
          addPair('Double Yellow', exitHas('Red') ? 'Red' : 'Nil', normalOs);
        }
      }
    }
  }

  if (entryHas('Yellow')) {
    if (!exit) {
      addPair('Yellow', '-', isLoopRoute ? '30' : normalOs);
    } else {
      let added = false;
      if (exitHas('Yellow')) {
        addPair('Yellow', 'Yellow', isLoopRoute ? '30' : normalOs);
        added = true;
      }
      if (exitHas('Red') || !added) {
        addPair('Yellow', exitHas('Red') ? 'Red' : 'Nil', isLoopRoute ? '30' : normalOs);
      }
    }
  }

  if (entryHas('Red')) {
    addPair('Red', 'Nil', '15');
  }

  if (pairs.length === 0) {
    addPair('', '', normalOs);
  }

  return pairs;
}

/**
 * Computes exact physical meter distance between two consecutive RFID tags,
 * dynamically handling Adjustment/Junction A-Tags that carry dual chainages (LOC.1 & LOC.2).
 */
function computeConsecutiveTagDistance(
  prev: DetectedRfidTag,
  cur: DetectedRfidTag
): { segMeters: number | null; usedPrevMeters?: number; usedCurMeters?: number } {
  const prevCands: number[] = [];
  if (typeof prev.loc2Meters === 'number') prevCands.push(prev.loc2Meters);
  if (typeof prev.loc1Meters === 'number') prevCands.push(prev.loc1Meters);
  if (prevCands.length === 0 && typeof prev.absMeters === 'number') prevCands.push(prev.absMeters);

  const curCands: number[] = [];
  if (typeof cur.loc1Meters === 'number') curCands.push(cur.loc1Meters);
  if (typeof cur.loc2Meters === 'number') curCands.push(cur.loc2Meters);
  if (curCands.length === 0 && typeof cur.absMeters === 'number') curCands.push(cur.absMeters);

  if (prevCands.length === 0 || curCands.length === 0) {
    return { segMeters: null };
  }

  // Pick the closest pair across an A-Tag chainage boundary (continuous side of LOC.1 / LOC.2)
  let bestDiff = Infinity;
  let bestPrev = prevCands[0];
  let bestCur = curCands[0];
  for (const pm of prevCands) {
    for (const cm of curCands) {
      const diff = Math.abs(cm - pm);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestPrev = pm;
        bestCur = cm;
      }
    }
  }

  return {
    segMeters: Math.round(bestDiff),
    usedPrevMeters: bestPrev,
    usedCurMeters: bestCur,
  };
}

/**
 * 100% dynamic, zero-hardcoding CAD component & topology extractor for DWG/DXF layouts.
 * Directly extracts every RFID tag (with triangle facing direction, chainage, and A-Tag LOC.1/LOC.2),
 * every signal (with circle aspect stroke pattern, signal type, section type, line, and foot tag),
 * every turnout point, TIN, track circuit / axle counter DP, LC gate, shunting limit,
 * adjacent station IDs/names, bidirectional forward/reverse Entry->Exit routes, and baseline RDSO tables.
 */
export function extractComponentsFromCad(
  cad: CadDocumentData,
  fileName: string,
  settings: ExtractionSettings
): DeterministicCadExtraction {
  const entityBlockMap = new Map<string, string>();
  for (const e of cad.entities) {
    if (e.blockSource) entityBlockMap.set(e.id, e.blockSource);
  }

  const allTexts = cad.textAnnotations.map((t) => ({
    ...t,
    clean: t.text.replace(/\s+/g, ' ').trim(),
    blockSource: entityBlockMap.get(t.id),
  }));

  // Dynamic scale factor so both ~2000x300 AutoCAD DWGs and ~3000x800 Vector PDFs match proximity accurately
  const scaleFactor = Math.max(
    1,
    Math.min(3.2, Math.max(cad.bounds.width / 2100, cad.bounds.height / 360))
  );

  // -------------------------------------------------------------------------
  // 0. Detect Main Station & Left/Right Adjacent Station Anchors dynamically
  // -------------------------------------------------------------------------
  const stationAnchors: StationAnchor[] = [];
  const stationBuildingText = allTexts.find((t) => /STATION\s+BUILDING/i.test(t.clean));
  const stationIdTexts = allTexts.filter((t) => /STATION\s*ID\s*[:=-]?\s*\d{2,6}/i.test(t.clean));

  for (const stText of stationIdTexts) {
    const idMatch = stText.clean.match(/STATION\s*ID\s*[:=-]?\s*(\d{2,6})/i);
    const kmMatch = stText.clean.match(/KM\s*[:=-]?\s*(\d{1,4}\.\d{1,3})/i);
    const stationId = idMatch?.[1];
    const stationKm = kmMatch?.[1];

    // Look for a short station name text near this Station ID (scaled proximity)
    const nameSearchRadius = 55 * scaleFactor;
    const nameCand = allTexts
      .filter((cand) => {
        if (cand.id === stText.id) return false;
        if (Math.hypot(cand.x - stText.x, cand.y - stText.y) > nameSearchRadius) return false;
        const c = cand.clean;
        if (c.length < 2 || c.length > 28) return false;
        if (/STATION|LINE|KM|LOC\.|COMM\.|RFID|SIGNALLING|BUILDING|FOG|MODE|AXLE/i.test(c)) return false;
        if (/^(?:R-?\d+|S\d+|C\d+|P\d+|DP\d+|N-\d+|\d+\.\d+|\d+m|[SNTGLAX])$/i.test(c)) return false;
        return /^[A-Z][A-Z0-9\s-]{1,24}$/i.test(c);
      })
      .sort((a, b) => Math.hypot(a.x - stText.x, a.y - stText.y) - Math.hypot(b.x - stText.x, b.y - stText.y))[0];

    const isMain = Boolean(
      stationKm ||
      (stationBuildingText &&
        Math.hypot(stText.x - stationBuildingText.x, stText.y - stationBuildingText.y) < 140 * scaleFactor)
    );

    if (nameCand || stationId) {
      stationAnchors.push({
        name: nameCand?.clean || `STN-${stationId}`,
        stationId,
        stationKm,
        x: stText.x,
        y: stText.y,
        isMain,
      });
    }
  }

  // Fallback main station pick: middle X anchor if none matched Station Building / Km
  if (stationAnchors.length > 0 && !stationAnchors.some((a) => a.isMain)) {
    const sorted = [...stationAnchors].sort((a, b) => a.x - b.x);
    sorted[Math.floor(sorted.length / 2)].isMain = true;
  }

  const mainStation = stationAnchors.find((a) => a.isMain);
  const leftAdjStation = stationAnchors
    .filter((a) => !a.isMain && (!mainStation || a.x < mainStation.x))
    .sort((a, b) => a.x - b.x)[0];
  const rightAdjStation = stationAnchors
    .filter((a) => !a.isMain && (!mainStation || a.x > mainStation.x))
    .sort((a, b) => b.x - a.x)[0];

  // -------------------------------------------------------------------------
  // 1. Detect directional RFID Tag triangles (facing LEFT -X vs RIGHT +X)
  // -------------------------------------------------------------------------
  interface TriFeature {
    cx: number;
    cy: number;
    facing: 'RIGHT' | 'LEFT';
    size: number;
    layer: string;
    blockSource?: string;
  }
  const triangles: TriFeature[] = [];
  for (const e of cad.entities) {
    if (
      (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE' || e.type === 'SOLID') &&
      e.points &&
      e.points.length >= 3 &&
      e.points.length <= 5
    ) {
      const uniq: CadPoint[] = [];
      for (const p of e.points) {
        if (!uniq.some((u) => Math.hypot(u.x - p.x, u.y - p.y) < 1e-3)) uniq.push(p);
      }
      if (uniq.length !== 3) continue;
      const d01 = Math.hypot(uniq[0].x - uniq[1].x, uniq[0].y - uniq[1].y);
      const d12 = Math.hypot(uniq[1].x - uniq[2].x, uniq[1].y - uniq[2].y);
      const d20 = Math.hypot(uniq[2].x - uniq[0].x, uniq[2].y - uniq[0].y);
      const maxEdge = Math.max(d01, d12, d20);
      const minEdge = Math.min(d01, d12, d20);
      if (maxEdge <= 0.1 || maxEdge > cad.bounds.width * 0.05 || minEdge / maxEdge < 0.15) continue;

      const cx = (uniq[0].x + uniq[1].x + uniq[2].x) / 3;
      const cy = (uniq[0].y + uniq[1].y + uniq[2].y) / 3;
      let apex = uniq[0];
      let maxDx = Math.abs(uniq[0].x - cx);
      for (let i = 1; i < 3; i++) {
        const dx = Math.abs(uniq[i].x - cx);
        if (dx > maxDx) {
          maxDx = dx;
          apex = uniq[i];
        }
      }
      if (maxDx < maxEdge * 0.18) continue;
      triangles.push({
        cx,
        cy,
        facing: apex.x > cx ? 'RIGHT' : 'LEFT',
        size: maxEdge,
        layer: e.layer,
        blockSource: e.blockSource,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 2. Extract ALL RFID Tags + Chainage + A-Tag LOC.1/LOC.2 + Role + Facing
  // -------------------------------------------------------------------------
  const rfidRoleNames: Record<string, string> = {
    S: 'Signal Foot Tag (S)',
    N: 'Normal Tag (N)',
    T: 'Turnout / TIN Tag (T)',
    G: 'Gate Tag (G)',
    L: 'Adjacent Line Tag (L)',
    A: 'Adjustment / Junction Tag (A)',
    X: 'Territory Exit Tag (X)',
    U: 'RFID Tag',
  };

  const rfidTags: DetectedRfidTag[] = [];
  const seenRfid = new Set<string>();
  const searchRadius = Math.max(cad.bounds.height * 0.12, 80);

  for (const t of allTexts) {
    const m = t.clean.match(/^(R[-\s]?\d+[A-Z0-9-]*)$/i);
    if (!m) continue;
    const rawTag = m[1].toUpperCase().replace(/\s+/g, '-').replace(/^R(\d)/, 'R-$1');
    const dedupKey = `${rawTag}@${Math.round(t.x / (5 * scaleFactor))}_${Math.round(t.y / (5 * scaleFactor))}`;
    if (seenRfid.has(dedupKey)) continue;
    seenRfid.add(dedupKey);

    // Find nearest triangle for facing direction
    let bestTri: TriFeature | null = null;
    let bestTriDist = Infinity;
    for (const tri of triangles) {
      const dist = Math.hypot(tri.cx - t.x, tri.cy - t.y);
      if (dist < bestTriDist && dist <= Math.max(tri.size * 5, searchRadius)) {
        bestTriDist = dist;
        bestTri = tri;
      }
    }

    // Find nearest tag role code (S, N, T, G, L, A, X) within scaled proximity
    let roleCode: DetectedRfidTag['roleCode'] = 'U';
    let bestRoleDist = 24 * scaleFactor;
    for (const cand of allTexts) {
      if (!/^[SNTGLAX]$/i.test(cand.clean)) continue;
      const dist = Math.hypot(cand.x - t.x, cand.y - t.y);
      if (dist < bestRoleDist) {
        bestRoleDist = dist;
        roleCode = cand.clean.toUpperCase() as DetectedRfidTag['roleCode'];
      }
    }
    if (roleCode === 'U' && bestTri?.blockSource) {
      const bm = bestTri.blockSource.match(/RFID\s*-\s*([SNTGLAX])\b/i);
      if (bm) roleCode = bm[1].toUpperCase() as DetectedRfidTag['roleCode'];
    }

    // Parse A-Tag dual chainages (LOC.1: xx.xxx, LOC.2: yy.yyy) strictly for Adjustment Tags ('A') or tightly colocated
    let loc1Km: string | undefined;
    let loc2Km: string | undefined;
    let loc1Meters: number | undefined;
    let loc2Meters: number | undefined;
    let directionResetNote: string | undefined;
    const maxLocRadius = (roleCode === 'A' ? 24 : roleCode === 'U' ? 18 : 0) * scaleFactor;
    if (maxLocRadius > 0) {
      let bestLoc1Dist = maxLocRadius;
      let bestLoc2Dist = maxLocRadius;
      for (const cand of allTexts) {
        const dist = Math.hypot(cand.x - t.x, cand.y - t.y);
        if (dist > maxLocRadius) continue;
        const m1 = cand.clean.match(/(?:LOC\.?\s*1|ABS\.?\s*1)\s*[:=-]?\s*(\d{1,4}\.\d{2,3})/i);
        if (m1 && dist < bestLoc1Dist) {
          bestLoc1Dist = dist;
          loc1Km = m1[1];
          const v = Number.parseFloat(m1[1]);
          if (Number.isFinite(v)) loc1Meters = Math.round(v * 1000);
        }
        const m2 = cand.clean.match(/(?:LOC\.?\s*2|ABS\.?\s*2)\s*[:=-]?\s*(\d{1,4}\.\d{2,3})/i);
        if (m2 && dist < bestLoc2Dist) {
          bestLoc2Dist = dist;
          loc2Km = m2[1];
          const v = Number.parseFloat(m2[1]);
          if (Number.isFinite(v)) loc2Meters = Math.round(v * 1000);
        }
        const dirNote = cand.clean.match(/(Nominal\s+to\s+Reverse|Reverse\s+to\s+Nominal)/i);
        if (dirNote && !directionResetNote) {
          directionResetNote = dirNote[1];
        }
      }
      if ((loc1Meters !== undefined || loc2Meters !== undefined) && roleCode === 'U') {
        roleCode = 'A';
      }
    }

    // Find nearest plain chainage km (e.g., 32.290 or 129.430) within scaled proximity
    let chainageKm: string | undefined;
    let absMeters: number | undefined;
    if (loc1Km && loc2Km) {
      chainageKm = `${loc1Km} / ${loc2Km}`;
      absMeters = loc1Meters;
    } else {
      let bestKmDist = 34 * scaleFactor;
      for (const cand of allTexts) {
        if (!/^\d{1,4}\.\d{2,3}$/.test(cand.clean)) continue;
        const dist = Math.hypot(cand.x - t.x, cand.y - t.y);
        if (dist < bestKmDist) {
          bestKmDist = dist;
          chainageKm = cand.clean;
          const kmNum = Number.parseFloat(cand.clean);
          if (Number.isFinite(kmNum)) absMeters = Math.round(kmNum * 1000);
        }
      }
    }

    // Check if Fouling Mark (FM) is adjacent
    const hasFmNear = allTexts.some(
      (cand) => /^FM$/i.test(cand.clean) && Math.hypot(cand.x - t.x, cand.y - t.y) < 38 * scaleFactor
    );
    const isFoulingMark = rawTag.endsWith('-F') || hasFmNear;
    const finalLabel = isFoulingMark && !rawTag.endsWith('-F') ? `${rawTag}-F` : rawTag;
    const isDotted = Boolean(
      (t.blockSource || '').toLowerCase().includes('doted') ||
      (bestTri?.blockSource || '').toLowerCase().includes('doted')
    );

    rfidTags.push({
      id: `rfid_${rfidTags.length + 1}`,
      label: finalLabel,
      x: t.x,
      y: t.y,
      layer: t.layer,
      facing: bestTri ? bestTri.facing : 'UNKNOWN',
      directionLabel: 'Unknown',
      roleCode,
      roleName: rfidRoleNames[roleCode] || 'RFID Tag',
      chainageKm,
      absMeters,
      loc1Meters,
      loc2Meters,
      loc1Km,
      loc2Km,
      directionResetNote,
      isFoulingMark,
      isDotted,
      blockSource: bestTri?.blockSource || t.blockSource,
    });
  }

  // Determine Nominal (+km) vs Reverse (-km) X-axis orientation dynamically from consecutive plain tags
  const plainKmTags = rfidTags
    .filter((t) => t.roleCode !== 'A' && typeof t.absMeters === 'number')
    .sort((a, b) => a.x - b.x);
  let incVotes = 0;
  let decVotes = 0;
  for (let i = 1; i < plainKmTags.length; i++) {
    const prev = plainKmTags[i - 1];
    const cur = plainKmTags[i];
    const dm = cur.absMeters! - prev.absMeters!;
    if (Math.abs(dm) > 0 && Math.abs(dm) < 5000 && Math.abs(cur.y - prev.y) < 35 * scaleFactor) {
      if (dm > 0) incVotes++;
      else decVotes++;
    }
  }
  const kmIncreasesRight = incVotes >= decVotes;
  for (const tag of rfidTags) {
    if (tag.facing === 'RIGHT') {
      tag.directionLabel = kmIncreasesRight ? 'Nominal' : 'Reverse';
    } else if (tag.facing === 'LEFT') {
      tag.directionLabel = kmIncreasesRight ? 'Reverse' : 'Nominal';
    }
  }

  // -------------------------------------------------------------------------
  // 3. Detect Signal-Head Circles & Internal Line Patterns (Green/Yellow/Red/Double)
  // -------------------------------------------------------------------------
  const detectedCircles: Array<{ x: number; y: number; r: number; blockSource?: string; layer: string }> = [];
  for (const e of cad.entities) {
    if (
      e.type === 'CIRCLE' &&
      e.center &&
      typeof e.radius === 'number' &&
      e.radius > 0.2 &&
      e.radius < cad.bounds.width * 0.025
    ) {
      detectedCircles.push({ x: e.center.x, y: e.center.y, r: e.radius, blockSource: e.blockSource, layer: e.layer });
    } else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.points && e.points.length >= 8) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of e.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const w = maxX - minX;
      const h = maxY - minY;
      if (w > 0.4 && h > 0.4 && w < cad.bounds.width * 0.05 && Math.abs(w - h) / Math.max(w, h) < 0.2) {
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const r = (w + h) / 4;
        if (e.points.every((p) => { const d = Math.hypot(p.x - cx, p.y - cy); return d >= r * 0.78 && d <= r * 1.22; })) {
          detectedCircles.push({ x: cx, y: cy, r, blockSource: e.blockSource, layer: e.layer });
        }
      }
    }
  }

  const chordSegments: Array<{ x1: number; y1: number; x2: number; y2: number; mx: number; my: number; len: number }> = [];
  for (const e of cad.entities) {
    if ((e.type === 'LINE' || e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.points && e.points.length >= 2 && e.points.length < 8) {
      for (let i = 0; i < e.points.length - 1; i++) {
        const p1 = e.points[i];
        const p2 = e.points[i + 1];
        const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (len > 0.1 && len < cad.bounds.width * 0.05) {
          chordSegments.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2, len });
        }
      }
    }
  }

  interface CircleAspect {
    x: number;
    y: number;
    r: number;
    aspect: 'Green' | 'Yellow' | 'Double Yellow' | 'Red';
    rawPattern: string;
    blockSource?: string;
    layer: string;
  }
  const circleAspects: CircleAspect[] = [];
  for (const c of detectedCircles) {
    let horiz = 0, vert = 0, diagPos = 0, diagNeg = 0;
    for (const s of chordSegments) {
      if (Math.abs(s.mx - c.x) > c.r * 0.9 || Math.abs(s.my - c.y) > c.r * 0.9) continue;
      if (s.len < c.r * 0.6 || s.len > c.r * 2.5) continue;
      if (Math.hypot(s.x1 - c.x, s.y1 - c.y) > c.r * 1.35 || Math.hypot(s.x2 - c.x, s.y2 - c.y) > c.r * 1.35) continue;
      const angleDeg = ((Math.atan2(s.y2 - s.y1, s.x2 - s.x1) * 180) / Math.PI + 180) % 180;
      if (angleDeg <= 18 || angleDeg >= 162) horiz++;
      else if (angleDeg >= 72 && angleDeg <= 108) vert++;
      else if (angleDeg > 18 && angleDeg < 72) diagPos++;
      else diagNeg++;
    }
    if (horiz + vert + diagPos + diagNeg === 0) continue;

    let aspect: CircleAspect['aspect'] = 'Yellow';
    let rawPattern = 'Diagonal(Yellow)';
    if (horiz >= 1 && vert === 0 && diagPos === 0 && diagNeg === 0) {
      aspect = 'Green';
      rawPattern = horiz >= 2 ? 'Double-Horizontal(Green)' : 'Horizontal(Green)';
    } else if (vert >= 1 && horiz === 0 && diagPos === 0 && diagNeg === 0) {
      aspect = 'Red';
      rawPattern = vert >= 2 ? 'Double-Vertical(Red)' : 'Vertical(Red)';
    } else if (diagPos >= 2 || diagNeg >= 2) {
      aspect = 'Double Yellow';
      rawPattern = 'Double-Diagonal(Double Yellow)';
    } else if (diagPos >= 1 && diagNeg >= 1) {
      aspect = 'Yellow';
      rawPattern = 'Cross-Diagonal(Yellow)';
    } else {
      aspect = 'Yellow';
      rawPattern = 'Diagonal(Yellow)';
    }
    circleAspects.push({ x: c.x, y: c.y, r: c.r, aspect, rawPattern, blockSource: c.blockSource, layer: c.layer });
  }

  // Cluster signal head circles
  const visitedC = new Array(circleAspects.length).fill(false);
  const signalClusters: CircleAspect[][] = [];
  for (let i = 0; i < circleAspects.length; i++) {
    if (visitedC[i]) continue;
    const queue = [i];
    visitedC[i] = true;
    const grp: CircleAspect[] = [];
    while (queue.length > 0) {
      const idx = queue.shift()!;
      const cur = circleAspects[idx];
      grp.push(cur);
      for (let j = 0; j < circleAspects.length; j++) {
        if (visitedC[j]) continue;
        const other = circleAspects[j];
        if (Math.hypot(cur.x - other.x, cur.y - other.y) <= Math.max(cur.r, other.r) * 3.6) {
          visitedC[j] = true;
          queue.push(j);
        }
      }
    }
    if (grp.length >= 1 && grp.length <= 6) signalClusters.push(grp);
  }

  // Line labels present on the drawing (normalized cleanly, including Loop lines without "LINE")
  const lineLabels = allTexts.filter(
    (t) =>
    (/\b(UP|DN|DOWN|COMMON|COMM|GOODS|PASSENGER|LOOP|MAIN)\b.*\bLINE\b|\b(UP|DN|DOWN|COMMON|COMM)\s*[-]?\s*(MAIN|LOOP)\b|\bUP-COMM\s+LOOP-DN\b|\bLOOP\s*[-]?\s*\d+\b/i.test(
      t.clean
    ) &&
      t.clean.length <= 36)
  );

  const findNearestLine = (x: number, y: number, blockSource?: string): string => {
    const blkUpper = (blockSource || '').toUpperCase();
    let best = '';
    let bestScore = Infinity;
    for (const ll of lineLabels) {
      const dy = Math.abs(ll.y - y);
      const dx = Math.abs(ll.x - x);
      const score = dy * 8 + dx;
      if (score < bestScore) {
        bestScore = score;
        best = ll.clean;
      }
    }
    const normalized = normalizeLineName(best || 'MAIN LINE');
    // If CAD block explicitly identifies a Loop Line Starter/Signal and no explicit loop text label was closer,
    // honor the CAD block's loop classification cleanly.
    if (blkUpper.includes('LOOP') && !normalized.includes('LOOP')) {
      return 'COMMON LOOP LINE';
    }
    return normalized;
  };

  // Match each signal-head cluster with its Signal ID (robust railway numbering)
  const signals: DetectedSignal[] = [];
  const usedSignalTexts = new Set<string>();

  const findNearestFootTag = (x: number, y: number): DetectedRfidTag | undefined => {
    const sTag = rfidTags
      .filter((rt) => rt.roleCode === 'S' && Math.hypot(rt.x - x, rt.y - y) <= 75 * scaleFactor)
      .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    if (sTag) return sTag;
    return rfidTags
      .filter((rt) => Math.hypot(rt.x - x, rt.y - y) <= 65 * scaleFactor)
      .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
  };

  const tryParseSignalToken = (
    raw: string,
    x: number,
    y: number
  ): { normalizedLabel: string; isCallingOn: boolean } | null => {
    const clean = raw.trim();
    if (!clean || clean.length > 15) return null;
    if (
      /^(?:UP|DN|DOWN|NO|ALT|REV|KM|CH|REF|VER|PU|IN|PT|N|FM|DP|BSLB|SLB|CLASS|GATE|LINE|LOOP|STATION|BUILDING|RFID|TIN|DRG|PLAN|SCALE|DATE|REV\.NO)/i.test(
        clean
      )
    ) {
      return null;
    }
    if (/^\d{3,}$/.test(clean) || /^\d+\.\d+$/.test(clean)) return null;

    // 1. Explicit Signal Prefixes: S1, S1D, S1 ID, S30, S30A, S24, SH1, C1, GS1, GS1D, IB1
    const explicitMatch = clean.match(
      /^(S|SH|GS|C|IB)[-]?(\d{1,3})(?:\s*(ID|D|A|B|C|S|CO)|\s*10|\s*([A-Z]*))?$/i
    );
    if (explicitMatch) {
      const prefix = explicitMatch[1].toUpperCase();
      const num = explicitMatch[2];
      let suffix = (explicitMatch[3] || explicitMatch[4] || '').toUpperCase();
      if (suffix === '10') suffix = 'ID';
      const norm = `${prefix}${num}${suffix ? (suffix === 'ID' ? ' ID' : suffix) : ''}`;
      const isCo = prefix === 'C' || suffix === 'A' || suffix === 'CO';
      return { normalizedLabel: norm, isCallingOn: isCo };
    }

    // 2. Numeric with Signal Suffix: 1D, 1ID, 1 ID, 30D, 30ID, 30 ID, 3010, 1A, 30A, 1S, 1s
    const suffixMatch = clean.match(/^(\d{1,3})(?:\s*(ID|D|A|B|C|S|CO)|10)$/i);
    if (suffixMatch) {
      const num = suffixMatch[1];
      let suffix = suffixMatch[2] ? suffixMatch[2].toUpperCase() : 'ID';
      if (suffix === 'S' || suffix === 's') suffix = '';
      const norm = `S${num}${suffix ? (suffix === 'ID' ? ' ID' : suffix) : ''}`;
      const isCo = suffix === 'A' || suffix === 'CO';
      return { normalizedLabel: norm, isCallingOn: isCo };
    }

    // 3. Standalone numeric signal number (1-99), e.g., 1, 3, 4, 24, 25, 26, 27, 30
    // Must be close to an RFID foot tag or a detected signal head circle
    const numMatch = clean.match(/^(\d{1,2})$/);
    if (numMatch) {
      const num = numMatch[1];
      const hasFootTag = rfidTags.some((rt) => Math.hypot(rt.x - x, rt.y - y) <= 75 * scaleFactor);
      const hasCircle = signalClusters.some((grp) => {
        const cx = grp.reduce((acc, g) => acc + g.x, 0) / grp.length;
        const cy = grp.reduce((acc, g) => acc + g.y, 0) / grp.length;
        return Math.hypot(cx - x, cy - y) <= 65 * scaleFactor;
      });
      if (hasFootTag || hasCircle) {
        return { normalizedLabel: `S${num}`, isCallingOn: false };
      }
    }

    return null;
  };

  for (const grp of signalClusters.sort((a, b) => a[0].x - b[0].x)) {
    const cx = grp.reduce((acc, g) => acc + g.x, 0) / grp.length;
    const cy = grp.reduce((acc, g) => acc + g.y, 0) / grp.length;
    const avgR = grp.reduce((acc, g) => acc + g.r, 0) / grp.length;
    const blockSource = grp.find((g) => g.blockSource)?.blockSource;
    const layer = grp[0].layer;

    const nearby = allTexts
      .filter((t) => Math.hypot(t.x - cx, t.y - cy) <= Math.max(avgR * 20, 52 * scaleFactor))
      .sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));

    let primaryMatch: { token: (typeof allTexts)[0]; norm: string; isCo: boolean } | null = null;
    let callingOnMatch: { token: (typeof allTexts)[0]; norm: string } | null = null;

    for (const t of nearby) {
      if (usedSignalTexts.has(t.id)) continue;
      const parsed = tryParseSignalToken(t.clean, t.x, t.y);
      if (!parsed) continue;
      if (parsed.isCallingOn && !callingOnMatch) {
        callingOnMatch = { token: t, norm: parsed.normalizedLabel };
      } else if (!primaryMatch) {
        primaryMatch = { token: t, norm: parsed.normalizedLabel, isCo: parsed.isCallingOn };
      }
    }

    if (!primaryMatch) continue;

    usedSignalTexts.add(primaryMatch.token.id);
    if (callingOnMatch) usedSignalTexts.add(callingOnMatch.token.id);

    const yellowCount = grp.filter((g) => g.aspect === 'Yellow').length;
    const aspectSet = new Set<string>();
    for (const g of grp) aspectSet.add(g.aspect);
    if (yellowCount >= 2) aspectSet.add('Double Yellow');
    const orderedAspects = ['Green', 'Double Yellow', 'Yellow', 'Red'].filter((a) => aspectSet.has(a));

    const footTag = findNearestFootTag(cx, cy);
    const line = findNearestLine(cx, cy, blockSource);
    const cls = classifySignalType(primaryMatch.norm, blockSource, line);
    const isDotted = Boolean((blockSource || '').toLowerCase().includes('doted'));
    const facing = footTag ? footTag.facing : 'UNKNOWN';
    const directionLabel = footTag ? footTag.directionLabel : 'Unknown';

    let stationTag: string | undefined;
    if (isDotted) {
      if (leftAdjStation && Math.abs(cx - leftAdjStation.x) < 220 * scaleFactor) stationTag = leftAdjStation.name;
      else if (rightAdjStation && Math.abs(cx - rightAdjStation.x) < 220 * scaleFactor) stationTag = rightAdjStation.name;
    }

    const mainSig: DetectedSignal = {
      id: `sig_${signals.length + 1}`,
      label: primaryMatch.norm,
      rawLabel: primaryMatch.token.clean,
      x: cx,
      y: cy,
      layer,
      blockSource,
      aspects: orderedAspects,
      aspectPatternText: grp.map((g) => g.rawPattern).join(' + '),
      facing,
      directionLabel,
      line,
      sectionType: cls.sectionType,
      signalType: cls.signalType,
      footTag,
      callingOnLabel: callingOnMatch?.norm,
      isDotted,
      isShunt: cls.isShunt,
      isCallingOn: cls.isCallingOn,
      isLss: cls.isLss,
      stationTag,
    };
    signals.push(mainSig);

    // Only create a distinct Calling-On signal for MAIN station signals (skip dotted adjacent-station Calling-On duplicates!)
    if (callingOnMatch && !isDotted) {
      signals.push({
        id: `sig_${signals.length + 1}`,
        label: callingOnMatch.norm,
        rawLabel: callingOnMatch.token.clean,
        x: callingOnMatch.token.x,
        y: callingOnMatch.token.y,
        layer: callingOnMatch.token.layer,
        blockSource: 'CALLING-ON',
        aspects: ['Miniature'],
        aspectPatternText: 'Calling-on Miniature (C)',
        facing,
        directionLabel,
        line,
        sectionType: 'Station Section',
        signalType: 'Calling-on',
        footTag,
        isDotted: false,
        isShunt: false,
        isCallingOn: true,
        isLss: false,
      });
    }
  }

  // Fallback for vector PDFs or CAD drawings where signal heads use filled/non-chord circles:
  // Capture remaining running signal labels (e.g., S1, S1D, S1 ID, S1A, S3, S25, S30A) directly from spatial text
  for (const t of allTexts) {
    if (usedSignalTexts.has(t.id)) continue;
    const parsed = tryParseSignalToken(t.clean, t.x, t.y);
    if (!parsed) continue;

    // Skip duplicate text already matched within close proximity
    if (
      signals.some(
        (s) =>
          s.label.toUpperCase() === parsed.normalizedLabel.toUpperCase() &&
          Math.hypot(s.x - t.x, s.y - t.y) < 45 * scaleFactor
      )
    ) {
      continue;
    }
    usedSignalTexts.add(t.id);

    const line = findNearestLine(t.x, t.y, t.blockSource);
    const cls = classifySignalType(parsed.normalizedLabel, t.blockSource, line);
    const footTag = findNearestFootTag(t.x, t.y);
    const isDotted = Boolean((t.blockSource || '').toLowerCase().includes('doted'));

    // Infer aspect set cleanly from signal type when vector chords are absent
    const fallbackAspects = cls.isCallingOn
      ? ['Miniature']
      : cls.sectionType === 'Absolute Block'
        ? ['Green', 'Double Yellow', 'Yellow']
        : line.includes('LOOP')
          ? ['Yellow', 'Red']
          : ['Green', 'Double Yellow', 'Yellow', 'Red'];

    signals.push({
      id: `sig_${signals.length + 1}`,
      label: parsed.normalizedLabel,
      rawLabel: t.clean,
      x: t.x,
      y: t.y,
      layer: t.layer,
      blockSource: t.blockSource,
      aspects: fallbackAspects,
      aspectPatternText: cls.isCallingOn ? 'Calling-on Miniature (C)' : 'Detected from layout label',
      facing: footTag ? footTag.facing : 'UNKNOWN',
      directionLabel: footTag ? footTag.directionLabel : 'Unknown',
      line,
      sectionType: cls.sectionType,
      signalType: cls.signalType,
      footTag,
      isDotted,
      isShunt: cls.isShunt,
      isCallingOn: cls.isCallingOn,
      isLss: cls.isLss,
    });
  }

  // Infer traffic direction for any signals/tags lacking triangle facing (common on vector PDFs):
  // Dynamically derive direction per line from Distant/Inner Distant -> Home signal relative X positions!
  const lineFacingMap = new Map<string, 'RIGHT' | 'LEFT'>();
  for (const s of signals) {
    if (s.facing !== 'UNKNOWN' && !s.line.includes('LOOP') && !lineFacingMap.has(s.line)) {
      lineFacingMap.set(s.line, s.facing);
    }
  }
  for (const distSig of signals) {
    if (distSig.sectionType !== 'Absolute Block') continue;
    // Match base signal number (e.g., S1D / S1 ID -> S1; S30 ID -> S30)
    const baseMatch = (distSig.label || distSig.rawLabel).match(/^(S[-]?\d+)/i);
    if (!baseMatch) continue;
    const basePrefix = baseMatch[1].toUpperCase();
    const homeSig = signals.find(
      (s) =>
        s.id !== distSig.id &&
        s.sectionType === 'Station Section' &&
        !s.isCallingOn &&
        (s.label.toUpperCase() === basePrefix || s.rawLabel.toUpperCase() === basePrefix)
    );
    if (homeSig && Math.abs(homeSig.x - distSig.x) > 10) {
      const inferred: 'RIGHT' | 'LEFT' = homeSig.x > distSig.x ? 'RIGHT' : 'LEFT';
      lineFacingMap.set(homeSig.line, inferred);
      lineFacingMap.set(distSig.line, inferred);
    }
  }
  for (const s of signals) {
    if (s.facing === 'UNKNOWN') {
      let inferred = lineFacingMap.get(s.line);
      if (!inferred) {
        if (s.signalType === 'Distant' || s.signalType === 'Inner Distant') {
          inferred = s.x < cad.bounds.width * 0.5 ? 'RIGHT' : 'LEFT';
        } else {
          const rightCand = signals.find((c) => c.id !== s.id && c.x > s.x + 10 && Math.abs(c.y - s.y) <= yBandTol);
          const leftCand = signals.find((c) => c.id !== s.id && c.x < s.x - 10 && Math.abs(c.y - s.y) <= yBandTol);
          if (rightCand && !leftCand) inferred = 'RIGHT';
          else if (leftCand && !rightCand) inferred = 'LEFT';
          else inferred = s.x < cad.bounds.width * 0.5 ? 'RIGHT' : 'LEFT';
        }
      }
      if (inferred) {
        s.facing = inferred;
        s.directionLabel =
          inferred === 'RIGHT'
            ? kmIncreasesRight
              ? 'Nominal'
              : 'Reverse'
            : kmIncreasesRight
              ? 'Reverse'
              : 'Nominal';
      }
    }
  }
  for (const tag of rfidTags) {
    if (tag.facing === 'UNKNOWN') {
      const tagLine = findNearestLine(tag.x, tag.y, tag.blockSource);
      const inferred =
        lineFacingMap.get(tagLine) ||
        (tagLine.includes('DN') ? (kmIncreasesRight ? 'RIGHT' : 'LEFT') : tagLine.includes('UP') ? (kmIncreasesRight ? 'LEFT' : 'RIGHT') : undefined) ||
        (tag.x < cad.bounds.width * 0.5 ? 'RIGHT' : 'LEFT');
      if (inferred) {
        tag.facing = inferred;
        tag.directionLabel =
          inferred === 'RIGHT'
            ? kmIncreasesRight
              ? 'Nominal'
              : 'Reverse'
            : kmIncreasesRight
              ? 'Reverse'
              : 'Nominal';
      }
    }
  }

  // Disambiguate dotted adjacent-station signal labels that collide with main-station signal IDs (zero duplicates!)
  const mainLabelSet = new Set(signals.filter((s) => !s.isDotted).map((s) => s.rawLabel.toUpperCase()));
  for (const s of signals) {
    if (s.isDotted && mainLabelSet.has(s.rawLabel.toUpperCase())) {
      s.label = s.stationTag ? `${s.rawLabel} (${s.stationTag})` : `${s.rawLabel} (Adj)`;
    }
  }

  // Also capture Shunt signals (e.g., SH9, SH10, SH23)
  for (const t of allTexts) {
    if (usedSignalTexts.has(t.id)) continue;
    if (/^SH[-\s]?\d+[A-Z]?$/i.test(t.clean)) {
      const line = findNearestLine(t.x, t.y, t.blockSource);
      const nearestTag = rfidTags
        .filter((rt) => Math.hypot(rt.x - t.x, rt.y - t.y) <= 65 * scaleFactor)
        .sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y))[0];
      signals.push({
        id: `sig_${signals.length + 1}`,
        label: t.clean,
        rawLabel: t.clean,
        x: t.x,
        y: t.y,
        layer: t.layer,
        blockSource: t.blockSource || 'SHUNT',
        aspects: ['Miniature'],
        aspectPatternText: 'Shunt Signal',
        facing: nearestTag?.facing || 'UNKNOWN',
        directionLabel: nearestTag?.directionLabel || 'Unknown',
        line,
        sectionType: 'Station Section',
        signalType: 'Shunt',
        footTag: nearestTag,
        isDotted: false,
        isShunt: true,
        isCallingOn: false,
        isLss: false,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 4. Extract Turnout Points, TINs, Track Circuits / Axle Counter DPs, LC Gates & FM
  // -------------------------------------------------------------------------
  const points: SimpleItem[] = [];
  const tins: SimpleItem[] = [];
  const trackCircuits: SimpleItem[] = [];
  const lcGates: SimpleItem[] = [];
  const foulingMarks: SimpleItem[] = [];
  const seenMisc = new Set<string>();

  for (const t of allTexts) {
    const c = t.clean;
    // TIN: (N-205), N-204, TIN-12
    const tinMatch = c.match(/^\(?((?:TIN)-\d+[A-Z]?)\)?$/i);
    if (tinMatch) {
      const lbl = tinMatch[1].toUpperCase();
      const key = `tin:${lbl}`;
      if (!seenMisc.has(key)) {
        seenMisc.add(key);
        tins.push({ id: `tin_${tins.length + 1}`, label: lbl, x: t.x, y: t.y, layer: t.layer, subType: 'Track Identification Number' });
      }
      continue;
    }

    // Pointers / Turnout Points: P-17, PT-101, N-45, IN-46, N51, N53, N56 (Indian Railways crossover normal/reverse points)
    if (
      (/^(?:P-[A-Z0-9]+|PT[-\s]?\d+[A-Z0-9]*|P\d+[A-Z0-9]*|[I|]?N[-\s]?\d+[A-Z0-9]*)$/i.test(c) ||
        /^\d+[A-Z]?\s*(?:A|B)?\s*PT$/i.test(c)) &&
      !/^DP/i.test(c) &&
      !/^NOMINAL/i.test(c) &&
      !/^NO\b/i.test(c)
    ) {
      const cleanPt = c.toUpperCase().replace(/^[I|]/, '').trim();
      const key = `pt:${cleanPt}`;
      if (!seenMisc.has(key)) {
        seenMisc.add(key);
        points.push({
          id: `pt_${points.length + 1}`,
          label: cleanPt,
          x: t.x,
          y: t.y,
          layer: t.layer,
          subType: 'Pointer (Point)',
        });
      }
      continue;
    }

    // Axle Counter Detection Point (DP2A, DP4B) -> track_circuit category, NOT turnout point!
    if (/^DP[-\s]?\d+[A-Z]?$/i.test(c)) {
      const key = `dp:${c.toUpperCase()}`;
      if (!seenMisc.has(key)) {
        seenMisc.add(key);
        trackCircuits.push({
          id: `tc_${trackCircuits.length + 1}`,
          label: c.toUpperCase(),
          x: t.x,
          y: t.y,
          layer: t.layer,
          subType: 'Axle Counter Detection Point (DP)',
        });
      }
      continue;
    }

    // Track Circuit / Axle Counter: 08T, 09T, C01T, 08AC, 3329AC, UP_BPAC-1, DMT, UMT, CLT, ULT
    if (/^(?:\d+[A-Z]?T|C\d+T|\d+AC|(?:UP|DN)[_-]?BPAC[-\s]?\d+|DMT|UMT|CLT|ULT|MLT|LLT)$/i.test(c)) {
      const key = `tc:${c.toUpperCase()}`;
      if (!seenMisc.has(key)) {
        seenMisc.add(key);
        trackCircuits.push({
          id: `tc_${trackCircuits.length + 1}`,
          label: c,
          x: t.x,
          y: t.y,
          layer: t.layer,
          subType: /AC|BPAC/i.test(c) ? 'Axle Counter Section' : 'Track Circuit',
        });
      }
      continue;
    }

    // LC Gate labels
    if (/\bLC[\s.-]*(?:NO\.?|GATE)?[\s.-]*\d+/i.test(c) || (t.layer.toLowerCase().includes('lc') && /\d+/.test(c))) {
      const key = `lc:${c.toUpperCase()}`;
      if (!seenMisc.has(key)) {
        seenMisc.add(key);
        lcGates.push({ id: `lc_${lcGates.length + 1}`, label: c, x: t.x, y: t.y, layer: t.layer, subType: 'Level Crossing Gate' });
      }
      continue;
    }

    // Fouling Mark (FM) / Shunt Limit Board (BSLB / SLB) — uniquely qualified by nearest RFID tag to avoid duplicate FM labels
    if (/^(?:FM|BSLB|SLB)$/i.test(c)) {
      const nearestTag = rfidTags
        .filter((rt) => Math.hypot(rt.x - t.x, rt.y - t.y) < 45)
        .sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y))[0];
      const uniqueLabel = nearestTag ? `${c.toUpperCase()} (${nearestTag.label})` : `${c.toUpperCase()}-${foulingMarks.length + 1}`;
      const key = `fm:${uniqueLabel}`;
      if (!seenMisc.has(key)) {
        seenMisc.add(key);
        foulingMarks.push({
          id: `fm_${foulingMarks.length + 1}`,
          label: uniqueLabel,
          x: t.x,
          y: t.y,
          layer: t.layer,
          subType: /^FM$/i.test(c) ? 'Fouling Mark' : 'Shunting Limit Board',
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 5. Build Complete Deduplicated ExtractedComponent List
  // -------------------------------------------------------------------------
  const components: ExtractedComponent[] = [];

  for (const s of signals) {
    components.push({
      id: s.id,
      label: s.label,
      category: 'signal',
      subType: s.signalType,
      direction: s.directionLabel,
      chainageKm: s.footTag?.chainageKm,
      absoluteLocationMeters: s.footTag?.absMeters,
      layer: s.layer,
      pageOrLayout: 'Model Space',
      properties: {
        signalType: s.signalType,
        sectionType: s.sectionType,
        line: s.line,
        aspects: s.aspects.join(', '),
        aspectPattern: s.aspectPatternText,
        footTag: s.footTag?.label || '',
        facing: s.facing,
        ...(s.stationTag ? { station: s.stationTag } : {}),
        ...(s.blockSource ? { cadBlock: s.blockSource } : {}),
      },
      relatedIds: s.footTag ? [s.footTag.id] : [],
      confidence: 0.94,
      sourceTrace: `CAD (X:${Math.round(s.x)}, Y:${Math.round(s.y)})`,
    });
  }

  for (const r of rfidTags) {
    components.push({
      id: r.id,
      label: r.label,
      category: 'rfid_tag',
      subType: r.roleName,
      direction: r.directionLabel,
      chainageKm: r.chainageKm,
      absoluteLocationMeters: r.absMeters,
      layer: r.layer,
      pageOrLayout: 'Model Space',
      properties: {
        tagCode: r.roleCode,
        tagDirection: `${r.directionLabel} (Facing ${r.facing})`,
        facing: r.facing,
        ...(r.loc1Km ? { loc1Km: r.loc1Km } : {}),
        ...(r.loc2Km ? { loc2Km: r.loc2Km } : {}),
        ...(r.directionResetNote ? { directionReset: r.directionResetNote } : {}),
        ...(r.isFoulingMark ? { foulingMark: 'Yes (-F)' } : {}),
        ...(r.blockSource ? { cadBlock: r.blockSource } : {}),
      },
      relatedIds: [],
      confidence: 0.95,
      sourceTrace: `CAD (X:${Math.round(r.x)}, Y:${Math.round(r.y)})`,
    });
  }

  for (const p of points) {
    components.push({
      id: p.id,
      label: p.label,
      category: 'point',
      subType: p.subType,
      direction: 'Both',
      layer: p.layer,
      pageOrLayout: 'Model Space',
      properties: {},
      relatedIds: [],
      confidence: 0.92,
      sourceTrace: `CAD (X:${Math.round(p.x)}, Y:${Math.round(p.y)})`,
    });
  }

  for (const tin of tins) {
    components.push({
      id: tin.id,
      label: tin.label,
      category: 'tin',
      subType: tin.subType,
      direction: 'Unknown',
      layer: tin.layer,
      pageOrLayout: 'Model Space',
      properties: {},
      relatedIds: [],
      confidence: 0.92,
      sourceTrace: `CAD (X:${Math.round(tin.x)}, Y:${Math.round(tin.y)})`,
    });
  }

  for (const tc of trackCircuits) {
    components.push({
      id: tc.id,
      label: tc.label,
      category: 'track_circuit',
      subType: tc.subType,
      direction: 'Unknown',
      layer: tc.layer,
      pageOrLayout: 'Model Space',
      properties: {},
      relatedIds: [],
      confidence: 0.88,
      sourceTrace: `CAD (X:${Math.round(tc.x)}, Y:${Math.round(tc.y)})`,
    });
  }

  for (const lc of lcGates) {
    components.push({
      id: lc.id,
      label: lc.label,
      category: 'lc_gate',
      subType: lc.subType,
      direction: 'Both',
      layer: lc.layer,
      pageOrLayout: 'Model Space',
      properties: {},
      relatedIds: [],
      confidence: 0.88,
      sourceTrace: `CAD (X:${Math.round(lc.x)}, Y:${Math.round(lc.y)})`,
    });
  }

  for (const fm of foulingMarks) {
    components.push({
      id: fm.id,
      label: fm.label,
      category: 'shunting_limit',
      subType: fm.subType,
      direction: 'Both',
      layer: fm.layer,
      pageOrLayout: 'Model Space',
      properties: {},
      relatedIds: [],
      confidence: 0.9,
      sourceTrace: `CAD (X:${Math.round(fm.x)}, Y:${Math.round(fm.y)})`,
    });
  }

  // -------------------------------------------------------------------------
  // 6. Build Bidirectional Forward & Reverse Entry->Exit Signal Routes
  //    with A-Tag LOC.1/LOC.2 Reset Support & Block-Section TIN Classification
  // -------------------------------------------------------------------------
  const relationships: ComponentRelationship[] = [];
  const tables: Record<KavachTableId, TableRowRecord[]> = createEmptyTables();

  const runningSignals = signals.filter((s) => !s.isShunt);
  const nonCallingSignals = runningSignals.filter((s) => !s.isCallingOn);
  const yBandTol = Math.max(cad.bounds.height * 0.11, 22);

  // Determine station yard X extent from main-station Home/Starter signals (non-dotted Station Section signals)
  const yardSignals = runningSignals.filter((s) => !s.isDotted && s.sectionType === 'Station Section');
  const yardMinX = yardSignals.length > 0 ? Math.min(...yardSignals.map((s) => s.x)) - 20 : cad.bounds.minX;
  const yardMaxX = yardSignals.length > 0 ? Math.max(...yardSignals.map((s) => s.x)) + 20 : cad.bounds.maxX;

  // Identify Block Section TINs (TINs located outside the station yard X extent)
  const blockTins = tins.filter((tin) => tin.x < yardMinX || tin.x > yardMaxX);
  const blockTinSet = new Set(blockTins.map((t) => t.label));

  // Helper to find the Block Section TIN and its parallel Adjacent Line TIN for a block corridor
  const findBlockAndAdjacentTin = (
    routeX: number,
    routeY: number
  ): { blockTin: string; adjacentTin: string } => {
    const sideBlockTins = blockTins.filter((bt) =>
      routeX < yardMinX ? bt.x < yardMinX : routeX > yardMaxX ? bt.x > yardMaxX : true
    );
    const pool = sideBlockTins.length > 0 ? sideBlockTins : blockTins;
    const sameTrack = pool
      .filter((bt) => Math.abs(bt.y - routeY) <= yBandTol)
      .sort((a, b) => Math.abs(a.x - routeX) - Math.abs(b.x - routeX))[0];
    const oppositeTrack = pool
      .filter((bt) => Math.abs(bt.y - routeY) > yBandTol)
      .sort((a, b) => Math.abs(a.x - (sameTrack?.x ?? routeX)) - Math.abs(b.x - (sameTrack?.x ?? routeX)))[0];
    return {
      blockTin: sameTrack?.label || '',
      adjacentTin: oppositeTrack?.label || '',
    };
  };

  interface ATagResetInfo {
    tag: DetectedRfidTag;
    startDistMeters: number;
    correctionMeters: number;
    directionAfterAdj: 'Nominal' | 'Reverse';
  }

  interface CorridorRoute {
    entry: DetectedSignal;
    exit: DetectedSignal;
    enRouteTags: DetectedRfidTag[];
    segmentDistances: Array<number | null>; // length = enRouteTags.length - 1
    tagSequenceStr: string;
    distanceMeters: number | null;
    aTagReset?: ATagResetInfo;
    inRoutePointsNormal: string[];
    inRoutePointsReverse: string[];
    inRouteTcs: string[];
    inRouteTins: string[];
    inRouteLc?: SimpleItem;
    inRouteFm?: SimpleItem;
    isCrossoverOrLoopTurnout: boolean;
  }

  const forwardRoutes: CorridorRoute[] = [];
  const seenRouteKeys = new Set<string>();

  const buildRouteBetween = (
    entry: DetectedSignal,
    exit: DetectedSignal,
    isCrossoverOrLoopTurnout: boolean
  ) => {
    const routeKey = `${entry.label.toUpperCase()}->${exit.label.toUpperCase()}`;
    if (seenRouteKeys.has(routeKey)) return;
    seenRouteKeys.add(routeKey);

    const minX = Math.min(entry.x, exit.x) - 18 * scaleFactor;
    const maxX = Math.max(entry.x, exit.x) + 18 * scaleFactor;
    const minY = Math.min(entry.y, exit.y) - yBandTol;
    const maxY = Math.max(entry.y, exit.y) + yBandTol;

    // Collect ordered en-route RFID tags matching this travel direction
    const routeTags = rfidTags
      .filter((rt) => {
        if (rt.facing !== 'UNKNOWN' && rt.facing !== entry.facing) return false;
        if (rt.x < minX || rt.x > maxX || rt.y < minY || rt.y > maxY) return false;
        if (!isCrossoverOrLoopTurnout) return true;
        // For diagonal diverging/converging loop routes, keep tags close to the linear path between entry & exit
        const dx = exit.x - entry.x;
        const frac = Math.abs(dx) > 1 ? Math.max(0, Math.min(1, (rt.x - entry.x) / dx)) : 0.5;
        const interpY = entry.y + (exit.y - entry.y) * frac;
        return Math.abs(rt.y - interpY) <= yBandTol * 1.15;
      })
      .sort((a, b) => (entry.facing === 'RIGHT' ? a.x - b.x : b.x - a.x));

    const orderedTags: DetectedRfidTag[] = [];
    if (entry.footTag) orderedTags.push(entry.footTag);
    for (const rt of routeTags) {
      if (!orderedTags.some((o) => o.id === rt.id)) orderedTags.push(rt);
    }
    if (exit.footTag && !orderedTags.some((o) => o.id === exit.footTag!.id)) {
      orderedTags.push(exit.footTag);
    }

    // Compute exact linking distances across all tags, seamlessly handling A-Tags (LOC.1 / LOC.2)!
    const seqParts: string[] = [];
    const segmentDistances: Array<number | null> = [];
    let totalDist = 0;
    let hasAllSegs = orderedTags.length >= 2;
    let aTagReset: ATagResetInfo | undefined;

    for (let i = 0; i < orderedTags.length; i++) {
      if (i === 0) {
        seqParts.push(`(0, ${orderedTags[i].label})`);
      } else {
        const prevTag = orderedTags[i - 1];
        const curTag = orderedTags[i];
        const { segMeters, usedCurMeters } = computeConsecutiveTagDistance(prevTag, curTag);
        segmentDistances.push(segMeters);
        if (segMeters !== null) {
          totalDist += segMeters;
          seqParts.push(`(${segMeters}, ${curTag.label})`);
          if (
            curTag.roleCode === 'A' &&
            typeof curTag.loc1Meters === 'number' &&
            typeof curTag.loc2Meters === 'number' &&
            !aTagReset
          ) {
            const incomingM = usedCurMeters ?? curTag.loc1Meters;
            const outgoingM = incomingM === curTag.loc1Meters ? curTag.loc2Meters : curTag.loc1Meters;
            const correction = Math.abs(outgoingM - incomingM);
            let dirAfter: 'Nominal' | 'Reverse' = entry.directionLabel === 'Reverse' ? 'Reverse' : 'Nominal';
            if (curTag.directionResetNote) {
              if (/to\s+Reverse/i.test(curTag.directionResetNote)) dirAfter = 'Reverse';
              else if (/to\s+Nominal/i.test(curTag.directionResetNote)) dirAfter = 'Nominal';
            } else if (i + 1 < orderedTags.length) {
              const nextTag = orderedTags[i + 1];
              if (typeof nextTag.absMeters === 'number') {
                dirAfter = nextTag.absMeters >= outgoingM ? 'Nominal' : 'Reverse';
              }
            }
            aTagReset = {
              tag: curTag,
              startDistMeters: totalDist,
              correctionMeters: correction,
              directionAfterAdj: dirAfter,
            };
          }
        } else {
          hasAllSegs = false;
          seqParts.push(`(?, ${curTag.label})`);
        }
      }
    }

    const directDist =
      typeof entry.footTag?.absMeters === 'number' && typeof exit.footTag?.absMeters === 'number'
        ? Math.abs(exit.footTag.absMeters - entry.footTag.absMeters)
        : null;
    const distanceMeters = hasAllSegs ? totalDist : directDist;

    // Only genuine turnout points (P..., PT...) inside this route (never Axle Counter DPs!)
    const inRoutePoints = Array.from(
      new Set(
        points
          .filter(
            (p) =>
              p.x >= Math.min(entry.x, exit.x) &&
              p.x <= Math.max(entry.x, exit.x) &&
              p.y >= Math.min(entry.y, exit.y) - yBandTol &&
              p.y <= Math.max(entry.y, exit.y) + yBandTol
          )
          .map((p) => p.label)
      )
    );

    const acAndTcs = trackCircuits.filter(
      (tc) =>
        tc.subType !== 'Axle Counter Detection Point (DP)' &&
        tc.x >= Math.min(entry.x, exit.x) - 10 * scaleFactor &&
        tc.x <= Math.max(entry.x, exit.x) + 10 * scaleFactor &&
        tc.y >= Math.min(entry.y, exit.y) - yBandTol &&
        tc.y <= Math.max(entry.y, exit.y) + yBandTol
    );
    const inRouteTcs = Array.from(new Set(acAndTcs.map((tc) => tc.label)));

    // Station yard TINs only (NEVER include Block Section TINs in TINs Requires Free per RDSO Cl. I.2.11.12!)
    const inRouteTins = Array.from(
      new Set(
        tins
          .filter(
            (tin) =>
              !blockTinSet.has(tin.label) &&
              tin.x >= Math.min(entry.x, exit.x) &&
              tin.x <= Math.max(entry.x, exit.x) &&
              tin.y >= Math.min(entry.y, exit.y) - yBandTol &&
              tin.y <= Math.max(entry.y, exit.y) + yBandTol
          )
          .map((tin) => tin.label)
      )
    );

    const inRouteLc = lcGates.find(
      (lc) => lc.x >= Math.min(entry.x, exit.x) && lc.x <= Math.max(entry.x, exit.x)
    );
    const inRouteFm = foulingMarks.find(
      (fm) =>
        fm.x >= Math.min(entry.x, exit.x) &&
        fm.x <= Math.max(entry.x, exit.x) &&
        fm.y >= Math.min(entry.y, exit.y) - yBandTol &&
        fm.y <= Math.max(entry.y, exit.y) + yBandTol
    );

    forwardRoutes.push({
      entry,
      exit,
      enRouteTags: orderedTags,
      segmentDistances,
      tagSequenceStr: seqParts.join(', '),
      distanceMeters,
      aTagReset,
      inRoutePointsNormal: isCrossoverOrLoopTurnout ? [] : inRoutePoints,
      inRoutePointsReverse: isCrossoverOrLoopTurnout ? inRoutePoints : [],
      inRouteTcs,
      inRouteTins,
      inRouteLc,
      inRouteFm,
      isCrossoverOrLoopTurnout,
    });
  };

  for (const entry of runningSignals) {
    if (entry.facing === 'UNKNOWN') {
      entry.facing = entry.x < cad.bounds.width * 0.5 ? 'RIGHT' : 'LEFT';
    }
    // Dotted adjacent-station signals are Exit targets, never Entry origins for this station
    if (entry.isDotted) continue;

    // 1. Primary straight corridor downstream signal (same Y-band, same facing)
    const downstreamCandidates = nonCallingSignals.filter((cand) => {
      if (cand.id === entry.id) return false;
      if (entry.isCallingOn && entry.footTag && cand.footTag && cand.footTag.id === entry.footTag.id) {
        return false;
      }
      if (entry.isCallingOn && Math.abs(cand.x - entry.x) < 25 * scaleFactor) return false;
      if (cand.facing !== 'UNKNOWN' && cand.facing !== entry.facing) return false;
      if (Math.abs(cand.y - entry.y) > yBandTol) return false;
      return entry.facing === 'RIGHT' ? cand.x > entry.x + 8 : cand.x < entry.x - 8;
    });

    if (downstreamCandidates.length > 0) {
      downstreamCandidates.sort((a, b) => Math.abs(a.x - entry.x) - Math.abs(b.x - entry.x));
      buildRouteBetween(entry, downstreamCandidates[0], false);
    } else if (entry.line.includes('LOOP')) {
      // 2. Converging Loop Starter -> adjacent Main Line Advance Starter / Exit via turnout points (Reverse)
      const convergingCandidates = nonCallingSignals.filter((cand) => {
        if (cand.id === entry.id || cand.line.includes('LOOP')) return false;
        if (cand.facing !== 'UNKNOWN' && cand.facing !== entry.facing) return false;
        if (Math.abs(cand.y - entry.y) > yBandTol * 3.0) return false;
        const ahead = entry.facing === 'RIGHT' ? cand.x > entry.x + 8 : cand.x < entry.x - 8;
        if (!ahead) return false;
        // Require a turnout point between entry and converging exit
        return points.some(
          (p) =>
            p.x >= Math.min(entry.x, cand.x) - 10 &&
            p.x <= Math.max(entry.x, cand.x) + 10 &&
            p.y >= Math.min(entry.y, cand.y) - yBandTol &&
            p.y <= Math.max(entry.y, cand.y) + yBandTol
        );
      });
      if (convergingCandidates.length > 0) {
        convergingCandidates.sort(
          (a, b) => Math.hypot(a.x - entry.x, a.y - entry.y) - Math.hypot(b.x - entry.x, b.y - entry.y)
        );
        buildRouteBetween(entry, convergingCandidates[0], true);
      }
    }

    // 3. Main Line Home Signal -> Diverging Loop Line Starter via turnout points (Reverse)
    if (!entry.line.includes('LOOP') && !entry.isCallingOn && entry.sectionType === 'Station Section') {
      const divergingLoopTargets = nonCallingSignals.filter((cand) => {
        if (cand.id === entry.id || !cand.line.includes('LOOP')) return false;
        if (cand.facing !== 'UNKNOWN' && cand.facing !== entry.facing) return false;
        if (Math.abs(cand.y - entry.y) > yBandTol * 3.0) return false;
        const ahead = entry.facing === 'RIGHT' ? cand.x > entry.x + 20 : cand.x < entry.x - 20;
        if (!ahead) return false;
        return points.some(
          (p) =>
            p.x >= Math.min(entry.x, cand.x) &&
            p.x <= Math.max(entry.x, cand.x) &&
            p.y >= Math.min(entry.y, cand.y) - yBandTol &&
            p.y <= Math.max(entry.y, cand.y) + yBandTol
        );
      });
      for (const loopTarget of divergingLoopTargets) {
        buildRouteBetween(entry, loopTarget, true);
      }
    }
  }

  // Record BOTH forward AND reverse-direction relationships!
  let relIdx = 1;
  for (const route of forwardRoutes) {
    relationships.push({
      id: `rel_${relIdx++}`,
      type: 'signal_route',
      fromId: route.entry.id,
      fromLabel: route.entry.label,
      toId: route.exit.id,
      toLabel: route.exit.label,
      description: `Forward (${route.entry.directionLabel} / RFID ${route.entry.facing}) on ${route.entry.line}${route.isCrossoverOrLoopTurnout ? ' via Turnout (Reverse)' : ''}: ${route.enRouteTags.map((t) => t.label).join(' → ')}${route.distanceMeters !== null ? ` (${route.distanceMeters}m)` : ''}`,
    });

    if (!route.entry.isCallingOn) {
      const invertedFacing = route.entry.facing === 'RIGHT' ? 'LEFT' : 'RIGHT';
      const invertedDir = route.entry.directionLabel === 'Nominal' ? 'Reverse' : 'Nominal';
      relationships.push({
        id: `rel_${relIdx++}`,
        type: 'reverse_signal_route',
        fromId: route.exit.id,
        fromLabel: route.exit.label,
        toId: route.entry.id,
        toLabel: route.entry.label,
        description: `Reverse / TSL swapped (${invertedDir} / Inverted RFID ${invertedFacing}) on ${route.entry.line}: ${[...route.enRouteTags].reverse().map((t) => t.label).join(' → ')}`,
      });
    }
  }

  // Signal -> Foot Tag links
  for (const s of runningSignals) {
    if (s.footTag) {
      relationships.push({
        id: `rel_${relIdx++}`,
        type: 'signal_to_foot_tag',
        fromId: s.id,
        fromLabel: s.label,
        toId: s.footTag.id,
        toLabel: s.footTag.label,
        description: `Signal Foot Tag (${s.footTag.roleCode}, ${s.footTag.directionLabel}, Facing ${s.footTag.facing})`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 7. Populate All 7 RDSO KAVACH Tables (+ 6B) Deterministically from CAD Graph
  // -------------------------------------------------------------------------
  // Table 1: KAVACH Table of Control (one S. No. per unique route across its aspect rows)
  let t1No = 1;
  let t1RowIdx = 0;
  for (const route of forwardRoutes) {
    const aspectRows = deriveDynamicAspectPairs(route.entry, route.exit);
    const isBlockRoute = route.entry.sectionType === 'Absolute Block';
    for (const asp of aspectRows) {
      const calcSet = new Set<string>(['sNo', 'sectionType', 'signalType', 'distanceMeters', 'authorizedSpeedOs']);
      tables.table1_control.push(
        makeTableRow(
          'table1_control',
          t1RowIdx++,
          {
            sNo: String(t1No),
            entrySignal: route.entry.label,
            exitSignal: route.exit.label,
            sectionType: route.entry.sectionType,
            line: route.entry.line,
            signalType: route.entry.signalType,
            aspectEntry: asp.aspectEntry,
            aspectExit: asp.aspectExit,
            pointsNormal: route.inRoutePointsNormal.length > 0 ? route.inRoutePointsNormal.join(', ') : '-',
            pointsReverse: route.inRoutePointsReverse.length > 0 ? route.inRoutePointsReverse.join(', ') : '-',
            trackCircuitUp: route.entry.isCallingOn
              ? route.inRouteTcs[0] ? `${route.inRouteTcs[0]} (Occupied)` : '-'
              : route.inRouteTcs.length > 0 ? route.inRouteTcs.join(', ') : '-',
            tinsFree:
              route.entry.isCallingOn || isBlockRoute
                ? '-'
                : route.inRouteTins.length > 0
                  ? route.inRouteTins.join(', ')
                  : '-',
            tinsOverlap: '-',
            entryFootTag: route.entry.footTag?.label || '',
            enRouteTags: route.tagSequenceStr,
            distanceMeters: route.distanceMeters !== null ? String(route.distanceMeters) : '',
            movementAuthority: asp.ma,
            authorizedSpeedOs: route.isCrossoverOrLoopTurnout ? String(settings.singleTurnoutSpeedKmph) : asp.osSpeed,
          },
          calcSet,
          `Offline ${route.entry.label}→${route.exit.label}`
        )
      );
    }
    t1No++;
  }

  // Table 2: Block Section Details (departure LSS / Advance Starter routes with Block TIN, Adjacent TIN, Next Station ID, A-Tag reset!)
  let lssRoutes = forwardRoutes.filter((r) => r.entry.isLss && !r.entry.isCallingOn);
  if (lssRoutes.length === 0) {
    // If layout drawing does not explicitly mark signals with "ADV" or "LSS", dynamically identify outermost departure routes in each direction
    const nonCalling = forwardRoutes.filter((r) => !r.entry.isCallingOn);
    const leftExits = nonCalling
      .filter((r) => r.entry.facing === 'LEFT')
      .sort((a, b) => a.entry.x - b.entry.x);
    const rightExits = nonCalling
      .filter((r) => r.entry.facing === 'RIGHT')
      .sort((a, b) => b.entry.x - a.entry.x);
    const candidates: CorridorRoute[] = [];
    if (leftExits.length > 0) candidates.push(leftExits[0]);
    if (rightExits.length > 0) candidates.push(rightExits[0]);
    lssRoutes = candidates;
  }
  for (let i = 0; i < lssRoutes.length; i++) {
    const r = lssRoutes[i];
    const movDir = r.entry.line.toUpperCase().includes('UP') ? 'UP' : 'Down';
    const lastTag = r.enRouteTags[r.enRouteTags.length - 1];
    const midX = (r.entry.x + r.exit.x) / 2;
    const { blockTin, adjacentTin } = findBlockAndAdjacentTin(midX, r.entry.y);
    const targetAdjStation =
      r.entry.facing === 'LEFT' ? leftAdjStation : rightAdjStation;

    tables.table2_block_section.push(
      makeTableRow(
        'table2_block_section',
        i,
        {
          lssSignal: r.entry.label,
          distanceMeters: r.distanceMeters !== null ? String(r.distanceMeters) : '',
          blockSectionTin: blockTin,
          movementDirection: movDir,
          adjacentLineTins: adjacentTin,
          nextStationId: targetAdjStation?.stationId || '',
          nextStationBorderRfid:
            lastTag && typeof lastTag.absMeters === 'number'
              ? `${lastTag.label} (${lastTag.absMeters}m)`
              : lastTag?.label || '',
          authorizedSpeed: 'MPS',
          startDistAbsReset: r.aTagReset ? String(r.aTagReset.startDistMeters) : '-',
          absLocationCorrection: r.aTagReset ? String(r.aTagReset.correctionMeters) : '-',
          locoDirectionAfterAdj: r.aTagReset ? r.aTagReset.directionAfterAdj : '-',
        },
        new Set(['distanceMeters', 'startDistAbsReset', 'absLocationCorrection']),
        `CAD LSS ${r.entry.label}`
      )
    );
  }

  // Table 3: Shunting Limit Table (outermost station-limit tags per direction with adjacent station name)
  const stationRangeTags = [...rfidTags]
    .filter((t) => !t.isDotted && t.roleCode !== 'A')
    .sort((a, b) => a.x - b.x);
  const boundaryTags: Array<{ tag: DetectedRfidTag; adjName: string }> = [];
  for (const dir of ['Nominal', 'Reverse'] as const) {
    const dirTags = stationRangeTags.filter((t) => t.directionLabel === dir);
    if (dirTags.length > 0) {
      boundaryTags.push({
        tag: dirTags[0],
        adjName: leftAdjStation?.name || 'Adjacent Station (Left)',
      });
      if (dirTags.length > 1) {
        boundaryTags.push({
          tag: dirTags[dirTags.length - 1],
          adjName: rightAdjStation?.name || 'Adjacent Station (Right)',
        });
      }
    }
  }
  if (boundaryTags.length === 0 && stationRangeTags.length > 0) {
    boundaryTags.push({
      tag: stationRangeTags[0],
      adjName: leftAdjStation?.name || 'Adjacent Station (Left)',
    });
    if (stationRangeTags.length > 1) {
      boundaryTags.push({
        tag: stationRangeTags[stationRangeTags.length - 1],
        adjName: rightAdjStation?.name || 'Adjacent Station (Right)',
      });
    }
  }
  const seenShunt = new Set<string>();
  let t3Idx = 0;
  for (const item of boundaryTags) {
    const bt = item.tag;
    if (seenShunt.has(bt.label)) continue;
    seenShunt.add(bt.label);
    const nearestTin = [...tins].sort(
      (a, b) => Math.hypot(a.x - bt.x, a.y - bt.y) - Math.hypot(b.x - bt.x, b.y - bt.y)
    )[0];
    tables.table3_shunting_limit.push(
      makeTableRow(
        'table3_shunting_limit',
        t3Idx++,
        {
          adjacentStationName: item.adjName,
          direction: bt.directionLabel === 'Unknown' ? 'Nominal' : bt.directionLabel,
          rfidTagNo: bt.label,
          tin: nearestTin?.label || '',
          absoluteLocationMeters:
            typeof bt.absMeters === 'number'
              ? String(bt.absMeters)
              : bt.chainageKm
                ? String(bt.chainageKm)
                : String(Math.round(bt.x)),
        },
        new Set(['absoluteLocationMeters']),
        `CAD Tag ${bt.label}`
      )
    );
  }

  // Table 4: Track Profile (all primary forward routes excluding Calling-On)
  const primaryRoutes = forwardRoutes.filter((r) => !r.entry.isCallingOn);
  for (let i = 0; i < primaryRoutes.length; i++) {
    const r = primaryRoutes[i];
    const isLoop =
      r.entry.line.toUpperCase().includes('LOOP') ||
      r.entry.signalType === 'Starter' ||
      r.entry.signalType === 'Adv Starter';
    tables.table4_track_profile.push(
      makeTableRow(
        'table4_track_profile',
        i,
        {
          sNo: String(i + 1),
          entrySignal: r.entry.label,
          exitSignal: r.exit.label,
          line: r.entry.line,
          turnoutSpeedKmph: isLoop ? String(settings.singleTurnoutSpeedKmph) : '-',
          turnoutStartDist: '-',
          turnoutLength: '-',
          psrTuples: '',
          engineeringGradient: '',
          averageGradient: '',
          gradientLength: '',
          lcDistance: '',
          lcId: r.inRouteLc?.label || '-',
          lcManningType: r.inRouteLc ? '' : '-',
          lcClass: r.inRouteLc ? '' : '-',
          lcAutoWhistling: r.inRouteLc ? 'Yes, Distance Based' : '-',
          trackConditionType: r.inRouteFm ? 'Fouling Mark' : '-',
          trackConditionStart: '-',
          trackConditionLength: '-',
        },
        new Set(['sNo']),
        `CAD ${r.entry.label}→${r.exit.label}`
      )
    );
  }

  // Table 5: KAVACH TSR Route Table (grouped by normalized physical line)
  const lineStartTagMap = new Map<string, string>();
  for (let i = 0; i < primaryRoutes.length; i++) {
    const r = primaryRoutes[i];
    const oheLine = mainStation?.name ? `${mainStation.name} ${r.entry.line}` : r.entry.line;
    if (!lineStartTagMap.has(oheLine) && r.entry.footTag) {
      lineStartTagMap.set(oheLine, r.entry.footTag.label);
    }
    const startTag = lineStartTagMap.get(oheLine) || r.entry.footTag?.label || '';
    const numericId = startTag.replace(/[^0-9]/g, '');
    tables.table5_tsr_route.push(
      makeTableRow(
        'table5_tsr_route',
        i,
        {
          sNo: String(i + 1),
          entrySignal: r.entry.label,
          exitSignal: r.exit.label,
          oheLine,
          oheStartRfidTag: startTag,
          tsrRouteId: numericId,
          entrySignalDistFromStart: '',
          lastPoleDistFromExit: '',
          ohePoleKmData: '',
        },
        new Set(['sNo', 'tsrRouteId']),
        `CAD ${r.entry.label}→${r.exit.label}`
      )
    );
  }

  // Tables 6, 6B, 7: Reverse-Direction TSL Tables (Entry/Exit swapped + RFID tags reversed & Exit Foot Tag excluded!)
  if (settings.includeTslTables) {
    for (let i = 0; i < primaryRoutes.length; i++) {
      const r = primaryRoutes[i];
      // Reverse the RFID tag order & EXCLUDE the new Exit Signal foot tag (original Entry foot tag) per Cl. I.2.12.16!
      const reversedTags = [...r.enRouteTags].reverse();
      const tslEntryFoot = reversedTags[0];
      const tslEnRoute = reversedTags.filter((t) => t.id !== r.entry.footTag?.id);
      const tslSeqParts: string[] = [];
      for (let k = 0; k < tslEnRoute.length; k++) {
        if (k === 0) {
          tslSeqParts.push(`(0, ${tslEnRoute[k].label})`);
        } else {
          const { segMeters } = computeConsecutiveTagDistance(tslEnRoute[k - 1], tslEnRoute[k]);
          tslSeqParts.push(`(${segMeters !== null ? segMeters : '?'}, ${tslEnRoute[k].label})`);
        }
      }

      tables.table6_tsl_control.push(
        makeTableRow(
          'table6_tsl_control',
          i,
          {
            tslEntrySignal: r.exit.label,
            tslExitSignal: r.entry.label,
            signalType: r.exit.signalType,
            aspectEntry: 'Red/Blank',
            aspectExit: 'Red',
            requiredRouteCommand: '',
            pointsNormal: r.inRoutePointsNormal.length > 0 ? r.inRoutePointsNormal.join(', ') : '-',
            pointsReverse: r.inRoutePointsReverse.length > 0 ? r.inRoutePointsReverse.join(', ') : '-',
            trackCircuitUp: r.inRouteTcs.length > 0 ? r.inRouteTcs.join(', ') : '',
            tinsFree:
              r.entry.sectionType === 'Absolute Block'
                ? '-'
                : r.inRouteTins.length > 0
                  ? r.inRouteTins.join(', ')
                  : '-',
            entryFootTag: tslEntryFoot?.label || '',
            enRouteTags: tslSeqParts.join(', '),
            distanceMeters: r.distanceMeters !== null ? String(r.distanceMeters) : '',
            movementAuthority: '1',
            authorizedSpeedOs: '25 / 15',
          },
          new Set(['aspectEntry', 'aspectExit', 'distanceMeters']),
          `Offline TSL ${r.exit.label}→${r.entry.label}`
        )
      );

      tables.table7_tsl_track_profile.push(
        makeTableRow(
          'table7_tsl_track_profile',
          i,
          {
            tslEntrySignal: r.exit.label,
            tslExitSignal: r.entry.label,
            turnoutSpeedKmph:
              r.isCrossoverOrLoopTurnout || r.entry.line.toUpperCase().includes('LOOP')
                ? String(settings.singleTurnoutSpeedKmph)
                : '-',
            turnoutStartDist: '-',
            turnoutLength: '-',
            psrTuples: '',
            engineeringGradient: '',
            averageGradient: '',
            gradientLength: '',
            lcDistance: '',
            lcId: r.inRouteLc?.label || '-',
            lcManningType: r.inRouteLc ? '' : '-',
            lcClass: r.inRouteLc ? '' : '-',
            lcAutoWhistling: r.inRouteLc ? 'Yes, Distance Based' : '-',
            trackConditionType: r.inRouteFm ? 'Fouling Mark' : '-',
            trackConditionStart: '-',
            trackConditionLength: '-',
          },
          new Set([]),
          `Offline TSL ${r.exit.label}→${r.entry.label}`
        )
      );
    }

    for (let i = 0; i < lssRoutes.length; i++) {
      const r = lssRoutes[i];
      const midX = (r.entry.x + r.exit.x) / 2;
      const { blockTin, adjacentTin } = findBlockAndAdjacentTin(midX, r.entry.y);
      const targetAdjStation =
        r.entry.facing === 'LEFT' ? leftAdjStation : rightAdjStation;
      const revStartDist =
        r.aTagReset && r.distanceMeters !== null
          ? Math.max(0, r.distanceMeters - r.aTagReset.startDistMeters)
          : null;

      tables.table6b_tsl_block.push(
        makeTableRow(
          'table6b_tsl_block',
          i,
          {
            signalForBlock: r.exit.label,
            tslBlockTin: blockTin,
            adjacentLineTins: adjacentTin,
            nextStationId: targetAdjStation?.stationId || '',
            nextStationBorderRfid: r.entry.footTag?.label || '----',
            startDistAbsReset: revStartDist !== null ? String(revStartDist) : '-',
            absLocationCorrection: r.aTagReset ? String(r.aTagReset.correctionMeters) : '-',
            locoDirectionAfterAdj: r.aTagReset
              ? r.aTagReset.directionAfterAdj === 'Nominal'
                ? 'Reverse'
                : 'Nominal'
              : '----',
          },
          new Set(['startDistAbsReset', 'absLocationCorrection']),
          `Offline TSL Block ${r.exit.label}`
        )
      );
    }
  }

  // Extract metadata hints dynamically from title-block & station anchors
  const metadataHints: Partial<DocumentMetadata> = {
    ...createEmptyMetadata(),
    rfidLayoutRef: fileName,
  };
  if (mainStation) {
    metadataHints.stationName = mainStation.name;
    metadataHints.stationCode = mainStation.name;
    if (mainStation.stationId) metadataHints.stationId = mainStation.stationId;
    if (mainStation.stationKm) metadataHints.stationKm = mainStation.stationKm;
  }
  for (const t of allTexts) {
    const upper = t.clean.toUpperCase();
    const stnIdMatch = t.clean.match(/STATION\s*ID\s*[:=-]?\s*(\d{2,6})/i);
    if (stnIdMatch && !metadataHints.stationId) metadataHints.stationId = stnIdMatch[1];
    const spdMatch = t.clean.match(/(?:SECTION\s*SPEED|MPS)\s*[:=-]?\s*(\d{2,3})\s*(?:KMPH)?/i);
    if (spdMatch && !metadataHints.sectionSpeedKmph) metadataHints.sectionSpeedKmph = spdMatch[1];
    const drgMatch = t.clean.match(/(?:DRG\.?\s*NO\.?|DRAWING\s*NO\.?)\s*[:=-]?\s*([A-Z0-9/_-]{4,})/i);
    if (drgMatch && !metadataHints.drawingNo) metadataHints.drawingNo = drgMatch[1];
    const rfidRefMatch = t.clean.match(/\b(RFID[_-]TAG[_-]LAYOUT[_-][A-Z0-9._-]+)\b/i);
    if (rfidRefMatch) metadataHints.rfidLayoutRef = rfidRefMatch[1];
    if (upper.includes('DIVISION') && t.clean.length < 40 && !metadataHints.division) {
      metadataHints.division = t.clean.replace(/DIVISION\s*[:=-]?\s*/i, '').trim();
    }
  }

  // Deterministically audit which companion-sheet data was absent in the drawing (zero fabrication)
  const missingCompanionInfo: string[] = [];
  const hasGradientText = allTexts.some((t) => /\b1\s+in\s+\d+\b|\bGRADIENT\b/i.test(t.clean));
  const hasOheMastText = allTexts.some((t) => /\bOHE\b|\bMAST\b|\bPOLE\b/i.test(t.clean));
  if (!hasGradientText) {
    missingCompanionInfo.push(
      'Engineering Gradient Index Plan not found in uploaded drawing — Engineering/Average Gradient columns in Tables 4 & 7 left empty for manual or companion-sheet entry.'
    );
  }
  if (!hasOheMastText) {
    missingCompanionInfo.push(
      'OHE Mast / Pole Layout data not found in uploaded drawing — Last Pole Distance & OHE Pole Km columns in Table 5 left empty for manual or companion-sheet entry.'
    );
  }
  if (!metadataHints.division || !metadataHints.section) {
    missingCompanionInfo.push(
      'Division / Section header fields were not printed in the drawing title block — update in Station Header Metadata before final export.'
    );
  }
  if (settings.includeTslTables) {
    missingCompanionInfo.push(
      'SIP / TOC Route Button Commands (Table 6 "Required Route Command") require the Station Interlocking Plan (SIP) companion sheet.'
    );
  }

  const corridorSummaryText = [
    `OFFLINE GEOMETRIC EXTRACTION SUMMARY (${components.length} unique components: ${signals.length} signals, ${rfidTags.length} directional RFID tags, ${points.length} turnout points, ${tins.length} TINs, ${trackCircuits.length} track circuits/axle counter DPs, ${lcGates.length} LC gates, ${foulingMarks.length} FM/SLB):`,
    `Detected Station: ${mainStation ? `${mainStation.name} (ID:${mainStation.stationId || '?'}, Km:${mainStation.stationKm || '?'})` : 'Unknown'} | Left Adj: ${leftAdjStation ? `${leftAdjStation.name} (ID:${leftAdjStation.stationId || '?'})` : '-'} | Right Adj: ${rightAdjStation ? `${rightAdjStation.name} (ID:${rightAdjStation.stationId || '?'})` : '-'}`,
    `Chainage Orientation: km ${kmIncreasesRight ? 'INCREASES left-to-right (+X = Nominal, -X = Reverse)' : 'DECREASES left-to-right (-X = Nominal, +X = Reverse)'}`,
    `SIGNALS (${signals.length}):`,
    ...signals.map(
      (s) =>
        `  - ${s.label} | Type:${s.signalType} | Section:${s.sectionType} | Line:${s.line} | Aspects:[${s.aspects.join(', ')}] | FootTag:${s.footTag?.label || 'none'} | Facing:${s.facing} (${s.directionLabel}) | Block:${s.blockSource || '-'} | X:${Math.round(s.x)},Y:${Math.round(s.y)}`
    ),
    `PRIMARY CORRIDOR ROUTES (${forwardRoutes.length} forward + ${forwardRoutes.filter((r) => !r.entry.isCallingOn).length} reverse):`,
    ...forwardRoutes.map(
      (r) =>
        `  - ${r.entry.label} -> ${r.exit.label} | Line:${r.entry.line} | Section:${r.entry.sectionType} | SigType:${r.entry.signalType} | Dist:${r.distanceMeters ?? '?'}m | Tags:${r.tagSequenceStr}${r.aTagReset ? ` | A-Tag:${r.aTagReset.tag.label} (Start:${r.aTagReset.startDistMeters}m, Corr:${r.aTagReset.correctionMeters}m, After:${r.aTagReset.directionAfterAdj})` : ''}`
    ),
  ].join('\n');

  return {
    metadataHints,
    components,
    relationships,
    tables,
    corridorSummaryText,
    missingCompanionInfo,
  };
}
