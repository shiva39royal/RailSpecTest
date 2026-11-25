import React, { useState, useEffect } from 'react';
import {
  X,
  TrainTrack,
  Upload,
  Table2,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Play,
  Layers,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  Cpu
} from 'lucide-react';

interface LandingPageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartUpload: () => void;
  onLoadSample: () => void;
  onViewTables: () => void;
}

export const LandingPageModal: React.FC<LandingPageModalProps> = ({
  isOpen,
  onClose,
  onStartUpload,
  onLoadSample,
  onViewTables,
}) => {
  const [dontShowAgain, setDontShowAgain] = useState<boolean>(() => {
    return localStorage.getItem('xtractor_hide_landing_v1') === 'true';
  });

  const [backendHealth, setBackendHealth] = useState<'checking' | 'healthy' | 'offline'>('checking');
  const [pythonStatus, setPythonStatus] = useState<string>('Checking...');

  useEffect(() => {
    if (!isOpen) return;
    // Check local backend health
    fetch('/api/projects')
      .then((res) => {
        if (res.ok) {
          setBackendHealth('healthy');
          setPythonStatus('PyMuPDF & OCR Engine Active');
        } else {
          setBackendHealth('offline');
          setPythonStatus('Backend responded with error');
        }
      })
      .catch(() => {
        setBackendHealth('offline');
        setPythonStatus('Running in standalone / offline mode');
      });
  }, [isOpen]);

  const handleClose = () => {
    if (dontShowAgain) {
      localStorage.setItem('xtractor_hide_landing_v1', 'true');
    } else {
      localStorage.removeItem('xtractor_hide_landing_v1');
    }
    onClose();
  };

  const handleAction = (actionFn: () => void) => {
    handleClose();
    actionFn();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden text-slate-100"
        role="dialog"
        aria-modal="true"
      >
        {/* Header with Title and Close */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-emerald-500 p-0.5 shadow-md flex items-center justify-center">
              <img src="/assets/icon.png" alt="X-Tractor Train Icon" className="w-full h-full object-contain rounded-lg" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-black tracking-tight text-white">
                  <span className="text-emerald-400">X</span>-Tractor
                </span>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full">
                  RDSO v4.0 Amdt-6
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Indian Railways KAVACH Table of Control (TOC) Extraction Engine
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Close Welcome Banner"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Animated GIF Banner */}
          <div className="relative rounded-xl overflow-hidden border border-cyan-500/30 shadow-lg shadow-cyan-950/50 group bg-slate-950 flex items-center justify-center">
            <img
              src="/assets/banner.gif"
              alt="X-Tractor High-Tech Rail Signalling Banner"
              className="w-full h-auto object-contain max-h-[280px] mx-auto"
            />
            <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-slate-900/80 backdrop-blur-sm border border-slate-700/80 px-2.5 py-1 rounded-full text-[11px] text-cyan-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Signalling Studio Live
            </div>
          </div>

          {/* Core Capabilities Grid */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              Key Automation Pillars
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-blue-500/50 transition-colors">
                <div className="flex items-center gap-2 text-blue-400 mb-1.5">
                  <TrainTrack className="w-4 h-4" />
                  <span className="font-semibold text-xs text-white">Points in Route</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Calculates Normal &amp; Reverse (<code className="text-blue-300">P-xx</code>) via Tag-line vector dot products and RDSO overlap exclusions.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-emerald-500/50 transition-colors">
                <div className="flex items-center gap-2 text-emerald-400 mb-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  <span className="font-semibold text-xs text-white">Track Circuit "UP"</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Discovers required picked-UP track circuits per signal route corridor, including berthing track circuits.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-amber-400 mb-1.5">
                <div className="flex items-center gap-2 text-amber-400 mb-1.5">
                  <Layers className="w-4 h-4" />
                  <span className="font-semibold text-xs text-white">TINs Free in Route</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Extracts Track Identification Numbers (<code className="text-amber-300">TIN-xx</code>) from RFID layouts with Calling-On handling.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-purple-500/50 transition-colors">
                <div className="flex items-center gap-2 text-purple-400 mb-1.5">
                  <Cpu className="w-4 h-4" />
                  <span className="font-semibold text-xs text-white">TINs in Overlap</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Resolves exit signal overlap TINs with conditional point settings (<code className="text-purple-300">P-17(N): TIN-101</code>).
                </p>
              </div>
            </div>
          </div>

          {/* Quick Actions & System Health */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
            {/* Action 1 */}
            <button
              type="button"
              onClick={() => handleAction(onStartUpload)}
              className="group p-4 rounded-xl bg-gradient-to-br from-blue-600/20 to-blue-800/20 border border-blue-500/30 hover:border-blue-400 hover:bg-blue-600/30 text-left transition-all cursor-pointer shadow-sm hover:shadow-md hover:shadow-blue-900/30"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Upload className="w-4 h-4" />
                </div>
                <span className="text-[10px] uppercase font-bold text-blue-400 tracking-wider">Start Here</span>
              </div>
              <h4 className="text-sm font-semibold text-white mb-1">Open Station Layout</h4>
              <p className="text-xs text-slate-400">
                Upload DWG, DXF, or PDF SIP signalling plans to automatically extract control tables.
              </p>
            </button>

            {/* Action 2 */}
            <button
              type="button"
              onClick={() => handleAction(onLoadSample)}
              className="group p-4 rounded-xl bg-gradient-to-br from-emerald-600/20 to-emerald-800/20 border border-emerald-500/30 hover:border-emerald-400 hover:bg-emerald-600/30 text-left transition-all cursor-pointer shadow-sm hover:shadow-md hover:shadow-emerald-900/30"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Play className="w-4 h-4" />
                </div>
                <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">Instant Demo</span>
              </div>
              <h4 className="text-sm font-semibold text-white mb-1">Load Sample Station</h4>
              <p className="text-xs text-slate-400">
                Instantly load and test Chitgidda (CTF) Station with complete pre-configured layouts.
              </p>
            </button>

            {/* Action 3 */}
            <button
              type="button"
              onClick={() => handleAction(onViewTables)}
              className="group p-4 rounded-xl bg-gradient-to-br from-slate-800 to-slate-800/80 border border-slate-700 hover:border-slate-500 hover:bg-slate-700/50 text-left transition-all cursor-pointer shadow-sm hover:shadow-md"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="w-8 h-8 rounded-lg bg-slate-700 text-slate-300 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Table2 className="w-4 h-4" />
                </div>
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">TOC View</span>
              </div>
              <h4 className="text-sm font-semibold text-white mb-1">View Table of Control</h4>
              <p className="text-xs text-slate-400">
                Inspect generated Table 1 Control rows, validation checks, and export to Excel/PDF.
              </p>
            </button>
          </div>

          {/* System & Runtime Health Status Pill */}
          <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              {backendHealth === 'healthy' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400" />
              )}
              <span className="text-slate-300">
                System Status: <span className="text-white font-medium">{pythonStatus}</span>
              </span>
            </div>
            <div className="flex items-center gap-4 text-slate-400 text-[11px]">
              <span>Desktop Package: <strong className="text-slate-200">X-Tractor Windows Setup</strong></span>
              <span>Spec: <strong className="text-slate-200">RDSO/SPN/196/2020</strong></span>
            </div>
          </div>
        </div>

        {/* Footer with Checkbox and Enter Studio Button */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-950/60">
          <label className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-blue-500 cursor-pointer"
            />
            Don't show this welcome banner automatically on startup
          </label>
          <button
            type="button"
            onClick={handleClose}
            className="px-5 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-500 hover:to-emerald-500 text-white font-medium text-xs flex items-center gap-2 shadow-lg shadow-blue-900/30 transition-all cursor-pointer"
          >
            <span>Enter Studio</span>
            <Play className="w-3.5 h-3.5 fill-current" />
          </button>
        </div>
      </div>
    </div>
  );
};
