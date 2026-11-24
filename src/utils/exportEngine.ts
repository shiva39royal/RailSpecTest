import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  KAVACH_SPEC_TABLES,
  SPEC_DOCUMENT_INFO,
} from '../spec/kavachSpecSchema';
import { getTable1MergeGroups, getTable1PreviewSpan } from '../engine/kavachEngine';
import { FONT_FAMILY_OPTIONS, buildFormattedSegments } from './cellFormatting';
import {
  CellAuditMeta,
  KavachTableId,
  SpecTableDefinition,
  TextStyleProps,
  WorkspaceProject,
} from '../types/project';

function hexToRgbTuple(hex?: string): [number, number, number] | null {
  if (!hex) return null;
  const clean = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

function hexToExcelArgb(hex?: string): string {
  if (!hex) return 'FF0F172A';
  const clean = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return 'FF0F172A';
  return `FF${clean.toUpperCase()}`;
}

function resolvePdfCellStyles(
  meta: CellAuditMeta | undefined,
  baseFontSize: number
): Record<string, any> {
  const effective: TextStyleProps = {
    ...(meta?.spans && meta.spans.length === 1 ? meta.spans[0] : {}),
    ...(meta?.style || {}),
  };
  const out: Record<string, any> = {};
  if (effective.fontFamily && effective.fontFamily !== 'default') {
    const opt = FONT_FAMILY_OPTIONS.find((f) => f.id === effective.fontFamily);
    if (opt) out.font = opt.pdfFont;
  }
  if (effective.bold) {
    out.fontStyle = 'bold';
  }
  if (typeof effective.fontSize === 'number') {
    out.fontSize = Math.max(5.5, Math.min(13, Math.round(effective.fontSize * 0.65 * 10) / 10));
  } else {
    out.fontSize = baseFontSize;
  }
  const rgb = hexToRgbTuple(effective.color);
  if (rgb) {
    out.textColor = rgb;
  }
  return out;
}

function toExcelFont(style?: TextStyleProps) {
  const opt = style?.fontFamily
    ? FONT_FAMILY_OPTIONS.find((f) => f.id === style.fontFamily)
    : undefined;
  return {
    name: opt?.excelName || 'Calibri',
    size: typeof style?.fontSize === 'number' ? Math.max(8, Math.round(style.fontSize * 0.85)) : 9.5,
    bold: Boolean(style?.bold),
    color: { argb: hexToExcelArgb(style?.color) },
  };
}

function sanitizeFileName(raw: string): string {
  return (raw || 'Railway_Station')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Builds two-row grouped headers for jsPDF-AutoTable when a table has column groups
 * (e.g., Turnout Speed, Gradient, LC Gate, Track Condition, Check RFID Sequence).
 */
function buildAutoTableHeaders(spec: SpecTableDefinition): any[][] {
  const hasGroups = spec.columns.some((c) => Boolean(c.group));
  if (!hasGroups) {
    return [spec.columns.map((c) => c.label)];
  }

  const row1: any[] = [];
  const row2: any[] = [];

  let i = 0;
  while (i < spec.columns.length) {
    const col = spec.columns[i];
    if (!col.group) {
      row1.push({ content: col.label, rowSpan: 2, styles: { valign: 'middle', halign: 'center' } });
      i++;
    } else {
      const grp = col.group;
      let span = 0;
      while (i + span < spec.columns.length && spec.columns[i + span].group === grp) {
        row2.push({
          content: spec.columns[i + span].label,
          styles: { valign: 'middle', halign: 'center' },
        });
        span++;
      }
      row1.push({ content: grp, colSpan: span, styles: { valign: 'middle', halign: 'center' } });
      i += span;
    }
  }

  return [row1, row2];
}

function drawRdsoSheetHeader(
  doc: jsPDF,
  project: WorkspaceProject,
  tableTitle: string,
  pageWidth: number
) {
  const m = project.metadata;
  const margin = 8;
  const pageHeight = doc.internal.pageSize.getHeight();

  // Outer engineering sheet border
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.35);
  doc.rect(margin, 6, pageWidth - margin * 2, pageHeight - 12);

  // TOP ~5% AREA: Top-left 2x4 RDSO station metadata box (without Section Speed / Version boxes)
  const boxX = margin + 3;
  const boxY = 8.5;
  const cellH = 5.2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(15, 23, 42);

  // Row 1: Station Name | Division
  doc.setFillColor(241, 245, 249);
  doc.rect(boxX, boxY, 27, cellH, 'FD');
  doc.rect(boxX + 27, boxY, 46, cellH, 'S');
  doc.rect(boxX + 73, boxY, 21, cellH, 'FD');
  doc.rect(boxX + 94, boxY, 48, cellH, 'S');

  doc.text('Station Name:', boxX + 1.5, boxY + 3.6);
  doc.setFont('helvetica', 'normal');
  doc.text(m.stationName || '—', boxX + 50, boxY + 3.6, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.text('Division:', boxX + 74.5, boxY + 3.6);
  doc.setFont('helvetica', 'normal');
  doc.text(m.division || '—', boxX + 118, boxY + 3.6, { align: 'center' });

  // Row 2: Station ID | Section
  const row2Y = boxY + cellH;
  doc.setFillColor(241, 245, 249);
  doc.rect(boxX, row2Y, 27, cellH, 'FD');
  doc.rect(boxX + 27, row2Y, 46, cellH, 'S');
  doc.rect(boxX + 73, row2Y, 21, cellH, 'FD');
  doc.rect(boxX + 94, row2Y, 48, cellH, 'S');

  doc.setFont('helvetica', 'bold');
  doc.text('Station ID:', boxX + 1.5, row2Y + 3.6);
  doc.setFont('helvetica', 'normal');
  doc.text(m.stationId || '—', boxX + 50, row2Y + 3.6, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.text('Section:', boxX + 74.5, row2Y + 3.6);
  doc.setFont('helvetica', 'normal');
  doc.text(m.section || '—', boxX + 118, row2Y + 3.6, { align: 'center' });

  // Centered sheet heading below top box
  const heading = `${tableTitle}${m.stationName ? ` for ${m.stationName}` : ''}${m.stationCode ? ` (${m.stationCode})` : ''}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(heading, pageWidth / 2, row2Y + cellH + 5, { align: 'center' });
}

function drawRdsoSignatureFooter(
  doc: jsPDF,
  project: WorkspaceProject,
  pageNumber: number,
  totalPages: number,
  tableTitle: string
) {
  const m = project.metadata;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 8;
  const innerMargin = margin + 3;
  const footerW = pageWidth - innerMargin * 2;
  const footerH = 49; // ~17-20% of A3 landscape height (297mm)
  const footerY = pageHeight - 9 - footerH;

  const leftW = footerW * 0.36;
  const midW = footerW * 0.30;
  const rightW = footerW - leftW - midW;

  const xLeft = innerMargin;
  const xMid = xLeft + leftW;
  const xRight = xMid + midW;

  // 7 rows: rows 1-4 (6.2mm each = 24.8mm), row 5 (7mm), rows 6-7 (8.6mm each = 17.2mm) -> total 49mm
  const r1 = 6.2;
  const r2 = 6.2;
  const r3 = 6.2;
  const r4 = 6.2;
  const r5 = 7.0;
  const r6 = 8.6;
  const r7 = 8.6;
  const y0 = footerY;
  const y1 = y0 + r1;
  const y2 = y1 + r2;
  const y3 = y2 + r3;
  const y4 = y3 + r4;
  const y5 = y4 + r5;
  const y6 = y5 + r6;
  const y7 = y6 + r7;

  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.25);
  doc.setFillColor(255, 255, 255);
  doc.rect(xLeft, y0, footerW, footerH, 'FD');

  // Major 3-block vertical dividers
  doc.line(xMid, y0, xMid, y7);
  doc.line(xRight, y0, xRight, y7);

  // Horizontal full-width dividers for top 4 rows & row 5
  doc.line(xLeft, y1, xRight, y1);
  doc.line(xRight, y1, xLeft + footerW, y1);
  doc.line(xLeft, y2, xMid, y2);
  doc.line(xRight, y2, xLeft + footerW, y2);
  doc.line(xLeft, y3, xMid, y3);
  doc.line(xRight, y3, xLeft + footerW, y3);
  doc.line(xLeft, y4, xLeft + footerW, y4);

  const stationLabel = `${m.stationName || 'STATION'}${m.stationCode ? `(${m.stationCode})` : ''}${m.stationId ? `-${m.stationId}` : ''}`;

  // LEFT BLOCK (36%): Rows 1-4 metadata + Rows 5-7 PREPARED BY / CHECKED BY / Firm Logo
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(6.8);
  doc.setFont('helvetica', 'bold');
  doc.text(stationLabel, xLeft + leftW / 2, y0 + 4.2, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.3);
  doc.text(`REF: SIP NO: ${m.sipRef || '—'} & TOC: ${m.tocRef || '—'}`, xLeft + leftW / 2, y1 + 4.2, { align: 'center' });
  doc.text(`REF: ${m.rfidLayoutRef || '—'}`, xLeft + leftW / 2, y2 + 4.2, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.text(`TABLE NO: ${m.tableDocNo || '—'}`, xLeft + leftW / 2, y3 + 4.2, { align: 'center' });

  // Left block bottom sub-columns: SIGN/NAME (5%), PREPARED (8%), CHECKED (13%), Firm Logo (10%)
  const cSignW = footerW * 0.05;
  const cPrepW = footerW * 0.08;
  const cChkW = footerW * 0.13;
  const xPrepEnd = xLeft + cSignW + cPrepW;
  const xChkEnd = xPrepEnd + cChkW;

  doc.line(xPrepEnd, y4, xPrepEnd, y7);
  doc.line(xChkEnd, y4, xChkEnd, y7);
  doc.line(xLeft, y5, xChkEnd, y5);
  doc.line(xLeft + cSignW, y5, xLeft + cSignW, y7);
  doc.line(xLeft, y6, xChkEnd, y6);

  doc.setFontSize(6.2);
  doc.setFont('helvetica', 'bold');
  doc.text('PREPARED BY', xLeft + (cSignW + cPrepW) / 2, y4 + 4.5, { align: 'center' });
  doc.text('CHECKED BY', xPrepEnd + cChkW / 2, y4 + 4.5, { align: 'center' });
  doc.text('Firm Logo', xChkEnd + (xMid - xChkEnd) / 2, y4 + (y7 - y4) / 2 + 1, { align: 'center' });
  doc.text('SIGN', xLeft + cSignW / 2, y5 + 5.2, { align: 'center' });
  doc.text('NAME', xLeft + cSignW / 2, y6 + 5.2, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.text(m.preparedBy || '—', xLeft + cSignW + cPrepW / 2, y6 + 5.2, { align: 'center' });
  doc.text(m.checkedBy || '—', xPrepEnd + cChkW / 2, y6 + 5.2, { align: 'center' });

  // MIDDLE BLOCK (30%): 3 equal approval columns (HQ top, blank sign rows 2-4, RDSO row 5, APPROVED BY rows 6-7)
  const midColW = midW / 3;
  doc.line(xMid + midColW, y0, xMid + midColW, y5);
  doc.line(xMid + midColW * 2, y0, xMid + midColW * 2, y5);
  doc.line(xMid, y5, xRight, y5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.8);
  doc.text(m.railwayHqApprover1 || 'JE/SSE/Proj/HQ', xMid + midColW * 0.5, y0 + 4.2, { align: 'center' });
  doc.text(m.railwayHqApprover2 || 'ASTE/Proj/HQ', xMid + midColW * 1.5, y0 + 4.2, { align: 'center' });
  doc.text(m.railwayHqApprover3 || 'Dy.CSTE/Proj/HQ', xMid + midColW * 2.5, y0 + 4.2, { align: 'center' });

  doc.text(m.rdsoApprover1 || 'JE/SSE/RDSO/LKO', xMid + midColW * 0.5, y4 + 4.5, { align: 'center' });
  doc.text(m.rdsoApprover2 || 'ADE/RDSO/LKO', xMid + midColW * 1.5, y4 + 4.5, { align: 'center' });
  doc.text(m.rdsoApprover3 || 'DIRECTOR/RDSO/LKO', xMid + midColW * 2.5, y4 + 4.5, { align: 'center' });

  doc.setFontSize(6.5);
  doc.text('APPROVED BY', xMid + midW / 2, y5 + 6.5, { align: 'center' });
  doc.setFontSize(6.8);
  doc.text(m.finalApprover || 'EXE. DIRECTOR TELE-II', xMid + midW / 2, y6 + 4.5, { align: 'center' });

  // RIGHT BLOCK (34%): Rows 1-4 titles + Rows 5-7 DRG.NO / KAVACH / SHEET / SHEETS
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.text('SIGNAL & TELECOMMUNICATIONS', xRight + rightW / 2, y0 + 4.2, { align: 'center' });
  doc.text('KAVACH', xRight + rightW / 2, y1 + 4.2, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.text(stationLabel, xRight + rightW / 2, y2 + 4.2, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.text(tableTitle.toUpperCase(), xRight + rightW / 2, y3 + 4.2, { align: 'center' });

  const cDrgW = footerW * 0.10;
  const cKavW = footerW * 0.12;
  const cShtW = footerW * 0.06;
  const xKavStart = xRight + cDrgW;
  const xShtStart = xKavStart + cKavW;
  const xShtsStart = xShtStart + cShtW;

  doc.line(xKavStart, y4, xKavStart, y7);
  doc.line(xShtStart, y4, xShtStart, y7);
  doc.line(xShtsStart, y4, xShtsStart, y7);
  doc.line(xShtStart, y5, xLeft + footerW, y5);

  doc.setFontSize(6.2);
  doc.text(m.drawingNo || 'DRG.NO.', xRight + cDrgW / 2, y4 + (y7 - y4) / 2 + 1, { align: 'center' });
  doc.text('KAVACH:', xKavStart + cKavW / 2, y4 + 9, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.text(m.sipRef || '—', xKavStart + cKavW / 2, y4 + 15, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.text('SHEET', xShtStart + cShtW / 2, y4 + 4.5, { align: 'center' });
  doc.text('SHEETS', xShtsStart + (xLeft + footerW - xShtsStart) / 2, y4 + 4.5, { align: 'center' });
  doc.setFontSize(7.5);
  doc.text(String(pageNumber), xShtStart + cShtW / 2, y5 + (y7 - y5) / 2 + 1.5, { align: 'center' });
  doc.text(String(totalPages), xShtsStart + (xLeft + footerW - xShtsStart) / 2, y5 + (y7 - y5) / 2 + 1.5, { align: 'center' });
}

/**
 * Generates an official landscape A3 multi-page RDSO KAVACH PDF package from the user's final dataset.
 */
export function exportKavachToPdf(
  project: WorkspaceProject,
  selectedTableIds?: KavachTableId[]
): void {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a3',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const tablesToExport = KAVACH_SPEC_TABLES.filter((t) =>
    selectedTableIds && selectedTableIds.length > 0 ? selectedTableIds.includes(t.id) : true
  );

  // Track which table title corresponds to each generated page for accurate footers
  const pageTableTitles = new Map<number, string>();
  let isFirstSection = true;

  for (const spec of tablesToExport) {
    const rows = project.tables[spec.id] || [];
    if (!isFirstSection) {
      doc.addPage('a3', 'landscape');
    }
    isFirstSection = false;

    const startPage = doc.getNumberOfPages();
    pageTableTitles.set(startPage, spec.title);

    const head = buildAutoTableHeaders(spec);
    const isTable1 = spec.id === 'table1_control';
    const mergeGroups = isTable1 && rows.length > 0 ? getTable1MergeGroups(rows) : null;

    const basePdfFontSize = spec.columns.length > 14 ? 6.2 : 7.3;

    const body: any[][] =
      rows.length > 0
        ? rows.map((row, rIdx) => {
            const mergeInfo = mergeGroups ? mergeGroups[rIdx] : null;
            const groupFill: [number, number, number] =
              mergeInfo && mergeInfo.groupIndex % 2 === 1 ? [248, 250, 252] : [255, 255, 255];

            const rowCells: any[] = [];
            for (const c of spec.columns) {
              const val = row.cells[c.key];
              const text = val !== undefined && val !== '' ? val : '-';
              const customPdfStyles = resolvePdfCellStyles(row.cellMeta[c.key], basePdfFontSize);

              if (isTable1 && mergeGroups && mergeInfo) {
                const span = getTable1PreviewSpan(rows, rIdx, c.key, mergeGroups);
                if (span.skip) continue;

                const styles: Record<string, any> = {
                  fillColor: groupFill,
                  valign: 'middle',
                  ...customPdfStyles,
                };
                if (c.align === 'center') styles.halign = 'center';
                else if (c.align === 'right') styles.halign = 'right';

                if (span.rowSpan > 1) {
                  rowCells.push({
                    content: text,
                    rowSpan: span.rowSpan,
                    styles,
                  });
                } else {
                  rowCells.push({ content: text, styles });
                }
              } else if (Object.keys(customPdfStyles).length > 1 || customPdfStyles.fontStyle || customPdfStyles.textColor || customPdfStyles.font) {
                rowCells.push({ content: text, styles: customPdfStyles });
              } else {
                rowCells.push(text);
              }
            }
            return rowCells;
          })
        : [
            [
              {
                content: `No records populated for ${spec.title}.`,
                colSpan: spec.columns.length,
                styles: {
                  halign: 'center' as const,
                  fontStyle: 'italic' as const,
                  textColor: [100, 116, 139] as [number, number, number],
                },
              },
            ],
          ];

    autoTable(doc, {
      head,
      body,
      startY: 28,
      margin: { top: 28, right: 11, bottom: 60, left: 11 },
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: spec.columns.length > 14 ? 6.2 : 7.3,
        cellPadding: 1.5,
        overflow: 'linebreak',
        lineColor: [30, 41, 59],
        lineWidth: 0.18,
        textColor: [15, 23, 42],
        valign: 'middle',
      },
      headStyles: {
        fillColor: [226, 232, 240],
        textColor: [15, 23, 42],
        fontStyle: 'bold',
        halign: 'center',
        valign: 'middle',
      },
      alternateRowStyles: isTable1
        ? undefined
        : {
            fillColor: [248, 250, 252],
          },
      didDrawPage: (data) => {
        const currentPage = data.pageNumber;
        pageTableTitles.set(currentPage, spec.title);
        drawRdsoSheetHeader(doc, project, spec.title, pageWidth);
      },
    });

    // If Table 2 (Block Section Details), render Global Station Control Parameters + Revision History below it
    if (spec.id === 'table2_block_section') {
      const finalY = (doc as any).lastAutoTable?.finalY ?? 80;
      if (finalY < doc.internal.pageSize.getHeight() - 88) {
        autoTable(doc, {
          startY: finalY + 5,
          margin: { left: 11, right: 11, bottom: 60 },
          theme: 'grid',
          styles: { fontSize: 7.3, cellPadding: 1.8, lineColor: [30, 41, 59], lineWidth: 0.2 },
          head: [
            [
              { content: 'Signals Override (OV) not required at zero speed (Cl. I.2.11.19)', styles: { fillColor: [226, 232, 240], textColor: [15, 23, 42] } },
              { content: 'Authorized speed on detection of train in On-Sight mode (Cl. I.2.11.20)', styles: { fillColor: [226, 232, 240], textColor: [15, 23, 42] } },
            ],
          ],
          body: [
            [
              project.metadata.signalsOverrideNotRequiredAtZeroSpeed || '—',
              project.metadata.authorizedSpeedOnDetectionInOs
                ? `${project.metadata.authorizedSpeedOnDetectionInOs} kmph`
                : '—',
            ],
          ],
        });

        const revStartY = ((doc as any).lastAutoTable?.finalY ?? finalY + 24) + 5;
        if (project.metadata.revisions.length > 0 && revStartY < doc.internal.pageSize.getHeight() - 72) {
          autoTable(doc, {
            startY: revStartY,
            margin: { left: 11, right: 180, bottom: 60 },
            theme: 'grid',
            styles: { fontSize: 6.8, cellPadding: 1.6, lineColor: [30, 41, 59], lineWidth: 0.2 },
            headStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
            head: [['Rev No.', 'Revision History', 'Date']],
            body: project.metadata.revisions.map((r) => [r.revNo, r.description, r.date]),
          });
        }
      }
    }
  }

  // Stamp consistent RDSO Pages 16-17 fixed signature & title blocks across every page
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawRdsoSignatureFooter(
      doc,
      project,
      p,
      totalPages,
      pageTableTitles.get(p) || 'KAVACH Table of Control'
    );
  }

  const baseName = sanitizeFileName(
    `${project.metadata.stationName || project.name}_KAVACH_Control_Tables_v${project.metadata.versionControl || '1.0.0'}`
  );
  doc.save(`${baseName}.pdf`);
}

/**
 * Generates a formatted, editable multi-worksheet Excel (.xlsx) workbook using ExcelJS.
 */
export async function exportKavachToExcel(
  project: WorkspaceProject,
  selectedTableIds?: KavachTableId[]
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'RailSpec KAVACH Studio';
  workbook.created = new Date();

  const m = project.metadata;

  // Sheet 1: Station Metadata, References & Revision History
  const metaSheet = workbook.addWorksheet('Station Metadata', {
    views: [{ state: 'frozen', ySplit: 2 }],
  });
  metaSheet.columns = [
    { header: 'Field', key: 'field', width: 38 },
    { header: 'Value', key: 'value', width: 52 },
    { header: 'RDSO Reference', key: 'ref', width: 28 },
  ];

  metaSheet.mergeCells('A1:C1');
  const titleCell = metaSheet.getCell('A1');
  titleCell.value = `KAVACH STATION DOCUMENTATION — ${m.stationName || project.name} (${SPEC_DOCUMENT_INFO.code} ${SPEC_DOCUMENT_INFO.amendment})`;
  titleCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  metaSheet.getRow(1).height = 28;

  const metaHeaderRow = metaSheet.getRow(2);
  metaHeaderRow.values = ['Parameter', 'Value', 'RDSO Clause'];
  metaHeaderRow.font = { bold: true, color: { argb: 'FF0F172A' } };
  metaHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

  const metaRows: Array<[string, string, string]> = [
    ['Station Name', m.stationName, 'Cl. I.2.11.1'],
    ['Station Code', m.stationCode, 'Cl. I.2.11.1'],
    ['Station ID', m.stationId, 'Cl. I.2.11.1'],
    ['Station Chainage (KM)', m.stationKm, 'Cl. I.2.11.1'],
    ['Division', m.division, 'Cl. I.2.11.1'],
    ['Section', m.section, 'Cl. I.2.11.1'],
    ['Section Speed (kmph)', m.sectionSpeedKmph, 'Cl. I.2.12'],
    ['Version Control (X.Y.Z)', m.versionControl, 'Cl. I.2.9'],
    ['Reference SIP No.', m.sipRef, 'Cl. I.2.2(i)'],
    ['Reference TOC No.', m.tocRef, 'Cl. I.2.2(ii)'],
    ['Approved RFID Tag-TIN Layout', m.rfidLayoutRef, 'Cl. I.2.2(iii)'],
    ['Adjacent Stationary KAVACH Ref', m.adjacentKavachRef, 'Cl. I.2.2(v)'],
    ['Engineering Gradient Index Plan Ref', m.gradientPlanRef, 'Cl. I.2.2(vi)'],
    ['Drawing Number', m.drawingNo, 'Cl. I.2.13'],
    ['Table Document Number', m.tableDocNo, 'Cl. I.2.13'],
    ['Signals Override (OV) not required at zero speed', m.signalsOverrideNotRequiredAtZeroSpeed, 'Cl. I.2.11.19'],
    ['Authorized speed on detection in OS mode (kmph)', m.authorizedSpeedOnDetectionInOs, 'Cl. I.2.11.20'],
    ['Prepared By', m.preparedBy, 'Cl. I.2.13'],
    ['Checked By', m.checkedBy, 'Cl. I.2.13'],
  ];

  for (const [field, value, ref] of metaRows) {
    const row = metaSheet.addRow([field, value || '', ref]);
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
  }

  // Add Revision History below metadata
  metaSheet.addRow([]);
  const revTitle = metaSheet.addRow(['Rev No.', 'Revision Description', 'Date']);
  revTitle.font = { bold: true };
  revTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  for (const rev of m.revisions) {
    metaSheet.addRow([rev.revNo, rev.description, rev.date]);
  }

  // Sheets for each selected RDSO KAVACH table
  const tablesToExport = KAVACH_SPEC_TABLES.filter((t) =>
    selectedTableIds && selectedTableIds.length > 0 ? selectedTableIds.includes(t.id) : true
  );

  for (const spec of tablesToExport) {
    const safeSheetName = `${spec.tableNumber} ${spec.shortTitle}`.replace(/[\\/*?:[\]]/g, '').slice(0, 31);
    const hasGroups = spec.columns.some((c) => Boolean(c.group));
    const headerStartRow = 4;
    const dataStartRow = hasGroups ? 6 : 5;

    const ws = workbook.addWorksheet(safeSheetName, {
      views: [{ state: 'frozen', ySplit: dataStartRow - 1 }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });

    // Top Station Metadata Banner Rows (Rows 1–2, matching RDSO Page 16/17 without Section Speed / Version)
    ws.getCell(1, 1).value = `Station Name: ${m.stationName || '—'} | Station ID: ${m.stationId || '—'}`;
    ws.getCell(1, 4).value = `Division: ${m.division || '—'} | Section: ${m.section || '—'}`;
    ws.getRow(1).font = { bold: true, size: 10, color: { argb: 'FF0F172A' } };

    ws.getCell(2, 1).value = `${spec.title}${m.stationName ? ` for ${m.stationName}` : ''}${m.stationCode ? ` (${m.stationCode})` : ''}`;
    ws.getRow(2).font = { bold: true, size: 11, color: { argb: 'FF1D4ED8' } };

    // Build Grouped / Ungrouped Column Headers
    if (!hasGroups) {
      const headerRow = ws.getRow(headerStartRow);
      headerRow.values = spec.columns.map((c) => c.label);
      headerRow.height = 28;
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, size: 9.5, color: { argb: 'FF0F172A' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF64748B' } },
          bottom: { style: 'thin', color: { argb: 'FF64748B' } },
          left: { style: 'thin', color: { argb: 'FF64748B' } },
          right: { style: 'thin', color: { argb: 'FF64748B' } },
        };
      });
    } else {
      const rTop = ws.getRow(headerStartRow);
      const rSub = ws.getRow(headerStartRow + 1);
      rTop.height = 22;
      rSub.height = 28;

      let cIdx = 0;
      while (cIdx < spec.columns.length) {
        const col = spec.columns[cIdx];
        const excelCol = cIdx + 1;
        if (!col.group) {
          ws.mergeCells(headerStartRow, excelCol, headerStartRow + 1, excelCol);
          rTop.getCell(excelCol).value = col.label;
          cIdx++;
        } else {
          const grp = col.group;
          let span = 0;
          while (cIdx + span < spec.columns.length && spec.columns[cIdx + span].group === grp) {
            rSub.getCell(excelCol + span).value = spec.columns[cIdx + span].label;
            span++;
          }
          if (span > 1) {
            ws.mergeCells(headerStartRow, excelCol, headerStartRow, excelCol + span - 1);
          }
          rTop.getCell(excelCol).value = grp;
          cIdx += span;
        }
      }

      for (const hr of [rTop, rSub]) {
        for (let colNum = 1; colNum <= spec.columns.length; colNum++) {
          const cell = hr.getCell(colNum);
          cell.font = { bold: true, size: 9, color: { argb: 'FF0F172A' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FF64748B' } },
            bottom: { style: 'thin', color: { argb: 'FF64748B' } },
            left: { style: 'thin', color: { argb: 'FF64748B' } },
            right: { style: 'thin', color: { argb: 'FF64748B' } },
          };
        }
      }
    }

    // Set column widths
    spec.columns.forEach((col, idx) => {
      ws.getColumn(idx + 1).width = Math.max(12, Math.round((col.widthPx || 120) / 7));
    });

    // Populate Data Rows
    const rows = project.tables[spec.id] || [];
    const isTable1 = spec.id === 'table1_control';
    const mergeGroups = isTable1 && rows.length > 0 ? getTable1MergeGroups(rows) : null;

    rows.forEach((rowRec, rIdx) => {
      const excelRow = ws.getRow(dataStartRow + rIdx);
      const mergeInfo = mergeGroups ? mergeGroups[rIdx] : null;
      const isOddGroup = Boolean(mergeInfo && mergeInfo.groupIndex % 2 === 1);

      spec.columns.forEach((col, cIdx) => {
        const rawVal = rowRec.cells[col.key] ?? '';
        const meta = rowRec.cellMeta[col.key];
        const cell = excelRow.getCell(cIdx + 1);

        if (meta?.spans && meta.spans.length > 0 && rawVal !== '') {
          const segments = buildFormattedSegments(rawVal, meta);
          cell.value = {
            richText: segments.map((seg) => ({
              text: seg.text,
              font: toExcelFont(seg.style),
            })),
          };
        } else if (
          (col.dataType === 'number' || col.dataType === 'distance') &&
          rawVal !== '' &&
          /^-?\d+(\.\d+)?$/.test(rawVal.trim())
        ) {
          cell.value = Number(rawVal.trim());
        } else {
          cell.value = rawVal;
        }

        cell.font = toExcelFont(meta?.style);
        cell.alignment = {
          vertical: 'middle',
          horizontal: col.align || 'left',
          wrapText: true,
        };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        };

        // Subtle tint for manually edited cells, missing required fields, or alternating Table 1 route groups
        if (meta?.source === 'manual') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
        } else if (col.mandatory && rawVal.trim() === '') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
        } else if (isOddGroup) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        }
      });
    });

    // Vertically merge Table 1 columns across consecutive matching aspect rows per RDSO Pages 16–17
    if (isTable1 && mergeGroups) {
      rows.forEach((_, rIdx) => {
        spec.columns.forEach((col, cIdx) => {
          const span = getTable1PreviewSpan(rows, rIdx, col.key, mergeGroups);
          if (!span.skip && span.rowSpan > 1) {
            const startExcelRow = dataStartRow + rIdx;
            const endExcelRow = startExcelRow + span.rowSpan - 1;
            ws.mergeCells(startExcelRow, cIdx + 1, endExcelRow, cIdx + 1);
          }
        });
      });
    }
  }

  // Final Worksheet: Validation Audit
  const valSheet = workbook.addWorksheet('Validation Audit');
  valSheet.columns = [
    { header: 'Severity', key: 'severity', width: 12 },
    { header: 'Table', key: 'table', width: 22 },
    { header: 'RDSO Clause', key: 'clause', width: 18 },
    { header: 'Rule', key: 'rule', width: 32 },
    { header: 'Message', key: 'message', width: 70 },
  ];
  valSheet.getRow(1).font = { bold: true };
  valSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

  for (const issue of project.validationIssues) {
    valSheet.addRow({
      severity: issue.severity.toUpperCase(),
      table: issue.tableId,
      clause: issue.clauseRef,
      rule: issue.ruleName,
      message: issue.message,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const baseName = sanitizeFileName(
    `${m.stationName || project.name}_KAVACH_Control_Tables_v${m.versionControl || '1.0.0'}`
  );
  triggerBlobDownload(blob, `${baseName}.xlsx`);
}

export function exportKavachToJson(project: WorkspaceProject): void {
  const payload = {
    spec: SPEC_DOCUMENT_INFO,
    exportedAt: new Date().toISOString(),
    metadata: project.metadata,
    components: project.components,
    relationships: project.relationships,
    tables: project.tables,
    validationIssues: project.validationIssues,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const baseName = sanitizeFileName(`${project.metadata.stationName || project.name}_KAVACH_Dataset`);
  triggerBlobDownload(blob, `${baseName}.json`);
}
