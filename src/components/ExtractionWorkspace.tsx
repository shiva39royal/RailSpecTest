import React from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Circle,
  Cpu,
  Eye,
  Loader2,
  Play,
  Table2,
} from 'lucide-react';
import { KAVACH_SPEC_TABLES } from '../spec/kavachSpecSchema';
import type {
  ExtractionProgressStage,
  NavigationSection,
  UploadedDrawing,
  WorkspaceProject,
} from '../types/project';

interface ExtractionWorkspaceProps {
  project: WorkspaceProject;
  activeDrawing: UploadedDrawing | null;
  stages: ExtractionProgressStage[];
  missingCompanionInfo: string[];
  pageScopeText: string;
  onPageScopeChange: (val: string) => void;
  onStartExtraction: () => void;
  onNavigate: (section: NavigationSection) => void;
}

export function ExtractionWorkspace({
  project,
  activeDrawing,
  stages,
  missingCompanionInfo,
  pageScopeText,
  onPageScopeChange,
  onStartExtraction,
  onNavigate,
}: ExtractionWorkspaceProps) {
  const isRunning = project.extractionStatus === 'running';
  const isCompleted = project.extractionStatus === 'completed';

  const totalRows = KAVACH_SPEC_TABLES.reduce(
    (sum, t) => sum + (project.tables[t.id]?.length || 0),
    0
  );
  const errorCount = project.validationIssues.filter((i) => i.severity === 'error').length;
  const warningCount = project.validationIssues.filter((i) => i.severity === 'warning').length;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Offline Deterministic KAVACH Extraction Engine</h1>
          <p className="text-sm text-slate-600 mt-1">
            Parses native DWG, DXF, and vector PDF geometry &amp; spatial text 100% locally offline (no external AI models or API keys) against RDSO/SPN/196/2020 V4.0 (Amdt-6) rules to detect signals, RFID tags, topology, calculations, and all control tables.
          </p>
        </div>

        <button
          type="button"
          onClick={onStartExtraction}
          disabled={!activeDrawing || isRunning}
          className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 disabled:text-slate-500 rounded-md flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
        >
          {isRunning ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4 fill-current" />
          )}
          {isRunning ? 'Running Dynamic Extraction...' : 'Start Extraction'}
        </button>
      </div>

      {/* Extraction Input & Scope Configuration */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Active Drawing & Extraction Scope</h2>

          {!activeDrawing ? (
            <div className="p-6 bg-slate-50 border border-slate-200 rounded-md text-center">
              <p className="text-sm font-medium text-slate-700">No drawing selected for extraction.</p>
              <p className="text-xs text-slate-500 mt-1">
                Upload a DWG, DXF, or PDF layout and verify it in Drawing Viewer first.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('upload')}
                className="mt-3 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md"
              >
                Go to Upload Drawings
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4 border-b border-slate-100 text-xs">
                <div>
                  <span className="text-slate-500 block">Primary Layout File</span>
                  <span className="font-semibold text-slate-900 mt-0.5 block truncate">
                    {activeDrawing.fileName}
                  </span>
                  <span className="text-slate-500 font-mono tabular-nums">
                    {activeDrawing.format} ·{' '}
                    {activeDrawing.format === 'PDF'
                      ? `Viewing Page ${project.activePageNumber} of ${activeDrawing.pageCount}`
                      : `${activeDrawing.cadData?.totalEntityCount.toLocaleString() ?? 0} CAD entities`}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Companion Sheets Attached</span>
                  <span className="font-semibold text-slate-900 mt-0.5 block">
                    {project.drawings.filter((d) => d.id !== activeDrawing.id).length} companion file(s)
                  </span>
                  <span className="text-slate-500">
                    Missing companion data (Gradients, OHE Poles, SIP) will be flagged, never fabricated.
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Target Page / Layout Focus
                  </label>
                  <input
                    type="text"
                    value={pageScopeText}
                    onChange={(e) => onPageScopeChange(e.target.value)}
                    placeholder={
                      activeDrawing.format === 'PDF'
                        ? `Page ${project.activePageNumber}`
                        : 'Model Space (All Layers)'
                    }
                    className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    For multi-page PDFs, navigate to the station layout page in Drawing Viewer before clicking Start Extraction.
                  </p>
                </div>

                <div className="flex flex-col justify-center gap-2 pt-2">
                  <p className="text-xs text-slate-600">
                    All applicable RDSO KAVACH tables are extracted dynamically. Choose which tables to edit, preview, and export in Generated Tables &amp; Final Preview.
                  </p>
                  <button
                    type="button"
                    onClick={() => onNavigate('viewer')}
                    className="self-start text-xs font-medium text-blue-700 hover:underline flex items-center gap-1"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Inspect layout in Drawing Viewer
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Specification Rules Summary */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-blue-700" />
            <h2 className="text-sm font-semibold text-slate-900">Active Spec Rules</h2>
          </div>
          <ul className="space-y-2 text-xs text-slate-600">
            <li>• 100% Offline local vector parser (DWG, DXF &amp; vector PDF) — zero API keys or external AI</li>
            <li>• All 7 RDSO KAVACH tables generated deterministically from geometry &amp; spatial text</li>
            <li>• RFID tag distance conservation &amp; A-Tag reset calculations</li>
            <li>• Turnout speed ({project.settings.singleTurnoutSpeedKmph}/{project.settings.multiTurnoutSpeedKmph} kmph) &amp; +{project.settings.stationEntryTurnoutBufferM}m/+{project.settings.stationExitTurnoutBufferM}m rules</li>
            <li>• Harmonic Average Gradient G = D / Σ(dᵢ/gᵢ) (max {project.settings.maxAverageGradientsPerRoute})</li>
            <li>• Zero fabrication: missing companion fields flagged for review</li>
          </ul>
        </div>
      </div>

      {/* Live Processing Stages */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Extraction Pipeline Stages</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {stages.map((st, idx) => (
            <div
              key={st.id}
              className={`p-3.5 rounded-md border ${st.status === 'running'
                ? 'border-blue-300 bg-blue-50/50'
                : st.status === 'completed'
                  ? 'border-emerald-200 bg-emerald-50/30'
                  : st.status === 'error'
                    ? 'border-red-200 bg-red-50/40'
                    : 'border-slate-200 bg-slate-50/40'
                }`}
            >
              <div className="flex items-center gap-2">
                {st.status === 'running' && <Loader2 className="w-4 h-4 text-blue-700 animate-spin shrink-0" />}
                {st.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                {st.status === 'error' && <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />}
                {st.status === 'pending' && <Circle className="w-4 h-4 text-slate-400 shrink-0" />}
                <span className="text-xs font-semibold text-slate-900">
                  {idx + 1}. {st.label}
                </span>
              </div>
              {st.detail && <p className="text-[11px] text-slate-600 mt-1.5 pl-6">{st.detail}</p>}
            </div>
          ))}
        </div>

        {project.extractionStatus === 'error' && project.extractionError && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md flex items-start gap-2.5 text-xs text-red-800">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Extraction Failed</p>
              <p className="mt-0.5">{project.extractionError}</p>
            </div>
          </div>
        )}
      </div>

      {/* Extraction Results Summary */}
      {isCompleted && (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Extraction Completed — {project.metadata.stationName || activeDrawing?.fileName}
              </h2>
              <p className="text-xs text-slate-600 mt-1 max-w-3xl">{project.extractionSummary}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onNavigate('components')}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap"
              >
                Inspect Components ({project.components.length})
              </button>
              <button
                type="button"
                onClick={() => onNavigate('tables')}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md flex items-center gap-1.5 whitespace-nowrap"
              >
                <Table2 className="w-3.5 h-3.5" />
                Open Generated Tables
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
              <span className="text-xs text-slate-500">Detected Components</span>
              <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                {project.components.length}
              </p>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
              <span className="text-xs text-slate-500">Mapped Relationships</span>
              <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                {project.relationships.length}
              </p>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
              <span className="text-xs text-slate-500">Generated Table Rows</span>
              <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                {totalRows}
              </p>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
              <span className="text-xs text-slate-500">Validation Flags</span>
              <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                <span className={errorCount > 0 ? 'text-red-700' : 'text-emerald-700'}>{errorCount} err</span>
                <span className="text-slate-400 text-sm font-normal"> / </span>
                <span className="text-amber-700 text-base">{warningCount} warn</span>
              </p>
            </div>
          </div>

          {missingCompanionInfo.length > 0 && (
            <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-md">
              <p className="text-xs font-semibold text-amber-900">
                Missing Companion Document Data Flagged (Not Fabricated)
              </p>
              <ul className="mt-1.5 space-y-1 text-xs text-amber-800">
                {missingCompanionInfo.map((item, idx) => (
                  <li key={idx}>• {item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
