import React, { useState, useEffect } from 'react';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Play
} from 'lucide-react';

interface LandingPageModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LandingPageModal: React.FC<LandingPageModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [dontShowAgain, setDontShowAgain] = useState<boolean>(() => {
    return localStorage.getItem('xtractor_hide_landing_v1') === 'true';
  });

  const [backendHealth, setBackendHealth] = useState<'checking' | 'healthy' | 'offline'>('checking');
  const [pythonStatus, setPythonStatus] = useState<string>('Checking...');

  useEffect(() => {
    if (!isOpen) return;
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

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 w-screen h-screen bg-slate-950 flex flex-col overflow-hidden text-slate-100 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
    >
      {/* Full-Window Header */}
      <div className="flex items-center justify-between px-8 py-4 border-b border-slate-800 bg-slate-950/90 shrink-0">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-emerald-500 p-0.5 shadow-md flex items-center justify-center">
            <img src="/assets/icon.png" alt="X-tractor Train Icon" className="w-full h-full object-contain rounded-lg" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-2xl font-black tracking-tight text-white">
                <span className="text-emerald-400">X</span>-tractor
              </span>
              <span className="px-2.5 py-0.5 text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full">
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
          className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          title="Close Welcome Screen"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Full-Window Centered Banner Stage */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 gap-6 overflow-y-auto bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
        <div className="relative w-full max-w-5xl rounded-2xl overflow-hidden border border-cyan-500/30 shadow-2xl shadow-cyan-950/50 bg-slate-950 flex items-center justify-center">
          <img
            src="/assets/banner.gif"
            alt="X-tractor High-Tech Rail Signalling Banner"
            className="w-full h-auto max-h-[62vh] object-contain mx-auto"
          />
          <div className="absolute top-4 right-4 flex items-center gap-2 bg-slate-900/85 backdrop-blur-sm border border-slate-700/80 px-3 py-1.5 rounded-full text-xs text-cyan-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Signalling Studio Live
          </div>
        </div>

        {/* System & Runtime Health Status Bar */}
        <div className="w-full max-w-5xl px-4 py-3 bg-slate-900/80 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
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
            <span>Desktop App: <strong className="text-slate-200">X-tractor</strong></span>
            <span>Spec: <strong className="text-slate-200">RDSO/SPN/196/2020</strong></span>
          </div>
        </div>
      </div>

      {/* Full-Window Footer */}
      <div className="flex items-center justify-between px-8 py-4 border-t border-slate-800 bg-slate-950/90 shrink-0">
        <label className="flex items-center gap-2.5 text-xs text-slate-400 hover:text-slate-200 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-blue-500 cursor-pointer"
          />
          Don't show this welcome screen automatically on startup
        </label>
        <button
          type="button"
          onClick={handleClose}
          className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-500 hover:to-emerald-500 text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-blue-900/30 transition-all cursor-pointer"
        >
          <span>Enter Studio</span>
          <Play className="w-4 h-4 fill-current" />
        </button>
      </div>
    </div>
  );
};
