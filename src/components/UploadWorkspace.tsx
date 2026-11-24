import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileCode2,
  FileText,
  Trash2,
  Upload,
} from 'lucide-react';
import type { UploadedDrawing } from '../types/project';
import { fetchJsonWithRetry } from '../utils/http';

interface UploadWorkspaceProps {
  drawings: UploadedDrawing[];
  activeDrawingId: string | null;
  onDrawingUploaded: (drawing: UploadedDrawing, sourceFile?: File) => void;
  onSelectDrawing: (drawingId: string, openViewer?: boolean) => void;
  onDeleteDrawing: (drawingId: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function UploadWorkspace({
  drawings,
  activeDrawingId,
  onDrawingUploaded,
  onSelectDrawing,
  onDeleteDrawing,
}: UploadWorkspaceProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatusText, setUploadStatusText] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setErrorMsg(null);
    setUploading(true);
    setUploadStatusText('Validating & Parsing Drawing Borders & Geometry...');

    try {
      for (const file of Array.from(fileList)) {
        const role = drawings.length === 0 ? 'primary_layout' : 'other';
        setUploadStatusText(`Uploading & decoding ${file.name}...`);

        const data = await fetchJsonWithRetry<{ drawing: UploadedDrawing }>(
          '/api/drawings/upload',
          () => {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('role', role);
            return {
              method: 'POST',
              body: formData,
            };
          },
          {
            fallbackError: `Upload failed for ${file.name}`,
            maxRetries: 3,
            onStatus: (msg) => setUploadStatusText(msg),
          }
        );
        onDrawingUploaded(data.drawing, file);
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setUploading(false);
      setUploadStatusText('');
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Upload Railway Station Drawings</h1>
          <p className="text-sm text-slate-600 mt-1">
            Upload railway station layout drawings in DWG, DXF, or PDF format. Files are validated, border-fitted for clean inspection, and analyzed dynamically on demand.
          </p>
        </div>
      </div>

      {/* Dropzone */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${isDragging
            ? 'border-blue-600 bg-blue-50/50'
            : 'border-slate-300 hover:border-slate-400 bg-slate-50/60'
            }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".dwg,.dxf,.pdf"
            multiple
            onChange={(e) => handleFiles(e.target.files)}
            className="hidden"
          />
          <Upload className="w-8 h-8 text-slate-500 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-900">
            {uploading
              ? uploadStatusText || 'Validating & Parsing Drawing Borders & Geometry...'
              : 'Drop DWG, DXF, or PDF drawings here, or click to browse'}
          </p>
          <p className="text-xs text-slate-500 mt-1.5">
            Supports AutoCAD DWG (R13–R2018+ with DXF recovery bridge), ASCII DXF (layers, blocks, dimensions, text), and multi-page vector PDF up to 100 MB.
          </p>
        </div>

        {errorMsg && (
          <div className="p-3.5 bg-red-50 border border-red-200 rounded-md flex items-start gap-2.5 text-xs text-red-800">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      {/* Uploaded Files List */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Uploaded Drawings ({drawings.length})
          </h2>
          <span className="text-xs text-slate-500">
            Inspect any drawing in Drawing Viewer before starting extraction · Select target tables in Edit &amp; Preview
          </span>
        </div>

        {drawings.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No drawings uploaded yet. Upload a station layout above to validate its format, borders, layers, and pages.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {drawings.map((drw) => {
              const isActive = drw.id === activeDrawingId;
              return (
                <div
                  key={drw.id}
                  className={`p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${isActive ? 'bg-blue-50/40' : 'hover:bg-slate-50/60'
                    }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="p-2 bg-slate-100 rounded-md text-slate-700 shrink-0 mt-0.5">
                      {drw.format === 'PDF' ? (
                        <FileText className="w-5 h-5" />
                      ) : (
                        <FileCode2 className="w-5 h-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-900 truncate">
                          {drw.fileName}
                        </span>
                        {isActive && (
                          <span className="text-xs font-medium text-blue-700">· Active in Viewer</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums mt-0.5 flex-wrap">
                        <span>{drw.format}</span>
                        <span>·</span>
                        <span>{formatBytes(drw.sizeBytes)}</span>
                        <span>·</span>
                        <span>
                          {drw.format === 'PDF'
                            ? `${drw.pageCount} page${drw.pageCount > 1 ? 's' : ''}`
                            : `${drw.cadData?.totalEntityCount.toLocaleString() ?? 'CAD'} entities / ${drw.cadData?.layers.length ?? 0} layers`}
                        </span>
                        <span>·</span>
                        <span
                          className={
                            drw.validationStatus === 'valid'
                              ? 'text-emerald-700 font-sans font-medium flex items-center gap-1'
                              : 'text-amber-700 font-sans font-medium flex items-center gap-1'
                          }
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {drw.validationStatus === 'valid' ? 'Validated' : 'Needs Review'}
                        </span>
                      </div>
                      {drw.validationNotes.length > 0 && (
                        <p className="text-xs text-slate-600 mt-1">{drw.validationNotes.join(' ')}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <button
                      type="button"
                      onClick={() => onSelectDrawing(drw.id, true)}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Inspect Drawing
                    </button>

                    <button
                      type="button"
                      onClick={() => setPendingDeleteId(drw.id)}
                      className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-md"
                      title="Remove drawing"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirmation Dialog for Destructive Removal */}
      {pendingDeleteId && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-5 shadow-lg">
            <h3 className="text-sm font-bold text-slate-900">Remove Uploaded Drawing?</h3>
            <p className="text-xs text-slate-600 mt-1.5">
              This removes the drawing from the current workspace. Previously extracted tables will remain editable until you run a new extraction.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setPendingDeleteId(null)}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteDrawing(pendingDeleteId);
                  setPendingDeleteId(null);
                }}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md"
              >
                Remove Drawing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
