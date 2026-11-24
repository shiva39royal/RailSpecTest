import React from 'react';
import type {
  CellAuditMeta,
  CellFontFamily,
  TextFormatSpan,
  TextStyleProps,
} from '../types/project';

export const FONT_FAMILY_OPTIONS: Array<{
  id: CellFontFamily;
  label: string;
  css: string | undefined;
  excelName: string;
  pdfFont: 'helvetica' | 'courier' | 'times';
}> = [
  { id: 'default', label: 'Default', css: undefined, excelName: 'Calibri', pdfFont: 'helvetica' },
  {
    id: 'sans',
    label: 'Public Sans',
    css: '"Public Sans", system-ui, sans-serif',
    excelName: 'Arial',
    pdfFont: 'helvetica',
  },
  {
    id: 'mono',
    label: 'JetBrains Mono',
    css: '"JetBrains Mono", ui-monospace, monospace',
    excelName: 'Consolas',
    pdfFont: 'courier',
  },
  {
    id: 'serif',
    label: 'Serif (Times)',
    css: 'Georgia, "Times New Roman", serif',
    excelName: 'Times New Roman',
    pdfFont: 'times',
  },
  {
    id: 'display',
    label: 'Plus Jakarta',
    css: '"Plus Jakarta Sans", system-ui, sans-serif',
    excelName: 'Calibri',
    pdfFont: 'helvetica',
  },
];

export const FONT_SIZE_OPTIONS = [9, 10, 11, 12, 13, 14, 16, 18];

export const TEXT_COLOR_PRESETS: Array<{ label: string; value: string }> = [
  { label: 'Default', value: '' },
  { label: 'Slate', value: '#0F172A' },
  { label: 'Blue', value: '#1D4ED8' },
  { label: 'Red', value: '#B91C1C' },
  { label: 'Green', value: '#047857' },
  { label: 'Amber', value: '#B45309' },
  { label: 'Purple', value: '#7C3AED' },
];

function cleanStyle(style: TextStyleProps): TextStyleProps {
  const cleaned: TextStyleProps = {};
  if (typeof style.fontSize === 'number' && Number.isFinite(style.fontSize)) {
    cleaned.fontSize = style.fontSize;
  }
  if (style.bold === true) {
    cleaned.bold = true;
  }
  if (style.fontFamily && style.fontFamily !== 'default') {
    cleaned.fontFamily = style.fontFamily;
  }
  if (style.color && style.color.trim() !== '') {
    cleaned.color = style.color.trim();
  }
  return cleaned;
}

function stylesEqual(a: TextStyleProps, b: TextStyleProps): boolean {
  return (
    a.fontSize === b.fontSize &&
    Boolean(a.bold) === Boolean(b.bold) &&
    (a.fontFamily || 'default') === (b.fontFamily || 'default') &&
    (a.color || '') === (b.color || '')
  );
}

function isEmptyStyle(s: TextStyleProps): boolean {
  return (
    s.fontSize === undefined &&
    !s.bold &&
    (!s.fontFamily || s.fontFamily === 'default') &&
    (!s.color || s.color === '')
  );
}

/**
 * Applies a font/color/bold formatting patch either to a selected substring [start, end)
 * or to the entire cell's base style.
 */
