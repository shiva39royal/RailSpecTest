import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  RefreshCw,
  Wrench,
} from 'lucide-react';
import { KAVACH_TABLE_MAP } from '../spec/kavachSpecSchema';
import type { KavachTableId, ValidationIssue } from '../types/project';

interface ValidationWorkspaceProps {
  issues: ValidationIssue[];
  onRevalidate: () => void;
  onJumpToIssue: (tableId: KavachTableId | 'metadata', rowId?: string, columnKey?: string) => void;
  onApplySuggestedFix: (issue: ValidationIssue) => void;
  onSaveAndPreview: () => void;
}

export function ValidationWorkspace({
  issues,
  onRevalidate,
  onJumpToIssue,
  onApplySuggestedFix,
  onSaveAndPreview,
}: ValidationWorkspaceProps) {
  const [severityFilter, setSeverityFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all');

  const counts = useMemo(() => {
    return {
      total: issues.length,
      error: issues.filter((i) => i.severity === 'error').length,
      warning: issues.filter((i) => i.severity === 'warning').length,
      info: issues.filter((i) => i.severity === 'info').length,
    };
  }, [issues]);

  const filtered = useMemo(() => {
    if (severityFilter === 'all') return issues;
    return issues.filter((i) => i.severity === severityFilter);
  }, [issues, severityFilter]);

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            RDSO Data Validation & Invariant Audit
          </h1>
          <p className="text-xs text-slate-600 mt-1">
            Deterministic verification of RDSO/SPN/196/2020 V4.0 Amdt-6 rules: tag-sequence distance conservation, A-Tag resets, PSR & gradient length sums, turnout formulas, and missing companion data.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRevalidate}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-md flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Re-run Validation
          </button>
          <button
            type="button"
            onClick={onSaveAndPreview}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap"
          >
            Save & Open Final Preview
          </button>
        </div>
      </div>

      {/* Audit Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <span className="text-xs text-slate-500">Critical Rule Errors</span>
          <p className={`text-2xl font-bold font-mono tabular-nums mt-1 ${counts.error > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
            {counts.error}
          </p>
          <span className="text-[11px] text-slate-500">Mandatory fields or math invariant violations</span>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <span className="text-xs text-slate-500">Companion / Verification Warnings</span>
          <p className="text-2xl font-bold font-mono tabular-nums text-amber-700 mt-1">
            {counts.warning}
          </p>
          <span className="text-[11px] text-slate-500">Missing companion sheet entries (Gradients, OHE, SIP)</span>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <span className="text-xs text-slate-500">Validation Status</span>
          <p className="text-base font-bold text-slate-900 mt-1.5 flex items-center gap-1.5">
            {counts.error === 0 ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Ready for Sign-Off
              </>
            ) : (
              <>
                <AlertCircle className="w-4 h-4 text-red-600" />
                Action Required
              </>
            )}
          </p>
          <span className="text-[11px] text-slate-500">Export always uses your verified dataset</span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
        {(
          [
            { id: 'all', label: `All Issues (${counts.total})` },
            { id: 'error', label: `Errors (${counts.error})` },
            { id: 'warning', label: `Warnings (${counts.warning})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSeverityFilter(tab.id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              severityFilter === tab.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Issues List */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <CheckCircle2 className="w-9 h-9 text-emerald-600 mx-auto mb-2.5" />
            <h2 className="text-sm font-bold text-slate-900">No Validation Issues Found</h2>
            <p className="text-xs text-slate-600 mt-1">
              All populated tables satisfy RDSO KAVACH Control Table invariants and required field checks.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filtered.map((issue) => {
              const tableTitle =
                issue.tableId === 'metadata'
                  ? 'Sheet Metadata'
                  : `${KAVACH_TABLE_MAP[issue.tableId].tableNumber}: ${KAVACH_TABLE_MAP[issue.tableId].shortTitle}`;

              return (
                <div
                  key={issue.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    {issue.severity === 'error' ? (
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs flex-wrap">
                        <span
                          className={`font-semibold ${
                            issue.severity === 'error' ? 'text-red-800' : 'text-amber-800'
                          }`}
                        >
                          {issue.ruleName}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-700 font-medium">{tableTitle}</span>
                        <span className="text-slate-400">·</span>
                        <span className="font-mono text-[11px] text-slate-500">{issue.clauseRef}</span>
                      </div>
                      <p className="text-xs text-slate-700 mt-1">{issue.message}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {issue.suggestedValue && (
                      <button
                        type="button"
                        onClick={() => onApplySuggestedFix(issue)}
                        className="px-2.5 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                      >
                        <Wrench className="w-3.5 h-3.5" />
                        Apply {issue.suggestedValue}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onJumpToIssue(issue.tableId, issue.rowId, issue.columnKey)}
                      className="px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md flex items-center gap-1 whitespace-nowrap"
                    >
                      Inspect Cell
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
