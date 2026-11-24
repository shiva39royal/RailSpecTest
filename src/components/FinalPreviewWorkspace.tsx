import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckSquare,
  Download,
  Eye,
  FileSpreadsheet,
  Plus,
  Printer,
  Trash2,
} from 'lucide-react';
import { KAVACH_SPEC_TABLES, KAVACH_TABLE_MAP } from '../spec/kavachSpecSchema';
import { getTable1MergeGroups, getTable1PreviewSpan } from '../engine/kavachEngine';
import { renderFormattedText } from '../utils/cellFormatting';
import { generateKavachPdfBlob } from '../utils/exportEngine';
import type { KavachTableId, RevisionEntry, TableRowRecord, WorkspaceProject } from '../types/project';

interface FinalPreviewWorkspaceProps {
  project: WorkspaceProject;
  selectedTableIds: KavachTableId[];
  onChangeSelectedTables: (ids: KavachTableId[]) => void;
  onExportPdf: (selectedTables: KavachTableId[]) => void;
  onExportExcel: (selectedTables: KavachTableId[]) => void;
  onUpdateRevisions: (revisions: RevisionEntry[]) => void;
  onSaveWorkspace: () => void;
}

export function FinalPreviewWorkspace({
  project,
  selectedTableIds,
  onChangeSelectedTables,
  onExportPdf,
  onExportExcel,
  onUpdateRevisions,
  onSaveWorkspace,
}: FinalPreviewWorkspaceProps) {
  const [activePreviewTableId, setActivePreviewTableId] = useState<KavachTableId>(
    selectedTableIds[0] || 'table1_control'
  );
  const [showTableSelector, setShowTableSelector] = useState(false);

  const selectedSet = useMemo(() => new Set(selectedTableIds), [selectedTableIds]);
  const includedTables = useMemo(
    () => KAVACH_SPEC_TABLES.filter((t) => selectedSet.has(t.id)),
    [selectedSet]
  );

  const selectedTableId: KavachTableId = selectedSet.has(activePreviewTableId)
    ? activePreviewTableId
    : includedTables[0]?.id || 'table1_control';

  const spec = KAVACH_TABLE_MAP[selectedTableId];
  const rows = project.tables[selectedTableId] || [];
  const m = project.metadata;

  const table1MergeGroups = useMemo(
    () => (selectedTableId === 'table1_control' ? getTable1MergeGroups(rows) : null),
    [selectedTableId, rows]
  );

  const sheetChunks = useMemo(() => {
    if (rows.length === 0) return [[]];
    if (selectedTableId === 'table1_control' && table1MergeGroups) {
      const chunks: TableRowRecord[][] = [];
      let currentChunk: TableRowRecord[] = [];
      let i = 0;
      while (i < rows.length) {
        const grp = table1MergeGroups[i];
        const span = grp ? grp.rowSpan : 1;
        const groupRows = rows.slice(i, i + span);
        if (currentChunk.length > 0 && currentChunk.length + span > 18) {
          chunks.push(currentChunk);
          currentChunk = [...groupRows];
        } else {
          currentChunk.push(...groupRows);
        }
        i += span;
      }
      if (currentChunk.length > 0) chunks.push(currentChunk);
      return chunks;
    }

    const chunks: TableRowRecord[][] = [];
    for (let i = 0; i < rows.length; i += 18) {
      chunks.push(rows.slice(i, i + 18));
    }
    return chunks;
  }, [rows, selectedTableId, table1MergeGroups]);

  const toggleTableSelection = (id: KavachTableId) => {
    const next = new Set(selectedTableIds);
    if (next.has(id)) {
      if (next.size <= 1) return;
      next.delete(id);
    } else {
      next.add(id);
    }
    const ordered = KAVACH_SPEC_TABLES.filter((t) => next.has(t.id)).map((t) => t.id);
    onChangeSelectedTables(ordered);
    if (!next.has(activePreviewTableId) && ordered.length > 0) {
      setActivePreviewTableId(ordered[0]);
    }
  };

  const hasGroups = spec.columns.some((c) => Boolean(c.group));
  const topHeaders = useMemo(() => {
    if (!hasGroups) return [];
    const items: Array<{ label: string; colSpan: number; rowSpan: number }> = [];
    let i = 0;
    while (i < spec.columns.length) {
      const col = spec.columns[i];
      if (!col.group) {
        items.push({ label: col.label, colSpan: 1, rowSpan: 2 });
        i++;
      } else {
        const grp = col.group;
        let span = 0;
        while (i + span < spec.columns.length && spec.columns[i + span].group === grp) span++;
        items.push({ label: grp, colSpan: span, rowSpan: 1 });
        i += span;
      }
    }
    return items;
  }, [spec.columns, hasGroups]);

  const errorCount = project.validationIssues.filter((i) => i.severity === 'error').length;

  const addRevision = () => {
    const nextNum = String(m.revisions.length);
    const today = new Date().toISOString().slice(0, 10);
    onUpdateRevisions([
      ...m.revisions,
      { revNo: nextNum, description: 'Reviewed and updated station control data', date: today },
    ]);
  };

  return (
    <div className="space-y-5">
      {/* Preview Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 no-print">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Final Document Preview — RDSO Engineering Sheet Format
          </h1>
          <p className="text-xs text-slate-600 mt-0.5">
            {project.isSavedForPreview
              ? `Reflects user-approved dataset saved ${project.lastSavedAt ? new Date(project.lastSavedAt).toLocaleTimeString() : ''}.`
              : 'Preview reflects live edits. Click Save to finalize before exporting official PDF/Excel deliverables.'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setShowTableSelector((v) => !v)}
            className={`px-3 py-2 text-xs font-medium rounded-md border flex items-center gap-1.5 whitespace-nowrap ${
              showTableSelector
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            <CheckSquare className="w-3.5 h-3.5" />
            Select Tables ({selectedTableIds.length}/{KAVACH_SPEC_TABLES.length})
          </button>
          {!project.isSavedForPreview && (
            <button
              type="button"
              onClick={onSaveWorkspace}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md whitespace-nowrap"
            >
              Save Final Dataset
            </button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-md flex items-center gap-1.5 whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Sheet
          </button>
          <button
            type="button"
            onClick={() => onExportExcel(selectedTableIds)}
            className="px-3.5 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-md flex items-center gap-1.5 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Download Excel (.xlsx)
          </button>
          <button
            type="button"
            onClick={() => {
              const blob = generateKavachPdfBlob(project, selectedTableIds);
              const url = URL.createObjectURL(blob);
              window.open(url, '_blank');
            }}
            className="px-3.5 py-2 text-xs font-semibold text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-300 rounded-md flex items-center gap-1.5 whitespace-nowrap"
            title="Preview generated PDF directly in browser"
          >
            <Eye className="w-3.5 h-3.5" />
            Preview PDF
          </button>
          <button
            type="button"
            onClick={() => onExportPdf(selectedTableIds)}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Download PDF Package
          </button>
        </div>
      </div>

      {/* Preview-Level Table Selection Panel */}
      {showTableSelector && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3 no-print">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <div>
              <h2 className="text-xs font-bold text-slate-900">
                Select Sheets to Include in Final Preview &amp; Export
              </h2>
              <p className="text-[11px] text-slate-500">
                Only checked tables appear in this document package and in generated PDF / Excel deliverables.
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={() => onChangeSelectedTables(KAVACH_SPEC_TABLES.map((t) => t.id))}
                className="text-blue-700 hover:underline font-medium"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={() => {
                  const populated = KAVACH_SPEC_TABLES.filter(
                    (t) => (project.tables[t.id]?.length || 0) > 0
                  ).map((t) => t.id);
                  if (populated.length > 0) {
                    onChangeSelectedTables(populated);
                    if (!populated.includes(activePreviewTableId)) setActivePreviewTableId(populated[0]);
                  }
                }}
                className="text-slate-700 hover:underline font-medium"
              >
                Populated Only
              </button>
              <button
                type="button"
                onClick={() => setShowTableSelector(false)}
                className="text-slate-500 hover:text-slate-900"
              >
                Done
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {KAVACH_SPEC_TABLES.map((t) => {
              const checked = selectedSet.has(t.id);
              const count = project.tables[t.id]?.length || 0;
              return (
                <label
                  key={t.id}
                  className={`px-3 py-2 rounded-md border text-xs flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                    checked
                      ? 'border-blue-300 bg-blue-50/40 text-slate-900'
                      : 'border-slate-200 bg-slate-50/50 text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTableSelection(t.id)}
                      className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                    />
                    <span className="truncate font-medium">
                      {t.tableNumber}: {t.shortTitle}
                    </span>
                  </span>
                  <span className="font-mono tabular-nums text-[11px] text-slate-500 shrink-0">
                    {count}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {errorCount > 0 && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-md flex items-center gap-2.5 text-xs text-amber-900 no-print">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            There are <strong>{errorCount}</strong> unresolved validation error(s) in your dataset. You may still preview and export, or resolve them in Data Validation.
          </span>
        </div>
      )}

      {/* Selected Sheet Switcher */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 no-print">
        {includedTables.map((t, idx) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActivePreviewTableId(t.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
              selectedTableId === t.id
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            Sheet {idx + 1}: {t.shortTitle} ({project.tables[t.id]?.length || 0})
          </button>
        ))}
      </div>

      {/* Official RDSO Landscape Engineering Document Sheet Frames (5% Top + 75% Table + 20% Fixed Title Block on Every Sheet) */}
      <div className="space-y-8">
        {sheetChunks.map((chunkRows, sheetIdx) => {
          const chunkMergeGroups =
            selectedTableId === 'table1_control' ? getTable1MergeGroups(chunkRows) : null;
          const isLastSheet = sheetIdx === sheetChunks.length - 1;

          return (
            <div
              key={sheetIdx}
              className="rdso-sheet-page bg-white border-2 border-slate-900 p-4 shadow-sm overflow-x-auto print:border print:p-2 print:shadow-none print:break-after-page"
            >
              <div className="min-w-[1120px] min-h-[780px] flex flex-col justify-between gap-3">
                {/* TOP ~5% AREA: Station Metadata Box (Top-Left) + Centered Sheet Heading */}
                <div className="space-y-1.5 shrink-0">
                  <div className="flex items-start justify-between">
                    <table className="border-collapse border border-slate-900 text-[11px] w-[500px]">
                      <tbody>
                        <tr>
                          <td className="border border-slate-900 bg-slate-100 font-bold px-2.5 py-1 w-28">
                            Station Name:
                          </td>
                          <td className="border border-slate-900 px-2.5 py-1 font-semibold text-center w-36">
                            {m.stationName || '—'}
                          </td>
                          <td className="border border-slate-900 bg-slate-100 font-bold px-2.5 py-1 w-20">
                            Division:
                          </td>
                          <td className="border border-slate-900 px-2.5 py-1 font-semibold text-center">
                            {m.division || '—'}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-slate-900 bg-slate-100 font-bold px-2.5 py-1">
                            Station ID:
                          </td>
                          <td className="border border-slate-900 px-2.5 py-1 font-mono font-semibold text-center">
                            {m.stationId || '—'}
                          </td>
                          <td className="border border-slate-900 bg-slate-100 font-bold px-2.5 py-1">
                            Section:
                          </td>
                          <td className="border border-slate-900 px-2.5 py-1 font-semibold text-center">
                            {m.section || '—'}
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    {sheetChunks.length > 1 && (
                      <div className="text-right no-print">
                        <span className="text-[11px] font-mono px-2.5 py-1 bg-slate-100 border border-slate-300 rounded font-bold text-slate-800">
                          Sheet {sheetIdx + 1} of {sheetChunks.length}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="text-center pt-0.5">
                    <p className="text-sm font-bold text-slate-900 tracking-wide">
                      {spec.title}
                      {m.stationName ? ` for ${m.stationName}` : ''}
                      {m.stationCode ? ` (${m.stationCode})` : ''}
                      {sheetChunks.length > 1 ? ` — Sheet ${sheetIdx + 1} of ${sheetChunks.length}` : ''}
                    </p>
                  </div>
                </div>

                {/* MIDDLE ~75% AREA: Main Specification Table */}
                <div className="flex-1 flex flex-col justify-start min-h-[500px] space-y-4">
                  <table className="w-full border-collapse border border-slate-900 text-[11px]">
                    <thead>
                      {hasGroups ? (
                        <>
                          <tr className="bg-slate-200/80 text-slate-900 font-bold text-center">
                            {topHeaders.map((h, i) => (
                              <th
                                key={i}
                                colSpan={h.colSpan}
                                rowSpan={h.rowSpan}
                                className="border border-slate-900 px-1.5 py-1.5 leading-tight"
                              >
                                {h.label}
                              </th>
                            ))}
                          </tr>
                          <tr className="bg-slate-200/80 text-slate-900 font-bold text-center">
                            {spec.columns
                              .filter((c) => Boolean(c.group))
                              .map((c) => (
                                <th key={c.key} className="border border-slate-900 px-1.5 py-1.5 leading-tight">
                                  {c.label}
                                </th>
                              ))}
                          </tr>
                        </>
                      ) : (
                        <tr className="bg-slate-200/80 text-slate-900 font-bold text-center">
                          {spec.columns.map((c) => (
                            <th key={c.key} className="border border-slate-900 px-2 py-2 leading-tight">
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      )}
                    </thead>
                    <tbody>
                      {chunkRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={spec.columns.length}
                            className="border border-slate-900 py-8 text-center italic text-slate-500"
                          >
                            No rows populated for {spec.title}.
                          </td>
                        </tr>
                      ) : (
                        chunkRows.map((row, rowIdx) => {
                          const mergeInfo = chunkMergeGroups ? chunkMergeGroups[rowIdx] : null;
                          const rowBgClass = mergeInfo
                            ? mergeInfo.groupIndex % 2 === 1
                              ? 'bg-slate-50/55'
                              : 'bg-white'
                            : 'even:bg-slate-50/50';

                          return (
                            <tr key={row.rowId} className={rowBgClass}>
                              {spec.columns.map((col) => {
                                if (selectedTableId === 'table1_control' && chunkMergeGroups) {
                                  const span = getTable1PreviewSpan(chunkRows, rowIdx, col.key, chunkMergeGroups);
                                  if (span.skip) return null;
                                  const val = row.cells[col.key];
                                  const meta = row.cellMeta[col.key];
                                  return (
                                    <td
                                      key={col.key}
                                      rowSpan={span.rowSpan > 1 ? span.rowSpan : undefined}
                                      className={`border border-slate-900 px-1.5 py-1.5 align-middle ${
                                        col.align === 'right'
                                          ? 'text-right font-mono tabular-nums'
                                          : col.align === 'center'
                                            ? 'text-center'
                                            : 'text-left'
                                      }`}
                                    >
                                      {val && val.trim() !== '' ? renderFormattedText(val, meta) : '-'}
                                    </td>
                                  );
                                }

                                const val = row.cells[col.key];
                                const meta = row.cellMeta[col.key];
                                return (
                                  <td
                                    key={col.key}
                                    className={`border border-slate-900 px-1.5 py-1.5 align-middle ${
                                      col.align === 'right'
                                        ? 'text-right font-mono tabular-nums'
                                        : col.align === 'center'
                                          ? 'text-center'
                                          : 'text-left'
                                    }`}
                                  >
                                    {val && val.trim() !== '' ? renderFormattedText(val, meta) : '-'}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>

                  {/* Global Station Parameters (displayed on last sheet of Table 2 per RDSO Page 21) */}
                  {selectedTableId === 'table2_block_section' && isLastSheet && (
                    <div className="pt-1">
                      <table className="border-collapse border border-slate-900 text-xs w-full">
                        <tbody>
                          <tr>
                            <td className="border border-slate-900 bg-slate-100 font-bold px-3 py-2 w-64">
                              Signals Override (OV) not required at zero speed
                            </td>
                            <td className="border border-slate-900 px-3 py-2 font-mono font-semibold text-center">
                              {m.signalsOverrideNotRequiredAtZeroSpeed || '—'}
                            </td>
                            <td className="border border-slate-900 bg-slate-100 font-bold px-3 py-2 w-64">
                              Authorized speed on detection of train in On-Sight mode
                            </td>
                            <td className="border border-slate-900 px-3 py-2 font-mono font-semibold text-center">
                              {m.authorizedSpeedOnDetectionInOs ? `${m.authorizedSpeedOnDetectionInOs} kmph` : '—'}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* BOTTOM ~20% AREA: Fixed RDSO Pages 16–17 Signature & Approval Title Block */}
                <div className="shrink-0 pt-2">
                  <table className="w-full border-collapse border border-slate-900 text-[10px]">
                    <tbody>
                      <tr>
                        <td
                          colSpan={4}
                          className="border border-slate-900 px-2 py-1 font-semibold text-center w-[36%]"
                        >
                          {m.stationName || 'STATION'}
                          {m.stationCode ? `(${m.stationCode})` : ''}
                          {m.stationId ? `-${m.stationId}` : ''}
                        </td>
                        <td className="border border-slate-900 px-1.5 py-1 font-bold text-center w-[10%]">
                          {m.railwayHqApprover1 || 'JE/SSE/Proj/HQ'}
                        </td>
                        <td className="border border-slate-900 px-1.5 py-1 font-bold text-center w-[10%]">
                          {m.railwayHqApprover2 || 'ASTE/Proj/HQ'}
                        </td>
                        <td className="border border-slate-900 px-1.5 py-1 font-bold text-center w-[10%]">
                          {m.railwayHqApprover3 || 'Dy.CSTE/Proj/HQ'}
                        </td>
                        <td
                          colSpan={4}
                          className="border border-slate-900 px-2 py-1 font-bold text-center w-[34%]"
                        >
                          {m.titleSignalTelecom || 'SIGNAL & TELECOMMUNICATIONS'}
                        </td>
                      </tr>

                      <tr>
                        <td colSpan={4} className="border border-slate-900 px-2 py-1 text-center">
                          REF: SIP NO: {m.sipRef || '—'} &amp; TOC: {m.tocRef || '—'}
                        </td>
                        <td rowSpan={3} className="border border-slate-900 h-12"></td>
                        <td rowSpan={3} className="border border-slate-900 h-12"></td>
                        <td rowSpan={3} className="border border-slate-900 h-12"></td>
                        <td colSpan={4} className="border border-slate-900 px-2 py-1 font-bold text-center">
                          {m.titleKavach || 'KAVACH'}
                        </td>
                      </tr>

                      <tr>
                        <td colSpan={4} className="border border-slate-900 px-2 py-1 text-center">
                          REF: {m.rfidLayoutRef || '—'}
                        </td>
                        <td colSpan={4} className="border border-slate-900 px-2 py-1 font-semibold text-center">
                          {m.stationName || 'STATION'}
                          {m.stationCode ? `(${m.stationCode})` : ''}
                          {m.stationId ? `-${m.stationId}` : ''}
                        </td>
                      </tr>

                      <tr>
                        <td colSpan={4} className="border border-slate-900 px-2 py-1 text-center font-medium">
                          TABLE NO: {m.tableDocNo || '—'}
                        </td>
                        <td colSpan={4} className="border border-slate-900 px-2 py-1 text-center font-bold">
                          {spec.title.toUpperCase()}
                        </td>
                      </tr>

                      <tr>
                        <td colSpan={2} className="border border-slate-900 px-2 py-1 font-bold text-center w-[13%]">
                          {m.titlePreparedBy || 'PREPARED BY'}
                        </td>
                        <td className="border border-slate-900 px-2 py-1 font-bold text-center w-[13%]">
                          {m.titleCheckedBy || 'CHECKED BY'}
                        </td>
                        <td
                          rowSpan={3}
                          className="border border-slate-900 px-2 py-1 font-bold text-center align-middle w-[10%]"
                        >
                          Firm Logo
                        </td>
                        <td className="border border-slate-900 px-1.5 py-1 font-bold text-center">
                          {m.rdsoApprover1 || 'JE/SSE/RDSO/LKO'}
                        </td>
                        <td className="border border-slate-900 px-1.5 py-1 font-bold text-center">
                          {m.rdsoApprover2 || 'ADE/RDSO/LKO'}
                        </td>
                        <td className="border border-slate-900 px-1.5 py-1 font-bold text-center">
                          {m.rdsoApprover3 || 'DIRECTOR/RDSO/LKO'}
                        </td>
                        <td
                          rowSpan={3}
                          className="border border-slate-900 px-2 py-1 text-center align-middle font-semibold w-[10%]"
                        >
                          {m.drawingNo || 'DRG.NO.'}
                        </td>
                        <td
                          rowSpan={3}
                          className="border border-slate-900 px-2 py-1 text-center align-middle w-[12%]"
                        >
                          <div className="font-bold">KAVACH:</div>
                          <div className="mt-0.5">{m.sipRef || '—'}</div>
                        </td>
                        <td className="border border-slate-900 px-1.5 py-1 font-bold text-center w-[6%]">
                          SHEET
                        </td>
                        <td className="border border-slate-900 px-1.5 py-1 font-bold text-center w-[6%]">
                          SHEETS
                        </td>
                      </tr>

                      <tr>
                        <td className="border border-slate-900 px-1.5 py-1.5 font-bold text-center w-[5%]">
                          SIGN
                        </td>
                        <td className="border border-slate-900 px-2 py-1.5 w-[8%]"></td>
                        <td className="border border-slate-900 px-2 py-1.5"></td>
                        <td colSpan={3} rowSpan={2} className="border border-slate-900 px-2 py-1.5 text-center align-middle">
                          <div className="font-bold">{m.titleApprovedBy || 'APPROVED BY'}</div>
                          <div className="font-semibold mt-0.5">{m.finalApprover || 'EXE. DIRECTOR TELE-II'}</div>
                        </td>
                        <td rowSpan={2} className="border border-slate-900 px-1.5 py-1.5 text-center font-mono font-semibold align-middle">
                          {sheetIdx + 1}
                        </td>
                        <td rowSpan={2} className="border border-slate-900 px-1.5 py-1.5 text-center font-mono font-semibold align-middle">
                          {sheetChunks.length}
                        </td>
                      </tr>

                      <tr>
                        <td className="border border-slate-900 px-1.5 py-1.5 font-bold text-center">
                          NAME
                        </td>
                        <td className="border border-slate-900 px-2 py-1.5 text-center font-medium">
                          {m.preparedBy || '—'}
                        </td>
                        <td className="border border-slate-900 px-2 py-1.5 text-center font-medium">
                          {m.checkedBy || '—'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Revision History Editor (Cl. I.2.14 — Separate below sheet frame) */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 no-print">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-slate-800 uppercase">
            Revision History (Cl. I.2.14 — Printed on Block Section Sheet)
          </span>
          <button
            type="button"
            onClick={addRevision}
            className="text-xs font-medium text-blue-700 hover:underline flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Revision Row
          </button>
        </div>
        <table className="border-collapse border border-slate-300 text-xs w-full max-w-2xl">
          <thead>
            <tr className="bg-slate-100 font-bold text-center">
              <th className="border border-slate-300 px-2 py-1 w-16">Rev No.</th>
              <th className="border border-slate-300 px-2 py-1">Revision Description</th>
              <th className="border border-slate-300 px-2 py-1 w-28">Date</th>
              <th className="border border-slate-300 px-1.5 py-1 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {m.revisions.map((rev, idx) => (
              <tr key={idx}>
                <td className="border border-slate-300 px-2 py-1 text-center font-mono">{rev.revNo}</td>
                <td className="border border-slate-300 px-2 py-1">
                  <input
                    type="text"
                    value={rev.description}
                    onChange={(e) => {
                      const next = [...m.revisions];
                      next[idx] = { ...next[idx], description: e.target.value };
                      onUpdateRevisions(next);
                    }}
                    className="w-full bg-transparent focus:outline-none focus:bg-blue-50/50"
                  />
                </td>
                <td className="border border-slate-300 px-2 py-1 text-center font-mono">{rev.date}</td>
                <td className="border border-slate-300 px-1 py-1 text-center">
                  {m.revisions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onUpdateRevisions(m.revisions.filter((_, i) => i !== idx))}
                      className="text-slate-400 hover:text-red-600"
                      title="Delete revision"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
