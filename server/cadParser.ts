import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import DxfParser from 'dxf-parser';
import { aciToHex } from './aciPalette';
import type {
  CadBounds,
  CadDocumentData,
  CadEntity,
  CadLayer,
  CadPoint,
} from '../src/types/project';

const execFileAsync = promisify(execFile);

/**
 * Decodes AutoCAD MTEXT / TEXT escape sequences safely without eating across
 * paragraph breaks (\P) or Unicode escapes (\U+XXXX).
 */
function cleanMText(raw: string): string {
  if (!raw) return '';
  return raw
    // Decode \U+XXXX Unicode escapes (e.g. \U+25D9 -> ◙)
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_m, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return '';
      }
    })
    // Paragraph & line breaks
    .replace(/\\P/g, '\n')
    .replace(/\^J/g, '\n')
    .replace(/\\~/g, ' ')
    // Stacked fractions \Snum/den; or \Snum^den;
    .replace(/\\S([^;\\{}\n^/#]+)[/^#]([^;\\{}\n]*);/g, '$1/$2')
    // Parameterized MTEXT formatting codes ending in ';' (never cross \, {, }, or newline)
    .replace(/\\[A-Za-z][^;\\{}\n]*;/g, '')
    // Toggle formatting codes without semicolons (\L, \l, \O, \o, \K, \k)
    .replace(/\\[LlOoKk]/g, '')
    // Escaped literal characters
    .replace(/\\\\/g, '\\')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}')
    // Grouping braces
    .replace(/[{}]/g, '')
    // Standard AutoCAD special %% symbols
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[uUoO]/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line, idx, arr) => !(line === '.' && idx === arr.length - 1 && arr.length > 1))
    .join('\n')
    .trim();
}

/**
 * Normalizes text rotation so labels inside 180°-rotated reverse-direction blocks
 * remain upright and readable left-to-right (matching AutoCAD $MIRRTEXT = 0 / AnnoPO).
 */
function normalizeReadableRotation(rad: number): { rad: number; flipped: boolean } {
  let a = rad % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a <= -Math.PI) a += Math.PI * 2;
  if (a > Math.PI * 0.55) return { rad: a - Math.PI, flipped: true };
  if (a < -Math.PI * 0.55) return { rad: a + Math.PI, flipped: true };
  return { rad: a, flipped: false };
}

function mapTextAlignment(
  halign: number,
  valign: number,
  flipped: boolean
): { textAlign: 'left' | 'center' | 'right'; textBaseline: 'top' | 'middle' | 'bottom' | 'alphabetic' } {
  let textAlign: 'left' | 'center' | 'right' =
    halign === 1 || halign === 4 ? 'center' : halign === 2 ? 'right' : 'left';
  if (flipped) {
    if (textAlign === 'left') textAlign = 'right';
    else if (textAlign === 'right') textAlign = 'left';
  }
  const textBaseline: 'top' | 'middle' | 'bottom' | 'alphabetic' =
    valign === 3 ? 'top' : valign === 2 || halign === 4 ? 'middle' : valign === 1 ? 'bottom' : 'alphabetic';
  return { textAlign, textBaseline };
}

function mapMTextAlignment(attachmentPoint?: number): {
  textAlign: 'left' | 'center' | 'right';
  textBaseline: 'top' | 'middle' | 'bottom' | 'alphabetic';
} {
  const ap = attachmentPoint ?? 1;
  const col = (ap - 1) % 3;
  const row = Math.floor((ap - 1) / 3);
  const textAlign: 'left' | 'center' | 'right' = col === 1 ? 'center' : col === 2 ? 'right' : 'left';
  const textBaseline: 'top' | 'middle' | 'bottom' = row === 1 ? 'middle' : row === 2 ? 'bottom' : 'top';
  return { textAlign, textBaseline };
}

/**
 * AutoCAD 4-corner SOLID entities store vertices in Z-order (P1, P2, P3, P4).
 * Reorder to (P1, P2, P4, P3) so Canvas fills a clean quad instead of a crossed bowtie.
 */
function reorderSolidPoints(pts: CadPoint[]): CadPoint[] {
  if (pts.length === 4) {
    return [pts[0], pts[1], pts[3], pts[2]];
  }
  return pts;
}

interface Transform2D {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  rotRad: number;
}

const IDENTITY_TRANSFORM: Transform2D = { tx: 0, ty: 0, sx: 1, sy: 1, rotRad: 0 };

function applyTransform(pt: CadPoint, t: Transform2D): CadPoint {
  const sx = pt.x * t.sx;
  const sy = pt.y * t.sy;
  const cos = Math.cos(t.rotRad);
  const sin = Math.sin(t.rotRad);
  return {
    x: Math.round((sx * cos - sy * sin + t.tx) * 1000) / 1000,
    y: Math.round((sx * sin + sy * cos + t.ty) * 1000) / 1000,
  };
}

function composeTransform(parent: Transform2D, child: Transform2D): Transform2D {
  const origin = applyTransform({ x: child.tx, y: child.ty }, parent);
  return {
    tx: origin.x,
    ty: origin.y,
    sx: parent.sx * child.sx,
    sy: parent.sy * child.sy,
    rotRad: parent.rotRad + child.rotRad,
  };
}

function approximateBulgeArc(p1: CadPoint, p2: CadPoint, bulge: number, steps = 10): CadPoint[] {
  if (!bulge || Math.abs(bulge) < 1e-6) return [p2];
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-9) return [p2];

  const theta = 4 * Math.atan(bulge);
  const sinHalf = Math.sin(theta / 2);
  if (Math.abs(sinHalf) < 1e-9) return [p2];

  const radius = chord / (2 * sinHalf);
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  const distToCenter = Math.sqrt(Math.max(0, radius * radius - (chord / 2) ** 2));
  const sign = bulge > 0 ? 1 : -1;
  const perpX = (-dy / chord) * sign;
  const perpY = (dx / chord) * sign;

  const cx = midX + perpX * distToCenter * (Math.abs(theta) > Math.PI ? -1 : 1);
  const cy = midY + perpY * distToCenter * (Math.abs(theta) > Math.PI ? -1 : 1);
  const startAngle = Math.atan2(p1.y - cy, p1.x - cx);

  const pts: CadPoint[] = [];
  for (let i = 1; i <= steps; i++) {
    const a = startAngle + (theta * i) / steps;
    pts.push({
      x: cx + Math.abs(radius) * Math.cos(a),
      y: cy + Math.abs(radius) * Math.sin(a),
    });
  }
  return pts;
}

function computeBounds(entities: CadEntity[]): CadBounds {
  const xs: number[] = [];
  const ys: number[] = [];

  const pushPt = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    xs.push(x);
    ys.push(y);
  };

  for (const e of entities) {
    if (e.points) {
      for (const p of e.points) pushPt(p.x, p.y);
    }
    if (e.paths) {
      for (const loop of e.paths) {
        for (const p of loop) pushPt(p.x, p.y);
      }
    }
    if (e.center) {
      const r = e.radius ?? (e.majorAxis ? Math.hypot(e.majorAxis.x, e.majorAxis.y) : 0);
      pushPt(e.center.x - r, e.center.y - r);
      pushPt(e.center.x + r, e.center.y + r);
    }
  }

  if (xs.length === 0) {
    return { minX: 0, minY: 0, maxX: 1000, maxY: 500, width: 1000, height: 500 };
  }

  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);

  let minX = xs[0];
  let maxX = xs[xs.length - 1];
  let minY = ys[0];
  let maxY = ys[ys.length - 1];

  // Trim extreme stray outlier points (e.g., accidental (0,0) reference dot far away from the drawing border)
  if (xs.length >= 40) {
    const p01X = xs[Math.floor(xs.length * 0.01)];
    const p99X = xs[Math.floor(xs.length * 0.99)];
    const p01Y = ys[Math.floor(ys.length * 0.01)];
    const p99Y = ys[Math.floor(ys.length * 0.99)];
    const coreW = Math.max(1e-6, p99X - p01X);
    const coreH = Math.max(1e-6, p99Y - p01Y);
    const fullW = maxX - minX;
    const fullH = maxY - minY;

    if (fullW > coreW * 3.5) {
      const marginX = coreW * 0.08;
      minX = p01X - marginX;
      maxX = p99X + marginX;
    }
    if (fullH > coreH * 3.5) {
      const marginY = coreH * 0.08;
      minY = p01Y - marginY;
      maxY = p99Y + marginY;
    }
  }

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  return { minX, minY, maxX, maxY, width, height };
}

interface RawDxfAttrib {
  text: string;
  tag: string;
  layer: string;
  colorIndex?: number;
  trueColor?: number;
  invisible: boolean;
  inPaperSpace: boolean;
  startPoint: CadPoint;
  endPoint?: CadPoint;
  hasEndPoint: boolean;
  height: number;
  rotationDeg: number;
  halign: number;
  valign: number;
}

interface RawDxfHatch {
  layer: string;
  colorIndex?: number;
  trueColor?: number;
  invisible: boolean;
  inPaperSpace: boolean;
  solidFill: boolean;
  patternName: string;
  loops: CadPoint[][];
}

