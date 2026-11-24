export type DrawingFormat = 'PDF' | 'DXF' | 'DWG';

export type NavigationSection =
  | 'dashboard'
  | 'upload'
  | 'viewer'
  | 'extraction'
  | 'components'
  | 'tables'
  | 'validation'
  | 'preview'
  | 'export'
  | 'settings';

export type KavachTableId =
  | 'table1_control'
  | 'table2_block_section'
  | 'table3_shunting_limit'
  | 'table4_track_profile'
  | 'table5_tsr_route'
  | 'table6_tsl_control'
  | 'table6b_tsl_block'
  | 'table7_tsl_track_profile';

export interface CadPoint {
  x: number;
  y: number;
}

export interface CadLayer {
  name: string;
  color: string;
  visible: boolean;
  entityCount: number;
}

export interface CadEntity {
  id: string;
  type:
    | 'LINE'
    | 'LWPOLYLINE'
    | 'POLYLINE'
    | 'CIRCLE'
    | 'ARC'
    | 'ELLIPSE'
    | 'TEXT'
    | 'MTEXT'
    | 'SPLINE'
    | 'SOLID'
    | 'HATCH'
    | 'POINT'
    | 'DIMENSION';
  layer: string;
  color: string;
  points?: CadPoint[];
  paths?: CadPoint[][];
  solidFill?: boolean;
  closed?: boolean;
  center?: CadPoint;
  radius?: number;
  majorAxis?: CadPoint;
  axisRatio?: number;
  startAngle?: number;
  endAngle?: number;
  text?: string;
  height?: number;
  rotation?: number;
  textAlign?: 'left' | 'center' | 'right';
  textBaseline?: 'top' | 'middle' | 'bottom' | 'alphabetic';
  blockSource?: string;
}

export interface CadBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface CadLayoutInfo {
  name: string;
  entityCount: number;
}

export interface CadDocumentData {
  format: 'DXF' | 'DWG';
  cadVersion?: string;
  units?: string;
  bounds: CadBounds;
  layers: CadLayer[];
  layouts: CadLayoutInfo[];
  entities: CadEntity[];
  textAnnotations: Array<{
    id: string;
    text: string;
    x: number;
    y: number;
    layer: string;
    height?: number;
  }>;
  blockNames: string[];
  totalEntityCount: number;
  svgFallback?: string;
  parseWarnings: string[];
}

export interface UploadedDrawing {
  id: string;
  fileName: string;
  format: DrawingFormat;
  sizeBytes: number;
  uploadedAt: string;
  role: 'primary_layout' | 'sip_toc' | 'gradient_plan' | 'ohe_layout' | 'adjacent_kavach' | 'other';
  validationStatus: 'valid' | 'warning' | 'error';
  validationNotes: string[];
  pageCount: number;
  fileUrl: string;
  cadData?: CadDocumentData;
  pdfMetadata?: {
    pageCount: number;
    width?: number;
    height?: number;
    title?: string;
    contentBounds?: {
      pageNumber: number;
      pageWidth: number;
      pageHeight: number;
      llx: number;
      lly: number;
      urx: number;
      ury: number;
      cropX: number;
      cropY: number;
      cropWidth: number;
      cropHeight: number;
      trimmedRatio: number;
    };
  };
}

export type ComponentCategory =
  | 'signal'
  | 'rfid_tag'
  | 'point'
  | 'track_circuit'
  | 'tin'
  | 'lc_gate'
  | 'shunting_limit'
  | 'track_line'
  | 'gradient_marker'
  | 'ohe_pole'
  | 'infrastructure';

export interface ExtractedComponent {
  id: string;
  label: string;
  category: ComponentCategory;
  subType: string;
  direction?: 'Nominal' | 'Reverse' | 'UP' | 'DN' | 'Both' | 'Unknown';
  chainageKm?: string;
  absoluteLocationMeters?: number;
  layer?: string;
  pageOrLayout?: string;
  coordinates?: { x: number; y: number };
  properties: Record<string, string>;
  relatedIds: string[];
  confidence: number;
  sourceTrace: string;
}

export interface ComponentRelationship {
  id: string;
  type:
    | 'signal_route'
    | 'reverse_signal_route'
    | 'signal_to_foot_tag'
    | 'route_to_point'
    | 'route_to_tin'
    | 'route_to_track_circuit'
    | 'lss_to_block'
    | 'tag_sequence'
    | 'lc_on_route'
    | 'shunting_boundary';
  fromId: string;
  fromLabel: string;
  toId: string;
  toLabel: string;
  description: string;
  properties?: Record<string, string>;
}

export type CellSource = 'extracted' | 'calculated' | 'manual' | 'missing';

export type CellFontFamily = 'default' | 'sans' | 'mono' | 'serif' | 'display';

