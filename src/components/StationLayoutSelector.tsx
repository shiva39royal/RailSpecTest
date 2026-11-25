import React, { useEffect, useRef, useState } from 'react';
import {
  Calendar,
  Check,
  ChevronDown,
  Layers,
  Search,
  Train,
  X,
} from 'lucide-react';
import type { SavedProjectSummary } from '../types/project';

interface StationLayoutSelectorProps {
  layouts: SavedProjectSummary[];
  selectedLayoutId: string | null;
  onSelectLayout: (layoutId: string) => void;
  placeholder?: string;
  className?: string;
  align?: 'left' | 'right';
}

export function StationLayoutSelector({
  layouts,
  selectedLayoutId,
  onSelectLayout,
  placeholder = 'Select Station Layout...',
  className = '',
  align = 'left',
}: StationLayoutSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const selectedLayout = layouts.find((l) => l.id === selectedLayoutId) || null;

  const filteredLayouts = layouts.filter((l) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const name = (l.stationName || l.name || '').toLowerCase();
    const id = (l.stationId || '').toLowerCase();
    return name.includes(q) || id.includes(q);
  });

  return (
    <div ref={containerRef} className={`relative inline-block text-left ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`group flex items-center justify-between gap-3 px-3.5 py-2 bg-white border rounded-lg shadow-xs transition-all text-left min-w-[280px] max-w-sm ${
          isOpen
            ? 'border-blue-600 ring-2 ring-blue-600/20 shadow-sm'
            : selectedLayout
            ? 'border-slate-300 hover:border-blue-500 hover:shadow-sm'
            : 'border-dashed border-blue-400 bg-blue-50/30 hover:bg-blue-50/60'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border transition-colors ${
              selectedLayout
                ? 'bg-blue-50 text-blue-700 border-blue-200 group-hover:bg-blue-100'
                : 'bg-white text-blue-600 border-blue-200 shadow-2xs'
            }`}
          >
            <Train className="w-5 h-5" />
          </div>

          <div className="min-w-0">
            {selectedLayout ? (
              <>
                <p className="text-xs font-bold text-slate-900 truncate tracking-tight">
                  {selectedLayout.stationName || selectedLayout.name}
                </p>
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
                  {selectedLayout.stationId && <span>ID: {selectedLayout.stationId}</span>}
                  {selectedLayout.stationId && <span>•</span>}
                  <span>
                    {typeof selectedLayout.totalRows === 'number' && selectedLayout.totalRows > 0
                      ? `${selectedLayout.totalRows} rows`
                      : 'KAVACH Tables'}
                  </span>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs font-semibold text-blue-900">{placeholder}</p>
                <p className="text-[10px] text-slate-500">Choose a station to load</p>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 pl-1">
          {selectedLayout && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              Active
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${
              isOpen ? 'rotate-180 text-blue-600' : 'group-hover:text-slate-600'
            }`}
          />
        </div>
      </button>

      {/* Dropdown Menu Popover */}
      {isOpen && (
        <div
          className={`absolute ${
            align === 'right' ? 'right-0' : 'left-0'
          } mt-2 z-50 w-80 sm:w-96 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1`}
        >
          {/* Popover Header */}
          <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
            <div>
              <span className="text-xs font-bold text-slate-900">Station Layouts</span>
              <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] font-mono font-medium bg-slate-200 text-slate-700">
                {layouts.length}
              </span>
            </div>
            <span className="text-[10px] text-slate-500">Offline datasets</span>
          </div>

          {/* Search Field */}
          {layouts.length > 3 && (
            <div className="p-2 border-b border-slate-100 bg-white">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by station name or ID..."
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* List of Stations */}
          <div className="max-h-72 overflow-y-auto p-1.5 space-y-1">
            {filteredLayouts.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                {layouts.length === 0 ? 'No station layouts saved yet.' : 'No stations match your search.'}
              </div>
            ) : (
              filteredLayouts.map((layout) => {
                const isSelected = layout.id === selectedLayoutId;
                const displayName = layout.stationName || layout.name;

                return (
                  <div
                    key={layout.id}
                    onClick={() => {
                      onSelectLayout(layout.id);
                      setIsOpen(false);
                      setSearch('');
                    }}
                    className={`p-2.5 rounded-lg flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-blue-50/90 border border-blue-200 text-blue-900'
                        : 'hover:bg-slate-50 border border-transparent text-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${
                          isSelected
                            ? 'bg-blue-700 text-white'
                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}
                      >
                        <Train className="w-4 h-4" />
                      </div>

                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">
                          {displayName}
                        </p>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono mt-0.5">
                          {layout.stationId && <span>ID: {layout.stationId}</span>}
                          {layout.stationId && <span>•</span>}
                          <span>
                            {typeof layout.totalRows === 'number' && layout.totalRows > 0
                              ? `${layout.totalRows} table rows`
                              : `${layout.drawingCount} file(s)`}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isSelected ? (
                        <div className="w-5 h-5 rounded-full bg-blue-700 text-white flex items-center justify-center">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400 font-medium hover:text-blue-700">
                          Select
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
