import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Eye,
  EyeOff,
  FileWarning,
  Layers,
  Maximize2,
  Moon,
  Play,
  RotateCcw,
  RotateCw,
  Sun,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { CadDocumentData, CadEntity, UploadedDrawing } from '../types/project';
import { fetchJsonWithRetry } from '../utils/http';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MIN_ZOOM = 0.25; // 25%
const MAX_ZOOM = 55; // 5500%

interface CropRect {
  pageWidth: number;
  pageHeight: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  trimmedRatio: number;
}

interface DrawingViewerProps {
  drawing: UploadedDrawing | null;
  pageNumber: number;
  onPageNumberChange: (page: number) => void;
  onStartExtraction: () => void;
  extractionRunning: boolean;
  onHydrateCadData?: (drawingId: string, cadData: CadDocumentData) => void;
  onNavigateUpload: () => void;
}

function clampZoom(val: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(val * 1000) / 1000));
}

export function DrawingViewer({
  drawing,
  pageNumber,
  onPageNumberChange,
  onStartExtraction,
  extractionRunning,
  onHydrateCadData,
  onNavigateUpload,
}: DrawingViewerProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    // Viewport pan/zoom state (zoom = 1 means 100% Fit-to-Screen of tight drawing borders)
    const [zoom, setZoom] = useState<number>(1);
    const [zoomInput, setZoomInput] = useState<string>('100');
    const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({ w: 1000, h: 620 });
    const [rotation, setRotation] = useState<number>(0);

    const panStartRef = useRef<{ mx: number; my: number; px: number; py: number }>({
      mx: 0,
      my: 0,
      px: 0,
      py: 0,
    });

    // Track last crisp PDF render transform so interactive drag/wheel has zero lag via GPU CSS delta
    const [renderedView, setRenderedView] = useState<{ zoom: number; panX: number; panY: number }>({
      zoom: 1,
      panX: 0,
      panY: 0,
    });

    // PDF state
    const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
    const [pdfNumPages, setPdfNumPages] = useState<number>(1);
    const [pdfLoading, setPdfLoading] = useState<boolean>(false);
    const [pdfError, setPdfError] = useState<string | null>(null);
    const [pdfCropBox, setPdfCropBox] = useState<CropRect | null>(null);
    const renderTaskRef = useRef<any>(null);
    const renderDebounceRef = useRef<number | null>(null);

    // CAD state
    const [cadLoading, setCadLoading] = useState(false);
    const [cadDarkBg, setCadDarkBg] = useState(true);
    const [showLayersPanel, setShowLayersPanel] = useState(false);
    const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
    const [cursorWorldCoord, setCursorWorldCoord] = useState<{ x: number; y: number } | null>(null);
    const [hoveredEntity, setHoveredEntity] = useState<CadEntity | null>(null);
    const cadTransformRef = useRef<{ scale: number; offsetX: number; offsetY: number; minX: number; maxY: number } | null>(
      null
    );

    useEffect(() => {
      setZoomInput(String(Math.round(zoom * 100)));
    }, [zoom]);

    const resetView = useCallback(() => {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }, []);

    // Keep viewport dimensions synced smoothly with ResizeObserver
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const updateSize = () => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 50) {
          setViewportSize({ w: Math.floor(rect.width), h: Math.floor(rect.height) });
        }
      };
      updateSize();
      const obs = new ResizeObserver(updateSize);
      obs.observe(el);
      return () => obs.disconnect();
    }, [drawing?.id]);

    // Hydrate CAD data from backend if missing (e.g. after reloading saved workspace)
    useEffect(() => {
      if (!drawing || drawing.format === 'PDF') {
        setCadLoading(false);
        return;
      }
      if (drawing.cadData) {
        setCadLoading(false);
        setHiddenLayers(
          new Set(drawing.cadData.layers.filter((l) => !l.visible).map((l) => l.name))
        );
        return;
      }
      let cancelled = false;
      setCadLoading(true);
      fetchJsonWithRetry<{ cadData?: CadDocumentData }>(
        `/api/drawings/${drawing.id}/cad`,
        () => ({ method: 'GET' }),
        { maxRetries: 2 }
      )
        .then((data) => {
          if (!cancelled && data.cadData && onHydrateCadData) {
            onHydrateCadData(drawing.id, data.cadData);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setCadLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [drawing, onHydrateCadData]);

    // Load PDF document whenever active PDF drawing changes
    useEffect(() => {
      if (!drawing || drawing.format !== 'PDF') {
        pdfDocRef.current = null;
        setPdfCropBox(null);
        setPdfLoading(false);
        setPdfError(null);
        return;
      }
      let cancelled = false;
      setPdfLoading(true);
      setPdfError(null);
      resetView();

      const loadingTask = pdfjsLib.getDocument({ url: drawing.fileUrl });
      loadingTask.promise
        .then((pdf) => {
          if (cancelled) return;
          pdfDocRef.current = pdf;
          setPdfNumPages(pdf.numPages);
          if (pageNumber > pdf.numPages) {
            onPageNumberChange(1);
          }
          setPdfLoading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          setPdfError(`Failed to load PDF document: ${err?.message || 'Unknown error'}`);
          setPdfLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }, [drawing?.id, drawing?.fileUrl, drawing?.format]);

    // Fetch exact tight drawing-border bounding box for the current PDF page (eliminates excess blank margins)
    useEffect(() => {
      if (!drawing || drawing.format !== 'PDF') return;
      let cancelled = false;

      // Instant hit if Page 1 bounds were already computed during upload
      const precomputed = drawing.pdfMetadata?.contentBounds;
      if (precomputed && precomputed.pageNumber === pageNumber) {
        setPdfCropBox({
          pageWidth: precomputed.pageWidth,
          pageHeight: precomputed.pageHeight,
          cropX: precomputed.cropX,
          cropY: precomputed.cropY,
          cropWidth: precomputed.cropWidth,
          cropHeight: precomputed.cropHeight,
          trimmedRatio: precomputed.trimmedRatio,
        });
        resetView();
        return;
      }

      const loadBounds = async () => {
        try {
          const data = await fetchJsonWithRetry<{ bounds?: CropRect }>(
            `/api/drawings/${drawing.id}/pdf-bounds?page=${pageNumber}`,
            () => ({ method: 'GET' }),
            { maxRetries: 2 }
          );
          if (!cancelled && data.bounds) {
            setPdfCropBox({
              pageWidth: data.bounds.pageWidth,
              pageHeight: data.bounds.pageHeight,
              cropX: data.bounds.cropX,
              cropY: data.bounds.cropY,
              cropWidth: data.bounds.cropWidth,
              cropHeight: data.bounds.cropHeight,
              trimmedRatio: data.bounds.trimmedRatio,
            });
            resetView();
            return;
          }
        } catch {
          // Fall back to client-side pixel scan below
        }

        // Client-side border scan fallback if server bounds endpoint unavailable
        if (pdfDocRef.current && !cancelled) {
          try {
            const safePage = Math.max(1, Math.min(pageNumber, pdfDocRef.current.numPages));
            const page = await pdfDocRef.current.getPage(safePage);
            const baseVp = page.getViewport({ scale: 1 });
            const scanScale = Math.min(1, 900 / Math.max(baseVp.width, baseVp.height));
            const scanVp = page.getViewport({ scale: scanScale });
            const off = document.createElement('canvas');
            off.width = Math.max(1, Math.floor(scanVp.width));
            off.height = Math.max(1, Math.floor(scanVp.height));
            const octx = off.getContext('2d');
            if (octx) {
              octx.fillStyle = '#ffffff';
              octx.fillRect(0, 0, off.width, off.height);
              await page.render({ canvasContext: octx, viewport: scanVp, canvas: off }).promise;
              const imgData = octx.getImageData(0, 0, off.width, off.height).data;
              let minX = off.width;
              let minY = off.height;
              let maxX = 0;
              let maxY = 0;
              for (let y = 0; y < off.height; y++) {
                for (let x = 0; x < off.width; x++) {
                  const idx = (y * off.width + x) * 4;
                  if (imgData[idx] < 245 || imgData[idx + 1] < 245 || imgData[idx + 2] < 245) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                  }
                }
              }
              if (!cancelled && maxX > minX + 4 && maxY > minY + 4) {
                const pad = 4;
                const cx = Math.max(0, minX / scanScale - pad);
                const cy = Math.max(0, minY / scanScale - pad);
                const cw = Math.min(baseVp.width - cx, (maxX - minX) / scanScale + pad * 2);
                const ch = Math.min(baseVp.height - cy, (maxY - minY) / scanScale + pad * 2);
                setPdfCropBox({
                  pageWidth: baseVp.width,
                  pageHeight: baseVp.height,
                  cropX: cx,
                  cropY: cy,
                  cropWidth: cw,
                  cropHeight: ch,
                  trimmedRatio: Math.max(0, 1 - (cw * ch) / (baseVp.width * baseVp.height)),
                });
                resetView();
                return;
              }
            }
            if (!cancelled) {
              setPdfCropBox({
                pageWidth: baseVp.width,
                pageHeight: baseVp.height,
                cropX: 0,
                cropY: 0,
                cropWidth: baseVp.width,
                cropHeight: baseVp.height,
                trimmedRatio: 0,
              });
            }
          } catch {
            // ignore fallback error
          }
        }
      };

      loadBounds();
      return () => {
        cancelled = true;
      };
    }, [drawing?.id, drawing?.format, drawing?.pdfMetadata?.contentBounds, pageNumber, pdfLoading, resetView]);

    // Viewport-clipped vector PDF rendering — stays razor-sharp from 25% all the way to 5500% zoom
    // without EVER exceeding HTML5 Canvas max dimensions, displaying strictly inside drawing borders!
    useEffect(() => {
      if (!drawing || drawing.format !== 'PDF' || !pdfDocRef.current || !canvasRef.current || pdfLoading) {
        return;
      }

      let cancelled = false;
      const runRender = async () => {
        try {
          const pdf = pdfDocRef.current!;
          const safePage = Math.max(1, Math.min(pageNumber, pdf.numPages));
          const page = await pdf.getPage(safePage);
          if (cancelled) return;

          const baseVp = page.getViewport({ scale: 1, rotation });
          const isRot90or270 = rotation === 90 || rotation === 270;
          const origBox: CropRect = pdfCropBox || {
            pageWidth: page.getViewport({ scale: 1, rotation: 0 }).width,
            pageHeight: page.getViewport({ scale: 1, rotation: 0 }).height,
            cropX: 0,
            cropY: 0,
            cropWidth: page.getViewport({ scale: 1, rotation: 0 }).width,
            cropHeight: page.getViewport({ scale: 1, rotation: 0 }).height,
            trimmedRatio: 0,
          };

          const effectiveW = isRot90or270 ? origBox.cropHeight : origBox.cropWidth;
          const effectiveH = isRot90or270 ? origBox.cropWidth : origBox.cropHeight;

          const viewW = Math.max(320, viewportSize.w);
          const viewH = Math.max(280, viewportSize.h);
          const pad = 20;
          const fitScale = Math.min(
            (viewW - pad * 2) / Math.max(1, effectiveW),
            (viewH - pad * 2) / Math.max(1, effectiveH)
          );

          const screenScale = fitScale * zoom;
          const drawnW = effectiveW * screenScale;
          const drawnH = effectiveH * screenScale;
          const drawOriginX = (viewW - drawnW) / 2 + pan.x;
          const drawOriginY = (viewH - drawnH) / 2 + pan.y;

          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const canvas = canvasRef.current!;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          if (renderTaskRef.current) {
            try {
              renderTaskRef.current.cancel();
            } catch {
              // ignore cancel error
            }
          }

          canvas.width = Math.floor(viewW * dpr);
          canvas.height = Math.floor(viewH * dpr);
          canvas.style.width = `${viewW}px`;
          canvas.style.height = `${viewH}px`;

          // Clean drafting backdrop outside the cropped drawing border
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Draw crisp white sheet strictly within the detected drawing borders
          const sheetX = drawOriginX * dpr;
          const sheetY = drawOriginY * dpr;
          const sheetW = drawnW * dpr;
          const sheetH = drawnH * dpr;

          ctx.save();
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(sheetX, sheetY, sheetW, sheetH);

          // Clip strictly to the drawing border rectangle so zero excess outer sheet data leaks
          ctx.beginPath();
          ctx.rect(sheetX, sheetY, sheetW, sheetH);
          ctx.clip();

          // Exact PDF.js viewport mapping cropped PDF region onto visible canvas pixels at native DPI
          let rotCropX = origBox.cropX;
          let rotCropY = origBox.cropY;
          if (rotation === 90) {
            rotCropX = origBox.cropY;
            rotCropY = origBox.pageWidth - (origBox.cropX + origBox.cropWidth);
          } else if (rotation === 180) {
            rotCropX = origBox.pageWidth - (origBox.cropX + origBox.cropWidth);
            rotCropY = origBox.pageHeight - (origBox.cropY + origBox.cropHeight);
          } else if (rotation === 270) {
            rotCropX = origBox.pageHeight - (origBox.cropY + origBox.cropHeight);
            rotCropY = origBox.cropX;
          }

          const renderScale = screenScale * dpr;
          const offsetX = (drawOriginX - rotCropX * screenScale) * dpr;
          const offsetY = (drawOriginY - rotCropY * screenScale) * dpr;
          const viewport = page.getViewport({
            scale: renderScale,
            rotation,
            offsetX,
            offsetY,
          });

          const task = page.render({ canvasContext: ctx, viewport, canvas });
          renderTaskRef.current = task;
          await task.promise;
          ctx.restore();

          // Subtle crisp outer border line around the cropped drawing frame
          if (!cancelled) {
            ctx.save();
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = Math.max(1, dpr);
            ctx.strokeRect(sheetX, sheetY, sheetW, sheetH);
            ctx.restore();
            setRenderedView({ zoom, panX: pan.x, panY: pan.y });
          }
        } catch (err: any) {
          if (err?.name !== 'RenderingCancelledException' && !cancelled) {
            setPdfError(`Page render error: ${err?.message || 'Unable to render page'}`);
          }
        }
      };

      // Render immediately on initial load / fit, and gently debounce during rapid pan/wheel bursts
      if (renderDebounceRef.current) {
        window.clearTimeout(renderDebounceRef.current);
      }
      const delay = isPanning ? 110 : 40;
      renderDebounceRef.current = window.setTimeout(runRender, delay);

      return () => {
        cancelled = true;
        if (renderDebounceRef.current) {
          window.clearTimeout(renderDebounceRef.current);
        }
      };
    }, [drawing, pageNumber, zoom, pan, viewportSize, pdfCropBox, pdfLoading, isPanning, rotation]);

    // Render DWG / DXF CAD entities onto high-DPI HTML5 Canvas with exact aspect ratio & layers up to 5500%
    const renderCadCanvas = useCallback(
      (
        targetCanvas: HTMLCanvasElement,
        widthCss: number,
        heightCss: number,
        overrideZoom?: number,
        overridePan?: { x: number; y: number },
        forceLightBg?: boolean
      ) => {
        if (!drawing?.cadData) return;
        const cad = drawing.cadData;
        const ctx = targetCanvas.getContext('2d');
        if (!ctx) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        targetCanvas.width = Math.floor(widthCss * dpr);
        targetCanvas.height = Math.floor(heightCss * dpr);
        targetCanvas.style.width = `${widthCss}px`;
        targetCanvas.style.height = `${heightCss}px`;

        const isDark = forceLightBg ? false : cadDarkBg;
        ctx.save();
        ctx.scale(dpr, dpr);
        if (rotation !== 0) {
          ctx.translate(widthCss / 2, heightCss / 2);
          ctx.rotate((rotation * Math.PI) / 180);
          ctx.translate(-widthCss / 2, -heightCss / 2);
        }
        ctx.fillStyle = isDark ? '#0B1220' : '#FFFFFF';
        ctx.fillRect(0, 0, widthCss, heightCss);

        // Subtle engineering grid in CAD mode
        ctx.strokeStyle = isDark ? 'rgba(148, 163, 184, 0.06)' : 'rgba(15, 23, 42, 0.04)';
        ctx.lineWidth = 1;
        const gridStep = 40;
        for (let gx = 0; gx < widthCss; gx += gridStep) {
          ctx.beginPath();
          ctx.moveTo(gx, 0);
          ctx.lineTo(gx, heightCss);
          ctx.stroke();
        }
        for (let gy = 0; gy < heightCss; gy += gridStep) {
          ctx.beginPath();
          ctx.moveTo(0, gy);
          ctx.lineTo(widthCss, gy);
          ctx.stroke();
        }

        const pad = 20;
        const b = cad.bounds;
        const fitScale = Math.min(
          (widthCss - pad * 2) / Math.max(1e-6, b.width),
          (heightCss - pad * 2) / Math.max(1e-6, b.height)
        );
        const activeZoom = overrideZoom ?? zoom;
        const activePan = overridePan ?? pan;
        const scale = fitScale * activeZoom;

        const drawnW = b.width * scale;
        const drawnH = b.height * scale;
        const offsetX = (widthCss - drawnW) / 2 + activePan.x;
        const offsetY = (heightCss - drawnH) / 2 + activePan.y;

        if (overrideZoom === undefined) {
          cadTransformRef.current = { scale, offsetX, offsetY, minX: b.minX, maxY: b.maxY };
        }

        const toScreen = (x: number, y: number) => ({
          sx: (x - b.minX) * scale + offsetX,
          sy: (b.maxY - y) * scale + offsetY,
        });

        const adaptColor = (hex: string): string => {
          const lc = hex.toLowerCase();
          if (!isDark && (lc === '#e2e8f0' || lc === '#ffffff' || lc === '#f8fafc' || lc === '#cbd5e1')) {
            return '#0f172a';
          }
          if (isDark && (lc === '#000000' || lc === '#0f172a')) {
            return '#e2e8f0';
          }
          return hex;
        };

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // 4-Pass AutoCAD Draw Order:
        // Pass 1: HATCH fills (TIN color bands, background fills)
        // Pass 2: SOLID fills (arrows, markers, filled symbols)
        // Pass 3: Vector geometry (tracks, signals, blocks, polylines, arcs)
        // Pass 4: Annotations (TEXT, MTEXT, ATTRIB, DIMENSION) cleanly on top
        const hatchEntities: CadEntity[] = [];
        const solidEntities: CadEntity[] = [];
        const strokeEntities: CadEntity[] = [];
        const textEntities: CadEntity[] = [];

        for (const entity of cad.entities) {
          if (hiddenLayers.has(entity.layer)) continue;
          if (entity.type === 'HATCH') hatchEntities.push(entity);
          else if (entity.type === 'SOLID') solidEntities.push(entity);
          else if (entity.type === 'TEXT' || entity.type === 'MTEXT' || entity.type === 'DIMENSION') {
            textEntities.push(entity);
          } else {
            strokeEntities.push(entity);
          }
        }

        // Pass 1: HATCH
        for (const entity of hatchEntities) {
          const loops = entity.paths && entity.paths.length > 0
            ? entity.paths
            : entity.points && entity.points.length >= 3
              ? [entity.points]
              : [];
          if (loops.length === 0) continue;

          const fillCol = adaptColor(entity.color);
          ctx.beginPath();
          for (const loop of loops) {
            if (loop.length < 3) continue;
            const p0 = toScreen(loop[0].x, loop[0].y);
            ctx.moveTo(p0.sx, p0.sy);
            for (let i = 1; i < loop.length; i++) {
              const pi = toScreen(loop[i].x, loop[i].y);
              ctx.lineTo(pi.sx, pi.sy);
            }
            ctx.closePath();
          }
          ctx.fillStyle = fillCol;
          ctx.globalAlpha = entity.solidFill === false ? 0.25 : isDark ? 0.55 : 0.48;
          ctx.fill('evenodd');
          ctx.globalAlpha = 1;
        }

        // Pass 2: SOLID
        for (const entity of solidEntities) {
          const pts = entity.points;
          if (!pts || pts.length < 3) continue;
          const col = adaptColor(entity.color);
          ctx.beginPath();
          const p0 = toScreen(pts[0].x, pts[0].y);
          ctx.moveTo(p0.sx, p0.sy);
          for (let i = 1; i < pts.length; i++) {
            const pi = toScreen(pts[i].x, pts[i].y);
            ctx.lineTo(pi.sx, pi.sy);
          }
          ctx.closePath();
          ctx.fillStyle = col;
          ctx.strokeStyle = col;
          ctx.globalAlpha = 0.85;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }

        // Pass 3: Vector Strokes
        for (const entity of strokeEntities) {
          const stroke = adaptColor(entity.color);
          ctx.strokeStyle = stroke;
          ctx.fillStyle = stroke;
          ctx.lineWidth = Math.max(0.8, Math.min(2.0, 1.15));

          switch (entity.type) {
            case 'LINE':
            case 'LWPOLYLINE':
            case 'POLYLINE':
            case 'SPLINE': {
              const pts = entity.points;
              if (!pts || pts.length < 2) break;
              ctx.beginPath();
              const p0 = toScreen(pts[0].x, pts[0].y);
              ctx.moveTo(p0.sx, p0.sy);
              for (let i = 1; i < pts.length; i++) {
                const pi = toScreen(pts[i].x, pts[i].y);
                ctx.lineTo(pi.sx, pi.sy);
              }
              if (entity.closed) ctx.closePath();
              ctx.stroke();
              break;
            }
            case 'CIRCLE': {
              if (!entity.center || !entity.radius) break;
              const c = toScreen(entity.center.x, entity.center.y);
              const r = Math.max(1.2, entity.radius * scale);
              ctx.beginPath();
              ctx.arc(c.sx, c.sy, r, 0, Math.PI * 2);
              ctx.stroke();
              break;
            }
            case 'ARC': {
              if (!entity.center || !entity.radius) break;
              const c = toScreen(entity.center.x, entity.center.y);
              const r = Math.max(1.2, entity.radius * scale);
              const startA = -(entity.startAngle ?? 0);
              const endA = -(entity.endAngle ?? Math.PI * 2);
              ctx.beginPath();
              ctx.arc(c.sx, c.sy, r, startA, endA, true);
              ctx.stroke();
              break;
            }
            case 'ELLIPSE': {
              if (!entity.center || !entity.majorAxis) break;
              const c = toScreen(entity.center.x, entity.center.y);
              const rx = Math.max(1.2, Math.hypot(entity.majorAxis.x, entity.majorAxis.y) * scale);
              const ry = Math.max(1.2, rx * (entity.axisRatio ?? 1));
              const rot = -Math.atan2(entity.majorAxis.y, entity.majorAxis.x);
              ctx.beginPath();
              ctx.ellipse(c.sx, c.sy, rx, ry, rot, 0, Math.PI * 2);
              ctx.stroke();
              break;
            }
            case 'POINT': {
              if (!entity.center) break;
              const c = toScreen(entity.center.x, entity.center.y);
              ctx.beginPath();
              ctx.arc(c.sx, c.sy, 1.8, 0, Math.PI * 2);
              ctx.fill();
              break;
            }
          }
        }

        // Pass 4: Crisp Annotations (TEXT, MTEXT, ATTRIB, DIMENSION)
        for (const entity of textEntities) {
          if (!entity.center || !entity.text) continue;
          const rawPx = (entity.height || 2.5) * scale * 1.12;
          if (rawPx < 2.4) continue;
          const pxHeight = Math.min(72, Math.max(3.5, rawPx));
          const c = toScreen(entity.center.x, entity.center.y);
          // Skip off-screen text for speed at 5500% zoom
          if (c.sx < -400 || c.sx > widthCss + 400 || c.sy < -200 || c.sy > heightCss + 200) continue;

          const stroke = adaptColor(entity.color);
          ctx.save();
          ctx.translate(c.sx, c.sy);
          if (entity.rotation) ctx.rotate(-entity.rotation);
          ctx.font = `500 ${pxHeight.toFixed(1)}px "JetBrains Mono", monospace`;
          ctx.fillStyle = stroke;
          ctx.textAlign = entity.textAlign || 'left';
          const baseline = entity.textBaseline || 'alphabetic';
          ctx.textBaseline = baseline;

          const lines = entity.text.split('\n');
          const lineStep = pxHeight * 1.2;
          const startY =
            baseline === 'middle'
              ? -((lines.length - 1) * lineStep) / 2
              : baseline === 'bottom'
                ? -(lines.length - 1) * lineStep
                : 0;

          for (let idx = 0; idx < lines.length; idx++) {
            ctx.fillText(lines[idx], 0, startY + idx * lineStep);
          }
          ctx.restore();
        }

        ctx.restore();
      },
      [drawing, zoom, pan, cadDarkBg, hiddenLayers]
    );

    useEffect(() => {
      if (!drawing || drawing.format === 'PDF' || !drawing.cadData || !canvasRef.current) {
        return;
      }
      renderCadCanvas(canvasRef.current, Math.max(400, viewportSize.w), Math.max(360, viewportSize.h));
    }, [drawing, zoom, pan, cadDarkBg, hiddenLayers, viewportSize, renderCadCanvas]);

    // Zoom helper anchored at a specific screen point (cx, cy) inside the viewer container
    const zoomAtPoint = useCallback(
      (nextZoomRaw: number, clientX?: number, clientY?: number) => {
        const nextZoom = clampZoom(nextZoomRaw);
        const container = containerRef.current;
        if (!container || clientX === undefined || clientY === undefined) {
          const ratio = nextZoom / zoom;
          setPan((p) => ({ x: p.x * ratio, y: p.y * ratio }));
          setZoom(nextZoom);
          return;
        }
        const rect = container.getBoundingClientRect();
        const cx = clientX - rect.left - rect.width / 2;
        const cy = clientY - rect.top - rect.height / 2;
        const ratio = nextZoom / zoom;
        setPan((p) => ({
          x: cx - (cx - p.x) * ratio,
          y: cy - (cy - p.y) * ratio,
        }));
        setZoom(nextZoom);
      },
      [zoom]
    );

    const handleWheel = (e: React.WheelEvent) => {
      e.preventDefault();
      const step = e.deltaY < 0 ? 1.22 : 1 / 1.22;
      zoomAtPoint(zoom * step, e.clientX, e.clientY);
    };

    const handleMouseDown = (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      setIsPanning(true);
      panStartRef.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
    };

    const handleMouseMove = (e: React.MouseEvent) => {
      if (isPanning) {
        setPan({
          x: panStartRef.current.px + (e.clientX - panStartRef.current.mx),
          y: panStartRef.current.py + (e.clientY - panStartRef.current.my),
        });
      }

      if (drawing?.cadData && cadTransformRef.current && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const t = cadTransformRef.current;
        const wx = (sx - t.offsetX) / t.scale + t.minX;
        const wy = t.maxY - (sy - t.offsetY) / t.scale;
        setCursorWorldCoord({ x: wx, y: wy });

        const tol = 14 / t.scale;
        let found: CadEntity | null = null;
        for (const ent of drawing.cadData.entities) {
          if (hiddenLayers.has(ent.layer)) continue;
          if (ent.center && ent.text) {
            if (Math.hypot(ent.center.x - wx, ent.center.y - wy) < tol) {
              found = ent;
              break;
            }
          }
        }
        setHoveredEntity(found);
      }
    };

    const handleMouseUp = () => setIsPanning(false);

    const toggleLayer = (layerName: string) => {
      setHiddenLayers((prev) => {
        const next = new Set(prev);
        if (next.has(layerName)) next.delete(layerName);
        else next.add(layerName);
        return next;
      });
    };

    const commitZoomInput = () => {
      const parsed = Number.parseFloat(zoomInput);
      if (Number.isFinite(parsed)) {
        const clampedPct = Math.max(MIN_ZOOM * 100, Math.min(MAX_ZOOM * 100, parsed));
        zoomAtPoint(clampedPct / 100);
        setZoomInput(String(Math.round(clampedPct)));
      } else {
        setZoomInput(String(Math.round(zoom * 100)));
      }
    };

    if (!drawing) {
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[520px] bg-white border border-slate-200 rounded-lg p-10 text-center">
          <FileWarning className="w-10 h-10 text-slate-400 mb-3" />
          <h2 className="text-lg font-semibold text-slate-900">No Railway Layout Drawing Loaded</h2>
          {/* <p className="text-sm text-slate-600 max-w-md mt-1.5">
            Upload a railway station layout in DWG, DXF, or PDF format to inspect every layer, track, signal, and RFID tag at full border-fitted precision up to 5500% zoom.
          </p> */}
          <button
            type="button"
            onClick={onNavigateUpload}
            className="mt-5 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors whitespace-nowrap"
          >
            Upload Drawing
          </button>
        </div>
      );
    }

    const isCad = drawing.format === 'DXF' || drawing.format === 'DWG';

    // Smooth GPU delta transform for PDF while debounced crisp vector re-render settles
    const pdfScaleDelta = renderedView.zoom > 0 ? zoom / renderedView.zoom : 1;
    const pdfDx = pan.x - renderedView.panX * pdfScaleDelta;
    const pdfDy = pan.y - renderedView.panY * pdfScaleDelta;
    const hasPendingPdfTransform =
      drawing.format === 'PDF' &&
      (Math.abs(pdfScaleDelta - 1) > 0.001 || Math.abs(pdfDx) > 0.5 || Math.abs(pdfDy) > 0.5);

    return (
      <div className="flex flex-col h-[calc(100vh-116px)] min-h-[560px] bg-white border border-slate-200 rounded-lg overflow-hidden">
        {/* Precision Viewer Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-sm font-semibold text-slate-900 truncate max-w-[230px]" title={drawing.fileName}>
              {drawing.fileName}
            </span>
            <span className="text-xs text-slate-500 font-mono tabular-nums whitespace-nowrap">
              {drawing.format}
              {isCad && drawing.cadData
                ? ` · ${drawing.cadData.totalEntityCount.toLocaleString()} entities · ${drawing.cadData.layers.length} layers`
                : pdfCropBox
                  ? ` · Border ${Math.round(pdfCropBox.cropWidth)}×${Math.round(pdfCropBox.cropHeight)} pt`
                  : ''}
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Multi-page PDF controls */}
            {drawing.format === 'PDF' && (
              <div className="flex items-center gap-1 pr-2 mr-1 border-r border-slate-200">
                <button
                  type="button"
                  disabled={pageNumber <= 1}
                  onClick={() => onPageNumberChange(Math.max(1, pageNumber - 1))}
                  className="p-1.5 rounded text-slate-700 hover:bg-slate-200/70 disabled:opacity-40"
                  title="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-1 text-xs font-mono tabular-nums text-slate-700">
                  <span>Page</span>
                  <input
                    type="number"
                    min={1}
                    max={pdfNumPages}
                    value={pageNumber}
                    onChange={(e) => {
                      const val = Number.parseInt(e.target.value, 10);
                      if (!Number.isNaN(val) && val >= 1 && val <= pdfNumPages) {
                        onPageNumberChange(val);
                      }
                    }}
                    className="w-11 px-1 py-0.5 text-center bg-white border border-slate-300 rounded text-xs font-mono"
                  />
                  <span>/ {pdfNumPages}</span>
                </div>
                <button
                  type="button"
                  disabled={pageNumber >= pdfNumPages}
                  onClick={() => onPageNumberChange(Math.min(pdfNumPages, pageNumber + 1))}
                  className="p-1.5 rounded text-slate-700 hover:bg-slate-200/70 disabled:opacity-40"
                  title="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* High-Magnification Zoom Controls (25% up to 5500%) */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => zoomAtPoint(zoom / 1.35)}
                className="p-1.5 rounded text-slate-700 hover:bg-slate-200/70"
                title="Zoom out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <div className="flex items-center bg-white border border-slate-300 rounded px-1.5 py-0.5">
                <input
                  type="text"
                  inputMode="numeric"
                  value={zoomInput}
                  onChange={(e) => setZoomInput(e.target.value.replace(/[^0-9]/g, ''))}
                  onBlur={commitZoomInput}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitZoomInput();
                  }}
                  aria-label="Zoom percentage up to 5500%"
                  className="w-11 text-right text-xs font-mono tabular-nums text-slate-800 focus:outline-none"
                />
                <span className="text-xs font-mono text-slate-500 ml-0.5">%</span>
              </div>
              <button
                type="button"
                onClick={() => zoomAtPoint(zoom * 1.35)}
                className="p-1.5 rounded text-slate-700 hover:bg-slate-200/70"
                title="Zoom in (up to 5500%)"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={resetView}
                className="px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200/70 rounded flex items-center gap-1 whitespace-nowrap"
                title="Fit drawing borders to screen"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                Fit
              </button>
              <div className="flex items-center gap-0.5 border-l border-slate-300 pl-1 ml-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setRotation((r) => (r + 270) % 360);
                    resetView();
                  }}
                  className="p-1 rounded text-slate-700 hover:bg-slate-200/70"
                  title="Rotate 90° Counter-Clockwise"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRotation((r) => (r + 90) % 360);
                    resetView();
                  }}
                  className="px-1.5 py-1 text-xs font-mono font-medium text-slate-700 hover:bg-slate-200/70 rounded flex items-center gap-1 whitespace-nowrap"
                  title="Rotate 90° Clockwise"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>{rotation !== 0 ? `${rotation}°` : 'Rotate'}</span>
                </button>
              </div>
              {[500, 1500, 3000, 5500].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => zoomAtPoint(pct / 100)}
                  className={`px-1.5 py-1 text-[11px] font-mono tabular-nums rounded whitespace-nowrap ${
                    Math.round(zoom * 100) === pct
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:bg-slate-200/70'
                  }`}
                >
                  {pct}%
                </button>
              ))}
            </div>

            {/* CAD-specific controls */}
            {isCad && (
              <div className="flex items-center gap-1 pl-2 ml-1 border-l border-slate-200">
                <button
                  type="button"
                  onClick={() => setCadDarkBg((v) => !v)}
                  className="px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200/70 rounded flex items-center gap-1 whitespace-nowrap"
                  title="Toggle blueprint / paper background"
                >
                  {cadDarkBg ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                  {cadDarkBg ? 'Paper' : 'Blueprint'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowLayersPanel((v) => !v)}
                  className={`px-2 py-1 text-xs font-medium rounded flex items-center gap-1 whitespace-nowrap ${
                    showLayersPanel
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:bg-slate-200/70'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  Layers ({drawing.cadData?.layers.length || 0})
                </button>
              </div>
            )}

            {/* Prominent Start Extraction CTA */}
            <button
              type="button"
              onClick={onStartExtraction}
              disabled={extractionRunning}
              className="ml-1 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:bg-blue-400 rounded-md flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              {extractionRunning ? 'Extracting...' : 'Start Extraction'}
            </button>
          </div>
        </div>

        {/* Main Viewport + Optional CAD Layer Drawer */}
        <div className="flex flex-1 min-h-0 relative">
          <div
            ref={containerRef}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className={`flex-1 relative overflow-hidden select-none ${
              isPanning ? 'cursor-grabbing' : 'cursor-grab'
            } ${isCad && cadDarkBg ? 'bg-[#0B1220]' : 'bg-slate-200'}`}
          >
            {pdfError && (
              <div className="absolute inset-0 flex items-center justify-center p-6 z-20">
                <div className="bg-white border border-red-200 rounded-lg p-5 max-w-md text-center">
                  <p className="text-sm font-semibold text-red-700">Drawing Render Error</p>
                  <p className="text-xs text-slate-600 mt-1">{pdfError}</p>
                </div>
              </div>
            )}

            {(pdfLoading || cadLoading) && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900/10 z-10">
                <div className="bg-white border border-slate-200 rounded-md px-4 py-2.5 text-xs font-medium text-slate-700 shadow-sm">
                  Detecting drawing borders & rendering vector geometry...
                </div>
              </div>
            )}

            <canvas
              ref={canvasRef}
              className="block w-full h-full"
              style={
                hasPendingPdfTransform
                  ? {
                      transformOrigin: 'center center',
                      transform: `translate(${pdfDx}px, ${pdfDy}px) scale(${pdfScaleDelta})`,
                    }
                  : undefined
              }
            />

            {/* Bottom-left precision coordinate / zoom readout */}
            <div className="absolute bottom-3 left-3 flex items-center gap-3 px-3 py-1.5 bg-slate-900/85 text-slate-100 rounded text-[11px] font-mono tabular-nums pointer-events-none">
              <span className="flex items-center gap-1">
                <Crosshair className="w-3 h-3 text-slate-400" />
                {isCad && cursorWorldCoord
                  ? `X: ${cursorWorldCoord.x.toFixed(2)}  Y: ${cursorWorldCoord.y.toFixed(2)} · Zoom: ${Math.round(zoom * 100)}%`
                  : `Border View · Zoom: ${Math.round(zoom * 100)}% (max 5500%) · Drag to pan · Scroll to zoom`}
              </span>
              {hoveredEntity && (
                <span className="border-l border-slate-600 pl-2 text-blue-300 truncate max-w-[280px]">
                  [{hoveredEntity.layer}] {hoveredEntity.text}
                </span>
              )}
            </div>

            {/* Reset Pan Quick Action if zoomed or panned */}
            {(Math.abs(pan.x) > 40 || Math.abs(pan.y) > 40 || zoom !== 1) && (
              <button
                type="button"
                onClick={resetView}
                className="absolute bottom-3 right-3 px-2.5 py-1.5 bg-white/95 hover:bg-white border border-slate-300 text-slate-800 rounded text-xs font-medium flex items-center gap-1 shadow-sm"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Fit Borders
              </button>
            )}
          </div>

          {/* CAD Layer Visibility Sidebar */}
          {isCad && showLayersPanel && drawing.cadData && (
            <aside className="w-64 border-l border-slate-200 bg-white flex flex-col shrink-0">
              <div className="px-3 py-2.5 border-b border-slate-200 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900">CAD Layers</span>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setHiddenLayers(new Set())}
                    className="text-blue-700 hover:underline"
                  >
                    All On
                  </button>
                  <button
                    type="button"
                    onClick={() => setHiddenLayers(new Set(drawing.cadData!.layers.map((l) => l.name)))}
                    className="text-slate-600 hover:underline"
                  >
                    All Off
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                {drawing.cadData.layers.map((layer) => {
                  const isHidden = hiddenLayers.has(layer.name);
                  return (
                    <button
                      key={layer.name}
                      type="button"
                      onClick={() => toggleLayer(layer.name)}
                      className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0 border border-slate-300"
                          style={{ backgroundColor: layer.color }}
                        />
                        <span
                          className={`text-xs truncate ${
                            isHidden ? 'text-slate-400 line-through' : 'text-slate-800 font-medium'
                          }`}
                          title={layer.name}
                        >
                          {layer.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[11px] font-mono tabular-nums text-slate-400">
                          {layer.entityCount}
                        </span>
                        {isHidden ? (
                          <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                        ) : (
                          <Eye className="w-3.5 h-3.5 text-slate-600" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>
          )}
        </div>
      </div>
    );
}
