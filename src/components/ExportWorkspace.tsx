import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
} from 'lucide-react';
import { KAVACH_SPEC_TABLES } from '../spec/kavachSpecSchema';
import type { KavachTableId, WorkspaceProject } from '../types/project';

interface ExportWorkspaceProps {
  project: WorkspaceProject;
  selectedTableIds: KavachTableId[];
  onChangeSelectedTables: (ids: KavachTableId[]) => void;
  onExportPdf: (selectedTables: KavachTableId[]) => void;
  onExportExcel: (selectedTables: KavachTableId[]) => Promise<void>;
  onExportJson: () => void;
  onSaveWorkspace: () => void;
}

export function ExportWorkspace({
  project,
  selectedTableIds,
  onChangeSelectedTables,
  onExportPdf,
  onExportExcel,
  onExportJson,
  onSaveWorkspace,
}: ExportWorkspaceProps) {
  const [exportingExcel, setExportingExcel] = useState(false);
  const selectedTables = new Set<KavachTableId>(selectedTableIds);

  const toggleTable = (id: KavachTableId) => {
    const next = new Set(selectedTableIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChangeSelectedTables(KAVACH_SPEC_TABLES.filter((t) => next.has(t.id)).map((t) => t.id));
  };

  const selectedList = KAVACH_SPEC_TABLES.filter((t) => selectedTables.has(t.id)).map((t) => t.id);
  const errorCount = project.validationIssues.filter((i) => i.severity === 'error').length;

  const handleExcelClick = async () => {
    if (selectedList.length === 0) return;
    setExportingExcel(true);
    try {
      await onExportExcel(selectedList);
    } finally {
      setExportingExcel(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">
          Export & Download Final Documentation
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          All exports are generated strictly from your final reviewed and edited dataset — never from raw unedited extraction output.
        </p>
      </div>

      {/* Readiness Banner */}
      <div
        className={`p-4 rounded-lg border flex flex-wrap items-center justify-between gap-3 text-xs ${
          project.isSavedForPreview && errorCount === 0
            ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
            : 'bg-amber-50/70 border-amber-200 text-amber-900'
        }`}
      >
        <div className="flex items-start gap-2.5">
          {project.isSavedForPreview && errorCount === 0 ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          )}
          <div>
            <p className="font-semibold">
              {project.isSavedForPreview
                ? `Final dataset saved (${project.lastSavedAt ? new Date(project.lastSavedAt).toLocaleString() : 'Ready'})`
                : 'Unsaved table edits detected'}
            </p>
            <p className="mt-0.5">
              Station: <strong>{project.metadata.stationName || 'Untitled'}</strong> · Version{' '}
              <span className="font-mono">{project.metadata.versionControl}</span> ·{' '}
              {errorCount} critical validation error(s) remaining.
            </p>
          </div>
        </div>
        {!project.isSavedForPreview && (
          <button
            type="button"
            onClick={onSaveWorkspace}
            className="px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md whitespace-nowrap"
          >
            Save & Validate Now
          </button>
        )}
      </div>

      {/* Select Tables to Include */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Select RDSO Tables to Include ({selectedList.length} of {KAVACH_SPEC_TABLES.length})
          </h2>
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
              onClick={() => onChangeSelectedTables([])}
              className="text-slate-600 hover:underline"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {KAVACH_SPEC_TABLES.map((t) => {
            const count = project.tables[t.id]?.length || 0;
            const checked = selectedTables.has(t.id);
            return (
              <label
                key={t.id}
                className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-slate-50 cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTable(t.id)}
                    className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                  />
                  <div>
                    <span className="text-xs font-semibold text-slate-900">
                      {t.tableNumber}: {t.title}
                    </span>
                    <span className="text-[11px] text-slate-500 block">{t.clauseRef}</span>
                  </div>
                </div>
                <span className="text-xs font-mono tabular-nums text-slate-600">
                  {count} row{count === 1 ? '' : 's'}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Export Deliverable Formats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between gap-4">
          <div>
            <FileText className="w-6 h-6 text-blue-700 mb-3" />
            <h3 className="text-sm font-bold text-slate-900">RDSO Landscape PDF Package</h3>
            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
              Multi-page A3 landscape engineering PDF with official RDSO top metadata grids, grouped column headers, auto-paginated tables, revision history, and approval signature blocks.
            </p>
          </div>
          <button
            type="button"
            disabled={selectedList.length === 0}
            onClick={() => onExportPdf(selectedList)}
            className="w-full px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 rounded-md flex items-center justify-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            Download PDF (.pdf)
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between gap-4">
          <div>
            <FileSpreadsheet className="w-6 h-6 text-emerald-700 mb-3" />
            <h3 className="text-sm font-bold text-slate-900">Formatted Excel Workbook</h3>
            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
              Multi-worksheet .xlsx file with dedicated tabs for Station Metadata, every selected RDSO table with merged headers, freeze panes, numeric typing, and a Validation Audit sheet.
            </p>
          </div>
          <button
            type="button"
            disabled={selectedList.length === 0 || exportingExcel}
            onClick={handleExcelClick}
            className="w-full px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 rounded-md flex items-center justify-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            {exportingExcel ? 'Generating Workbook...' : 'Download Excel (.xlsx)'}
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between gap-4">
          <div>
            <FileJson className="w-6 h-6 text-slate-700 mb-3" />
            <h3 className="text-sm font-bold text-slate-900">Structured KAVACH JSON</h3>
            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
              Machine-readable JSON export preserving component relationships, cell audit provenance (extracted vs. manually edited), metadata, and validation audit records.
            </p>
          </div>
          <button
            type="button"
            onClick={onExportJson}
            className="w-full px-4 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-md flex items-center justify-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            Download JSON (.json)
          </button>
        </div>
      </div>
    </div>
  );
}
