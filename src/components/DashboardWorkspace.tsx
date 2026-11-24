import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Download,
  Eye,
  FileCheck2,
  FolderOpen,
  Table2,
  Upload,
} from 'lucide-react';
import { KAVACH_SPEC_TABLES, SPEC_DOCUMENT_INFO } from '../spec/kavachSpecSchema';
import type { NavigationSection, WorkspaceProject } from '../types/project';

interface DashboardWorkspaceProps {
  project: WorkspaceProject;
  savedProjects: Array<{
    id: string;
    name: string;
    updatedAt: string;
    stationName: string;
    stationId: string;
    drawingCount: number;
    isSavedForPreview: boolean;
  }>;
  onNavigate: (section: NavigationSection) => void;
  onLoadProject: (projectId: string) => void;
  onNewProject: () => void;
}

export function DashboardWorkspace({
  project,
  savedProjects,
  onNavigate,
  onLoadProject,
  onNewProject,
}: DashboardWorkspaceProps) {
  const totalRows = KAVACH_SPEC_TABLES.reduce(
    (sum, t) => sum + (project.tables[t.id]?.length || 0),
    0
  );
  const errorCount = project.validationIssues.filter((i) => i.severity === 'error').length;
  const warningCount = project.validationIssues.filter((i) => i.severity === 'warning').length;

  const hasDrawing = project.drawings.length > 0;
  const hasExtracted = project.extractionStatus === 'completed';

  const workflowSteps: Array<{
    num: string;
    title: string;
    detail: string;
    done: boolean;
    section: NavigationSection;
    cta: string;
  }> = [
    {
      num: '01',
      title: 'Upload & Validate Drawings',
      detail: hasDrawing
        ? `${project.drawings.length} file(s) validated and ready`
        : 'Upload DWG, DXF, or PDF station layout',
      done: hasDrawing,
      section: 'upload',
      cta: hasDrawing ? 'Manage Files' : 'Upload',
    },
    {
      num: '02',
      title: 'Inspect Drawing Layout',
      detail: hasDrawing
        ? `Active: ${project.drawings.find((d) => d.id === project.activeDrawingId)?.fileName || project.drawings[0].fileName}`
        : 'Verify layers, signals, tags & zoom before extraction',
      done: hasDrawing,
      section: 'viewer',
      cta: 'Open Viewer',
    },
    {
      num: '03',
      title: 'Run Dynamic Extraction',
      detail: hasExtracted
        ? `${project.components.length} components · ${project.relationships.length} relationships`
        : 'Analyze geometry, topology, and RDSO calculations',
      done: hasExtracted,
      section: 'extraction',
      cta: hasExtracted ? 'View Report' : 'Extract',
    },
    {
      num: '04',
      title: 'Edit Tables & Validate',
      detail: hasExtracted
        ? `${totalRows} rows across 7 tables · ${errorCount} errors / ${warningCount} warnings`
        : 'Review, edit cells, and verify RDSO invariants',
      done: hasExtracted && errorCount === 0,
      section: 'tables',
      cta: 'Edit Tables',
    },
    {
      num: '05',
      title: 'Save, Preview & Export',
      detail: project.isSavedForPreview
        ? 'Finalized for RDSO PDF & Excel export'
        : 'Save verified data to generate final sheets',
      done: project.isSavedForPreview,
      section: project.isSavedForPreview ? 'preview' : 'export',
      cta: 'Preview / Export',
    },
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header Row */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Railway Station Layout & KAVACH Workspace
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            {SPEC_DOCUMENT_INFO.code} ({SPEC_DOCUMENT_INFO.version} {SPEC_DOCUMENT_INFO.amendment}) · Dynamic DWG, DXF & PDF extraction to official KAVACH Control & Track Profile tables.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onNewProject}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-md whitespace-nowrap"
          >
            New Station Workspace
          </button>
          <button
            type="button"
            onClick={() => onNavigate(hasDrawing ? 'viewer' : 'upload')}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md flex items-center gap-1.5 whitespace-nowrap"
          >
            {hasDrawing ? <Eye className="w-3.5 h-3.5" /> : <Upload className="w-3.5 h-3.5" />}
            {hasDrawing ? 'Inspect Active Drawing' : 'Upload Station Drawing'}
          </button>
        </div>
      </div>

      {/* Key Metrics Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <span className="text-xs text-slate-500">Station Context</span>
          <p className="text-base font-bold text-slate-900 mt-1 truncate">
            {project.metadata.stationName || 'Not Extracted Yet'}
          </p>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            {project.metadata.stationId ? `ID ${project.metadata.stationId}` : 'ID —'} · Ver {project.metadata.versionControl}
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <span className="text-xs text-slate-500">Uploaded Drawings</span>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            {project.drawings.length}
          </p>
          <span className="text-xs text-slate-500">DWG, DXF & PDF formats</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <span className="text-xs text-slate-500">Extracted Records</span>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            {totalRows}
          </p>
          <span className="text-xs text-slate-500">
            {project.components.length} components · {project.relationships.length} links
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <span className="text-xs text-slate-500">Validation Audit</span>
          <p className="text-2xl font-bold font-mono tabular-nums mt-0.5">
            <span className={errorCount > 0 ? 'text-red-700' : 'text-emerald-700'}>{errorCount}</span>
            <span className="text-slate-400 text-base font-normal"> err / </span>
            <span className="text-amber-700">{warningCount}</span>
            <span className="text-slate-400 text-base font-normal"> warn</span>
          </p>
          <span className="text-xs text-slate-500">RDSO Amdt-6 invariant checks</span>
        </div>
      </div>

      {/* End-to-End Engineering Workflow Tracker */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">End-to-End Documentation Workflow</h2>
          <span className="text-xs text-slate-500">Click any stage to continue</span>
        </div>
        <div className="divide-y divide-slate-100">
          {workflowSteps.map((step) => (
            <div
              key={step.num}
              className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
            >
              <div className="flex items-start gap-3.5">
                <span className="font-mono text-xs font-semibold text-slate-400 pt-0.5">
                  {step.num}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{step.title}</span>
                    {step.done && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">{step.detail}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate(step.section)}
                className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md flex items-center gap-1 self-start sm:self-center whitespace-nowrap shrink-0"
              >
                {step.cta}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Table Readiness Summary & Saved Sessions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              RDSO KAVACH Output Tables Coverage
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('tables')}
              className="text-xs font-medium text-blue-700 hover:underline flex items-center gap-1"
            >
              <Table2 className="w-3.5 h-3.5" />
              Open Tables
            </button>
          </div>
          <div className="divide-y divide-slate-100 text-xs">
            {KAVACH_SPEC_TABLES.map((t) => {
              const count = project.tables[t.id]?.length || 0;
              const issues = project.validationIssues.filter((i) => i.tableId === t.id).length;
              return (
                <div key={t.id} className="px-5 py-2.5 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-900">{t.tableNumber}</span>
                    <span className="text-slate-400 mx-1.5">·</span>
                    <span className="text-slate-700">{t.title}</span>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 font-mono tabular-nums">
                    <span className="text-slate-600">{count} rows</span>
                    {issues > 0 ? (
                      <span className="text-amber-700 flex items-center gap-1 font-sans">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {issues} flag{issues > 1 ? 's' : ''}
                      </span>
                    ) : count > 0 ? (
                      <span className="text-emerald-700 flex items-center gap-1 font-sans">
                        <FileCheck2 className="w-3.5 h-3.5" />
                        Verified
                      </span>
                    ) : (
                      <span className="text-slate-400 font-sans">Pending</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Saved Server Workspaces */}
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden h-fit">
          <div className="px-4 py-3.5 border-b border-slate-200 flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-slate-600" />
            <h2 className="text-sm font-semibold text-slate-900">Saved Workspaces</h2>
          </div>
          {savedProjects.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No saved sessions yet. Save your edited tables to store and revisit station packages here.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {savedProjects.map((sp) => (
                <button
                  key={sp.id}
                  type="button"
                  onClick={() => onLoadProject(sp.id)}
                  className="w-full px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                >
                  <p className="text-xs font-semibold text-slate-900 truncate">
                    {sp.stationName || sp.name}
                    {sp.stationId ? ` (ID: ${sp.stationId})` : ''}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
                    {new Date(sp.updatedAt).toLocaleDateString()} · {sp.drawingCount} file(s)
                    {sp.isSavedForPreview ? ' · Saved' : ''}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