function sampleArcPoints(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
  ccw: boolean,
  steps = 16
): CadPoint[] {
  let s = (startDeg * Math.PI) / 180;
  let e = (endDeg * Math.PI) / 180;
  if (!ccw) {
    // AutoCAD CW hatch arcs mirror angles across X-axis
    s = -s;
    e = -e;
  }
  let sweep = e - s;
  if (ccw && sweep <= 0) sweep += Math.PI * 2;
  if (!ccw && sweep >= 0) sweep -= Math.PI * 2;
  if (Math.abs(sweep) < 1e-6) sweep = Math.PI * 2;
  const pts: CadPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = s + (sweep * i) / steps;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

/**
 * Fast linear raw-DXF supplement scanner rescuing entities that dxf-parser drops:
 *  - All ATTRIB entities (real signal IDs, RFID tag IDs, track circuits, points, chainages, TINs)
 *  - All HATCH entities (TIN color bands, solid fills, signal fills, logos)
 *  - TrueColor (group code 420) & visibility flags (code 60 / code 70 / code 67)
 */
function extractDxfSupplement(textContent: string): {
  modelAttribs: RawDxfAttrib[];
  blockAttribs: Map<string, RawDxfAttrib[]>;
  modelHatches: RawDxfHatch[];
  blockHatches: Map<string, RawDxfHatch[]>;
} {
  const modelAttribs: RawDxfAttrib[] = [];
  const blockAttribs = new Map<string, RawDxfAttrib[]>();
  const modelHatches: RawDxfHatch[] = [];
  const blockHatches = new Map<string, RawDxfHatch[]>();

  const lines = textContent.replace(/\r\n/g, '\n').split('\n');
  let section: 'NONE' | 'BLOCKS' | 'ENTITIES' = 'NONE';
  let currentBlock = '';

  let i = 0;
  while (i < lines.length - 1) {
    const code = lines[i].trim();
    const val = lines[i + 1].trim();
    i += 2;

    if (code === '0' && val === 'SECTION') {
      if (i < lines.length - 1 && lines[i].trim() === '2') {
        const secName = lines[i + 1].trim();
        i += 2;
        if (secName === 'BLOCKS') section = 'BLOCKS';
        else if (secName === 'ENTITIES') section = 'ENTITIES';
        else section = 'NONE';
      }
      continue;
    }
    if (code === '0' && val === 'ENDSEC') {
      section = 'NONE';
      currentBlock = '';
      continue;
    }
    if (section === 'NONE') continue;

    if (section === 'BLOCKS' && code === '0' && val === 'BLOCK') {
      currentBlock = '';
      while (i < lines.length - 1) {
        const bc = lines[i].trim();
        const bv = lines[i + 1].trim();
        if (bc === '0') break;
        i += 2;
        if (bc === '2') currentBlock = bv;
      }
      continue;
    }
    if (section === 'BLOCKS' && code === '0' && val === 'ENDBLK') {
      currentBlock = '';
      continue;
    }

    if (code === '0' && val === 'ATTRIB') {
      const attr: RawDxfAttrib = {
        text: '',
        tag: '',
        layer: '0',
        invisible: false,
        inPaperSpace: false,
        startPoint: { x: 0, y: 0 },
        hasEndPoint: false,
        height: 2.5,
        rotationDeg: 0,
        halign: 0,
        valign: 0,
      };
      let attrFlags = 0;
      let invis60 = false;
      let x2 = 0;
      let y2 = 0;
      let sawX2 = false;
      let sawY2 = false;
      while (i < lines.length - 1) {
        const ac = lines[i].trim();
        const av = lines[i + 1].trim();
        if (ac === '0') break;
        i += 2;
        if (ac === '1') attr.text = av;
        else if (ac === '2') attr.tag = av;
        else if (ac === '8') attr.layer = av;
        else if (ac === '62') attr.colorIndex = parseInt(av, 10);
        else if (ac === '420') attr.trueColor = parseInt(av, 10);
        else if (ac === '60' && parseInt(av, 10) === 1) invis60 = true;
        else if (ac === '67' && parseInt(av, 10) === 1) attr.inPaperSpace = true;
        else if (ac === '10') attr.startPoint.x = parseFloat(av) || 0;
        else if (ac === '20') attr.startPoint.y = parseFloat(av) || 0;
        else if (ac === '11') {
          x2 = parseFloat(av) || 0;
          sawX2 = true;
        } else if (ac === '21') {
          y2 = parseFloat(av) || 0;
          sawY2 = true;
        } else if (ac === '40') attr.height = parseFloat(av) || 2.5;
        else if (ac === '50') attr.rotationDeg = parseFloat(av) || 0;
        else if (ac === '70') attrFlags = parseInt(av, 10) || 0;
        else if (ac === '72') attr.halign = parseInt(av, 10) || 0;
        else if (ac === '74') attr.valign = parseInt(av, 10) || 0;
      }
      attr.invisible = invis60 || (attrFlags & 1) !== 0;
      if (sawX2 || sawY2) {
        attr.endPoint = { x: x2, y: y2 };
        attr.hasEndPoint = true;
      }
      if (!attr.invisible && !attr.inPaperSpace && attr.text.trim()) {
        if (section === 'ENTITIES') {
          modelAttribs.push(attr);
        } else if (currentBlock) {
          const arr = blockAttribs.get(currentBlock) || [];
          arr.push(attr);
          blockAttribs.set(currentBlock, arr);
        }
      }
      continue;
    }

    if (code === '0' && val === 'HATCH') {
      const pairs: Array<[number, string]> = [];
      while (i < lines.length - 1) {
        const hc = lines[i].trim();
        const hv = lines[i + 1].trim();
        if (hc === '0') break;
        i += 2;
        pairs.push([parseInt(hc, 10), hv]);
      }

      const hatch: RawDxfHatch = {
        layer: '0',
        invisible: false,
        inPaperSpace: false,
        solidFill: true,
        patternName: 'SOLID',
        loops: [],
      };

      let p = 0;
      let numLoops = 0;
      // Header of HATCH until code 91 (number of boundary paths)
      while (p < pairs.length) {
        const [gc, gv] = pairs[p++];
        if (gc === 8) hatch.layer = gv;
        else if (gc === 62) hatch.colorIndex = parseInt(gv, 10);
        else if (gc === 420) hatch.trueColor = parseInt(gv, 10);
        else if (gc === 60 && parseInt(gv, 10) === 1) hatch.invisible = true;
        else if (gc === 67 && parseInt(gv, 10) === 1) hatch.inPaperSpace = true;
        else if (gc === 2) hatch.patternName = gv;
        else if (gc === 70) hatch.solidFill = parseInt(gv, 10) === 1;
        else if (gc === 91) {
          numLoops = parseInt(gv, 10) || 0;
          break;
        }
      }

      // Parse each boundary loop
      for (let loopIdx = 0; loopIdx < numLoops && p < pairs.length; loopIdx++) {
        // Advance to next code 92 (boundary path type flag)
        while (p < pairs.length && pairs[p][0] !== 92) p++;
        if (p >= pairs.length) break;
        const pathType = parseInt(pairs[p++][1], 10) || 0;
        const isPolyline = (pathType & 2) !== 0;

        if (isPolyline) {
          let isClosed = true;
          let numVerts = 0;
          while (p < pairs.length) {
            const [gc, gv] = pairs[p];
            if (gc === 93) {
              numVerts = parseInt(gv, 10) || 0;
              p++;
              break;
            }
            if (gc === 73) isClosed = parseInt(gv, 10) !== 0;
            if (gc === 92 || gc === 97) break;
            p++;
          }
          const verts: Array<{ x: number; y: number; bulge: number }> = [];
          for (let vIdx = 0; vIdx < numVerts && p < pairs.length; vIdx++) {
            let vx = 0;
            let vy = 0;
            let bulge = 0;
            let gotX = false;
            while (p < pairs.length) {
              const [gc, gv] = pairs[p];
              if (gc === 10) {
                if (gotX) break;
                vx = parseFloat(gv) || 0;
                gotX = true;
                p++;
              } else if (gc === 20) {
                vy = parseFloat(gv) || 0;
                p++;
              } else if (gc === 42) {
                bulge = parseFloat(gv) || 0;
                p++;
              } else {
                break;
              }
            }
            if (gotX) verts.push({ x: vx, y: vy, bulge });
          }
          if (verts.length >= 3) {
            const pts: CadPoint[] = [];
            for (let k = 0; k < verts.length; k++) {
              const curr = { x: verts[k].x, y: verts[k].y };
              if (k === 0) pts.push(curr);
              if (k < verts.length - 1) {
                const next = { x: verts[k + 1].x, y: verts[k + 1].y };
                if (verts[k].bulge) pts.push(...approximateBulgeArc(curr, next, verts[k].bulge, 8));
                else pts.push(next);
              } else if (isClosed && verts[k].bulge) {
                pts.push(...approximateBulgeArc(curr, { x: verts[0].x, y: verts[0].y }, verts[k].bulge, 8));
              }
            }
            if (pts.length >= 3) hatch.loops.push(pts);
          }
        } else {
          // Edge boundary loop
          let numEdges = 0;
          while (p < pairs.length) {
            const [gc, gv] = pairs[p];
            if (gc === 93) {
              numEdges = parseInt(gv, 10) || 0;
              p++;
              break;
            }
            if (gc === 92 || gc === 97) break;
            p++;
          }
          const pts: CadPoint[] = [];
          for (let eIdx = 0; eIdx < numEdges && p < pairs.length; eIdx++) {
            while (p < pairs.length && pairs[p][0] !== 72 && pairs[p][0] !== 97 && pairs[p][0] !== 92) p++;
            if (p >= pairs.length || pairs[p][0] !== 72) break;
            const edgeType = parseInt(pairs[p++][1], 10) || 0;

            if (edgeType === 1) {
              // Line edge
              let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
              while (p < pairs.length && ![72, 92, 97].includes(pairs[p][0])) {
                const [gc, gv] = pairs[p++];
                if (gc === 10) x1 = parseFloat(gv) || 0;
                else if (gc === 20) y1 = parseFloat(gv) || 0;
                else if (gc === 11) x2 = parseFloat(gv) || 0;
                else if (gc === 21) y2 = parseFloat(gv) || 0;
              }
              if (pts.length === 0) pts.push({ x: x1, y: y1 });
              pts.push({ x: x2, y: y2 });
            } else if (edgeType === 2) {
              // Circular arc edge
              let cx = 0, cy = 0, r = 0, sDeg = 0, eDeg = 360, ccw = 1;
              while (p < pairs.length && ![72, 92, 97].includes(pairs[p][0])) {
                const [gc, gv] = pairs[p++];
                if (gc === 10) cx = parseFloat(gv) || 0;
                else if (gc === 20) cy = parseFloat(gv) || 0;
                else if (gc === 40) r = parseFloat(gv) || 0;
                else if (gc === 50) sDeg = parseFloat(gv) || 0;
                else if (gc === 51) eDeg = parseFloat(gv) || 0;
                else if (gc === 73) ccw = parseInt(gv, 10);
              }
              if (r > 0) pts.push(...sampleArcPoints(cx, cy, r, sDeg, eDeg, ccw !== 0, 16));
            } else if (edgeType === 3) {
              // Elliptic arc edge
              let cx = 0, cy = 0, mx = 1, my = 0, ratio = 1, sDeg = 0, eDeg = 360;
              while (p < pairs.length && ![72, 92, 97].includes(pairs[p][0])) {
                const [gc, gv] = pairs[p++];
                if (gc === 10) cx = parseFloat(gv) || 0;
                else if (gc === 20) cy = parseFloat(gv) || 0;
                else if (gc === 11) mx = parseFloat(gv) || 0;
                else if (gc === 21) my = parseFloat(gv) || 0;
                else if (gc === 40) ratio = parseFloat(gv) || 1;
                else if (gc === 50) sDeg = parseFloat(gv) || 0;
                else if (gc === 51) eDeg = parseFloat(gv) || 0;
              }
              const rx = Math.hypot(mx, my);
              const ry = rx * ratio;
              const rot = Math.atan2(my, mx);
              const sRad = (sDeg * Math.PI) / 180;
              let sweep = ((eDeg - sDeg) * Math.PI) / 180;
              if (sweep <= 0) sweep += Math.PI * 2;
              for (let k = 0; k <= 16; k++) {
                const a = sRad + (sweep * k) / 16;
                const lx = rx * Math.cos(a);
                const ly = ry * Math.sin(a);
                pts.push({
                  x: cx + lx * Math.cos(rot) - ly * Math.sin(rot),
                  y: cy + lx * Math.sin(rot) + ly * Math.cos(rot),
                });
              }
            } else if (edgeType === 4) {
              // Spline edge: collect control points
              let cx: number | null = null;
              while (p < pairs.length && ![72, 92, 97].includes(pairs[p][0])) {
                const [gc, gv] = pairs[p++];
                if (gc === 10) cx = parseFloat(gv) || 0;
                else if (gc === 20 && cx !== null) {
                  pts.push({ x: cx, y: parseFloat(gv) || 0 });
                  cx = null;
                }
              }
            }
          }
          if (pts.length >= 3) hatch.loops.push(pts);
        }
      }

      if (!hatch.invisible && !hatch.inPaperSpace && hatch.loops.length > 0) {
        if (section === 'ENTITIES') {
          modelHatches.push(hatch);
        } else if (currentBlock) {
          const arr = blockHatches.get(currentBlock) || [];
          arr.push(hatch);
          blockHatches.set(currentBlock, arr);
        }
      }
    }
  }

  return { modelAttribs, blockAttribs, modelHatches, blockHatches };
}

/**
 * Parses an ASCII DXF buffer into a complete, lossless CadDocumentData structure
 * preserving layers, recursively exploded INSERT blocks, ATTRIB values, HATCH color bands,
 * official 256-color ACI + ByBlock colors, visibility flags, text annotations, and geometry.
 */
export function parseDxfBuffer(buffer: Buffer): CadDocumentData {
  const textContent = buffer.toString('utf8');
  const parser = new DxfParser();
  const parsed: any = parser.parseSync(textContent);

  if (!parsed) {
    throw new Error('Failed to parse DXF file structure. Ensure the file is a valid ASCII DXF.');
  }

  const supplement = extractDxfSupplement(textContent);

  const layerColorMap = new Map<string, string>();
  const layerVisibleMap = new Map<string, boolean>();
  const layerCounts = new Map<string, number>();
  const parseWarnings: string[] = [];

  if (parsed.tables?.layer?.layers) {
    for (const [name, layerObj] of Object.entries<any>(parsed.tables.layer.layers)) {
      const ci = typeof layerObj.colorIndex === 'number' ? layerObj.colorIndex : 7;
      layerColorMap.set(name, aciToHex(Math.abs(ci)));
      const isOffOrFrozen =
        Boolean(layerObj.frozen) ||
        layerObj.visible === false ||
        ci < 0 ||
        name.toLowerCase() === 'defpoints';
      layerVisibleMap.set(name, !isOffOrFrozen);
      layerCounts.set(name, 0);
    }
  }

  const blocks: Record<string, any> = parsed.blocks || {};
  const entities: CadEntity[] = [];
  const textAnnotations: CadDocumentData['textAnnotations'] = [];
  let entitySeq = 1;

  const resolveColor = (
    colorIndex: number | undefined,
    trueColor: number | undefined,
    layerName: string,
    parentColor: string
  ): string => {
    if (typeof trueColor === 'number' && trueColor > 0 && trueColor <= 0xffffff) {
      return aciToHex(undefined, trueColor);
    }
    if (colorIndex === 0) {
      // AutoCAD ByBlock: inherit parent INSERT's color
      return parentColor;
    }
    if (typeof colorIndex === 'number' && colorIndex !== 256 && colorIndex > 0 && colorIndex <= 255) {
      return aciToHex(colorIndex);
    }
    return layerColorMap.get(layerName) || '#e2e8f0';
  };

  const bumpLayer = (layer: string, color: string) => {
    layerCounts.set(layer, (layerCounts.get(layer) || 0) + 1);
    if (!layerColorMap.has(layer)) layerColorMap.set(layer, color);
    if (!layerVisibleMap.has(layer)) layerVisibleMap.set(layer, layer.toLowerCase() !== 'defpoints');
  };

  const ingestRawAttrib = (
    attr: RawDxfAttrib,
    transform: Transform2D,
    inheritedLayer: string | undefined,
    parentColor: string,
    blockSource: string | undefined
  ) => {
    if (attr.invisible || attr.inPaperSpace) return;
    const cleaned = cleanMText(attr.text);
    if (!cleaned) return;
    const layer = attr.layer && attr.layer !== '0' ? attr.layer : inheritedLayer || attr.layer || '0';
    const color = resolveColor(attr.colorIndex, attr.trueColor, layer, parentColor);
    const id = `e_${entitySeq++}`;

    const useEndPoint = (attr.halign !== 0 || attr.valign !== 0) && attr.hasEndPoint && attr.endPoint;
    const basePos = useEndPoint ? attr.endPoint! : attr.startPoint;
    const transformedPos = applyTransform(basePos, transform);
    const height = (attr.height || 2.5) * Math.abs(transform.sy);
    const rawRad = (attr.rotationDeg * Math.PI) / 180 + transform.rotRad;
    const { rad, flipped } = normalizeReadableRotation(rawRad);
    const { textAlign, textBaseline } = mapTextAlignment(attr.halign, attr.valign, flipped);

    entities.push({
      id,
      type: 'TEXT',
      layer,
      color,
      center: transformedPos,
      text: cleaned,
      height,
      rotation: rad,
      textAlign,
      textBaseline,
      blockSource,
    });
    textAnnotations.push({
      id,
      text: cleaned,
      x: Math.round(transformedPos.x * 100) / 100,
      y: Math.round(transformedPos.y * 100) / 100,
      layer,
      height,
    });
    bumpLayer(layer, color);
  };

  const ingestRawHatch = (
    hatch: RawDxfHatch,
    transform: Transform2D,
    inheritedLayer: string | undefined,
    parentColor: string,
    blockSource: string | undefined
  ) => {
    if (hatch.invisible || hatch.inPaperSpace || hatch.loops.length === 0) return;
    const layer = hatch.layer && hatch.layer !== '0' ? hatch.layer : inheritedLayer || hatch.layer || '0';
    const color = resolveColor(hatch.colorIndex, hatch.trueColor, layer, parentColor);
    const id = `e_${entitySeq++}`;
    const paths = hatch.loops
      .map((loop) => loop.map((p) => applyTransform(p, transform)))
      .filter((loop) => loop.length >= 3);
    if (paths.length === 0) return;

    entities.push({
      id,
      type: 'HATCH',
      layer,
      color,
      paths,
      solidFill: hatch.solidFill,
      closed: true,
      blockSource,
    });
    bumpLayer(layer, color);
  };

  const ingestEntity = (
    raw: any,
    transform: Transform2D,
    inheritedLayer: string | undefined,
    parentColor: string,
    blockSource: string | undefined,
    depth: number
  ) => {
    if (!raw || !raw.type || depth > 8) return;
    // Skip invisible entities (Dynamic Block hidden visibility states, code 60 = 1)
    if (raw.visible === false || raw.isVisible === false) return;
    // Skip Paper Space entities when rendering Model Space
    if (depth === 0 && raw.inPaperSpace === true) return;

    const layer = raw.layer && raw.layer !== '0' ? raw.layer : inheritedLayer || raw.layer || '0';
    // Note: dxf-parser populates raw.color from colorIndex, so pass trueColor only if explicitly distinct
    const explicitTrueColor = typeof raw.trueColor === 'number' ? raw.trueColor : undefined;
    const color = resolveColor(raw.colorIndex, explicitTrueColor, layer, parentColor);
    const id = `e_${entitySeq++}`;

    switch (raw.type) {
      case 'LINE': {
        const verts = raw.vertices || [];
        if (verts.length >= 2) {
          entities.push({
            id,
            type: 'LINE',
            layer,
            color,
            points: [
              applyTransform({ x: verts[0].x, y: verts[0].y }, transform),
              applyTransform({ x: verts[1].x, y: verts[1].y }, transform),
            ],
            blockSource,
          });
          bumpLayer(layer, color);
        }
        break;
      }
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const verts = raw.vertices || [];
        if (verts.length >= 2) {
          const pts: CadPoint[] = [];
          for (let i = 0; i < verts.length; i++) {
            const curr = { x: verts[i].x, y: verts[i].y };
            if (i === 0) pts.push(applyTransform(curr, transform));
            if (i < verts.length - 1) {
              const next = { x: verts[i + 1].x, y: verts[i + 1].y };
              if (verts[i].bulge) {
                for (const bp of approximateBulgeArc(curr, next, verts[i].bulge)) {
                  pts.push(applyTransform(bp, transform));
                }
              } else {
                pts.push(applyTransform(next, transform));
              }
            }
          }
          const isClosed = Boolean(raw.shape || raw.closed);
          if (isClosed && verts[verts.length - 1]?.bulge) {
            for (const bp of approximateBulgeArc(
              { x: verts[verts.length - 1].x, y: verts[verts.length - 1].y },
              { x: verts[0].x, y: verts[0].y },
              verts[verts.length - 1].bulge
            )) {
              pts.push(applyTransform(bp, transform));
            }
          }
          entities.push({
            id,
            type: raw.type,
            layer,
            color,
            points: pts,
            closed: isClosed,
            blockSource,
          });
          bumpLayer(layer, color);
        }
        break;
      }
      case 'CIRCLE': {
        if (raw.center && typeof raw.radius === 'number') {
          const scale = (Math.abs(transform.sx) + Math.abs(transform.sy)) / 2;
          entities.push({
            id,
            type: 'CIRCLE',
            layer,
            color,
            center: applyTransform({ x: raw.center.x, y: raw.center.y }, transform),
            radius: raw.radius * scale,
            blockSource,
          });
          bumpLayer(layer, color);
        }
        break;
      }
      case 'ARC': {
        if (raw.center && typeof raw.radius === 'number') {
          const scale = (Math.abs(transform.sx) + Math.abs(transform.sy)) / 2;
          entities.push({
            id,
            type: 'ARC',
            layer,
            color,
            center: applyTransform({ x: raw.center.x, y: raw.center.y }, transform),
            radius: raw.radius * scale,
            startAngle: (raw.startAngle ?? 0) + transform.rotRad,
            endAngle: (raw.endAngle ?? Math.PI * 2) + transform.rotRad,
            blockSource,
          });
          bumpLayer(layer, color);
        }
        break;
      }
      case 'ELLIPSE': {
        if (raw.center && raw.majorAxisEndPoint) {
          entities.push({
            id,
            type: 'ELLIPSE',
            layer,
            color,
            center: applyTransform({ x: raw.center.x, y: raw.center.y }, transform),
            majorAxis: {
              x: raw.majorAxisEndPoint.x * transform.sx,
              y: raw.majorAxisEndPoint.y * transform.sy,
            },
            axisRatio: raw.axisRatio ?? 1,
            startAngle: raw.startAngle ?? 0,
            endAngle: raw.endAngle ?? Math.PI * 2,
            blockSource,
          });
          bumpLayer(layer, color);
        }
        break;
      }
      case 'SPLINE': {
        const ctrl = raw.controlPoints || raw.fitPoints || [];
        if (ctrl.length >= 2) {
          entities.push({
            id,
            type: 'SPLINE',
            layer,
            color,
            points: ctrl.map((p: any) => applyTransform({ x: p.x, y: p.y }, transform)),
            blockSource,
          });
          bumpLayer(layer, color);
        }
        break;
      }
      case 'SOLID':
      case '3DFACE': {
        const pts = raw.points || [];
        if (pts.length >= 3) {
          const transformed = pts.map((p: any) => applyTransform({ x: p.x, y: p.y }, transform));
          entities.push({
            id,
            type: 'SOLID',
            layer,
            color,
            points: raw.type === 'SOLID' ? reorderSolidPoints(transformed) : transformed,
            closed: true,
            blockSource,
          });
          bumpLayer(layer, color);
        }
        break;
      }
      case 'ATTDEF': {
        // In AutoCAD, non-constant ATTDEFs inside INSERTed blocks are templates replaced by ATTRIBs!
        // Only render an ATTDEF if it is constant AND visible.
        if (raw.invisible === true || ((raw.flags ?? 0) & 1) !== 0) break;
        if (blockSource && !raw.constant && ((raw.flags ?? 0) & 2) === 0) break;
        const halign = raw.horizontalJustification ?? raw.halign ?? 0;
        const valign = raw.verticalJustification ?? raw.valign ?? 0;
        const pos = (halign !== 0 || valign !== 0) && raw.endPoint ? raw.endPoint : raw.startPoint || raw.position;
        const cleaned = cleanMText(String(raw.text || raw.defaultValue || ''));
        if (pos && cleaned) {
          const transformedPos = applyTransform({ x: pos.x, y: pos.y }, transform);
          const height = (raw.textHeight || raw.height || 2.5) * Math.abs(transform.sy);
          const rawRad = ((raw.rotation || 0) * Math.PI) / 180 + transform.rotRad;
          const { rad, flipped } = normalizeReadableRotation(rawRad);
          const { textAlign, textBaseline } = mapTextAlignment(halign, valign, flipped);
          entities.push({
            id,
            type: 'TEXT',
            layer,
            color,
            center: transformedPos,
            text: cleaned,
            height,
            rotation: rad,
            textAlign,
            textBaseline,
            blockSource,
          });
          textAnnotations.push({
            id,
            text: cleaned,
            x: Math.round(transformedPos.x * 100) / 100,
            y: Math.round(transformedPos.y * 100) / 100,
            layer,
            height,
          });
          bumpLayer(layer, color);
        }
        break;
      }
      case 'TEXT':
      case 'MTEXT':
      case 'ATTRIB': {
        if (raw.invisible === true || ((raw.flags ?? 0) & 1) !== 0) break;
        const halign = raw.halign ?? raw.horizontalJustification ?? 0;
        const valign = raw.valign ?? raw.verticalJustification ?? 0;
        const useEnd = raw.type !== 'MTEXT' && (halign !== 0 || valign !== 0) && raw.endPoint;
        const pos = useEnd ? raw.endPoint : raw.startPoint || raw.position || raw.endPoint;
        const rawText = raw.text || raw.string || '';
        const cleaned = cleanMText(String(rawText));
        if (pos && cleaned) {
          const transformedPos = applyTransform({ x: pos.x, y: pos.y }, transform);
          const height = (raw.textHeight || raw.height || 2.5) * Math.abs(transform.sy);
          let localRad = ((raw.rotation || 0) * Math.PI) / 180;
          if (!raw.rotation && raw.directionVector && (raw.directionVector.x || raw.directionVector.y)) {
            localRad = Math.atan2(raw.directionVector.y, raw.directionVector.x);
          }
          const { rad, flipped } = normalizeReadableRotation(localRad + transform.rotRad);
          const alignInfo =
            raw.type === 'MTEXT'
              ? mapMTextAlignment(raw.attachmentPoint)
              : mapTextAlignment(halign, valign, flipped);
          entities.push({
            id,
            type: raw.type === 'MTEXT' ? 'MTEXT' : 'TEXT',
            layer,
            color,
            center: transformedPos,
            text: cleaned,
            height,
            rotation: rad,
            textAlign: alignInfo.textAlign,
            textBaseline: alignInfo.textBaseline,
            blockSource,
          });
          textAnnotations.push({
            id,
            text: cleaned,
            x: Math.round(transformedPos.x * 100) / 100,
            y: Math.round(transformedPos.y * 100) / 100,
            layer,
            height,
          });
          bumpLayer(layer, color);
        }
        break;
      }
      case 'DIMENSION': {
        const anchor = raw.middleOfText || raw.anchorPoint;
        if (anchor && raw.text && raw.text !== '<>') {
          const cleaned = cleanMText(String(raw.text));
          const pos = applyTransform({ x: anchor.x, y: anchor.y }, transform);
          entities.push({
            id,
            type: 'DIMENSION',
            layer,
            color,
            center: pos,
            text: cleaned,
            height: 2.5,
            textAlign: 'center',
            textBaseline: 'middle',
            blockSource,
          });
          textAnnotations.push({
            id,
            text: cleaned,
            x: Math.round(pos.x * 100) / 100,
            y: Math.round(pos.y * 100) / 100,
            layer,
          });
          bumpLayer(layer, color);
        }
        if (raw.block && blocks[raw.block]?.entities) {
          for (const child of blocks[raw.block].entities) {
            ingestEntity(child, transform, layer, color, raw.block, depth + 1);
          }
        }
        break;
      }
      case 'INSERT': {
        const block = blocks[raw.name];
        const pos = raw.position || { x: 0, y: 0 };
        const childT: Transform2D = {
          tx: pos.x,
          ty: pos.y,
          sx: raw.xScale ?? 1,
          sy: raw.yScale ?? 1,
          rotRad: ((raw.rotation ?? 0) * Math.PI) / 180,
        };
        const nextTransform = composeTransform(transform, childT);
        const baseX = block?.position?.x ?? 0;
        const baseY = block?.position?.y ?? 0;
        const adjustedT =
          baseX !== 0 || baseY !== 0
            ? composeTransform(nextTransform, { tx: -baseX, ty: -baseY, sx: 1, sy: 1, rotRad: 0 })
            : nextTransform;

        if (block?.entities) {
          for (const child of block.entities) {
            ingestEntity(child, adjustedT, layer, color, raw.name, depth + 1);
          }
        }
        // Ingest block-scoped HATCHes & ATTRIBs rescued from raw DXF
        const bHatches = supplement.blockHatches.get(raw.name);
        if (bHatches) {
          for (const bh of bHatches) {
            ingestRawHatch(bh, adjustedT, layer, color, raw.name);
          }
        }
        const bAttribs = supplement.blockAttribs.get(raw.name);
        if (bAttribs) {
          for (const ba of bAttribs) {
            ingestRawAttrib(ba, adjustedT, layer, color, raw.name);
          }
        }
        break;
      }
      case 'POINT': {
        if (raw.position) {
          entities.push({
            id,
            type: 'POINT',
            layer,
            color,
            center: applyTransform({ x: raw.position.x, y: raw.position.y }, transform),
            blockSource,
          });
          bumpLayer(layer, color);
        }
        break;
      }
      default:
        break;
    }
  };

  for (const rawEntity of parsed.entities || []) {
    ingestEntity(rawEntity, IDENTITY_TRANSFORM, undefined, '#e2e8f0', undefined, 0);
  }
  // Ingest Model Space HATCH color bands and ATTRIB annotations rescued from raw DXF
  for (const mh of supplement.modelHatches) {
    ingestRawHatch(mh, IDENTITY_TRANSFORM, undefined, '#e2e8f0', undefined);
  }
  for (const ma of supplement.modelAttribs) {
    ingestRawAttrib(ma, IDENTITY_TRANSFORM, undefined, '#e2e8f0', undefined);
  }

  const layers: CadLayer[] = Array.from(layerCounts.entries())
    .filter(([, count]) => count > 0)
    .map(([name, entityCount]) => ({
      name,
      color: layerColorMap.get(name) || '#e2e8f0',
      visible: layerVisibleMap.get(name) ?? true,
      entityCount,
    }))
    .sort((a, b) => b.entityCount - a.entityCount);

  return {
    format: 'DXF',
    cadVersion: parsed.header?.$ACADVER || 'DXF',
    units: String(parsed.header?.$INSUNITS ?? 'Unitless'),
    bounds: computeBounds(entities),
    layers,
    layouts: [{ name: 'Model', entityCount: entities.length }],
    entities,
    textAnnotations,
    blockNames: Object.keys(blocks).filter((b) => !b.startsWith('*')),
    totalEntityCount: entities.length,
    parseWarnings,
  };
}

