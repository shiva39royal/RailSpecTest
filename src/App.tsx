import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  Download,
  Eye,
  FileCheck2,
  GitBranch,
  LayoutDashboard,
  Play,
  Save,
  Settings,
  ShieldCheck,
  Table2,
  TrainTrack,
  Upload,
} from 'lucide-react';
import {
  DEFAULT_EXTRACTION_SETTINGS,
  KAVACH_SPEC_TABLES,
  KAVACH_TABLE_MAP,
  createEmptyMetadata,
  createEmptyTables,
} from './spec/kavachSpecSchema';
import { recalculateDependentTables, validateKavachDataset } from './engine/kavachEngine';
import { applyFormatToCellMeta, clampSpansToLength } from './utils/cellFormatting';
import { exportKavachToExcel, exportKavachToJson, exportKavachToPdf } from './utils/exportEngine';
import { fetchJsonWithRetry } from './utils/http';
import { DashboardWorkspace } from './components/DashboardWorkspace';
import { UploadWorkspace } from './components/UploadWorkspace';
import { DrawingViewer } from './components/DrawingViewer';
import { ExtractionWorkspace } from './components/ExtractionWorkspace';
import { ComponentsWorkspace } from './components/ComponentsWorkspace';
import { GeneratedTablesWorkspace } from './components/GeneratedTablesWorkspace';
import { ValidationWorkspace } from './components/ValidationWorkspace';
import { FinalPreviewWorkspace } from './components/FinalPreviewWorkspace';
import { ExportWorkspace } from './components/ExportWorkspace';
import { SettingsWorkspace } from './components/SettingsWorkspace';
import type {
  CadDocumentData,
  DocumentMetadata,
  ExtractionProgressStage,
  ExtractionSettings,
  KavachTableId,
  NavigationSection,
  RevisionEntry,
  TableRowRecord,
  TextStyleProps,
  UploadedDrawing,
  ValidationIssue,
  WorkspaceProject,
} from './types/project';

const LOCAL_STORAGE_KEY = 'railspec_kavach_active_workspace_v1';

function createInitialProject(): WorkspaceProject {
  const now = new Date().toISOString();
  return {
    id: `proj_${Date.now().toString(36)}`,
    name: 'Untitled Station Layout',
    createdAt: now,
    updatedAt: now,
    isSavedForPreview: false,
    drawings: [],
    activeDrawingId: null,
    activePageNumber: 1,
    extractionStatus: 'idle',
    components: [],
    relationships: [],
    metadata: createEmptyMetadata(),
    tables: createEmptyTables(),
    selectedTables: KAVACH_SPEC_TABLES.map((t) => t.id),
    validationIssues: [],
    settings: { ...DEFAULT_EXTRACTION_SETTINGS },
  };
}

function createInitialStages(): ExtractionProgressStage[] {
  return [
    { id: 'prepare', label: 'Drawing & Geometry Preparation', status: 'pending' },
    { id: 'components', label: 'Component & Symbol Recognition', status: 'pending' },
    { id: 'topology', label: 'Topology & Relationship Mapping', status: 'pending' },
    { id: 'calculations', label: 'RDSO Engineering Calculations', status: 'pending' },
    { id: 'tables', label: 'Dynamic 7-Table Generation', status: 'pending' },
    { id: 'validation', label: 'Completeness & Invariant Audit', status: 'pending' },
  ];
}

