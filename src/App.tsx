import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  Download,
  Eye,
  FileCheck2,
  GitBranch,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
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
import { GeneratedTablesWorkspace } from './components/GeneratedTablesWorkspace';
import { FinalPreviewWorkspace } from './components/FinalPreviewWorkspace';
import { SettingsWorkspace } from './components/SettingsWorkspace';
import { LandingPageModal } from './components/LandingPageModal';
import type {
  CadDocumentData,
  DocumentMetadata,
  ExtractionProgressStage,
  ExtractionSettings,
  KavachTableId,
  NavigationSection,
  RevisionEntry,
  SavedProjectSummary,
  TableRowRecord,
  TextStyleProps,
  UploadedDrawing,
  ValidationIssue,
  WorkspaceProject,
} from './types/project';

const LOCAL_STORAGE_KEY = 'railspec_kavach_active_workspace_v1';
const SIDEBAR_COLLAPSED_KEY = 'railspec_sidebar_collapsed';

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
    { id: 'tables', label: 'Generated Tables', icon: Table2 },
    { id: 'preview', label: 'Final Preview', icon: FileCheck2 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

export default function App() {
  const [activeNav, setActiveNav] = useState<NavigationSection>('dashboard');
  const [project, setProject] = useState<WorkspaceProject>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.id && parsed.tables) {
          const { tables, validationIssues } = applyRecalcAndValidate(
            parsed.tables,
            parsed.metadata || createEmptyMetadata(),
            parsed.settings || DEFAULT_EXTRACTION_SETTINGS
          );
          return { ...parsed, tables, validationIssues };
        }
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
  const [savedProjects, setSavedProjects] = useState<SavedProjectSummary[]>([]);
  const [selectedStationLayoutId, setSelectedStationLayoutId] = useState<string | null>(null);
  const [extractionSubTab, setExtractionSubTab] = useState<'engine' | 'components' | 'validation'>('engine');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [isLandingOpen, setIsLandingOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('xtractor_hide_landing_v1') !== 'true';
    } catch {
      return true;
    }
  });

  // Persist sidebar state & support Ctrl+B keyboard shortcut to toggle
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(isSidebarCollapsed));
    } catch {
      // ignore
    }
  }, [isSidebarCollapsed]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        const target = e.target as HTMLElement;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return;
        }
        e.preventDefault();
        setIsSidebarCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleNavigate = useCallback((section: NavigationSection) => {
    if (section === 'components') {
      setExtractionSubTab('components');
      setActiveNav('extraction');
    } else if (section === 'validation') {
      setExtractionSubTab('validation');
      setActiveNav('extraction');
    } else if (section === 'export') {
      setActiveNav('preview');
    } else {
      if (section === 'tables' || section === 'preview') {
        setSelectedStationLayoutId(null);
      }
      setActiveNav(section);
    }
  }, []);

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
      fetch('/api/health', { method: 'GET', cache: 'no-store', credentials: 'same-origin' }).catch(() => { });
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

  const handleLoadSampleStation = useCallback(async () => {
    try {
      showToast('Loading sample Chitgidda (CTF) Station layout...', 'info');
      const res = await fetchJsonWithRetry<{ drawing: UploadedDrawing }>(
        '/api/drawings/load-spec-pdf',
        () => ({ method: 'POST' }),
        { fallbackError: 'Failed to load sample station PDF', maxRetries: 2 }
      );
      if (res && res.drawing) {
        setProject((prev) => {
          const exists = prev.drawings.some((d) => d.id === res.drawing.id);
          const nextDrawings = exists
            ? prev.drawings.map((d) => (d.id === res.drawing.id ? res.drawing : d))
            : [res.drawing, ...prev.drawings];
          return {
            ...prev,
            drawings: nextDrawings,
            activeDrawingId: res.drawing.id,
            activePageNumber: 1,
            name: 'Chitgidda Station (CTF) - KAVACH Sample',
          };
        });
        showToast('Sample Chitgidda Station loaded successfully!', 'success');
        setActiveNav('viewer');
      }
    } catch (err: any) {
      showToast(err.message || 'Error loading sample station', 'error');
    }
  }, [showToast]);

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

      const now = new Date().toISOString();
      const baseLayoutName = activeDrawing.fileName.replace(/\.[^/.]+$/, '').trim();
      const existingMatch = savedProjects.find(
        (sp) =>
          sp.name.toLowerCase() === baseLayoutName.toLowerCase() ||
          sp.name.toLowerCase() === activeDrawing.fileName.toLowerCase() ||
          (data.metadata?.stationName &&
            sp.stationName &&
            sp.stationName.toLowerCase() === data.metadata.stationName.toLowerCase()) ||
          (sp.stationId && data.metadata?.stationId && sp.stationId === data.metadata.stationId)
      );

      const targetId = existingMatch ? existingMatch.id : project.id;
      const targetName = baseLayoutName || project.name;

      const extractedProject: WorkspaceProject = {
        ...project,
        id: targetId,
        name: targetName,
        updatedAt: now,
        isSavedForPreview: false,
        extractionStatus: 'completed',
        extractionError: undefined,
        extractionSummary: data.extractionSummary,
        extractedAt: now,
        metadata: data.metadata,
        components: data.components || [],
        relationships: data.relationships || [],
        tables: data.tables,
        validationIssues: data.validationIssues || [],
      };

      setProject(extractedProject);
      setSelectedStationLayoutId(targetId);

      // Auto-persist extracted dataset so user can revisit without re-uploading
      try {
        await fetchJsonWithRetry(
          `/api/projects/${targetId}`,
          () => ({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...extractedProject, drawings: [] }),
          }),
          { fallbackError: 'Failed to auto-save extracted workspace' }
        );
        fetchSavedProjects();
      } catch {
        // Non-blocking persistence failure
      }

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
    (tableId: KavachTableId, customRow?: TableRowRecord, insertIndex?: number) => {
      setProject((prev) => {
        let newRow: TableRowRecord;
        if (customRow) {
          newRow = customRow;
        } else {
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

          newRow = {
            rowId: `${tableId}_manual_${Date.now().toString(36)}`,
            cells,
            cellMeta,
            sourceTrace: 'Added manually',
          };
        }

        const currentList = prev.tables[tableId];
        let nextList: TableRowRecord[];
        if (typeof insertIndex === 'number' && insertIndex >= 0 && insertIndex <= currentList.length) {
          nextList = [
            ...currentList.slice(0, insertIndex),
            newRow,
            ...currentList.slice(insertIndex),
          ];
        } else {
          nextList = [...currentList, newRow];
        }

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

  const handleReloadFreshUpload = useCallback(() => {
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    } catch {
      // ignore
    }
    setSelectedStationLayoutId(null);
    setProject(createInitialProject());
    setStages(createInitialStages());
    setMissingCompanionInfo([]);
    setPageScopeText('');
    setActiveNav('upload');
    showToast('Reset to fresh station layout workspace.', 'info');
  }, [showToast]);

  const handleLoadProject = useCallback(
    async (projectId: string, targetNav: NavigationSection = 'tables') => {
      try {
        const data = await fetchJsonWithRetry<{ project: WorkspaceProject }>(
          `/api/projects/${projectId}`,
          () => ({ method: 'GET' }),
          {
            fallbackError: 'Could not load project',
            maxRetries: 2,
          }
        );
        const { tables, validationIssues } = applyRecalcAndValidate(
          data.project.tables,
          data.project.metadata,
          data.project.settings
        );
        setSelectedStationLayoutId(projectId);
        setProject((prev) => ({
          ...prev,
          id: data.project.id,
          name: data.project.name,
          updatedAt: data.project.updatedAt,
          isSavedForPreview: data.project.isSavedForPreview,
          lastSavedAt: data.project.lastSavedAt,
          metadata: data.project.metadata,
          tables,
          validationIssues,
          settings: data.project.settings,
        }));
        setActiveNav(targetNav);
        showToast(`Loaded workspace "${data.project.metadata?.stationName || data.project.name}".`, 'success');
      } catch (err) {
        showToast((err as Error).message, 'error');
      }
    },
    [applyRecalcAndValidate, showToast]
  );

  const handleDeleteProjects = useCallback(
    async (projectIds: string[]) => {
      // Optimistically remove from UI immediately
      setSavedProjects((prev) => prev.filter((p) => !projectIds.includes(p.id)));
      try {
        try {
          await fetchJsonWithRetry(
            '/api/projects',
            () => ({
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids: projectIds }),
            }),
            { fallbackError: 'Failed to delete selected project(s)', maxRetries: 1 }
          );
        } catch {
          // Fallback to POST /api/projects/delete if DELETE method is blocked
          await fetchJsonWithRetry(
            '/api/projects/delete',
            () => ({
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids: projectIds }),
            }),
            { fallbackError: 'Failed to delete selected project(s)' }
          );
        }
        await fetchSavedProjects();
        if (projectIds.includes(project.id)) {
          handleReloadFreshUpload();
        }
        showToast(`Deleted ${projectIds.length} layout dataset(s).`, 'success');
      } catch (err) {
        await fetchSavedProjects();
        showToast((err as Error).message, 'error');
      }
    },
    [fetchSavedProjects, handleReloadFreshUpload, project.id, showToast]
  );

  const handleClearAllProjects = useCallback(async () => {
    // Optimistically clear all from UI immediately
    setSavedProjects([]);
    try {
      try {
        await fetchJsonWithRetry(
          '/api/projects',
          () => ({
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          }),
          { fallbackError: 'Failed to clear all projects', maxRetries: 1 }
        );
      } catch {
        // Fallback to POST /api/projects/clear-all
        await fetchJsonWithRetry(
          '/api/projects/clear-all',
          () => ({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          }),
          { fallbackError: 'Failed to clear all projects' }
        );
      }
      await fetchSavedProjects();
      handleReloadFreshUpload();
      showToast('Cleared all saved layout datasets.', 'success');
    } catch (err) {
      await fetchSavedProjects();
      showToast((err as Error).message, 'error');
    }
  }, [fetchSavedProjects, handleReloadFreshUpload, showToast]);

  const handleNewProject = useCallback(() => {
    handleReloadFreshUpload();
  }, [handleReloadFreshUpload]);

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
  const activeNavMeta = NAV_ITEMS.find((n) => n.id === activeNav) || NAV_ITEMS[0];

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50 text-slate-900">
      {/* Persistent Left-Side Engineering Navigation Rail */}
      <aside
        className={`bg-[#0F172A] text-slate-200 flex flex-col shrink-0 border-r border-slate-800 no-print transition-all duration-200 ease-in-out ${
          isSidebarCollapsed
            ? 'w-0 overflow-hidden border-r-0 opacity-0 pointer-events-none'
            : 'w-64 opacity-100'
        }`}
      >
        <div className="h-16 px-4 flex items-center justify-between border-b border-slate-800 shrink-0 w-full">
          <button
            type="button"
            onClick={handleReloadFreshUpload}
            className="flex flex-col justify-center text-left hover:opacity-90 transition-opacity group cursor-pointer"
            title="X-Tractor Home — Click to start fresh upload / reload"
          >
            <div className="flex items-baseline leading-none tracking-tight">
              <span className="text-[26px] font-black text-emerald-400">X</span>
              <span className="text-[18px] font-normal text-white">-Tractor</span>
            </div>
            {/* Horizontal railway track directly under the name */}
            <svg className="w-20 h-1.5 mt-1" viewBox="0 0 72 6" fill="none" xmlns="http://www.w3.org/2000/svg">
              <line x1="0" y1="1" x2="72" y2="1" stroke="#475569" strokeWidth="1" strokeLinecap="round" />
              <line x1="0" y1="5" x2="72" y2="5" stroke="#475569" strokeWidth="1" strokeLinecap="round" />
              {[4, 12, 20, 28, 36, 44, 52, 60, 68].map((x) => (
                <line key={x} x1={x} y1="0" x2={x} y2="6" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" />
              ))}
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setIsSidebarCollapsed(true)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Hide Sidebar (Ctrl+B)"
            aria-label="Hide Sidebar"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeNav === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`w-full px-3 py-2 rounded-md text-xs font-medium flex items-center gap-2.5 transition-colors whitespace-nowrap ${isActive
                  ? 'bg-blue-700 text-white font-semibold'
                  : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                  }`}
              >
                <Icon className="w-4 h-4 shrink-0 opacity-90" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Bottom Sidebar Collapse Action */}
        <div className="p-3 border-t border-slate-800 shrink-0">
          <button
            type="button"
            onClick={() => setIsSidebarCollapsed(true)}
            className="w-full px-3 py-2 rounded-md text-xs font-medium flex items-center gap-2.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
            title="Hide Sidebar for wider workspace (Ctrl+B)"
          >
            <PanelLeftClose className="w-4 h-4 shrink-0" />
            <span className="truncate">Hide Sidebar</span>
          </button>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Clean Contextual Top Bar */}
        <header className="h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0 no-print">
          <div className="flex items-center gap-3 min-w-0">
            {/* Toggle Sidebar Button */}
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed((prev) => !prev)}
              className="p-1.5 -ml-1 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors flex items-center justify-center shrink-0 border border-slate-200 shadow-2xs cursor-pointer"
              title={isSidebarCollapsed ? 'Show Sidebar (Ctrl+B)' : 'Hide Sidebar (Ctrl+B)'}
              aria-label={isSidebarCollapsed ? 'Show Sidebar' : 'Hide Sidebar'}
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen className="w-4 h-4 text-blue-700" />
              ) : (
                <PanelLeftClose className="w-4 h-4 text-slate-600" />
              )}
            </button>

            {/* X-Tractor logo with green bold X and horizontal track under */}
            <div className="flex flex-col items-start leading-none shrink-0">
              <div className="flex items-baseline tracking-tight">
                <span className="text-[26px] font-black text-emerald-600">X</span>
                <span className="text-[18px] font-normal text-black">-Tractor</span>
              </div>
              {/* Horizontal railway track directly under the name */}
              <svg className="w-20 h-1.5 mt-0.5" viewBox="0 0 72 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                <line x1="0" y1="1" x2="72" y2="1" stroke="#334155" strokeWidth="1" strokeLinecap="round" />
                <line x1="0" y1="5" x2="72" y2="5" stroke="#334155" strokeWidth="1" strokeLinecap="round" />
                {[4, 12, 20, 28, 36, 44, 52, 60, 68].map((x) => (
                  <line key={x} x1={x} y1="0" x2={x} y2="6" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" />
                ))}
              </svg>
            </div>
            <span className="text-slate-300 font-light text-base" aria-hidden="true">/</span>
            <span className="text-slate-800 font-semibold text-xs whitespace-nowrap truncate">
              {activeNavMeta?.label || activeNav}
            </span>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {activeDrawing && activeNav !== 'extraction' && activeNav !== 'viewer' && activeNav !== 'tables' && activeNav !== 'preview' && (
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
            {project.extractionStatus === 'completed' &&
              activeNav !== 'upload' &&
              activeNav !== 'viewer' &&
              activeNav !== 'extraction' &&
              activeNav !== 'tables' &&
              activeNav !== 'preview' && (
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
            <button
              type="button"
              onClick={() => setIsLandingOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-300 rounded-lg transition-colors cursor-pointer shadow-2xs"
              title="Open X-Tractor Welcome Banner & Quick Start"
            >
              <img src="/assets/icon.png" alt="X-Tractor Train Icon" className="w-3.5 h-3.5 object-contain rounded-xs" />
              <span className="hidden sm:inline">Welcome Banner</span>
            </button>
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
              onNavigateUpload={() => handleNavigate('upload')}
            />
          </div>

          {activeNav === 'dashboard' && (
            <DashboardWorkspace
              project={project}
              savedProjects={savedProjects}
              onNavigate={handleNavigate}
              onLoadProject={handleLoadProject}
              onNewProject={handleReloadFreshUpload}
              onDeleteProjects={handleDeleteProjects}
              onClearAllProjects={handleClearAllProjects}
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
              onNavigate={handleNavigate}
              subTab={extractionSubTab}
              onSubTabChange={setExtractionSubTab}
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
              savedProjects={savedProjects}
              currentProjectId={selectedStationLayoutId}
              onLoadProject={(id) => handleLoadProject(id, 'tables')}
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
              savedProjects={savedProjects}
              currentProjectId={selectedStationLayoutId}
              onLoadProject={(id) => handleLoadProject(id, 'preview')}
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
          className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-md shadow-lg border text-xs font-medium flex items-center gap-2 max-w-md no-print ${toast.tone === 'error'
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

      {/* Landing Page Modal on Startup & on Demand */}
      <LandingPageModal
        isOpen={isLandingOpen}
        onClose={() => setIsLandingOpen(false)}
        onStartUpload={() => setActiveNav('upload')}
        onLoadSample={handleLoadSampleStation}
        onViewTables={() => setActiveNav('tables')}
      />
    </div>
  );
}