export function applyFormatToCellMeta(
  prevMeta: CellAuditMeta | undefined,
  textLength: number,
  patch: Partial<TextStyleProps> | 'clear',
  selection?: { start: number; end: number } | null
): CellAuditMeta {
  const baseMeta: CellAuditMeta = prevMeta ? { ...prevMeta } : { source: 'extracted' };

  if (patch === 'clear') {
    if (selection && selection.end > selection.start && textLength > 0 && baseMeta.spans?.length) {
      const selStart = Math.max(0, Math.min(textLength, selection.start));
      const selEnd = Math.max(selStart, Math.min(textLength, selection.end));
      const updatedSpans = applyPatchToSpans(baseMeta.spans, textLength, baseMeta.style || {}, selStart, selEnd, {
        fontSize: undefined,
        bold: false,
        fontFamily: 'default',
        color: '',
      });
      return {
        ...baseMeta,
        spans: updatedSpans.length > 0 ? updatedSpans : undefined,
        updatedAt: new Date().toISOString(),
      };
    }
    const { style: _s, spans: _sp, ...rest } = baseMeta;
    return { ...rest, updatedAt: new Date().toISOString() };
  }

  if (selection && selection.end > selection.start && textLength > 0) {
    const selStart = Math.max(0, Math.min(textLength, selection.start));
    const selEnd = Math.max(selStart, Math.min(textLength, selection.end));
    if (selEnd > selStart) {
      // Whole-text selection behaves cleanly as cell style update as well if covering 0..textLength and no spans exist
      if (selStart === 0 && selEnd === textLength && (!baseMeta.spans || baseMeta.spans.length === 0)) {
        const merged = cleanStyle({ ...(baseMeta.style || {}), ...patch });
        return {
          ...baseMeta,
          style: isEmptyStyle(merged) ? undefined : merged,
          updatedAt: new Date().toISOString(),
        };
      }
      const nextSpans = applyPatchToSpans(
        baseMeta.spans || [],
        textLength,
        baseMeta.style || {},
        selStart,
        selEnd,
        patch
      );
      return {
        ...baseMeta,
        spans: nextSpans.length > 0 ? nextSpans : undefined,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  const mergedCellStyle = cleanStyle({ ...(baseMeta.style || {}), ...patch });
  return {
    ...baseMeta,
    style: isEmptyStyle(mergedCellStyle) ? undefined : mergedCellStyle,
    updatedAt: new Date().toISOString(),
  };
}

function applyPatchToSpans(
  existingSpans: TextFormatSpan[],
  textLength: number,
  baseStyle: TextStyleProps,
  selStart: number,
  selEnd: number,
  patch: Partial<TextStyleProps>
): TextFormatSpan[] {
  // Build per-character effective style across 0..textLength, apply patch on [selStart, selEnd), then re-pack
  const chars: TextStyleProps[] = new Array(textLength);
  for (let i = 0; i < textLength; i++) {
    chars[i] = { ...baseStyle };
  }
  for (const sp of existingSpans) {
    const s = Math.max(0, sp.start);
    const e = Math.min(textLength, sp.end);
    for (let i = s; i < e; i++) {
      chars[i] = cleanStyle({ ...chars[i], ...sp });
    }
  }
  for (let i = selStart; i < selEnd; i++) {
    chars[i] = cleanStyle({ ...chars[i], ...patch });
  }

  const out: TextFormatSpan[] = [];
  let i = 0;
  while (i < textLength) {
    const cur = chars[i];
    let j = i + 1;
    while (j < textLength && stylesEqual(chars[j], cur)) {
      j++;
    }
    if (!stylesEqual(cur, cleanStyle(baseStyle))) {
      out.push({ start: i, end: j, ...cur });
    }
    i = j;
  }
  return out;
}

export function clampSpansToLength(
  spans: TextFormatSpan[] | undefined,
  newLength: number
): TextFormatSpan[] | undefined {
  if (!spans || spans.length === 0 || newLength <= 0) return undefined;
  const clamped = spans
    .map((sp) => ({
      ...sp,
      start: Math.max(0, Math.min(newLength, sp.start)),
      end: Math.max(0, Math.min(newLength, sp.end)),
    }))
    .filter((sp) => sp.end > sp.start);
  return clamped.length > 0 ? clamped : undefined;
}

export function buildFormattedSegments(
  text: string,
  meta?: CellAuditMeta
): Array<{ text: string; style: TextStyleProps }> {
  const baseStyle = cleanStyle(meta?.style || {});
  const spans = meta?.spans;
  if (!text) return [];
  if (!spans || spans.length === 0) {
    return [{ text, style: baseStyle }];
  }

  const len = text.length;
  const points = new Set<number>([0, len]);
  for (const sp of spans) {
    const s = Math.max(0, Math.min(len, sp.start));
    const e = Math.max(0, Math.min(len, sp.end));
    if (e > s) {
      points.add(s);
      points.add(e);
    }
  }
  const sortedPoints = Array.from(points).sort((a, b) => a - b);
  const segments: Array<{ text: string; style: TextStyleProps }> = [];

  for (let i = 0; i < sortedPoints.length - 1; i++) {
    const segStart = sortedPoints[i];
    const segEnd = sortedPoints[i + 1];
    if (segEnd <= segStart) continue;
    let effective: TextStyleProps = { ...baseStyle };
    for (const sp of spans) {
      if (sp.start <= segStart && sp.end >= segEnd) {
        effective = cleanStyle({ ...effective, ...sp });
      }
    }
    segments.push({
      text: text.slice(segStart, segEnd),
      style: effective,
    });
  }

  return segments;
}

export function textStyleToCss(style?: TextStyleProps): React.CSSProperties {
  if (!style) return {};
  const css: React.CSSProperties = {};
  if (typeof style.fontSize === 'number') css.fontSize = `${style.fontSize}px`;
  if (style.bold) css.fontWeight = 700;
  if (style.fontFamily && style.fontFamily !== 'default') {
    const opt = FONT_FAMILY_OPTIONS.find((f) => f.id === style.fontFamily);
    if (opt?.css) css.fontFamily = opt.css;
  }
  if (style.color) css.color = style.color;
  return css;
}

export function renderFormattedText(
  text: string,
  meta?: CellAuditMeta
): React.ReactNode {
  if (!meta?.style && (!meta?.spans || meta.spans.length === 0)) {
    return text;
  }
  const segments = buildFormattedSegments(text, meta);
  return segments.map((seg, idx) =>
    React.createElement('span', { key: idx, style: textStyleToCss(seg.style) }, seg.text)
  );
}

export function getActiveSelectionStyle(
  meta: CellAuditMeta | undefined,
  textLength: number,
  selection?: { start: number; end: number } | null
): TextStyleProps {
  const base = meta?.style || {};
  if (selection && selection.end > selection.start && textLength > 0 && meta?.spans?.length) {
    const mid = Math.min(textLength - 1, selection.start);
    let merged: TextStyleProps = { ...base };
    for (const sp of meta.spans) {
      if (sp.start <= mid && sp.end > mid) {
        merged = { ...merged, ...sp };
      }
    }
    return merged;
  }
  return base;
}
