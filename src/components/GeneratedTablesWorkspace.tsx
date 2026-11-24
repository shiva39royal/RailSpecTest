import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  Bold,
  Check,
  CheckSquare,
  Copy,
  Eraser,
  FileEdit,
  Layers,
  Plus,
  RotateCcw,
  Route,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { KAVACH_SPEC_TABLES, KAVACH_TABLE_MAP } from '../spec/kavachSpecSchema';
import {
  TABLE1_COMMON_MERGE_KEY_SET,
  deriveMovementAuthorityFromExitAspect,
  getSignalTypeChoicesForRow,
  getTable1MergeGroups,
  isCellEmpty,
} from '../engine/kavachEngine';
import {
  FONT_FAMILY_OPTIONS,
  FONT_SIZE_OPTIONS,
  TEXT_COLOR_PRESETS,
  getActiveSelectionStyle,
  renderFormattedText,
  textStyleToCss,
} from '../utils/cellFormatting';
import type {
  CellFontFamily,
  DocumentMetadata,
  KavachTableId,
  TableRowRecord,
  TextStyleProps,
  ValidationIssue,
} from '../types/project';

interface GeneratedTablesWorkspaceProps {
  activeTableId: KavachTableId;
  onSelectTable: (tableId: KavachTableId) => void;
  selectedTableIds: KavachTableId[];
  onChangeSelectedTables: (ids: KavachTableId[]) => void;
  tables: Record<KavachTableId, TableRowRecord[]>;
  metadata: DocumentMetadata;
  validationIssues: ValidationIssue[];
  focusedCell: { tableId: KavachTableId; rowId: string; columnKey: string } | null;
  onClearFocusedCell: () => void;
  onUpdateCell: (
    tableId: KavachTableId,
    rowId: string,
    columnKey: string,
    value: string,
    targetRowIds?: string[]
  ) => void;
  onFormatCell: (
    tableId: KavachTableId,
    rowId: string,
    columnKey: string,
    patch: Partial<TextStyleProps> | 'clear',
    selection?: { start: number; end: number } | null,
    targetRowIds?: string[]
  ) => void;
  onRevertCell: (tableId: KavachTableId, rowId: string, columnKey: string) => void;
  onAddRow: (tableId: KavachTableId, customRow?: TableRowRecord, insertIndex?: number) => void;
  onDuplicateRow: (tableId: KavachTableId, rowId: string) => void;
  onDeleteRow: (tableId: KavachTableId, rowId: string) => void;
  onUpdateMetadata: (patch: Partial<DocumentMetadata>) => void;
  onSaveAndValidate: () => void;
  isSaving: boolean;
}