const DWG_VERSION_MAP: Record<string, string> = {
  AC1009: 'AutoCAD R11/R12 (AC1009)',
  AC1012: 'AutoCAD R13 (AC1012)',
  AC1014: 'AutoCAD R14 (AC1014)',
  AC1015: 'AutoCAD 2000–2002 (AC1015)',
  AC1018: 'AutoCAD 2004–2006 (AC1018)',
  AC1021: 'AutoCAD 2007–2009 (AC1021)',
  AC1024: 'AutoCAD 2010–2012 (AC1024)',
  AC1027: 'AutoCAD 2013–2017 (AC1027)',
  AC1032: 'AutoCAD 2018–2024 (AC1032)',
};

function detectDwgVersionLabel(buffer: Buffer): { code: string; label: string } {
  const sig = buffer.subarray(0, 6).toString('latin1');
  if (/^AC10\d{2}$/.test(sig)) {
    return { code: sig, label: DWG_VERSION_MAP[sig] || `AutoCAD DWG (${sig})` };
  }
  return { code: 'UNKNOWN', label: 'Unknown DWG Header' };
}

/**
 * Spawns an isolated, short-lived child process to run LibreDWG WASM decoding.
 * Even if LibreDWG hits OOM, SIGABRT, or WASM "table index is out of bounds",
 * only the disposable child process terminates — the main Express server stays 100% healthy.
 */