const NAV_ITEMS: Array<{
  id: NavigationSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'upload', label: 'Upload Drawings', icon: Upload },
  { id: 'viewer', label: 'Drawing Viewer', icon: Eye },
  { id: 'extraction', label: 'Extraction', icon: Cpu },
  { id: 'components', label: 'Extracted Components', icon: GitBranch },
  { id: 'tables', label: 'Generated Tables', icon: Table2 },
  { id: 'validation', label: 'Data Validation', icon: ShieldCheck },
  { id: 'preview', label: 'Final Preview', icon: FileCheck2 },
  { id: 'export', label: 'Export & Downloads', icon: Download },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function App() {
  const [activeNav, setActiveNav] = useState<NavigationSection>('dashboard');
  const [project, setProject] = useState<WorkspaceProject>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.id && parsed.tables) return parsed;
      }
    } catch {
      // ignore localStorage error
    }
    return createInitialProject();
  });

  const [activeTableId, setActiveTableId] = useState<KavachTableId>('table1_control');
  const [focusedCell, setFocusedCell] = useState<{
    tableId: KavachTableId;
    rowId: string;
    columnKey: string;
  } | null>(null);
  const [stages, setStages] = useState<ExtractionProgressStage[]>(createInitialStages);
  const [missingCompanionInfo, setMissingCompanionInfo] = useState<string[]>([]);
  const [pageScopeText, setPageScopeText] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' | 'info' } | null>(
    null
  );
  const [savedProjects, setSavedProjects] = useState<
    Array<{
      id: string;
      name: string;
      updatedAt: string;
      stationName: string;
      stationId: string;
      drawingCount: number;
      isSavedForPreview: boolean;
    }>
  >([]);

  const drawingFilesRef = useRef<Map<string, File>>(new Map());

  const showToast = useCallback((message: string, tone: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, tone });
    setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, 4500);
  }, []);

  // Persist lightweight state in localStorage (excluding large CAD entity arrays)
  useEffect(() => {
    try {
      const compact = {
        ...project,
        drawings: project.drawings.map((d) => ({ ...d, cadData: undefined })),
      };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(compact));
    } catch {
      // ignore quota error
    }
  }, [project]);

  const fetchSavedProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        setSavedProjects(data.projects || []);
      }
    } catch {
      // ignore network error
    }
  }, []);

  useEffect(() => {
    fetchSavedProjects();
    // Silently warm up backend container whenever user returns to an idle tab
    const pingHealth = () => {
      if (document.visibilityState === 'hidden') return;
      fetch('/api/health', { method: 'GET', cache: 'no-store', credentials: 'same-origin' }).catch(() => {});
    };
    pingHealth();
    window.addEventListener('focus', pingHealth);
    document.addEventListener('visibilitychange', pingHealth);
    return () => {
      window.removeEventListener('focus', pingHealth);
      document.removeEventListener('visibilitychange', pingHealth);
    };
  }, [fetchSavedProjects]);

  const activeDrawing = useMemo(
    () =>
      project.drawings.find((d) => d.id === project.activeDrawingId) ||
      project.drawings[0] ||
      null,
    [project.drawings, project.activeDrawingId]
  );

  // Drawing handlers
  const handleDrawingUploaded = useCallback(
    (drawing: UploadedDrawing, sourceFile?: File) => {
      if (sourceFile) {
        drawingFilesRef.current.set(drawing.id, sourceFile);
      }
      setProject((prev) => ({
        ...prev,
        updatedAt: new Date().toISOString(),
        name: prev.drawings.length === 0 ? drawing.fileName.replace(/\.[^.]+$/, '') : prev.name,
        drawings: [...prev.drawings, drawing],
        activeDrawingId: prev.activeDrawingId || drawing.id,
        activePageNumber: 1,
      }));
      showToast(`Validated and loaded "${drawing.fileName}" (${drawing.format}).`, 'success');
    },
    [showToast]
  );

  const handleSelectDrawing = useCallback((drawingId: string, openViewer?: boolean) => {
    setProject((prev) => ({
      ...prev,
      activeDrawingId: drawingId,
      activePageNumber: 1,
    }));
    if (openViewer) setActiveNav('viewer');
  }, []);

  const handleDeleteDrawing = useCallback((drawingId: string) => {
    drawingFilesRef.current.delete(drawingId);
    setProject((prev) => {
      const remaining = prev.drawings.filter((d) => d.id !== drawingId);
      return {
        ...prev,
        drawings: remaining,
        activeDrawingId:
          prev.activeDrawingId === drawingId ? remaining[0]?.id || null : prev.activeDrawingId,
      };
    });
  }, []);

  const selectedTableIds: KavachTableId[] = useMemo(() => {
    if (Array.isArray(project.selectedTables) && project.selectedTables.length > 0) {
      return project.selectedTables;
    }
    return KAVACH_SPEC_TABLES.map((t) => t.id);
  }, [project.selectedTables]);

  const handleChangeSelectedTables = useCallback((ids: KavachTableId[]) => {
    setProject((prev) => ({
      ...prev,
      selectedTables: ids,
    }));
  }, []);

  const handleHydrateCadData = useCallback((drawingId: string, cadData: CadDocumentData) => {
    setProject((prev) => ({
      ...prev,
      drawings: prev.drawings.map((d) => (d.id === drawingId ? { ...d, cadData } : d)),
    }));
  }, []);

  // Dynamic Extraction Flow (ONLY triggered on explicit Start Extraction click)
  const handleStartExtraction = useCallback(async () => {
    if (!activeDrawing) {
      showToast('Please upload a DWG, DXF, or PDF station layout drawing first.', 'error');
      setActiveNav('upload');
      return;
    }

    setActiveNav('extraction');
    setProject((prev) => ({
      ...prev,
      extractionStatus: 'running',
      extractionError: undefined,
    }));

    const updateStage = (
      id: string,
      status: ExtractionProgressStage['status'],
      detail?: string
    ) => {
      setStages((prev) => prev.map((s) => (s.id === id ? { ...s, status, detail } : s)));
    };

    setStages(createInitialStages());
    updateStage('prepare', 'running', `Loading vector geometry for ${activeDrawing.fileName} (${activeDrawing.format})...`);

    try {
      updateStage(
        'prepare',
        'completed',
        activeDrawing.format === 'PDF'
          ? `Prepared Page ${project.activePageNumber} for offline PDF vector & text extraction`
          : `Prepared lossless CAD entity graph (${activeDrawing.cadData?.totalEntityCount.toLocaleString() ?? 'server-side'} entities)`
      );

      updateStage('components', 'running', 'Running offline symbol, signal, RFID tag & track-circuit detection...');

      const companionIds = project.drawings
        .filter((d) => d.id !== activeDrawing.id)
        .map((d) => d.id);

      const effectivePageRange =
        pageScopeText.trim() ||
        (activeDrawing.format === 'PDF' ? `Page ${project.activePageNumber}` : 'Model Space');

      const runExtractRequest = async (targetDrawingId: string, includeFallback: boolean) => {
        const payloadObj: Record<string, any> = {
          drawingId: targetDrawingId,
          companionDrawingIds: companionIds,
          pageNumber: project.activePageNumber,
          pageRange: effectivePageRange,
          settings: project.settings,
        };
        if (includeFallback && activeDrawing.cadData) {
          payloadObj.fallbackDrawing = activeDrawing;
        }
        const bodyStr = JSON.stringify(payloadObj);
        return fetchJsonWithRetry<any>(
          '/api/extract',
          () => ({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: bodyStr,
          }),
          {
            fallbackError: 'Offline extraction failed on the server',
            maxRetries: 2,
          }
        );
      };

      let data: any;
      try {
        data = await runExtractRequest(activeDrawing.id, false);
      } catch (firstErr) {
        const errMsg = (firstErr as Error).message || '';
        const isMissingOnServer = /no longer in server memory|drawing.*not found/i.test(errMsg);
        if (!isMissingOnServer) throw firstErr;

        // Automatic transparent recovery if container recycled and cleared /data/uploads:
        const cachedFile = drawingFilesRef.current.get(activeDrawing.id);
        if (cachedFile) {
          updateStage('prepare', 'running', `Re-syncing ${activeDrawing.fileName} with server...`);
          const reup = await fetchJsonWithRetry<{ drawing: UploadedDrawing }>(
            '/api/drawings/upload',
            () => {
              const fd = new FormData();
              fd.append('file', cachedFile);
              fd.append('role', activeDrawing.role || 'primary_layout');
              return { method: 'POST', body: fd };
            },
            { fallbackError: 'Could not re-sync drawing file', maxRetries: 2 }
          );
          const refreshed = reup.drawing;
          drawingFilesRef.current.set(refreshed.id, cachedFile);
          setProject((prev) => ({
            ...prev,
            activeDrawingId: prev.activeDrawingId === activeDrawing.id ? refreshed.id : prev.activeDrawingId,
            drawings: prev.drawings.map((d) => (d.id === activeDrawing.id ? refreshed : d)),
          }));
          updateStage('prepare', 'completed', `Re-synced ${refreshed.fileName} cleanly`);
          data = await runExtractRequest(refreshed.id, false);
        } else if (activeDrawing.id.startsWith('drw_spec_')) {
          const reloadSpec = await fetchJsonWithRetry<{ drawing: UploadedDrawing }>(
            '/api/drawings/load-spec-pdf',
            () => ({ method: 'POST' }),
            { fallbackError: 'Could not reload spec PDF', maxRetries: 2 }
          );
          const refreshed = reloadSpec.drawing;
          setProject((prev) => ({
            ...prev,
            activeDrawingId: prev.activeDrawingId === activeDrawing.id ? refreshed.id : prev.activeDrawingId,
            drawings: prev.drawings.map((d) => (d.id === activeDrawing.id ? refreshed : d)),
          }));
          data = await runExtractRequest(refreshed.id, false);
        } else if (activeDrawing.cadData) {
          data = await runExtractRequest(activeDrawing.id, true);
        } else {
          throw firstErr;
        }
      }

      setStages([
        { id: 'prepare', label: 'Drawing & Geometry Preparation', status: 'completed', detail: activeDrawing.fileName },
        {
          id: 'components',
          label: 'Component & Symbol Recognition',
          status: 'completed',
          detail: `${data.components?.length || 0} components detected`,
        },
        {
          id: 'topology',
          label: 'Topology & Relationship Mapping',
          status: 'completed',
          detail: `${data.relationships?.length || 0} relationships mapped`,
        },
        {
          id: 'calculations',
          label: 'RDSO Engineering Calculations',
          status: 'completed',
          detail: 'Distance conservation, A-Tag, turnout & gradient formulas verified',
        },
        {
          id: 'tables',
          label: 'Dynamic 7-Table Generation',
          status: 'completed',
          detail: 'Populated dynamically from RDSO KAVACH specification schema',
        },
        {
          id: 'validation',
          label: 'Completeness & Invariant Audit',
          status: 'completed',
          detail: `${data.validationIssues?.length || 0} validation item(s) logged`,
        },
      ]);

      setMissingCompanionInfo(data.missingCompanionInfo || []);
      setProject((prev) => ({
        ...prev,
        updatedAt: new Date().toISOString(),
        isSavedForPreview: false,
        extractionStatus: 'completed',
        extractionError: undefined,
        extractionSummary: data.extractionSummary,
        extractedAt: new Date().toISOString(),
        metadata: data.metadata,
        components: data.components || [],
        relationships: data.relationships || [],
        tables: data.tables,
        validationIssues: data.validationIssues || [],
      }));

      showToast('Dynamic extraction completed across all RDSO KAVACH tables.', 'success');
    } catch (err) {
      const msg = (err as Error).message || 'Unexpected extraction failure.';
      setStages((prev) =>
        prev.map((s) => (s.status === 'running' ? { ...s, status: 'error', detail: msg } : s))
      );
      setProject((prev) => ({
        ...prev,
        extractionStatus: 'error',
        extractionError: msg,
      }));
      showToast(msg, 'error');
    }
  }, [activeDrawing, pageScopeText, project.activePageNumber, project.drawings, project.settings, showToast]);

  // Helper to apply recalculations & validation immediately after any table/metadata/settings change
  const applyRecalcAndValidate = useCallback(
    (
      nextTables: Record<KavachTableId, TableRowRecord[]>,
      nextMetadata: DocumentMetadata,
      nextSettings: ExtractionSettings
    ) => {
      const recalculated = recalculateDependentTables(nextTables, nextSettings, nextMetadata);
      const issues = validateKavachDataset(nextMetadata, recalculated, nextSettings);
      return { tables: recalculated, validationIssues: issues };
    },
    []
  );

  // Table cell edit handlers
  const handleUpdateCell = useCallback(
    (
      tableId: KavachTableId,
      rowId: string,
      columnKey: string,
      value: string,
      targetRowIds?: string[]
    ) => {
      setProject((prev) => {
        const targetSet =
          targetRowIds && targetRowIds.length > 0 ? new Set(targetRowIds) : new Set([rowId]);
        const updatedRows = prev.tables[tableId].map((row) => {
          if (!targetSet.has(row.rowId)) return row;
          const prevMeta = row.cellMeta[columnKey];
          return {
            ...row,
            cells: { ...row.cells, [columnKey]: value },
            cellMeta: {
              ...row.cellMeta,
              [columnKey]: {
                ...prevMeta,
                source: 'manual' as const,
                originalValue: prevMeta?.originalValue ?? row.cells[columnKey] ?? '',
                spans: clampSpansToLength(prevMeta?.spans, value.length),
                updatedAt: new Date().toISOString(),
                trace: 'Manually modified by user',
              },
            },
          };
        });
        const nextTables = { ...prev.tables, [tableId]: updatedRows };
        const { tables, validationIssues } = applyRecalcAndValidate(
          nextTables,
          prev.metadata,
          prev.settings
        );
        return {
          ...prev,
          updatedAt: new Date().toISOString(),
          isSavedForPreview: false,
          tables,
          validationIssues,
        };
      });
    },
    [applyRecalcAndValidate]
  );

  const handleFormatCell = useCallback(
    (
      tableId: KavachTableId,
      rowId: string,
      columnKey: string,
      patch: Partial<TextStyleProps> | 'clear',
      selection?: { start: number; end: number } | null,
      targetRowIds?: string[]
    ) => {
      setProject((prev) => {
        const targetSet =
          targetRowIds && targetRowIds.length > 0 ? new Set(targetRowIds) : new Set([rowId]);
        const updatedRows = prev.tables[tableId].map((row) => {
          if (!targetSet.has(row.rowId)) return row;
          const textVal = row.cells[columnKey] ?? '';
          const nextMeta = applyFormatToCellMeta(
            row.cellMeta[columnKey],
            textVal.length,
            patch,
            selection
          );
          return {
            ...row,
            cellMeta: {
              ...row.cellMeta,
              [columnKey]: nextMeta,
            },
          };
        });
        return {
          ...prev,
          updatedAt: new Date().toISOString(),
          isSavedForPreview: false,
          tables: { ...prev.tables, [tableId]: updatedRows },
        };
      });
    },
    []
  );

  const handleRevertCell = useCallback(
    (tableId: KavachTableId, rowId: string, columnKey: string) => {
      setProject((prev) => {
        const updatedRows = prev.tables[tableId].map((row) => {
          if (row.rowId !== rowId) return row;
          const orig = row.cellMeta[columnKey]?.originalValue ?? '';
          return {
            ...row,
            cells: { ...row.cells, [columnKey]: orig },
            cellMeta: {
              ...row.cellMeta,
              [columnKey]: {
                ...row.cellMeta[columnKey],
                source: orig ? ('extracted' as const) : ('missing' as const),
                trace: 'Reverted to auto-extracted value',
              },
            },
          };
        });
        const nextTables = { ...prev.tables, [tableId]: updatedRows };
        const { tables, validationIssues } = applyRecalcAndValidate(
          nextTables,
          prev.metadata,
          prev.settings
        );
        return { ...prev, isSavedForPreview: false, tables, validationIssues };
      });
    },
    [applyRecalcAndValidate]
  );

  const handleAddRow = useCallback(
    (tableId: KavachTableId) => {
      setProject((prev) => {
        const spec = KAVACH_TABLE_MAP[tableId];
        const cells: Record<string, string> = {};
        const cellMeta: TableRowRecord['cellMeta'] = {};
        const nextIdx = prev.tables[tableId].length + 1;

        for (const col of spec.columns) {
          if (col.key === 'sNo') {
            cells[col.key] = String(nextIdx);
            cellMeta[col.key] = { source: 'calculated' };
          } else {
            cells[col.key] = '';
            cellMeta[col.key] = { source: 'missing' };
          }
        }

        const newRow: TableRowRecord = {
          rowId: `${tableId}_manual_${Date.now().toString(36)}`,
          cells,
          cellMeta,
          sourceTrace: 'Added manually',
        };
        const nextTables = { ...prev.tables, [tableId]: [...prev.tables[tableId], newRow] };
        const { tables, validationIssues } = applyRecalcAndValidate(
          nextTables,
          prev.metadata,
          prev.settings
        );
        return { ...prev, isSavedForPreview: false, tables, validationIssues };
      });
    },
    [applyRecalcAndValidate]
  );

  const handleDuplicateRow = useCallback(
    (tableId: KavachTableId, rowId: string) => {
      setProject((prev) => {
        const list = prev.tables[tableId];
        const idx = list.findIndex((r) => r.rowId === rowId);
        if (idx === -1) return prev;
        const src = list[idx];
        const copy: TableRowRecord = {
          ...src,
          rowId: `${tableId}_dup_${Date.now().toString(36)}`,
          cells: { ...src.cells },
          cellMeta: Object.fromEntries(
            Object.entries(src.cellMeta).map(([k, v]) => [k, { ...v, source: 'manual' as const }])
          ),
          sourceTrace: `Duplicated from ${src.rowId}`,
        };
        const nextList = [...list.slice(0, idx + 1), copy, ...list.slice(idx + 1)];
        const nextTables = { ...prev.tables, [tableId]: nextList };
        const { tables, validationIssues } = applyRecalcAndValidate(
          nextTables,
          prev.metadata,
          prev.settings
        );
        return { ...prev, isSavedForPreview: false, tables, validationIssues };
      });
    },
    [applyRecalcAndValidate]
  );

  const handleDeleteRow = useCallback(
    (tableId: KavachTableId, rowId: string) => {
      setProject((prev) => {
        const nextList = prev.tables[tableId].filter((r) => r.rowId !== rowId);
        const nextTables = { ...prev.tables, [tableId]: nextList };
        const { tables, validationIssues } = applyRecalcAndValidate(
          nextTables,
          prev.metadata,
          prev.settings
        );
        return { ...prev, isSavedForPreview: false, tables, validationIssues };
      });
    },
    [applyRecalcAndValidate]
  );

  const handleUpdateMetadata = useCallback(
    (patch: Partial<DocumentMetadata>) => {
      setProject((prev) => {
        const nextMeta = { ...prev.metadata, ...patch };
        const { tables, validationIssues } = applyRecalcAndValidate(
          prev.tables,
          nextMeta,
          prev.settings
        );
        return {
          ...prev,
          updatedAt: new Date().toISOString(),
          isSavedForPreview: false,
          metadata: nextMeta,
          tables,
          validationIssues,
        };
      });
    },
    [applyRecalcAndValidate]
  );

  const handleUpdateRevisions = useCallback((revisions: RevisionEntry[]) => {
    setProject((prev) => ({
      ...prev,
      metadata: { ...prev.metadata, revisions },
    }));
  }, []);

  const handleUpdateSettings = useCallback(
    (patch: Partial<ExtractionSettings>) => {
      setProject((prev) => {
        const nextSettings = { ...prev.settings, ...patch };
        const { tables, validationIssues } = applyRecalcAndValidate(
          prev.tables,
          prev.metadata,
          nextSettings
        );
        return { ...prev, settings: nextSettings, tables, validationIssues };
      });
    },
    [applyRecalcAndValidate]
  );

  // Save & Finalize Workspace for Preview / Export
  const handleSaveAndValidate = useCallback(
    async (openPreview = true) => {
      setIsSaving(true);
      try {
        const { tables, validationIssues } = applyRecalcAndValidate(
          project.tables,
          project.metadata,
          project.settings
        );
        const now = new Date().toISOString();
        const finalized: WorkspaceProject = {
          ...project,
          tables,
          validationIssues,
          updatedAt: now,
          lastSavedAt: now,
          isSavedForPreview: true,
        };

        const serializedProject = JSON.stringify(finalized);
        await fetchJsonWithRetry(
          `/api/projects/${finalized.id}`,
          () => ({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: serializedProject,
          }),
          {
            fallbackError: 'Failed to persist workspace to server',
            maxRetries: 2,
          }
        );

        setProject(finalized);
        fetchSavedProjects();
        const errCount = validationIssues.filter((i) => i.severity === 'error').length;
        showToast(
          errCount === 0
            ? 'Dataset saved and validated cleanly. Final Preview is ready.'
            : `Dataset saved with ${errCount} validation error(s) flagged for review.`,
          errCount === 0 ? 'success' : 'info'
        );
        if (openPreview) setActiveNav('preview');
      } catch (err) {
        showToast((err as Error).message, 'error');
      } finally {
        setIsSaving(false);
      }
    },
    [project, applyRecalcAndValidate, fetchSavedProjects, showToast]
  );

  const handleLoadProject = useCallback(
    async (projectId: string) => {
      try {
        const data = await fetchJsonWithRetry<{ project: WorkspaceProject }>(
          `/api/projects/${projectId}`,
          () => ({ method: 'GET' }),
          {
            fallbackError: 'Could not load project',
            maxRetries: 2,
          }
        );
        setProject(data.project);
        showToast(`Loaded workspace "${data.project.metadata?.stationName || data.project.name}".`, 'success');
      } catch (err) {
        showToast((err as Error).message, 'error');
      }
    },
    [showToast]
  );

  const handleNewProject = useCallback(() => {
    setProject(createInitialProject());
    setStages(createInitialStages());
    setMissingCompanionInfo([]);
    setPageScopeText('');
    setActiveNav('upload');
  }, []);

  const handleJumpToIssue = useCallback(
    (tableId: KavachTableId | 'metadata', rowId?: string, columnKey?: string) => {
      if (tableId === 'metadata') {
        setActiveNav('tables');
        showToast('Open "Station Header & Global Params" to update required sheet metadata.', 'info');
        return;
      }
      setActiveTableId(tableId);
      if (rowId && columnKey) {
        setFocusedCell({ tableId, rowId, columnKey });
      }
      setActiveNav('tables');
    },
    [showToast]
  );

  const handleApplySuggestedFix = useCallback(
    (issue: ValidationIssue) => {
      if (!issue.suggestedValue) return;
      if (issue.tableId === 'metadata' && issue.columnKey) {
        handleUpdateMetadata({ [issue.columnKey]: issue.suggestedValue });
        showToast(`Applied suggested metadata value (${issue.suggestedValue}).`, 'success');
      } else if (issue.tableId !== 'metadata' && issue.rowId && issue.columnKey) {
        handleUpdateCell(issue.tableId, issue.rowId, issue.columnKey, issue.suggestedValue);
        showToast(`Applied calculated fix (${issue.suggestedValue}) and re-validated.`, 'success');
      }
    },
    [handleUpdateCell, handleUpdateMetadata, showToast]
  );

  const errorCount = project.validationIssues.filter((i) => i.severity === 'error').length;
  const activeNavMeta = NAV_ITEMS.find((n) => n.id === activeNav)!;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50 text-slate-900">
      {/* Persistent Left-Side Engineering Navigation Rail */}
      <aside className="w-64 bg-[#0F172A] text-slate-200 flex flex-col shrink-0 border-r border-slate-800 no-print">
        <div className="h-14 px-5 flex items-center gap-2.5 border-b border-slate-800 shrink-0">
          <TrainTrack className="w-5 h-5 text-blue-400 shrink-0" />
          <span className="font-bold text-sm tracking-tight text-white whitespace-nowrap truncate">
            RailSpec KAVACH Studio
          </span>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeNav === item.id;
            let countLabel = '';
            if (item.id === 'upload' && project.drawings.length > 0) {
              countLabel = String(project.drawings.length);
            } else if (item.id === 'components' && project.components.length > 0) {
              countLabel = String(project.components.length);
            } else if (item.id === 'validation' && project.validationIssues.length > 0) {
              countLabel = String(project.validationIssues.length);
            }

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveNav(item.id)}
                className={`w-full px-3 py-2 rounded-md text-xs font-medium flex items-center justify-between gap-2 transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-blue-700 text-white font-semibold'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 shrink-0 opacity-90" />
                  <span className="truncate">{item.label}</span>
                </span>
                {countLabel && (
                  <span
                    className={`font-mono tabular-nums text-[11px] ${
                      isActive
                        ? 'text-blue-100'
                        : item.id === 'validation' && errorCount > 0
                          ? 'text-amber-400'
                          : 'text-slate-400'
                    }`}
                  >
                    {countLabel}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Active Station Context Footer (Quiet, Functional) */}
        <div className="px-4 py-3 border-t border-slate-800 text-[11px] text-slate-400 space-y-0.5 shrink-0">
          <div className="text-slate-200 font-medium truncate">
            {project.metadata.stationName || activeDrawing?.fileName || 'No Station Active'}
          </div>
          <div className="font-mono tabular-nums text-slate-400">
            RDSO/SPN/196/2020 · Amdt-6
          </div>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Clean Contextual Top Bar */}
        <header className="h-14 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-6 shrink-0 no-print">
          <div className="flex items-center gap-2 text-xs text-slate-500 min-w-0">
            <span className="font-semibold text-slate-900 whitespace-nowrap">
              {project.metadata.stationName || project.name}
            </span>
            <span aria-hidden="true">/</span>
            <span className="text-slate-700 font-medium whitespace-nowrap truncate">
              {activeNavMeta.label}
            </span>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {activeDrawing && activeNav !== 'extraction' && activeNav !== 'viewer' && (
              <button
                type="button"
                onClick={handleStartExtraction}
                disabled={project.extractionStatus === 'running'}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:bg-blue-400 rounded-md flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                {project.extractionStatus === 'running' ? 'Extracting...' : 'Start Extraction'}
              </button>
            )}
            {project.extractionStatus === 'completed' && activeNav !== 'tables' && (
              <button
                type="button"
                onClick={() => handleSaveAndValidate(true)}
                disabled={isSaving}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-md flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Save className="w-3.5 h-3.5" />
                Save & Preview
              </button>
            )}
          </div>
        </header>

        {/* Main Scrollable Viewport */}
        <main className="flex-1 overflow-y-auto p-6">
          {/* Keep DrawingViewer mounted so pan/zoom & CAD layer state stays preserved across tab switches */}
          <div className={activeNav === 'viewer' ? 'block' : 'hidden'}>
            <DrawingViewer
              drawing={activeDrawing}
              pageNumber={project.activePageNumber}
              onPageNumberChange={(page) =>
                setProject((prev) => ({ ...prev, activePageNumber: page }))
              }
              onStartExtraction={handleStartExtraction}
              extractionRunning={project.extractionStatus === 'running'}
              onHydrateCadData={handleHydrateCadData}
              onNavigateUpload={() => setActiveNav('upload')}
            />
          </div>

          {activeNav === 'dashboard' && (
            <DashboardWorkspace
              project={project}
              savedProjects={savedProjects}
              onNavigate={setActiveNav}
              onLoadProject={handleLoadProject}
              onNewProject={handleNewProject}
            />
          )}

          {activeNav === 'upload' && (
            <UploadWorkspace
              drawings={project.drawings}
              activeDrawingId={activeDrawing?.id || null}
              onDrawingUploaded={handleDrawingUploaded}
              onSelectDrawing={handleSelectDrawing}
              onDeleteDrawing={handleDeleteDrawing}
            />
          )}

          {activeNav === 'extraction' && (
            <ExtractionWorkspace
              project={project}
              activeDrawing={activeDrawing}
              stages={stages}
              missingCompanionInfo={missingCompanionInfo}
              pageScopeText={pageScopeText}
              onPageScopeChange={setPageScopeText}
              onStartExtraction={handleStartExtraction}
              onNavigate={setActiveNav}
            />
          )}

          {activeNav === 'components' && (
            <ComponentsWorkspace
              components={project.components}
              relationships={project.relationships}
              onNavigate={setActiveNav}
            />
          )}

          {activeNav === 'tables' && (
            <GeneratedTablesWorkspace
              activeTableId={activeTableId}
              onSelectTable={setActiveTableId}
              selectedTableIds={selectedTableIds}
              onChangeSelectedTables={handleChangeSelectedTables}
              tables={project.tables}
              metadata={project.metadata}
              validationIssues={project.validationIssues}
              focusedCell={focusedCell}
              onClearFocusedCell={() => setFocusedCell(null)}
              onUpdateCell={handleUpdateCell}
              onFormatCell={handleFormatCell}
              onRevertCell={handleRevertCell}
              onAddRow={handleAddRow}
              onDuplicateRow={handleDuplicateRow}
              onDeleteRow={handleDeleteRow}
              onUpdateMetadata={handleUpdateMetadata}
              onSaveAndValidate={() => handleSaveAndValidate(true)}
              isSaving={isSaving}
            />
          )}

          {activeNav === 'validation' && (
            <ValidationWorkspace
              issues={project.validationIssues}
              onRevalidate={() => {
                const { tables, validationIssues } = applyRecalcAndValidate(
                  project.tables,
                  project.metadata,
                  project.settings
                );
                setProject((prev) => ({ ...prev, tables, validationIssues }));
                showToast(`Validation refreshed: ${validationIssues.length} item(s) checked.`, 'info');
              }}
              onJumpToIssue={handleJumpToIssue}
              onApplySuggestedFix={handleApplySuggestedFix}
              onSaveAndPreview={() => handleSaveAndValidate(true)}
            />
          )}

          {activeNav === 'preview' && (
            <FinalPreviewWorkspace
              project={project}
              selectedTableIds={selectedTableIds}
              onChangeSelectedTables={handleChangeSelectedTables}
              onExportPdf={(selected) => {
                exportKavachToPdf(project, selected);
                showToast('Downloaded RDSO Landscape PDF package.', 'success');
              }}
              onExportExcel={async (selected) => {
                await exportKavachToExcel(project, selected);
                showToast('Downloaded formatted Excel (.xlsx) workbook.', 'success');
              }}
              onUpdateRevisions={handleUpdateRevisions}
              onSaveWorkspace={() => handleSaveAndValidate(false)}
            />
          )}

          {activeNav === 'export' && (
            <ExportWorkspace
              project={project}
              selectedTableIds={selectedTableIds}
              onChangeSelectedTables={handleChangeSelectedTables}
              onExportPdf={(selected) => {
                exportKavachToPdf(project, selected);
                showToast('Downloaded RDSO PDF documentation package.', 'success');
              }}
              onExportExcel={async (selected) => {
                await exportKavachToExcel(project, selected);
                showToast('Downloaded formatted Excel (.xlsx) workbook.', 'success');
              }}
              onExportJson={() => {
                exportKavachToJson(project);
                showToast('Downloaded structured KAVACH JSON dataset.', 'success');
              }}
              onSaveWorkspace={() => handleSaveAndValidate(false)}
            />
          )}

          {activeNav === 'settings' && (
            <SettingsWorkspace
              settings={project.settings}
              onUpdateSettings={handleUpdateSettings}
              onResetSettings={() => {
                handleUpdateSettings(DEFAULT_EXTRACTION_SETTINGS);
                showToast('Restored RDSO/SPN/196/2020 Amdt-6 default parameters.', 'info');
              }}
            />
          )}
        </main>
      </div>

      {/* Non-intrusive Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-md shadow-lg border text-xs font-medium flex items-center gap-2 max-w-md no-print ${
            toast.tone === 'error'
              ? 'bg-red-950 text-red-50 border-red-800'
              : toast.tone === 'success'
                ? 'bg-emerald-950 text-emerald-50 border-emerald-800'
                : 'bg-slate-900 text-slate-50 border-slate-700'
          }`}
        >
          {toast.tone === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