export function GeneratedTablesWorkspace({
  activeTableId,
  onSelectTable,
  selectedTableIds,
  onChangeSelectedTables,
  tables,
  metadata,
  validationIssues,
  focusedCell,
  onClearFocusedCell,
  onUpdateCell,
  onFormatCell,
  onRevertCell,
  onAddRow,
  onDuplicateRow,
  onDeleteRow,
  onUpdateMetadata,
  onSaveAndValidate,
  isSaving,
}: GeneratedTablesWorkspaceProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'manual' | 'missing' | 'issues'>('all');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [showMetaEditor, setShowMetaEditor] = useState(false);
  const [showTableSelector, setShowTableSelector] = useState(false);
  const [editingCell, setEditingCell] = useState<{ rowId: string; colKey: string } | null>(null);
  const [customInputMode, setCustomInputMode] = useState(false);
  const [activeCell, setActiveCell] = useState<{
    rowId: string;
    colKey: string;
    targetRowIds?: string[];
  } | null>(null);
  const [textSelection, setTextSelection] = useState<{
    rowId: string;
    colKey: string;
    start: number;
    end: number;
  } | null>(null);
  const [pendingDeleteRowId, setPendingDeleteRowId] = useState<string | null>(null);

  // Hierarchical Add Row Modal State
  const [isAddRowModalOpen, setIsAddRowModalOpen] = useState(false);
  const [targetSno, setTargetSno] = useState<string>('1');
  const [isNewRoute, setIsNewRoute] = useState(false);
  const [entryAspect, setEntryAspect] = useState<string>('Green');
  const [exitAspect, setExitAspect] = useState<string>('Green');
  const [newEntrySignal, setNewEntrySignal] = useState('');
  const [newExitSignal, setNewExitSignal] = useState('');
  const [newLine, setNewLine] = useState('Down Main');
  const [newSignalType, setNewSignalType] = useState('Home Signal');
  const [genericRowCells, setGenericRowCells] = useState<Record<string, string>>({});

  const selectedSet = useMemo(() => new Set(selectedTableIds), [selectedTableIds]);
  const visibleTables = useMemo(
    () => KAVACH_SPEC_TABLES.filter((t) => selectedSet.has(t.id)),
    [selectedSet]
  );

  const effectiveTableId: KavachTableId = selectedSet.has(activeTableId)
    ? activeTableId
    : visibleTables[0]?.id || 'table1_control';

  const spec = KAVACH_TABLE_MAP[effectiveTableId];
  const rows = tables[effectiveTableId] || [];

  const table1Routes = useMemo(() => {
    if (effectiveTableId !== 'table1_control') return [];
    const t1Rows = tables.table1_control || [];
    const routes: Array<{
      sNo: string;
      entrySignal: string;
      exitSignal: string;
      line: string;
      signalType: string;
      lastRowIndex: number;
      sampleRow: TableRowRecord;
      aspectCount: number;
    }> = [];

    t1Rows.forEach((row, idx) => {
      const sNo = row.cells.sNo || '';
      const existing = routes.find((r) => r.sNo === sNo);
      if (existing) {
        existing.lastRowIndex = idx;
        existing.aspectCount++;
      } else {
        routes.push({
          sNo,
          entrySignal: row.cells.entrySignal || '',
          exitSignal: row.cells.exitSignal || '',
          line: row.cells.line || '',
          signalType: row.cells.signalType || '',
          lastRowIndex: idx,
          sampleRow: row,
          aspectCount: 1,
        });
      }
    });

    return routes;
  }, [effectiveTableId, tables.table1_control]);

  const handleConfirmAddRow = () => {
    if (effectiveTableId === 'table1_control') {
      if (!isNewRoute && targetSno) {
        const route = table1Routes.find((r) => r.sNo === targetSno);
        if (route) {
          const ma = deriveMovementAuthorityFromExitAspect(exitAspect);
          const newRow: TableRowRecord = {
            rowId: `t1_manual_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            cells: {
              ...route.sampleRow.cells,
              sNo: route.sNo,
              aspectEntry: entryAspect,
              aspectExit: exitAspect,
              movementAuthority: ma,
            },
            cellMeta: {
              ...route.sampleRow.cellMeta,
              sNo: { source: 'calculated', trace: `Hierarchical aspect under S. No. ${route.sNo}` },
              aspectEntry: { source: 'manual', originalValue: entryAspect },
              aspectExit: { source: 'manual', originalValue: exitAspect },
              movementAuthority: {
                source: 'calculated',
                originalValue: ma,
                trace: `Derived MA (${ma}) from Exit Aspect "${exitAspect}"`,
              },
            },
            sourceTrace: `Added under S. No. ${route.sNo} (${route.entrySignal} → ${route.exitSignal})`,
          };
          onAddRow('table1_control', newRow, route.lastRowIndex + 1);
          setIsAddRowModalOpen(false);
          return;
        }
      }

      // New Route
      const nextSno = String(table1Routes.length + 1);
      const ma = deriveMovementAuthorityFromExitAspect(exitAspect);
      const newRow: TableRowRecord = {
        rowId: `t1_manual_${Date.now().toString(36)}`,
        cells: {
          sNo: nextSno,
          entrySignal: newEntrySignal.trim().toUpperCase() || 'S1',
          exitSignal: newExitSignal.trim().toUpperCase() || 'S2',
          sectionType: 'Station Section',
          line: newLine || 'Down Main',
          signalType: newSignalType || 'Home Signal',
          aspectEntry: entryAspect,
          aspectExit: exitAspect,
          pointsNormal: '-',
          pointsReverse: '-',
          trackCircuitUp: '-',
          tinsFree: '-',
          tinsOverlap: '-',
          entryFootTag: '',
          enRouteTags: '',
          distanceMeters: '',
          movementAuthority: ma,
          authorizedSpeedOs: 'MPS',
        },
        cellMeta: {
          sNo: { source: 'calculated' },
          aspectEntry: { source: 'manual', originalValue: entryAspect },
          aspectExit: { source: 'manual', originalValue: exitAspect },
          movementAuthority: {
            source: 'calculated',
            originalValue: ma,
            trace: `Derived MA (${ma}) from Exit Aspect "${exitAspect}"`,
          },
        },
        sourceTrace: 'New manual route created',
      };
      onAddRow('table1_control', newRow);
      setIsAddRowModalOpen(false);
      return;
    }

    // Tables 2-7
    const curSpec = KAVACH_TABLE_MAP[effectiveTableId];
    const cells: Record<string, string> = {};
    const cellMeta: TableRowRecord['cellMeta'] = {};
    const nextIdx = (tables[effectiveTableId] || []).length + 1;

    for (const col of curSpec.columns) {
      if (col.key === 'sNo') {
        cells[col.key] = String(nextIdx);
        cellMeta[col.key] = { source: 'calculated' };
      } else {
        cells[col.key] = genericRowCells[col.key] || '';
        cellMeta[col.key] = { source: cells[col.key] ? 'manual' : 'missing' };
      }
    }

    const newRow: TableRowRecord = {
      rowId: `${effectiveTableId}_manual_${Date.now().toString(36)}`,
      cells,
      cellMeta,
      sourceTrace: 'Added manually via modal',
    };
    onAddRow(effectiveTableId, newRow);
    setIsAddRowModalOpen(false);
  };

  const toggleTableSelection = (id: KavachTableId) => {
    const next = new Set(selectedTableIds);
    if (next.has(id)) {
      if (next.size <= 1) return; // keep at least 1 table selected
      next.delete(id);
    } else {
      next.add(id);
    }
    const ordered = KAVACH_SPEC_TABLES.filter((t) => next.has(t.id)).map((t) => t.id);
    onChangeSelectedTables(ordered);
    if (!next.has(activeTableId) && ordered.length > 0) {
      onSelectTable(ordered[0]);
    }
  };

  const issuesByTable = useMemo(() => {
    const map: Record<string, number> = {};
    for (const iss of validationIssues) {
      map[iss.tableId] = (map[iss.tableId] || 0) + 1;
    }
    return map;
  }, [validationIssues]);

  const cellIssueMap = useMemo(() => {
    const map = new Map<string, ValidationIssue>();
    for (const iss of validationIssues) {
      if (iss.tableId === effectiveTableId && iss.rowId && iss.columnKey) {
        map.set(`${iss.rowId}::${iss.columnKey}`, iss);
      }
    }
    return map;
  }, [validationIssues, effectiveTableId]);

  const filteredAndSortedRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = rows.filter((row) => {
      if (sourceFilter === 'manual') {
        const hasManual = Object.values(row.cellMeta).some((m) => m.source === 'manual');
        if (!hasManual) return false;
      } else if (sourceFilter === 'missing') {
        const hasMissing = spec.columns.some((c) => c.mandatory && isCellEmpty(row.cells[c.key]));
        if (!hasMissing) return false;
      } else if (sourceFilter === 'issues') {
        const hasIssue = validationIssues.some(
          (iss) => iss.tableId === effectiveTableId && iss.rowId === row.rowId
        );
        if (!hasIssue) return false;
      }

      if (!q) return true;
      return Object.values(row.cells).some((v) => String(v || '').toLowerCase().includes(q));
    });

    if (sortCol) {
      list = [...list].sort((a, b) => {
        const va = (a.cells[sortCol] || '').trim();
        const vb = (b.cells[sortCol] || '').trim();
        const na = Number(va);
        const nb = Number(vb);
        if (!Number.isNaN(na) && !Number.isNaN(nb) && va !== '' && vb !== '') {
          return sortAsc ? na - nb : nb - na;
        }
        return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      });
    }

    return list;
  }, [rows, searchQuery, sourceFilter, sortCol, sortAsc, spec.columns, validationIssues, effectiveTableId]);

  const table1MergeGroups = useMemo(
    () => (effectiveTableId === 'table1_control' ? getTable1MergeGroups(filteredAndSortedRows) : null),
    [effectiveTableId, filteredAndSortedRows]
  );

  // Build grouped header spans for table rendering
  const hasColumnGroups = spec.columns.some((c) => Boolean(c.group));
  const topHeaderCells = useMemo(() => {
    if (!hasColumnGroups) return [];
    const items: Array<{ label: string; colSpan: number; rowSpan: number; colKey?: string }> = [];
    let i = 0;
    while (i < spec.columns.length) {
      const col = spec.columns[i];
      if (!col.group) {
        items.push({ label: col.label, colSpan: 1, rowSpan: 2, colKey: col.key });
        i++;
      } else {
        const grp = col.group;
        let span = 0;
        while (i + span < spec.columns.length && spec.columns[i + span].group === grp) {
          span++;
        }
        items.push({ label: grp, colSpan: span, rowSpan: 1 });
        i += span;
      }
    }
    return items;
  }, [spec.columns, hasColumnGroups]);

  const handleSort = (colKey: string) => {
    if (sortCol === colKey) {
      setSortAsc((prev) => !prev);
    } else {
      setSortCol(colKey);
      setSortAsc(true);
    }
  };

  const activeRow = useMemo(
    () => (activeCell ? rows.find((r) => r.rowId === activeCell.rowId) || null : null),
    [rows, activeCell]
  );

  const activeSelectionRange = useMemo(() => {
    if (
      !activeCell ||
      !textSelection ||
      textSelection.rowId !== activeCell.rowId ||
      textSelection.colKey !== activeCell.colKey ||
      textSelection.end <= textSelection.start
    ) {
      return null;
    }
    return { start: textSelection.start, end: textSelection.end };
  }, [activeCell, textSelection]);

  const activeCellVal = activeRow && activeCell ? activeRow.cells[activeCell.colKey] ?? '' : '';
  const activeCellMeta = activeRow && activeCell ? activeRow.cellMeta[activeCell.colKey] : undefined;
  const activeColLabel = activeCell
    ? spec.columns.find((c) => c.key === activeCell.colKey)?.label || activeCell.colKey
    : '';
  const activeStyle = useMemo(
    () => getActiveSelectionStyle(activeCellMeta, activeCellVal.length, activeSelectionRange),
    [activeCellMeta, activeCellVal.length, activeSelectionRange]
  );

  const handleApplyStylePatch = (patch: Partial<TextStyleProps> | 'clear') => {
    if (!activeCell) return;
    onFormatCell(
      effectiveTableId,
      activeCell.rowId,
      activeCell.colKey,
      patch,
      activeSelectionRange,
      activeCell.targetRowIds
    );
  };

  const syncSelectionFromInput = (
    rowId: string,
    colKey: string,
    target: HTMLInputElement | HTMLTextAreaElement
  ) => {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    if (end > start) {
      setTextSelection({ rowId, colKey, start, end });
    } else {
      setTextSelection((prev) =>
        prev && prev.rowId === rowId && prev.colKey === colKey ? null : prev
      );
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Editable KAVACH Control & Profile Tables
          </h1>
          <p className="text-xs text-slate-600 mt-0.5">
            Click any cell to edit directly · Dependent engineering calculations and RDSO validation update automatically.
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

          <button
            type="button"
            onClick={() => setShowMetaEditor((v) => !v)}
            className={`px-3 py-2 text-xs font-medium rounded-md border flex items-center gap-1.5 whitespace-nowrap ${
              showMetaEditor
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Station Header & Global Params
          </button>

          <button
            type="button"
            onClick={onSaveAndValidate}
            disabled={isSaving}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:bg-blue-400 rounded-md flex items-center gap-1.5 whitespace-nowrap"
          >
            <Save className="w-3.5 h-3.5" />
            {isSaving ? 'Saving & Validating...' : 'Save & Prepare Preview'}
          </button>
        </div>
      </div>

      {/* Collapsible Edit-Level Table Selection Panel */}
      {showTableSelector && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <div>
              <h2 className="text-xs font-bold text-slate-900">
                Active Tables for Editing, Preview &amp; Export
              </h2>
              <p className="text-[11px] text-slate-500">
                Select which RDSO KAVACH tables to include in your active workspace. Changes sync automatically with Final Preview and Export.
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
                  const populated = KAVACH_SPEC_TABLES.filter((t) => (tables[t.id]?.length || 0) > 0).map(
                    (t) => t.id
                  );
                  if (populated.length > 0) {
                    onChangeSelectedTables(populated);
                    if (!populated.includes(activeTableId)) onSelectTable(populated[0]);
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
              const count = tables[t.id]?.length || 0;
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

      {/* Collapsible Station Header & Global Parameters Panel */}
      {showMetaEditor && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <h2 className="text-sm font-semibold text-slate-900">
              Sheet Header Metadata & Block Control Parameters (Cl. I.2.9, I.2.11.1, I.2.11.19–20)
            </h2>
            <button
              type="button"
              onClick={() => setShowMetaEditor(false)}
              className="text-xs text-slate-500 hover:text-slate-900"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {[
              { key: 'stationName', label: 'Station Name *' },
              { key: 'stationCode', label: 'Station Code' },
              { key: 'stationId', label: 'Station ID *' },
              { key: 'stationKm', label: 'Station KM' },
              { key: 'division', label: 'Division *' },
              { key: 'section', label: 'Section *' },
              { key: 'sectionSpeedKmph', label: 'Section Speed (kmph)' },
              { key: 'versionControl', label: 'Version Control (X.Y.Z) *' },
              { key: 'sipRef', label: 'Reference SIP No.' },
              { key: 'tocRef', label: 'Reference TOC No.' },
              { key: 'rfidLayoutRef', label: 'RFID Tag Layout Ref' },
              { key: 'drawingNo', label: 'Drawing No.' },
              { key: 'signalsOverrideNotRequiredAtZeroSpeed', label: 'Signals OV Not Req. at Zero Speed' },
              { key: 'authorizedSpeedOnDetectionInOs', label: 'Auth. Speed Detection in OS (kmph)' },
              { key: 'preparedBy', label: 'Prepared By' },
              { key: 'checkedBy', label: 'Checked By' },
            ].map((f) => (
              <div key={f.key}>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">{f.label}</label>
                <input
                  type="text"
                  value={String((metadata as any)[f.key] ?? '')}
                  onChange={(e) => onUpdateMetadata({ [f.key]: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Selected Table Switcher Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-slate-200">
        {visibleTables.map((t) => {
          const isActive = t.id === effectiveTableId;
          const count = tables[t.id]?.length || 0;
          const issCount = issuesByTable[t.id] || 0;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                onSelectTable(t.id);
                setSortCol(null);
                setEditingCell(null);
                setActiveCell(null);
                setTextSelection(null);
                setCustomInputMode(false);
              }}
              className={`px-3 py-2 text-xs font-medium rounded-t-md border-b-2 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                isActive
                  ? 'border-blue-700 text-blue-800 bg-white font-semibold'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>
                {t.tableNumber}: {t.shortTitle}
              </span>
              <span className="font-mono tabular-nums text-[11px] text-slate-400">({count})</span>
              {issCount > 0 && (
                <span className="font-mono tabular-nums text-[11px] text-amber-700 font-semibold">
                  · {issCount}!
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active Table Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-slate-50/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-bold text-slate-900">
                {spec.tableNumber} — {spec.title}
              </h2>
              <span className="text-xs font-mono text-slate-500">{spec.clauseRef}</span>
            </div>
            <p className="text-[11px] text-slate-600 mt-0.5">{spec.purpose}</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search table..."
                className="w-44 pl-8 pr-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="flex items-center gap-0.5 p-0.5 bg-slate-200/70 rounded-md text-[11px]">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'manual', label: 'Edited' },
                  { id: 'missing', label: 'Missing' },
                  { id: 'issues', label: 'Flagged' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSourceFilter(f.id)}
                  className={`px-2 py-1 rounded font-medium transition-colors whitespace-nowrap ${
                    sourceFilter === f.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                if (table1Routes.length > 0) {
                  setTargetSno(table1Routes[0].sNo);
                  setIsNewRoute(false);
                } else {
                  setIsNewRoute(true);
                }
                setEntryAspect('Green');
                setExitAspect('Green');
                setNewEntrySignal('');
                setNewExitSignal('');
                setNewLine('Down Main');
                setNewSignalType('Home Signal');
                setGenericRowCells({});
                setIsAddRowModalOpen(true);
              }}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md flex items-center gap-1.5 whitespace-nowrap shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Row
            </button>
          </div>
        </div>

        {/* Text & Cell Formatting Toolbar (Font Type, Font Size, Bold, Color for Selected Text or Cell) */}
        <div className="px-4 py-2 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 pr-1 border-r border-slate-200">
              <Type className="w-3.5 h-3.5 text-slate-500" />
              Text Format
            </span>

            {/* Font Type */}
            <select
              disabled={!activeCell}
              value={activeStyle.fontFamily || 'default'}
              onChange={(e) =>
                handleApplyStylePatch({ fontFamily: e.target.value as CellFontFamily })
              }
              title="Font family for selected text or active cell"
              className="px-2 py-1 text-xs bg-slate-50 border border-slate-300 rounded disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-blue-600"
            >
              {FONT_FAMILY_OPTIONS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>

            {/* Font Size */}
            <select
              disabled={!activeCell}
              value={activeStyle.fontSize ? String(activeStyle.fontSize) : ''}
              onChange={(e) =>
                handleApplyStylePatch({
                  fontSize: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              title="Font size (px) for selected text or active cell"
              className="px-2 py-1 text-xs bg-slate-50 border border-slate-300 rounded disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-blue-600"
            >
              <option value="">Size: Auto</option>
              {FONT_SIZE_OPTIONS.map((sz) => (
                <option key={sz} value={sz}>
                  {sz} px
                </option>
              ))}
            </select>

            {/* Bold Toggle */}
            <button
              type="button"
              disabled={!activeCell}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleApplyStylePatch({ bold: !activeStyle.bold })}
              title="Toggle Bold (B)"
              className={`px-2 py-1 rounded border text-xs font-bold flex items-center gap-1 disabled:opacity-40 ${
                activeStyle.bold
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
              }`}
            >
              <Bold className="w-3.5 h-3.5" />
            </button>

            {/* Preset Color Swatches + Custom Color Input */}
            <div className="flex items-center gap-1 pl-1 border-l border-slate-200">
              {TEXT_COLOR_PRESETS.filter((c) => c.value !== '').map((preset) => {
                const isSelectedColor =
                  (activeStyle.color || '').toUpperCase() === preset.value.toUpperCase();
                return (
                  <button
                    key={preset.value}
                    type="button"
                    disabled={!activeCell}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() =>
                      handleApplyStylePatch({
                        color: isSelectedColor ? '' : preset.value,
                      })
                    }
                    title={`Text color: ${preset.label}`}
                    className={`w-5 h-5 rounded border flex items-center justify-center disabled:opacity-40 ${
                      isSelectedColor
                        ? 'ring-2 ring-blue-600 border-slate-900'
                        : 'border-slate-300 hover:border-slate-500'
                    }`}
                    style={{ backgroundColor: preset.value }}
                  />
                );
              })}

              <label
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-300 bg-white text-[11px] text-slate-700 ${
                  activeCell ? 'cursor-pointer hover:bg-slate-50' : 'opacity-40 cursor-not-allowed'
                }`}
                title="Custom text color"
              >
                <span>Color</span>
                <input
                  type="color"
                  disabled={!activeCell}
                  value={activeStyle.color || '#0F172A'}
                  onChange={(e) => handleApplyStylePatch({ color: e.target.value })}
                  className="w-4 h-4 p-0 border-0 bg-transparent cursor-pointer"
                />
              </label>
            </div>

            {/* Clear Formatting */}
            <button
              type="button"
              disabled={!activeCell}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleApplyStylePatch('clear')}
              title="Clear formatting on selection or cell"
              className="px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-300 rounded flex items-center gap-1 disabled:opacity-40"
            >
              <Eraser className="w-3 h-3" />
              Clear
            </button>
          </div>

          <span className="text-[11px] text-slate-500 truncate max-w-sm">
            {!activeCell ? (
              'Click any cell (or highlight text inside it) to format font, size, bold & color'
            ) : activeSelectionRange ? (
              <>
                Selection:{' '}
                <strong className="font-mono text-slate-800">
                  &ldquo;{activeCellVal.slice(activeSelectionRange.start, activeSelectionRange.end)}&rdquo;
                </strong>{' '}
                ({activeSelectionRange.start}–{activeSelectionRange.end})
              </>
            ) : (
              <>
                Active cell: <strong className="text-slate-700">{activeColLabel}</strong> · highlight substring inside cell for partial text styling
              </>
            )}
          </span>
        </div>

        {/* Cell Provenance Legend (Quiet unboxed inline text) */}
        <div className="px-4 py-1.5 bg-white border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
          <div className="flex items-center gap-4 flex-wrap">
            <span>Cell provenance:</span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-white border border-slate-300 inline-block" />
              Auto-extracted
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-emerald-50 border border-emerald-300 inline-block" />
              Spec-calculated
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-blue-50 border border-blue-400 inline-block" />
              Manually modified
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-amber-50 border border-amber-400 inline-block" />
              Missing / Verify
            </span>
          </div>
          <span className="font-mono tabular-nums">
            Showing {filteredAndSortedRows.length} of {rows.length} rows
          </span>
        </div>

        {/* Dense Editable Engineering Grid */}
        <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-20 bg-slate-100 text-slate-700 shadow-xs">
              {hasColumnGroups ? (
                <>
                  <tr>
                    {topHeaderCells.map((cell, idx) => (
                      <th
                        key={idx}
                        colSpan={cell.colSpan}
                        rowSpan={cell.rowSpan}
                        onClick={cell.colKey ? () => handleSort(cell.colKey!) : undefined}
                        className={`border border-slate-300 px-2 py-1.5 text-center font-semibold text-[11px] leading-tight ${
                          cell.colKey ? 'cursor-pointer hover:bg-slate-200/70' : ''
                        }`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {cell.label}
                          {cell.colKey && <ArrowUpDown className="w-2.5 h-2.5 text-slate-400 shrink-0" />}
                        </span>
                      </th>
                    ))}
                    <th
                      rowSpan={2}
                      className="border border-slate-300 px-2 py-2 text-center font-semibold w-20 bg-slate-100"
                    >
                      Actions
                    </th>
                  </tr>
                  <tr>
                    {spec.columns
                      .filter((c) => Boolean(c.group))
                      .map((col) => (
                        <th
                          key={col.key}
                          onClick={() => handleSort(col.key)}
                          style={{ minWidth: col.widthPx || 100 }}
                          className="border border-slate-300 px-2 py-1.5 text-center font-semibold text-[11px] leading-tight cursor-pointer hover:bg-slate-200/70"
                        >
                          <span className="inline-flex items-center gap-1">
                            {col.label}
                            {col.mandatory && <span className="text-red-600">*</span>}
                            <ArrowUpDown className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                          </span>
                        </th>
                      ))}
                  </tr>
                </>
              ) : (
                <tr>
                  {spec.columns.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      style={{ minWidth: col.widthPx || 110 }}
                      className="border border-slate-300 px-2.5 py-2 text-center font-semibold text-[11px] leading-tight cursor-pointer hover:bg-slate-200/70"
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {col.mandatory && <span className="text-red-600">*</span>}
                        <ArrowUpDown className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                      </span>
                    </th>
                  ))}
                  <th className="border border-slate-300 px-2 py-2 text-center font-semibold w-20 bg-slate-100">
                    Actions
                  </th>
                </tr>
              )}
            </thead>

            <tbody className="bg-white">
              {filteredAndSortedRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={spec.columns.length + 1}
                    className="py-12 px-6 text-center text-slate-500 border border-slate-200"
                  >
                    <p className="text-sm font-medium text-slate-700">
                      {rows.length === 0
                        ? `No records extracted for ${spec.tableNumber} yet.`
                        : 'No rows match your current search or filter.'}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {rows.length === 0
                        ? 'Run Dynamic Extraction on a railway layout drawing or add records manually using "Add Row".'
                        : 'Clear the search or switch filter back to All.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredAndSortedRows.map((row, rowIdx) => {
                  const mergeInfo = table1MergeGroups ? table1MergeGroups[rowIdx] : null;
                  const rowDefaultBg =
                    mergeInfo && mergeInfo.groupIndex % 2 === 1 ? 'bg-slate-50/45' : 'bg-white';

                  return (
                    <tr key={row.rowId} className="hover:bg-slate-50/70">
                      {spec.columns.map((col) => {
                        const isCommonMergeCol =
                          effectiveTableId === 'table1_control' &&
                          TABLE1_COMMON_MERGE_KEY_SET.has(col.key);
                        if (isCommonMergeCol && mergeInfo && !mergeInfo.isGroupStart) {
                          return null;
                        }
                        const spanCount =
                          isCommonMergeCol && mergeInfo && mergeInfo.rowSpan > 1
                            ? mergeInfo.rowSpan
                            : undefined;
                        const editTargetRowIds =
                          spanCount && mergeInfo ? mergeInfo.groupRowIds : undefined;

                        const val = row.cells[col.key] ?? '';
                        const meta = row.cellMeta[col.key];
                        const issue = cellIssueMap.get(`${row.rowId}::${col.key}`);
                        const isMissingMandatory = col.mandatory && isCellEmpty(val);
                        const isEditing =
                          editingCell?.rowId === row.rowId && editingCell?.colKey === col.key;
                        const isFocusedFromValidation =
                          focusedCell?.tableId === effectiveTableId &&
                          focusedCell?.rowId === row.rowId &&
                          focusedCell?.columnKey === col.key;

                        const isManual = meta?.source === 'manual';
                        const isCalculated = meta?.source === 'calculated';

                        let cellBg = rowDefaultBg;
                        if (issue?.severity === 'error') cellBg = 'bg-red-50/70';
                        else if (isMissingMandatory) cellBg = 'bg-amber-50/70';
                        else if (isManual) cellBg = 'bg-blue-50/60';
                        else if (isCalculated) cellBg = 'bg-emerald-50/45';

                        const alignClass =
                          col.align === 'right'
                            ? 'text-right font-mono tabular-nums'
                            : col.align === 'center'
                              ? 'text-center'
                              : 'text-left';

                        const isActiveSelected =
                          activeCell?.rowId === row.rowId && activeCell?.colKey === col.key;

                        const contextualOptions: string[] | null =
                          effectiveTableId === 'table1_control' && col.key === 'signalType'
                            ? getSignalTypeChoicesForRow(
                                row.cells.entrySignal || '',
                                row.cells.line
                              )
                            : col.enumValues && col.enumValues.length > 0
                              ? col.enumValues
                              : null;

                        const useSelectEditor =
                          Boolean(contextualOptions && contextualOptions.length > 0) &&
                          !(isEditing && customInputMode);

                        return (
                          <td
                            key={col.key}
                            rowSpan={spanCount}
                            onClick={() => {
                              setEditingCell({ rowId: row.rowId, colKey: col.key });
                              setCustomInputMode(false);
                              setActiveCell({
                                rowId: row.rowId,
                                colKey: col.key,
                                targetRowIds: editTargetRowIds,
                              });
                              if (
                                textSelection &&
                                (textSelection.rowId !== row.rowId || textSelection.colKey !== col.key)
                              ) {
                                setTextSelection(null);
                              }
                              if (isFocusedFromValidation) onClearFocusedCell();
                            }}
                            title={
                              issue
                                ? `[${issue.clauseRef}] ${issue.message}`
                                : meta?.trace
                                  ? `${meta.source.toUpperCase()}: ${meta.trace}`
                                  : col.description
                            }
                            className={`border border-slate-200 px-2 py-1.5 relative cursor-text ${
                              spanCount ? 'align-middle' : 'align-top'
                            } ${cellBg} ${alignClass} ${
                              isFocusedFromValidation
                                ? 'ring-2 ring-inset ring-blue-600'
                                : isActiveSelected
                                  ? 'ring-1 ring-inset ring-blue-500'
                                  : ''
                            }`}
                          >
                            {isEditing ? (
                              <div className="flex items-start gap-1">
                                {useSelectEditor && contextualOptions ? (
                                  <select
                                    autoFocus
                                    value={val}
                                    style={textStyleToCss(meta?.style)}
                                    onChange={(e) => {
                                      if (e.target.value === '__CUSTOM__') {
                                        setCustomInputMode(true);
                                        return;
                                      }
                                      onUpdateCell(
                                        effectiveTableId,
                                        row.rowId,
                                        col.key,
                                        e.target.value,
                                        editTargetRowIds
                                      );
                                    }}
                                    onBlur={() => setEditingCell(null)}
                                    className="w-full px-1.5 py-1 text-xs bg-white border border-blue-600 rounded focus:outline-none"
                                  >
                                    <option value="">— Select —</option>
                                    {val && !contextualOptions.includes(val) && (
                                      <option value={val}>{val}</option>
                                    )}
                                    {contextualOptions.map((opt) => (
                                      <option key={opt} value={opt}>
                                        {opt}
                                      </option>
                                    ))}
                                    <option value="__CUSTOM__">Edit custom text...</option>
                                  </select>
                                ) : col.dataType === 'tuple_list' ? (
                                  <textarea
                                    autoFocus
                                    rows={3}
                                    value={val}
                                    style={textStyleToCss(meta?.style)}
                                    onSelect={(e) =>
                                      syncSelectionFromInput(row.rowId, col.key, e.currentTarget)
                                    }
                                    onKeyUp={(e) =>
                                      syncSelectionFromInput(row.rowId, col.key, e.currentTarget)
                                    }
                                    onMouseUp={(e) =>
                                      syncSelectionFromInput(row.rowId, col.key, e.currentTarget)
                                    }
                                    onChange={(e) =>
                                      onUpdateCell(
                                        effectiveTableId,
                                        row.rowId,
                                        col.key,
                                        e.target.value,
                                        editTargetRowIds
                                      )
                                    }
                                    onBlur={() => setEditingCell(null)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') setEditingCell(null);
                                    }}
                                    className="w-full px-1.5 py-1 text-xs font-mono bg-white border border-blue-600 rounded focus:outline-none min-w-[220px]"
                                  />
                                ) : (
                                  <input
                                    autoFocus
                                    type="text"
                                    value={val}
                                    style={textStyleToCss(meta?.style)}
                                    onSelect={(e) =>
                                      syncSelectionFromInput(row.rowId, col.key, e.currentTarget)
                                    }
                                    onKeyUp={(e) =>
                                      syncSelectionFromInput(row.rowId, col.key, e.currentTarget)
                                    }
                                    onMouseUp={(e) =>
                                      syncSelectionFromInput(row.rowId, col.key, e.currentTarget)
                                    }
                                    onChange={(e) =>
                                      onUpdateCell(
                                        effectiveTableId,
                                        row.rowId,
                                        col.key,
                                        e.target.value,
                                        editTargetRowIds
                                      )
                                    }
                                    onBlur={() => setEditingCell(null)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === 'Escape') setEditingCell(null);
                                    }}
                                    className="w-full px-1.5 py-0.5 text-xs bg-white border border-blue-600 rounded focus:outline-none"
                                  />
                                )}
                                {contextualOptions && contextualOptions.length > 0 && (
                                  <button
                                    type="button"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      setCustomInputMode((m) => !m);
                                    }}
                                    className="px-1.5 py-1 text-[10px] font-mono font-semibold text-slate-600 hover:text-blue-700 bg-white border border-slate-200 rounded shrink-0"
                                    title={customInputMode ? 'Switch to dropdown options' : 'Type custom text'}
                                  >
                                    {customInputMode ? 'List' : 'Aa'}
                                  </button>
                                )}
                                {isManual && meta?.originalValue !== undefined && (
                                  <button
                                    type="button"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      onRevertCell(effectiveTableId, row.rowId, col.key);
                                      setEditingCell(null);
                                    }}
                                    className="p-1 text-slate-500 hover:text-blue-700 bg-white border border-slate-200 rounded shrink-0"
                                    title={`Revert to extracted value: "${meta.originalValue}"`}
                                  >
                                    <RotateCcw className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div className="min-h-[20px] flex items-start justify-between gap-1 group">
                                <span
                                  className={`break-words leading-snug w-full ${
                                    col.dataType === 'tuple_list' ||
                                    col.dataType === 'distance' ||
                                    col.dataType === 'number'
                                      ? 'font-mono tabular-nums text-[11px]'
                                      : ''
                                  } ${
                                    isMissingMandatory ? 'text-amber-700 italic' : 'text-slate-900'
                                  }`}
                                >
                                  {val !== ''
                                    ? renderFormattedText(val, meta)
                                    : isMissingMandatory
                                      ? 'Missing — click to enter'
                                      : '—'}
                                </span>
                                {issue && (
                                  <AlertTriangle
                                    className={`w-3 h-3 shrink-0 mt-0.5 ${
                                      issue.severity === 'error' ? 'text-red-600' : 'text-amber-600'
                                    }`}
                                  />
                                )}
                                {isManual && !issue && (
                                  <FileEdit className="w-3 h-3 text-blue-600 shrink-0 mt-0.5" />
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}

                      {/* Row Action Buttons (at the far right end) */}
                      <td className="border border-slate-200 px-1.5 py-1 text-center whitespace-nowrap bg-slate-50/50">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onDuplicateRow(effectiveTableId, row.rowId)}
                            className="p-1 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded"
                            title="Duplicate row"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDeleteRowId(row.rowId)}
                            className="p-1 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded"
                            title="Delete row"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Row Confirmation Dialog */}
      {pendingDeleteRowId && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-sm w-full p-5 shadow-lg">
            <h3 className="text-sm font-bold text-slate-900">Delete Table Row?</h3>
            <p className="text-xs text-slate-600 mt-1.5">
              Removing this row will immediately update dependent calculations and re-run RDSO validation checks.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setPendingDeleteRowId(null)}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteRow(effectiveTableId, pendingDeleteRowId);
                  setPendingDeleteRowId(null);
                }}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md"
              >
                Delete Row
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hierarchical Add Row Modal Dialog */}
      {isAddRowModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-50 text-blue-700 rounded-lg shrink-0">
                  <Route className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    Add Row — {spec.title}
                    <span className="text-[10px] font-mono font-medium px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full">
                      {spec.tableNumber}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {effectiveTableId === 'table1_control'
                      ? 'Insert aspect rows hierarchically under an existing route (S. No.) or create a new route.'
                      : `Insert a new engineering row into ${spec.title}.`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddRowModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {effectiveTableId === 'table1_control' ? (
              <div className="space-y-4 text-xs">
                {/* Step 1: Route Group / S. No. Mode */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Route Hierarchy Placement
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setIsNewRoute(false)}
                      disabled={table1Routes.length === 0}
                      className={`px-3 py-2 text-xs font-medium rounded-lg border text-left transition-colors ${
                        !isNewRoute
                          ? 'border-blue-600 bg-blue-50/50 text-blue-900 font-semibold'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      Under Existing Route (S. No.)
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsNewRoute(true)}
                      className={`px-3 py-2 text-xs font-medium rounded-lg border text-left transition-colors ${
                        isNewRoute
                          ? 'border-blue-600 bg-blue-50/50 text-blue-900 font-semibold'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      + Create New Route
                    </button>
                  </div>
                </div>

                {!isNewRoute ? (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-700">
                      Select Target Route (S. No.)
                    </label>
                    <select
                      value={targetSno}
                      onChange={(e) => setTargetSno(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 font-medium"
                    >
                      {table1Routes.map((r) => (
                        <option key={r.sNo} value={r.sNo}>
                          S. No. {r.sNo} : {r.entrySignal} → {r.exitSignal} ({r.line} · {r.aspectCount} aspects)
                        </option>
                      ))}
                    </select>

                    {/* Route Preview Card */}
                    {(() => {
                      const cur = table1Routes.find((r) => r.sNo === targetSno);
                      if (!cur) return null;
                      return (
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-1 text-[11px] text-slate-600">
                          <div className="flex items-center justify-between text-slate-900 font-medium">
                            <span>
                              Route: <strong className="text-blue-700 font-semibold">{cur.entrySignal} → {cur.exitSignal}</strong>
                            </span>
                            <span className="font-mono text-slate-500">S. No. {cur.sNo}</span>
                          </div>
                          <div>
                            Line: <span className="font-semibold">{cur.line}</span> · Signal Type: <span className="font-semibold">{cur.signalType}</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-slate-600 text-[11px] font-medium mb-1">Entry Signal</label>
                      <input
                        type="text"
                        value={newEntrySignal}
                        onChange={(e) => setNewEntrySignal(e.target.value)}
                        placeholder="e.g. S1"
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md uppercase font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 text-[11px] font-medium mb-1">Exit Signal</label>
                      <input
                        type="text"
                        value={newExitSignal}
                        onChange={(e) => setNewExitSignal(e.target.value)}
                        placeholder="e.g. S3"
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md uppercase font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 text-[11px] font-medium mb-1">Line</label>
                      <input
                        type="text"
                        value={newLine}
                        onChange={(e) => setNewLine(e.target.value)}
                        placeholder="e.g. Down Main"
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 text-[11px] font-medium mb-1">Signal Type</label>
                      <input
                        type="text"
                        value={newSignalType}
                        onChange={(e) => setNewSignalType(e.target.value)}
                        placeholder="e.g. Home Signal"
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md"
                      />
                    </div>
                  </div>
                )}

                {/* Step 2: Entry Signal Aspect */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Aspect of Entry Signal
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: 'Green', dot: 'bg-emerald-500' },
                      { label: 'Double Yellow', dot: 'bg-amber-500' },
                      { label: 'Yellow', dot: 'bg-yellow-400' },
                      { label: 'Red', dot: 'bg-red-500' },
                      { label: 'Miniature', dot: 'bg-slate-400' },
                    ].map((asp) => (
                      <button
                        key={asp.label}
                        type="button"
                        onClick={() => setEntryAspect(asp.label)}
                        className={`px-3 py-1.5 rounded-lg border flex items-center gap-2 transition-all ${
                          entryAspect === asp.label
                            ? 'border-blue-600 bg-blue-50 text-blue-900 font-semibold ring-1 ring-blue-600'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-full ${asp.dot}`} />
                        <span>{asp.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Step 3: Requires Aspects of Exit Signal */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Requires Aspects of Exit Signal
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: 'Green', dot: 'bg-emerald-500', ma: '4' },
                      { label: 'Double Yellow', dot: 'bg-amber-500', ma: '3' },
                      { label: 'Yellow', dot: 'bg-yellow-400', ma: '2' },
                      { label: 'Red', dot: 'bg-red-500', ma: '1' },
                      { label: 'Nil', dot: 'bg-slate-300', ma: '1' },
                      { label: '-', dot: 'bg-slate-300', ma: '1' },
                    ].map((asp) => (
                      <button
                        key={asp.label}
                        type="button"
                        onClick={() => setExitAspect(asp.label)}
                        className={`px-3 py-1.5 rounded-lg border flex items-center gap-2 transition-all ${
                          exitAspect === asp.label
                            ? 'border-blue-600 bg-blue-50 text-blue-900 font-semibold ring-1 ring-blue-600'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-full ${asp.dot}`} />
                        <span>{asp.label}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 bg-slate-100 rounded text-slate-600">
                          MA: {asp.ma}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Step 4: Live Calculated Movement Authority Preview */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-blue-950 font-semibold">Calculated Movement Authority:</span>
                    <span className="ml-2 font-mono font-bold text-sm text-blue-700">
                      {deriveMovementAuthorityFromExitAspect(exitAspect)} Section(s)
                    </span>
                  </div>
                  <span className="text-[11px] font-medium text-blue-800 bg-blue-100 px-2.5 py-0.5 rounded-full">
                    {exitAspect.toLowerCase().includes('green')
                      ? 'Exit Green → 4'
                      : exitAspect.toLowerCase().includes('double yellow')
                        ? 'Exit Double Yellow → 3'
                        : exitAspect.toLowerCase().includes('yellow')
                          ? 'Exit Yellow → 2'
                          : 'Exit Red/Nil/- → 1'}
                  </span>
                </div>
              </div>
            ) : (
              /* Non-Table 1 generic row fields */
              <div className="space-y-3 text-xs">
                <p className="text-slate-600 text-xs">
                  Enter initial column values for the new record in <strong>{spec.title}</strong>:
                </p>
                <div className="grid grid-cols-2 gap-2.5 max-h-60 overflow-y-auto p-1">
                  {spec.columns
                    .filter((c) => c.key !== 'sNo')
                    .slice(0, 8)
                    .map((col) => (
                      <div key={col.key}>
                        <label className="block text-slate-600 text-[11px] font-medium mb-1 truncate">
                          {col.label} {col.mandatory && <span className="text-red-500">*</span>}
                        </label>
                        <input
                          type="text"
                          value={genericRowCells[col.key] || ''}
                          onChange={(e) =>
                            setGenericRowCells((prev) => ({
                              ...prev,
                              [col.key]: e.target.value,
                            }))
                          }
                          placeholder={col.description?.slice(0, 24) || '—'}
                          className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md"
                        />
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsAddRowModalOpen(false)}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmAddRow}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg flex items-center gap-1.5 shadow-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                {effectiveTableId === 'table1_control' ? 'Insert Aspect Row' : 'Insert Table Row'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