async function runIsolatedDwgWorker(
  mode: 'convert' | 'dxf',
  inputPath: string,
  outputPath: string
): Promise<{ ok: boolean; stderr: string }> {
  const bundledWorker = path.resolve(process.cwd(), 'dist-server', 'dwgWorker.mjs');
  const tsxWorker = path.resolve(process.cwd(), 'server', 'dwgWorker.ts');
  const tsxBin = path.resolve(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
  );

  // Prefer compiled .mjs worker in packaged Electron or when dist-server is built,
  // falling back to tsx.cmd (Windows) / tsx (POSIX) in local dev.
  const useBundled = fs.existsSync(bundledWorker) && (!fs.existsSync(tsxWorker) || fs.statSync(bundledWorker).mtimeMs >= fs.statSync(tsxWorker).mtimeMs);
  const cmd = useBundled ? process.execPath : tsxBin;
  const args = useBundled ? [bundledWorker, mode, inputPath, outputPath] : [tsxWorker, mode, inputPath, outputPath];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_OPTIONS: '--max-old-space-size=1024',
  };
  if (useBundled && process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = '1';
  }

  try {
    const { stderr } = await execFileAsync(cmd, args, {
      timeout: 25000,
      maxBuffer: 4 * 1024 * 1024,
      shell: !useBundled && process.platform === 'win32',
      env,
    });
    return { ok: fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0, stderr: stderr || '' };
  } catch (err: any) {
    const errText = [err?.stderr, err?.message].filter(Boolean).join(' ').trim();
    return { ok: false, stderr: errText || 'Isolated DWG worker process terminated.' };
  }
}

