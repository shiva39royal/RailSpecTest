import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CheckSquare,
  Database,
  FileCheck2,
  FolderOpen,
  Square,
  Table2,
  Trash2,
} from 'lucide-react';
import { SPEC_DOCUMENT_INFO } from '../spec/kavachSpecSchema';
import type { NavigationSection, SavedProjectSummary, WorkspaceProject } from '../types/project';

interface DashboardWorkspaceProps {
  project: WorkspaceProject;
  savedProjects: SavedProjectSummary[];
  onNavigate: (section: NavigationSection) => void;
  onLoadProject: (projectId: string, targetNav?: NavigationSection) => void;
  onNewProject: () => void;
  onDeleteProjects: (projectIds: string[]) => Promise<void>;
  onClearAllProjects: () => Promise<void>;
}

export function DashboardWorkspace({
  project,
  savedProjects,
  onNavigate,
  onLoadProject,
  onNewProject,
  onDeleteProjects,
  onClearAllProjects,
}: DashboardWorkspaceProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirmClearAll, setShowConfirmClearAll] = useState(false);

  const allSelected =
    savedProjects.length > 0 && selectedIds.length === savedProjects.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(savedProjects.map((p) => p.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    setIsDeleting(true);
    try {
      await onDeleteProjects(selectedIds);
      setSelectedIds([]);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmClearAll = async () => {
    setIsDeleting(true);
    try {
      await onClearAllProjects();
      setSelectedIds([]);
      setShowConfirmClearAll(false);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header Row */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Station Layouts &amp; Datasets Dashboard
          </h1>
          {/* <p className="text-sm text-slate-600 mt-1">
            {SPEC_DOCUMENT_INFO.code} ({SPEC_DOCUMENT_INFO.version} {SPEC_DOCUMENT_INFO.amendment}) · Preserved offline station layouts and extracted KAVACH datasets.
          </p> */}
        </div>
      </div>

      {/* Primary Saved Layouts & Extracted Datasets Section */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-blue-700" />
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Saved Station Layouts &amp; Extracted Datasets ({savedProjects.length})
              </h2>
              <p className="text-xs text-slate-500">
                Extracted KAVACH tables and metadata are preserved area. Click any layout name to directly open its Generated Tables.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {selectedIds.length > 0 && (
              <button
                type="button"
                onClick={handleDeleteSelected}
                disabled={isDeleting}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:bg-red-400 rounded-md flex items-center gap-1.5 shadow-xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Selected ({selectedIds.length})
              </button>
            )}
            {savedProjects.length > 0 && (
              <button
                type="button"
                onClick={() => setShowConfirmClearAll(true)}
                disabled={isDeleting}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-red-700 bg-white hover:bg-red-50 border border-slate-300 hover:border-red-300 rounded-md flex items-center gap-1.5 transition-colors shadow-xs"
              >
                <Trash2 className="w-3.5 h-3.5 text-slate-400" />
                Clear All
              </button>
            )}
          </div>
        </div>

        {savedProjects.length === 0 ? (
          <div className="py-12 px-6 text-center">
            <FolderOpen className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h3 className="text-sm font-semibold text-slate-800">No Saved Layout Datasets Yet</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
              Upload a station drawing (DWG, DXF, or PDF) and run Dynamic Extraction. All extracted tables and metadata will be automatically preserved here so you can revisit and edit anytime without re-uploading.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-slate-100 text-slate-700 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3 w-10 text-center">
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className="p-0.5 text-slate-600 hover:text-slate-900"
                      title={allSelected ? 'Deselect all' : 'Select all'}
                    >
                      {allSelected ? (
                        <CheckSquare className="w-4 h-4 text-blue-700" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-400" />
                      )}
                    </button>
                  </th>
                  <th className="py-2.5 px-3 text-left font-semibold">Layout / Station Name</th>
                  <th className="py-2.5 px-3 text-left font-semibold w-28">Station ID</th>
                  <th className="py-2.5 px-3 text-left font-semibold w-40">Extracted Records</th>
                  <th className="py-2.5 px-3 text-left font-semibold w-44">Last Updated</th>
                  <th className="py-2.5 px-3 text-center font-semibold w-28">Status</th>
                  <th className="py-2.5 px-3 text-right font-semibold w-36">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {savedProjects.map((sp) => {
                  const isChecked = selectedIds.includes(sp.id);
                  const isCurrent = project.id === sp.id;
                  const displayName = sp.stationName || sp.name;

                  return (
                    <tr
                      key={sp.id}
                      className={`hover:bg-blue-50/40 transition-colors ${
                        isChecked ? 'bg-blue-50/60' : isCurrent ? 'bg-slate-50/70' : ''
                      }`}
                    >
                      <td className="py-3 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => toggleSelect(sp.id)}
                          className="p-0.5 text-slate-600 hover:text-slate-900"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-blue-700" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400" />
                          )}
                        </button>
                      </td>
                      <td className="py-3 px-3">
                        <button
                          type="button"
                          onClick={() => onLoadProject(sp.id, 'tables')}
                          className="text-left group flex flex-col"
                        >
                          <span className="font-bold text-slate-900 group-hover:text-blue-700 group-hover:underline flex items-center gap-1.5">
                            {displayName}
                            {isCurrent && (
                              <span className="text-[10px] font-mono px-1.5 py-0.2 bg-blue-100 text-blue-800 rounded font-normal">
                                Active
                              </span>
                            )}
                          </span>
                          <span className="text-[11px] text-slate-500 font-mono">
                            {sp.name !== displayName ? sp.name : `${sp.drawingCount} file(s)`}
                          </span>
                        </button>
                      </td>
                      <td className="py-3 px-3 font-mono font-medium text-slate-700">
                        {sp.stationId || '—'}
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-mono tabular-nums text-slate-800 font-semibold">
                          {typeof sp.totalRows === 'number' && sp.totalRows > 0
                            ? `${sp.totalRows} table rows`
                            : 'Extracted tables'}
                        </div>
                        {typeof sp.componentsCount === 'number' && sp.componentsCount > 0 && (
                          <div className="text-[11px] text-slate-500">
                            {sp.componentsCount} components
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 font-mono text-[11px] text-slate-600 tabular-nums">
                        {new Date(sp.updatedAt).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3" />
                          Ready
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => onLoadProject(sp.id, 'tables')}
                          className="px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded inline-flex items-center gap-1"
                          title="Open in Generated Tables"
                        >
                          <span>Open Tables</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Clear All Confirmation Modal */}
      {showConfirmClearAll && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-sm w-full p-5 shadow-xl space-y-4">
            <div className="flex items-center gap-2.5 text-red-700">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="text-sm font-bold text-slate-900">Clear All Saved Layouts?</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              This will permanently delete all {savedProjects.length} saved station layout datasets from the application. Your workspace will be reset to a fresh upload state.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmClearAll(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmClearAll}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md shadow-xs"
              >
                Yes, Clear All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