export interface TextStyleProps {
  fontSize?: number;
  bold?: boolean;
  fontFamily?: CellFontFamily;
  color?: string;
}

export interface TextFormatSpan extends TextStyleProps {
  start: number;
  end: number;
}

export interface CellAuditMeta {
  source: CellSource;
  originalValue?: string;
  confidence?: number;
  trace?: string;
  note?: string;
  updatedAt?: string;
  style?: TextStyleProps;
  spans?: TextFormatSpan[];
}

export interface TableRowRecord {
  rowId: string;
  cells: Record<string, string>;
  cellMeta: Record<string, CellAuditMeta>;
  sourceTrace?: string;
  rowGroupId?: string;
}

export interface RevisionEntry {
  revNo: string;
  description: string;
  date: string;
}

export interface DocumentMetadata {
  stationName: string;
  stationCode: string;
  stationId: string;
  stationKm: string;
  division: string;
  section: string;
  sectionSpeedKmph: string;
  versionControl: string; // X.Y.Z per Cl. I.2.9
  sipRef: string;
  tocRef: string;
  rfidLayoutRef: string;
  tsrmsRef: string;
  adjacentKavachRef: string;
  gradientPlanRef: string;
  drawingNo: string;
  tableDocNo: string;
  // Global control parameters below Table 2 (Cl. I.2.11.19 & I.2.11.20)
  signalsOverrideNotRequiredAtZeroSpeed: string;
  authorizedSpeedOnDetectionInOs: string;
  // Approval / Signature block (Cl. I.2.13)
  preparedBy: string;
  checkedBy: string;
  railwayHqApprover1: string;
  railwayHqApprover2: string;
  railwayHqApprover3: string;
  rdsoApprover1: string;
  rdsoApprover2: string;
  rdsoApprover3: string;
  finalApprover: string;
  // Customizable Titles / Labels for Approval and Header Blocks (apply across all sheets)
  titlePreparedBy?: string;
  titleCheckedBy?: string;
  titleApprovedBy?: string;
  titleSignalTelecom?: string;
  titleKavach?: string;
  titleRailwayHq1?: string;
  titleRailwayHq2?: string;
  titleRailwayHq3?: string;
  titleRdsoApprover1?: string;
  titleRdsoApprover2?: string;
  titleRdsoApprover3?: string;
  revisions: RevisionEntry[];
}

export interface ValidationIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  tableId: KavachTableId | 'metadata';
  rowId?: string;
  columnKey?: string;
  clauseRef: string;
  ruleName: string;
  message: string;
  suggestedValue?: string;
}

export interface SpecColumnDefinition {
  key: string;
  label: string;
  group?: string;
  dataType: 'string' | 'number' | 'enum' | 'tuple_list' | 'distance';
  mandatory: boolean;
  clauseRef: string;
  description: string;
  sourceDoc: 'RFID_LAYOUT' | 'SIP_TOC' | 'ADJACENT_KAVACH' | 'GRADIENT_PLAN' | 'OHE_LAYOUT' | 'CALCULATED';
  extractionRule: string;
  widthPx?: number;
  align?: 'left' | 'center' | 'right';
  enumValues?: string[];
}

export interface SpecTableDefinition {
  id: KavachTableId;
  tableNumber: string;
  title: string;
  shortTitle: string;
  clauseRef: string;
  purpose: string;
  columns: SpecColumnDefinition[];
}

export interface ExtractionSettings {
  defaultSectionSpeedKmph: number;
  singleTurnoutSpeedKmph: number;
  multiTurnoutSpeedKmph: number;
  stationEntryTurnoutBufferM: number; // +30m per Cl. I.2.12.1(iii)
  stationExitTurnoutBufferM: number; // +10m per Cl. I.2.12.1(iii)
  maxAverageGradientsPerRoute: number; // 31 per Cl. I.2.12.3(b)(v)
  distanceToleranceMeters: number;
  includeTslTables: boolean;
  flagMissingCompanionData: boolean;
  strictRdsoValidation: boolean;
}

export interface ExtractionProgressStage {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  detail?: string;
}

export interface WorkspaceProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastSavedAt?: string;
  isSavedForPreview: boolean;
  drawings: UploadedDrawing[];
  activeDrawingId: string | null;
  activePageNumber: number;
  extractionStatus: 'idle' | 'running' | 'completed' | 'error';
  extractionError?: string;
  extractionSummary?: string;
  extractedAt?: string;
  components: ExtractedComponent[];
  relationships: ComponentRelationship[];
  metadata: DocumentMetadata;
  tables: Record<KavachTableId, TableRowRecord[]>;
  selectedTables?: KavachTableId[];
  validationIssues: ValidationIssue[];
  settings: ExtractionSettings;
}

export interface SavedProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  stationName: string;
  stationId: string;
  drawingCount: number;
  totalRows?: number;
  componentsCount?: number;
  isSavedForPreview: boolean;
}