function buildCadFromDwgDatabase(db: any, cadVersionFallback: string, parseWarnings: string[]): CadDocumentData {
  const layerColorMap = new Map<string, string>();
  const layerVisibleMap = new Map<string, boolean>();
  const layerCounts = new Map<string, number>();

  if (db?.tables?.LAYER?.entries) {
    for (const lyr of db.tables.LAYER.entries) {
      const name = lyr?.name || '0';
      const ci = typeof lyr?.colorIndex === 'number' ? lyr.colorIndex : 7;
      layerColorMap.set(name, aciToHex(Math.abs(ci), lyr?.color));
      const isHidden = Boolean(lyr?.off) || Boolean(lyr?.frozen) || ci < 0 || name.toLowerCase() === 'defpoints';
      layerVisibleMap.set(name, !isHidden);
      layerCounts.set(name, 0);
    }
  }

  const blockMap = new Map<string, any>();
  if (db?.tables?.BLOCK_RECORD?.entries) {
    for (const blk of db.tables.BLOCK_RECORD.entries) {
      if (blk?.name) blockMap.set(blk.name, blk);
    }
  }

  const entities: CadEntity[] = [];
  const textAnnotations: CadDocumentData['textAnnotations'] = [];
  let seq = 1;

  const resolveColor = (raw: any, layer: string, parentColor: string) => {
    if (typeof raw?.color === 'number' && raw.color > 0 && raw.color <= 0xffffff && raw?.colorIndex !== 0 && raw?.colorIndex !== 256) {
      return aciToHex(undefined, raw.color);
    }
    if (raw?.colorIndex === 0) return parentColor;
    if (typeof raw?.colorIndex === 'number' && raw.colorIndex !== 256 && raw.colorIndex > 0 && raw.colorIndex <= 255) {
      return aciToHex(raw.colorIndex);
    }
    return layerColorMap.get(layer) || '#e2e8f0';
  };

  const ingestDwgEntity = (
    raw: any,
    transform: Transform2D,
    inheritedLayer: string | undefined,
    parentColor: string,
    blockSource: string | undefined,
    depth: number
  ) => {
    if (!raw || !raw.type || depth > 8) return;
    if (raw.isVisible === false || raw.visible === false) return;

    const layer = raw.layer && raw.layer !== '0' ? raw.layer : inheritedLayer || raw.layer || '0';
    const color = resolveColor(raw, layer, parentColor);
    const id = `dwg_${seq++}`;
    const bump = () => {
      layerCounts.set(layer, (layerCounts.get(layer) || 0) + 1);
      if (!layerColorMap.has(layer)) layerColorMap.set(layer, color);
      if (!layerVisibleMap.has(layer)) layerVisibleMap.set(layer, layer.toLowerCase() !== 'defpoints');
    };

    const t = String(raw.type).toUpperCase();
    if (t === 'LINE' && raw.startPoint && raw.endPoint) {
      entities.push({
        id,
        type: 'LINE',
        layer,
        color,
        points: [
          applyTransform({ x: raw.startPoint.x, y: raw.startPoint.y }, transform),
          applyTransform({ x: raw.endPoint.x, y: raw.endPoint.y }, transform),
        ],
        blockSource,
      });
      bump();
    } else if (
      (t === 'LWPOLYLINE' || t === 'POLYLINE2D' || t === 'POLYLINE') &&
      Array.isArray(raw.vertices) &&
      raw.vertices.length >= 2
    ) {
      const verts = raw.vertices;
      const pts: CadPoint[] = [];
      for (let i = 0; i < verts.length; i++) {
        const curr = { x: verts[i].x, y: verts[i].y };
        if (i === 0) pts.push(applyTransform(curr, transform));
        if (i < verts.length - 1) {
          const next = { x: verts[i + 1].x, y: verts[i + 1].y };
          if (verts[i].bulge) {
            for (const bp of approximateBulgeArc(curr, next, verts[i].bulge)) {
              pts.push(applyTransform(bp, transform));
            }
          } else {
            pts.push(applyTransform(next, transform));
          }
        }
      }
      entities.push({
        id,
        type: 'LWPOLYLINE',
        layer,
        color,
        points: pts,
        closed: Boolean((raw.flag ?? 0) & 1 || raw.closed),
        blockSource,
      });
      bump();
    } else if (t === 'HATCH' && Array.isArray(raw.boundaryPaths) && raw.boundaryPaths.length > 0) {
      const paths: CadPoint[][] = [];
      for (const bp of raw.boundaryPaths) {
        if (Array.isArray(bp?.vertices) && bp.vertices.length >= 3) {
          const pts: CadPoint[] = [];
          for (let i = 0; i < bp.vertices.length; i++) {
            const curr = { x: bp.vertices[i].x, y: bp.vertices[i].y };
            if (i === 0) pts.push(applyTransform(curr, transform));
            if (i < bp.vertices.length - 1) {
              const next = { x: bp.vertices[i + 1].x, y: bp.vertices[i + 1].y };
              if (bp.vertices[i].bulge) {
                for (const arcPt of approximateBulgeArc(curr, next, bp.vertices[i].bulge, 8)) {
                  pts.push(applyTransform(arcPt, transform));
                }
              } else {
                pts.push(applyTransform(next, transform));
              }
            }
          }
          if (pts.length >= 3) paths.push(pts);
        } else if (Array.isArray(bp?.edges) && bp.edges.length > 0) {
          const pts: CadPoint[] = [];
          for (const edge of bp.edges) {
            if (edge?.start && edge?.end) {
              if (pts.length === 0) pts.push(applyTransform({ x: edge.start.x, y: edge.start.y }, transform));
              pts.push(applyTransform({ x: edge.end.x, y: edge.end.y }, transform));
            } else if (edge?.center && typeof edge?.radius === 'number') {
              const arcPts = sampleArcPoints(
                edge.center.x,
                edge.center.y,
                edge.radius,
                ((edge.startAngle ?? 0) * 180) / Math.PI,
                ((edge.endAngle ?? Math.PI * 2) * 180) / Math.PI,
                edge.isCounterClockwise !== false,
                16
              );
              for (const ap of arcPts) pts.push(applyTransform(ap, transform));
            }
          }
          if (pts.length >= 3) paths.push(pts);
        }
      }
      if (paths.length > 0) {
        entities.push({
          id,
          type: 'HATCH',
          layer,
          color,
          paths,
          solidFill: raw.solidFill !== 0 && raw.solidFill !== false,
          closed: true,
          blockSource,
        });
        bump();
      }
    } else if (t === 'CIRCLE' && raw.center && typeof raw.radius === 'number') {
      const scale = (Math.abs(transform.sx) + Math.abs(transform.sy)) / 2;
      entities.push({
        id,
        type: 'CIRCLE',
        layer,
        color,
        center: applyTransform({ x: raw.center.x, y: raw.center.y }, transform),
        radius: raw.radius * scale,
        blockSource,
      });
      bump();
    } else if (t === 'ARC' && raw.center && typeof raw.radius === 'number') {
      const scale = (Math.abs(transform.sx) + Math.abs(transform.sy)) / 2;
      entities.push({
        id,
        type: 'ARC',
        layer,
        color,
        center: applyTransform({ x: raw.center.x, y: raw.center.y }, transform),
        radius: raw.radius * scale,
        startAngle: (raw.startAngle ?? 0) + transform.rotRad,
        endAngle: (raw.endAngle ?? Math.PI * 2) + transform.rotRad,
        blockSource,
      });
      bump();
    } else if (t === 'ELLIPSE' && raw.center && raw.majorAxisEndPoint) {
      entities.push({
        id,
        type: 'ELLIPSE',
        layer,
        color,
        center: applyTransform({ x: raw.center.x, y: raw.center.y }, transform),
        majorAxis: {
          x: raw.majorAxisEndPoint.x * transform.sx,
          y: raw.majorAxisEndPoint.y * transform.sy,
        },
        axisRatio: raw.axisRatio ?? 1,
        startAngle: raw.startAngle ?? 0,
        endAngle: raw.endAngle ?? Math.PI * 2,
        blockSource,
      });
      bump();
    } else if (t === 'SPLINE' && Array.isArray(raw.controlPoints) && raw.controlPoints.length >= 2) {
      entities.push({
        id,
        type: 'SPLINE',
        layer,
        color,
        points: raw.controlPoints.map((p: any) => applyTransform({ x: p.x, y: p.y }, transform)),
        blockSource,
      });
      bump();
    } else if (t === 'TEXT' || t === 'MTEXT' || t === 'ATTRIB' || t === 'ATTDEF') {
      // Skip invisible attributes & non-constant ATTDEF placeholders inside blocks
      if (raw.invisible === true || ((raw.flags ?? 0) & 1) !== 0) return;
      if (t === 'ATTDEF' && blockSource && !raw.constant && ((raw.flags ?? 0) & 2) === 0) return;

      const halign = raw.halign ?? raw.horizontalJustification ?? 0;
      const valign = raw.valign ?? raw.verticalJustification ?? 0;
      const useEnd = t !== 'MTEXT' && (halign !== 0 || valign !== 0) && raw.endPoint;
      const pos = useEnd ? raw.endPoint : raw.insertionPoint || raw.startPoint || raw.position;
      const cleaned = cleanMText(String(raw.text || raw.defaultValue || ''));
      if (pos && cleaned) {
        const pt = applyTransform({ x: pos.x, y: pos.y }, transform);
        const height = (raw.textHeight || raw.height || 2.5) * Math.abs(transform.sy);
        const { rad, flipped } = normalizeReadableRotation((raw.rotation || 0) + transform.rotRad);
        const alignInfo =
          t === 'MTEXT'
            ? mapMTextAlignment(raw.attachmentPoint)
            : mapTextAlignment(halign, valign, flipped);
        entities.push({
          id,
          type: t === 'MTEXT' ? 'MTEXT' : 'TEXT',
          layer,
          color,
          center: pt,
          text: cleaned,
          height,
          rotation: rad,
          textAlign: alignInfo.textAlign,
          textBaseline: alignInfo.textBaseline,
          blockSource,
        });
        textAnnotations.push({
          id,
          text: cleaned,
          x: Math.round(pt.x * 100) / 100,
          y: Math.round(pt.y * 100) / 100,
          layer,
          height,
        });
        bump();
      }
    } else if (t === 'SOLID' && raw.corner1 && raw.corner2 && raw.corner3) {
      const corners = [raw.corner1, raw.corner2, raw.corner3, raw.corner4].filter(Boolean);
      const pts = corners.map((c: any) => applyTransform({ x: c.x, y: c.y }, transform));
      entities.push({
        id,
        type: 'SOLID',
        layer,
        color,
        points: reorderSolidPoints(pts),
        closed: true,
        blockSource,
      });
      bump();
    } else if (t === 'INSERT' && raw.name) {
      const blk = blockMap.get(raw.name);
      const pos = raw.insertionPoint || { x: 0, y: 0 };
      const childT: Transform2D = {
        tx: pos.x,
        ty: pos.y,
        sx: raw.xScale ?? 1,
        sy: raw.yScale ?? 1,
        rotRad: raw.rotation ?? 0,
      };
      const nextT = composeTransform(transform, childT);
      const baseX = blk?.basePoint?.x ?? 0;
      const baseY = blk?.basePoint?.y ?? 0;
      const adjustedT =
        baseX !== 0 || baseY !== 0
          ? composeTransform(nextT, { tx: -baseX, ty: -baseY, sx: 1, sy: 1, rotRad: 0 })
          : nextT;
      if (blk?.entities) {
        for (const child of blk.entities) {
          ingestDwgEntity(child, adjustedT, layer, color, raw.name, depth + 1);
        }
      }
      if (Array.isArray(raw.attribs)) {
        for (const attr of raw.attribs) {
          ingestDwgEntity(attr, transform, layer, color, raw.name, depth + 1);
        }
      }
    } else if (t.startsWith('DIMENSION')) {
      if (raw.text && raw.text !== '<>' && raw.textPoint) {
        const cleaned = cleanMText(String(raw.text));
        const pt = applyTransform({ x: raw.textPoint.x, y: raw.textPoint.y }, transform);
        entities.push({
          id,
          type: 'DIMENSION',
          layer,
          color,
          center: pt,
          text: cleaned,
          height: 2.5,
          textAlign: 'center',
          textBaseline: 'middle',
          blockSource,
        });
        textAnnotations.push({ id, text: cleaned, x: Math.round(pt.x * 100) / 100, y: Math.round(pt.y * 100) / 100, layer });
        bump();
      }
      if (raw.name && blockMap.get(raw.name)?.entities) {
        for (const child of blockMap.get(raw.name).entities) {
          ingestDwgEntity(child, transform, layer, color, raw.name, depth + 1);
        }
      }
    }
  };

  for (const rawEntity of db?.entities || []) {
    ingestDwgEntity(rawEntity, IDENTITY_TRANSFORM, undefined, '#e2e8f0', undefined, 0);
  }

  const layers: CadLayer[] = Array.from(layerCounts.entries())
    .filter(([, count]) => count > 0)
    .map(([name, entityCount]) => ({
      name,
      color: layerColorMap.get(name) || '#e2e8f0',
      visible: layerVisibleMap.get(name) ?? true,
      entityCount,
    }))
    .sort((a, b) => b.entityCount - a.entityCount);

  return {
    format: 'DWG',
    cadVersion: db?.header?.ACADVER || cadVersionFallback,
    units: String(db?.header?.INSUNITS ?? 'Unitless'),
    bounds: computeBounds(entities),
    layers,
    layouts: [{ name: 'Model', entityCount: entities.length }],
    entities,
    textAnnotations,
    blockNames: Array.from(blockMap.keys()).filter((b) => !b.startsWith('*')),
    totalEntityCount: entities.length,
    parseWarnings,
  };
}

/**
 * Multi-tier resilient binary AutoCAD .DWG parser running LibreDWG strictly out-of-process:
 *   Tier 0: Detect misnamed ASCII DXF files uploaded with a .dwg extension.
 *   Tier 1: Isolated child process -> dwg_read_data -> convertEx.
 *   Tier 2: Isolated child process -> native C dwg_write_dxf -> parseDxfBuffer.
 */
export async function parseDwgBuffer(buffer: Buffer): Promise<CadDocumentData> {
  const versionInfo = detectDwgVersionLabel(buffer);
  const parseWarnings: string[] = [];

  // Tier 0: Check if an ASCII DXF was saved/renamed with a .dwg extension
  const headText = buffer.subarray(0, Math.min(buffer.length, 2048)).toString('utf8');
  if (headText.includes('SECTION') && (headText.includes('HEADER') || headText.includes('ENTITIES'))) {
    const dxfCad = parseDxfBuffer(buffer);
    return {
      ...dxfCad,
      format: 'DWG',
      parseWarnings: [
        ...dxfCad.parseWarnings,
        'File contained ASCII DXF structure under a .dwg extension; parsed losslessly.',
      ],
    };
  }

  const stamp = `${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tmpDwg = path.join(os.tmpdir(), `railspec_in_${stamp}.dwg`);
  const tmpJson = path.join(os.tmpdir(), `railspec_out_${stamp}.json`);
  const tmpDxf = path.join(os.tmpdir(), `railspec_out_${stamp}.dxf`);
  let lastErrorMessage = '';

  try {
    fs.writeFileSync(tmpDwg, buffer);

    // Tier 1 (Fastest & Highest Fidelity): Isolated child process -> Native C dwg_write_dxf -> parseDxfBuffer
    // Preserves 100% of HATCH color bands, ATTRIB labels, SOLIDs, and blocks without WASM convert table bugs.
    const t1 = await runIsolatedDwgWorker('dxf', tmpDwg, tmpDxf);
    if (t1.ok) {
      try {
        const dxfBuf = fs.readFileSync(tmpDxf);
        const dxfCad = parseDxfBuffer(dxfBuf);
        if (dxfCad.totalEntityCount > 0 || dxfCad.layers.length > 0) {
          return {
            ...dxfCad,
            format: 'DWG',
            cadVersion: versionInfo.label,
            parseWarnings: [
              ...parseWarnings,
              ...dxfCad.parseWarnings,
              `Decoded ${versionInfo.label} via isolated LibreDWG DXF bridge (${dxfCad.totalEntityCount.toLocaleString()} entities preserved).`,
            ],
          };
        }
        parseWarnings.push('Primary DXF bridge returned 0 model-space entities; trying direct LibreDWG database conversion.');
      } catch (err) {
        lastErrorMessage = (err as Error)?.message || 'DXF bridge parse error';
      }
    } else {
      lastErrorMessage = t1.stderr;
    }

    // Tier 2 (Fallback): Isolated child process -> dwg_read_data + convertEx
    const t2 = await runIsolatedDwgWorker('convert', tmpDwg, tmpJson);
    if (t2.ok) {
      try {
        const db = JSON.parse(fs.readFileSync(tmpJson, 'utf8'));
        const cad = buildCadFromDwgDatabase(db, versionInfo.label, parseWarnings);
        if (cad.totalEntityCount > 0 || cad.layers.length > 0) {
          return cad;
        }
      } catch (err) {
        lastErrorMessage = lastErrorMessage || (err as Error)?.message || 'Unable to read converted DWG database.';
      }
    } else if (!lastErrorMessage) {
      lastErrorMessage = t2.stderr;
    }
  } finally {
    for (const f of [tmpDwg, tmpJson, tmpDxf]) {
      if (fs.existsSync(f)) {
        try {
          fs.unlinkSync(f);
        } catch {
          // ignore cleanup failure
        }
      }
    }
  }

  // Clear, actionable engineering message (never leak cryptic raw WASM stack crashes)
  const isUnsupportedModern = versionInfo.code === 'AC1032' || versionInfo.code === 'AC1027';
  const friendlyReason =
    versionInfo.code === 'UNKNOWN'
      ? 'This file does not contain a valid AutoCAD DWG binary header (AC10xx).'
      : isUnsupportedModern
        ? `Detected ${versionInfo.label}. This DWG contains proprietary AutoCAD proxy/AEC objects or compressed tables that GNU LibreDWG could not decode.`
        : `Detected ${versionInfo.label}, but its binary object tables could not be decoded (${lastErrorMessage.includes('table index') ? 'unsupported internal CAD proxy/object table' : lastErrorMessage.slice(0, 180)}).`;

  throw new Error(
    `${friendlyReason} Please save/export the drawing in AutoCAD as ASCII DXF (R2013/R2018 DXF), AutoCAD 2010/2013 DWG, or Vector PDF and upload again.`
  );
}

/**
 * Dynamically detects RFID tag triangle orientations (facing LEFT -X vs RIGHT +X)
 * and signal-head circle internal line patterns (horizontal=Green, vertical=Red,
 * diagonal/cross=Yellow, double=Double Yellow) purely from CAD vector geometry.
 */
function analyzeCadSignalAndRfidGeometry(cad: CadDocumentData): {
  rfidOrientations: string[];
  signalPatterns: string[];
} {
  const rfidOrientations: string[] = [];
  const signalPatterns: string[] = [];

  // 1. Collect candidate RFID tag text labels (R-xxx, TAG-xxx, etc.)
  const rfidTexts = cad.textAnnotations.filter((t) =>
    /\bR[-\s]?\d+[A-Z0-9-]*\b/i.test(t.text)
  );

  // Detect small triangular polylines/solids (3 distinct vertices) representing RFID tag arrowheads
  interface TriFeature {
    cx: number;
    cy: number;
    apexX: number;
    facing: 'RIGHT (+X)' | 'LEFT (-X)';
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
      // Deduplicate closing vertex if closed
      const uniq: CadPoint[] = [];
      for (const p of e.points) {
        if (!uniq.some((u) => Math.hypot(u.x - p.x, u.y - p.y) < 1e-3)) {
          uniq.push(p);
        }
      }
      if (uniq.length !== 3) continue;

      const d01 = Math.hypot(uniq[0].x - uniq[1].x, uniq[0].y - uniq[1].y);
      const d12 = Math.hypot(uniq[1].x - uniq[2].x, uniq[1].y - uniq[2].y);
      const d20 = Math.hypot(uniq[2].x - uniq[0].x, uniq[2].y - uniq[0].y);
      const maxEdge = Math.max(d01, d12, d20);
      const minEdge = Math.min(d01, d12, d20);
      // Skip degenerate or huge layout border triangles
      if (maxEdge <= 0.1 || maxEdge > cad.bounds.width * 0.05 || minEdge / maxEdge < 0.15) continue;

      // In an isosceles/directional RFID triangle, the base connects the two vertices with similar X
      // and the apex is the vertex farthest horizontally from the centroid.
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
      if (maxDx < maxEdge * 0.18) continue; // nearly vertical triangle with no clear X direction

      triangles.push({
        cx,
        cy,
        apexX: apex.x,
        facing: apex.x > cx ? 'RIGHT (+X)' : 'LEFT (-X)',
        size: maxEdge,
        layer: e.layer,
        blockSource: e.blockSource,
      });
    }
  }

  // Pair each RFID text label with its nearest directional triangle
  const matchedRfid = new Set<string>();
  const searchRadius = Math.max(cad.bounds.height * 0.12, 80);
  for (const rt of [...rfidTexts].sort((a, b) => a.x - b.x || b.y - a.y)) {
    let best: TriFeature | null = null;
    let bestDist = Infinity;
    for (const tri of triangles) {
      const dist = Math.hypot(tri.cx - rt.x, tri.cy - rt.y);
      if (dist < bestDist && dist <= Math.max(tri.size * 5, searchRadius)) {
        bestDist = dist;
        best = tri;
      }
    }
    if (best) {
      const key = `${rt.text}@${Math.round(rt.x)},${Math.round(rt.y)}`;
      if (!matchedRfid.has(key)) {
        matchedRfid.add(key);
        rfidOrientations.push(
          `Tag "${rt.text}" at (X:${rt.x}, Y:${rt.y}) -> Triangle Facing: ${best.facing} (dist=${bestDist.toFixed(1)}, layer=${best.layer}${best.blockSource ? `, block=${best.blockSource}` : ''})`
        );
      }
    }
  }

  // 2. Detect Signal-Head Circles (both native CIRCLE entities and bulged circular LWPOLYLINE loops)
  const detectedCircles: Array<{ x: number; y: number; r: number; blockSource?: string }> = [];

  const quarterArcs: Array<{ cx: number; cy: number; r: number; blockSource?: string }> = [];

  for (const e of cad.entities) {
    if (
      e.type === 'CIRCLE' &&
      e.center &&
      typeof e.radius === 'number' &&
      e.radius > 0.2 &&
      e.radius < cad.bounds.width * 0.025
    ) {
      detectedCircles.push({ x: e.center.x, y: e.center.y, r: e.radius, blockSource: e.blockSource });
    } else if (
      (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') &&
      e.points &&
      e.points.length >= 8
    ) {
      // Check if polyline forms a circular ring or strict 8-10 vertex octagon
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of e.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const w = maxX - minX;
      const h = maxY - minY;
      if (w > 0.4 && h > 0.4 && w < cad.bounds.width * 0.05 && h < cad.bounds.height * 0.05) {
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const r = (w + h) / 4;
        const ratio = Math.min(w, h) / Math.max(w, h);
        const radialOk =
          ratio >= 0.75 &&
          e.points.every((p) => {
            const d = Math.hypot(p.x - cx, p.y - cy);
            return d >= r * 0.75 && d <= r * 1.25;
          });
        const isOctagon = ratio >= 0.55 && e.points.length >= 8 && e.points.length <= 10;
        if (radialOk || isOctagon) {
          detectedCircles.push({ x: cx, y: cy, r, blockSource: e.blockSource });
        }
      }
    } else if (e.type === 'SPLINE' && e.points && e.points.length === 4) {
      const p0 = e.points[0], p1 = e.points[1], p2 = e.points[2], p3 = e.points[3];
      const dx = Math.abs(p3.x - p0.x);
      const dy = Math.abs(p3.y - p0.y);
      if (dx >= 0.25 && dy >= 0.25 && dx < cad.bounds.width * 0.025 && Math.abs(dx - dy) <= Math.max(dx, dy) * 0.25) {
        const mxCtrl = (p1.x + p2.x) / 2;
        const myCtrl = (p1.y + p2.y) / 2;
        const c1x = p0.x, c1y = p3.y;
        const c2x = p3.x, c2y = p0.y;
        const d1 = Math.hypot(mxCtrl - c1x, myCtrl - c1y);
        const d2 = Math.hypot(mxCtrl - c2x, myCtrl - c2y);
        quarterArcs.push({ cx: d1 > d2 ? c1x : c2x, cy: d1 > d2 ? c1y : c2y, r: (dx + dy) / 2, blockSource: e.blockSource });
      }
    } else if (e.type === 'SPLINE' && e.points && e.points.length >= 8) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of e.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const w = maxX - minX;
      const h = maxY - minY;
      if (w > 0.4 && h > 0.4 && w < cad.bounds.width * 0.05 && h < cad.bounds.height * 0.05) {
        const ratio = Math.min(w, h) / Math.max(w, h);
        if (ratio >= 0.55) {
          detectedCircles.push({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, r: (w + h) / 4, blockSource: e.blockSource });
        }
      }
    }
  }

  const usedArc = new Array(quarterArcs.length).fill(false);
  for (let i = 0; i < quarterArcs.length; i++) {
    if (usedArc[i]) continue;
    usedArc[i] = true;
    const base = quarterArcs[i];
    let count = 1, sumX = base.cx, sumY = base.cy, sumR = base.r;
    for (let j = i + 1; j < quarterArcs.length; j++) {
      if (usedArc[j]) continue;
      if (Math.hypot(quarterArcs[j].cx - base.cx, quarterArcs[j].cy - base.cy) <= Math.max(base.r * 0.2, 0.15)) {
        usedArc[j] = true;
        count++;
        sumX += quarterArcs[j].cx;
        sumY += quarterArcs[j].cy;
        sumR += quarterArcs[j].r;
      }
    }
    if (count >= 3) {
      detectedCircles.push({ x: sumX / count, y: sumY / count, r: sumR / count, blockSource: base.blockSource });
    }
  }

  // Collect line segments (from LINE and 2-point polylines)
  const segments: Array<{ x1: number; y1: number; x2: number; y2: number; mx: number; my: number; len: number }> = [];
  for (const e of cad.entities) {
    if ((e.type === 'LINE' || e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.points && e.points.length >= 2) {
      // Skip circular rings themselves when scanning internal chord lines
      if (e.points.length >= 8) continue;
      for (let i = 0; i < e.points.length - 1; i++) {
        const p1 = e.points[i];
        const p2 = e.points[i + 1];
        const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (len > 0.1 && len < cad.bounds.width * 0.05) {
          segments.push({
            x1: p1.x,
            y1: p1.y,
            x2: p2.x,
            y2: p2.y,
            mx: (p1.x + p2.x) / 2,
            my: (p1.y + p2.y) / 2,
            len,
          });
        }
      }
    }
  }

  interface AspectCircleInfo {
    x: number;
    y: number;
    r: number;
    pattern: string;
    blockSource?: string;
  }
  const aspectCircles: AspectCircleInfo[] = [];

  for (const c of detectedCircles) {
    const cx = c.x;
    const cy = c.y;
    const r = c.r;
    let horiz = 0;
    let vert = 0;
    let diagPos = 0;
    let diagNeg = 0;

    for (const s of segments) {
      // Midpoint must lie near the circle center and endpoints within 1.35 * radius
      if (Math.abs(s.mx - cx) > r * 0.9 || Math.abs(s.my - cy) > r * 0.9) continue;
      if (s.len < r * 0.6 || s.len > r * 2.5) continue;
      const d1 = Math.hypot(s.x1 - cx, s.y1 - cy);
      const d2 = Math.hypot(s.x2 - cx, s.y2 - cy);
      if (d1 > r * 1.35 || d2 > r * 1.35) continue;

      const dx = s.x2 - s.x1;
      const dy = s.y2 - s.y1;
      const angleDeg = ((Math.atan2(dy, dx) * 180) / Math.PI + 180) % 180;
      if (angleDeg <= 18 || angleDeg >= 162) {
        horiz++;
      } else if (angleDeg >= 72 && angleDeg <= 108) {
        vert++;
      } else if (angleDeg > 18 && angleDeg < 72) {
        diagPos++;
      } else {
        diagNeg++;
      }
    }

    const total = horiz + vert + diagPos + diagNeg;
    if (total === 0) continue;

    let pattern = '';
    if (horiz >= 2 && vert === 0 && diagPos === 0 && diagNeg === 0) {
      pattern = 'Double-Horizontal(Double/Green)';
    } else if (horiz === 1 && vert === 0 && diagPos === 0 && diagNeg === 0) {
      pattern = 'Horizontal(Green)';
    } else if (vert >= 2 && horiz === 0 && diagPos === 0 && diagNeg === 0) {
      pattern = 'Double-Vertical(Double/Red)';
    } else if (vert === 1 && horiz === 0 && diagPos === 0 && diagNeg === 0) {
      pattern = 'Vertical(Red)';
    } else if (diagPos >= 1 && diagNeg >= 1) {
      pattern = 'Cross-Diagonal(Yellow)';
    } else if (diagPos >= 2 || diagNeg >= 2) {
      pattern = 'Double-Diagonal(Double Yellow)';
    } else if (diagPos === 1 || diagNeg === 1) {
      pattern = 'Diagonal(Yellow)';
    } else {
      pattern = `Mixed(H:${horiz},V:${vert},D:${diagPos + diagNeg})`;
    }

    aspectCircles.push({ x: cx, y: cy, r, pattern, blockSource: c.blockSource });
  }

  // Cluster adjacent signal aspect circles (same signal head) within 3.5*r distance
  const visited = new Array(aspectCircles.length).fill(false);
  const clusters: AspectCircleInfo[][] = [];
  for (let i = 0; i < aspectCircles.length; i++) {
    if (visited[i]) continue;
    const queue = [i];
    visited[i] = true;
    const group: AspectCircleInfo[] = [];
    while (queue.length > 0) {
      const idx = queue.shift()!;
      const cur = aspectCircles[idx];
      group.push(cur);
      for (let j = 0; j < aspectCircles.length; j++) {
        if (visited[j]) continue;
        const other = aspectCircles[j];
        const maxGap = Math.max(cur.r, other.r) * 3.6;
        if (Math.hypot(cur.x - other.x, cur.y - other.y) <= maxGap) {
          visited[j] = true;
          queue.push(j);
        }
      }
    }
    if (group.length >= 1 && group.length <= 6) {
      clusters.push(group);
    }
  }

  // Pair each signal head cluster with nearby text annotations
  const sortedClusters = clusters.sort((a, b) => a[0].x - b[0].x);
  for (const grp of sortedClusters.slice(0, 120)) {
    const cx = grp.reduce((acc, g) => acc + g.x, 0) / grp.length;
    const cy = grp.reduce((acc, g) => acc + g.y, 0) / grp.length;
    const avgR = grp.reduce((acc, g) => acc + g.r, 0) / grp.length;
    const nearbyLabels = cad.textAnnotations
      .filter((t) => Math.hypot(t.x - cx, t.y - cy) <= Math.max(avgR * 18, 65))
      .sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))
      .slice(0, 4)
      .map((t) => `"${t.text.replace(/\s+/g, ' ')}"`);
    const blockSrc = grp.find((g) => g.blockSource)?.blockSource;
    const patternsStr = grp.map((g) => g.pattern).join(' + ');
    signalPatterns.push(
      `SignalHead (${grp.length} aspects) at (X:${cx.toFixed(1)}, Y:${cy.toFixed(1)})${blockSrc ? ` [Block:${blockSrc}]` : ''}: [${patternsStr}]${nearbyLabels.length ? ` | Nearby text: ${nearbyLabels.join(', ')}` : ''}`
    );
  }

  return { rfidOrientations, signalPatterns };
}

/**
 * Generates a compact, high-precision spatial geometry + text digest of a CAD drawing
 * so the dynamic extraction engine has exact coordinates, RFID tag IDs & facing directions,
 * signal aspect patterns, TINs, signals, points, distances, and layer groupings.
 */
export function buildCadGeometryDigest(cad: CadDocumentData): string {
  const lines: string[] = [];
  lines.push(`CAD Format: ${cad.format} | Version: ${cad.cadVersion || 'Unknown'} | Total Entities: ${cad.totalEntityCount}`);
  lines.push(
    `Drawing Bounds: X=[${cad.bounds.minX.toFixed(2)}, ${cad.bounds.maxX.toFixed(2)}], Y=[${cad.bounds.minY.toFixed(2)}, ${cad.bounds.maxY.toFixed(2)}]`
  );
  lines.push(
    `Layers (${cad.layers.length}): ${cad.layers.slice(0, 40).map((l) => `${l.name}(${l.entityCount})`).join(', ')}`
  );
  if (cad.blockNames.length > 0) {
    lines.push(`Named Blocks (${cad.blockNames.length}): ${cad.blockNames.slice(0, 60).join(', ')}`);
  }

  // Build id -> blockSource lookup from entities
  const entityBlockMap = new Map<string, string>();
  for (const e of cad.entities) {
    if (e.blockSource) entityBlockMap.set(e.id, e.blockSource);
  }

  // Sort text annotations left-to-right (X) then top-to-bottom (Y descending in CAD)
  const sortedTexts = [...cad.textAnnotations].sort((a, b) => a.x - b.x || b.y - a.y);
  lines.push(`\nALL TEXT ANNOTATIONS WITH EXACT CAD COORDINATES (${sortedTexts.length} items):`);
  for (const t of sortedTexts.slice(0, 900)) {
    const blk = entityBlockMap.get(t.id);
    lines.push(
      `[X:${t.x}, Y:${t.y} | Layer:${t.layer}${blk ? ` | Block:${blk}` : ''}] ${t.text.replace(/\s+/g, ' ')}`
    );
  }

  // Dynamically computed RFID Tag orientations & Signal aspect stroke patterns
  const { rfidOrientations, signalPatterns } = analyzeCadSignalAndRfidGeometry(cad);
  if (rfidOrientations.length > 0) {
    lines.push(`\nDETECTED RFID TAG TRIANGLE FACING DIRECTIONS (${rfidOrientations.length} tags):`);
    for (const ro of rfidOrientations.slice(0, 200)) {
      lines.push(ro);
    }
  }
  if (signalPatterns.length > 0) {
    lines.push(`\nDETECTED SIGNAL-HEAD ASPECT CIRCLE STROKE PATTERNS (${signalPatterns.length} signal heads):`);
    for (const sp of signalPatterns.slice(0, 120)) {
      lines.push(sp);
    }
  }

  // Summarize horizontal/diagonal track corridors from long lines/polylines
  const longLines = cad.entities
    .filter((e) => (e.type === 'LINE' || e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.points && e.points.length >= 2)
    .map((e) => {
      const p0 = e.points![0];
      const p1 = e.points![e.points!.length - 1];
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      return { layer: e.layer, p0, p1, len };
    })
    .filter((seg) => seg.len > cad.bounds.width * 0.02)
    .sort((a, b) => b.len - a.len)
    .slice(0, 100);

  if (longLines.length > 0) {
    lines.push(`\nMAJOR TRACK/CORRIDOR VECTOR SEGMENTS (${longLines.length} longest):`);
    for (const s of longLines) {
      lines.push(
        `Layer:${s.layer} (${s.p0.x.toFixed(1)},${s.p0.y.toFixed(1)}) -> (${s.p1.x.toFixed(1)},${s.p1.y.toFixed(1)}) len=${s.len.toFixed(1)}`
      );
    }
  }

  return lines.join('\n');
}
