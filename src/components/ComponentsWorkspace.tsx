import React, { useMemo, useState } from 'react';
import { ArrowRight, GitBranch, Layers, Search } from 'lucide-react';
import type {
  ComponentCategory,
  ComponentRelationship,
  ExtractedComponent,
  NavigationSection,
} from '../types/project';

interface ComponentsWorkspaceProps {
  components: ExtractedComponent[];
  relationships: ComponentRelationship[];
  onNavigate: (section: NavigationSection) => void;
}

const CATEGORY_LABELS: Record<ComponentCategory | 'all', string> = {
  all: 'All',
  signal: 'Signals',
  rfid_tag: 'RFID Tags',
  point: 'Pointers (Points)',
  track_circuit: 'Track Circuits',
  tin: 'TIN Zones',
  lc_gate: 'LC Gates',
  shunting_limit: 'Shunting Limits',
  track_line: 'Track Lines',
  gradient_marker: 'Gradients',
  ohe_pole: 'OHE Poles',
  infrastructure: 'Infrastructure',
};

export function ComponentsWorkspace({
  components,
  relationships,
  onNavigate,
}: ComponentsWorkspaceProps) {
  const [viewMode, setViewMode] = useState<'components' | 'relationships'>('components');
  const [categoryFilter, setCategoryFilter] = useState<ComponentCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: components.length };
    for (const c of components) {
      counts[c.category] = (counts[c.category] || 0) + 1;
    }
    return counts;
  }, [components]);

  const filteredComponents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return components.filter((c) => {
      if (categoryFilter !== 'all' && c.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        c.label.toLowerCase().includes(q) ||
        c.subType.toLowerCase().includes(q) ||
        (c.chainageKm || '').toLowerCase().includes(q) ||
        (c.layer || '').toLowerCase().includes(q) ||
        c.sourceTrace.toLowerCase().includes(q)
      );
    });
  }, [components, categoryFilter, searchQuery]);

  const filteredRelationships = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return relationships.filter((r) => {
      if (!q) return true;
      return (
        r.fromLabel.toLowerCase().includes(q) ||
        r.toLabel.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q)
      );
    });
  }, [relationships, searchQuery]);

  const selectedComponent = useMemo(
    () => components.find((c) => c.id === selectedId) || null,
    [components, selectedId]
  );

  const relatedEdges = useMemo(() => {
    if (!selectedComponent) return [];
    return relationships.filter(
      (r) =>
        r.fromId === selectedComponent.id ||
        r.toId === selectedComponent.id ||
        r.fromLabel === selectedComponent.label ||
        r.toLabel === selectedComponent.label
    );
  }, [relationships, selectedComponent]);

  if (components.length === 0 && relationships.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-12 text-center max-w-3xl mx-auto">
        <Layers className="w-9 h-9 text-slate-400 mx-auto mb-3" />
        <h2 className="text-base font-bold text-slate-900">No Extracted Components Yet</h2>
        <p className="text-xs text-slate-600 mt-1.5 max-w-md mx-auto">
          Upload a station layout drawing, inspect it in Drawing Viewer, and click Start Extraction to identify signals, RFID tags, points, track circuits, TINs, LC gates, and route relationships.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('extraction')}
          className="mt-4 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md"
        >
          Go to Extraction Engine
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Extracted Components & Relationships
          </h1>
          <p className="text-xs text-slate-600 mt-1">
            {components.length} detected railway elements · {relationships.length} topological associations mapped dynamically from the uploaded drawing.
          </p>
        </div>

        {/* Interactive Mode Switcher */}
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setViewMode('components')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              viewMode === 'components'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Components ({components.length})
          </button>
          <button
            type="button"
            onClick={() => setViewMode('relationships')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              viewMode === 'relationships'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            Relationships ({relationships.length})
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {viewMode === 'components' ? (
          <div className="flex items-center gap-1 flex-wrap">
            {(Object.keys(CATEGORY_LABELS) as Array<ComponentCategory | 'all'>)
              .filter((cat) => cat === 'all' || (categoryCounts[cat] || 0) > 0)
              .map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    categoryFilter === cat
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {CATEGORY_LABELS[cat]} ({categoryCounts[cat] || 0})
                </button>
              ))}
          </div>
        ) : (
          <span className="text-xs text-slate-500">
            Directed route topology, signal-to-foot-tag links, point locking, and block handovers
          </span>
        )}

        <div className="relative w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter label, type, chainage..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
      </div>

      {viewMode === 'components' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Components Table */}
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                  <tr className="text-[11px] font-semibold text-slate-600">
                    <th className="py-2.5 px-3">Label / ID</th>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3">Sub-Type</th>
                    <th className="py-2.5 px-3">Direction</th>
                    <th className="py-2.5 px-3 text-right">Chainage / Loc (m)</th>
                    <th className="py-2.5 px-3">Source Trace</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredComponents.map((comp) => {
                    const active = comp.id === selectedId;
                    return (
                      <tr
                        key={comp.id}
                        onClick={() => setSelectedId(comp.id)}
                        className={`cursor-pointer transition-colors ${
                          active ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-2 px-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                          {comp.label}
                        </td>
                        <td className="py-2 px-3 text-slate-700 whitespace-nowrap">
                          {CATEGORY_LABELS[comp.category] || comp.category}
                        </td>
                        <td className="py-2 px-3 text-slate-600">{comp.subType}</td>
                        <td className="py-2 px-3 text-slate-600 whitespace-nowrap">
                          {comp.direction || '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {comp.chainageKm ||
                            (comp.absoluteLocationMeters !== undefined
                              ? `${comp.absoluteLocationMeters} m`
                              : '—')}
                        </td>
                        <td className="py-2 px-3 text-slate-500 max-w-[180px] truncate" title={comp.sourceTrace}>
                          {comp.sourceTrace}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Selected Component Inspector */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 h-fit space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-2.5">
              Component Inspector
            </h2>
            {!selectedComponent ? (
              <p className="text-xs text-slate-500">
                Select any component row to inspect its extracted attributes, traceability notes, and mapped relationships.
              </p>
            ) : (
              <div className="space-y-4 text-xs">
                <div>
                  <span className="text-slate-500 block">Identifier</span>
                  <span className="text-base font-bold font-mono text-slate-900">
                    {selectedComponent.label}
                  </span>
                  <span className="block text-slate-600 mt-0.5">
                    {CATEGORY_LABELS[selectedComponent.category]} · {selectedComponent.subType}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                  <div>
                    <span className="text-slate-500 block">Direction</span>
                    <span className="font-medium text-slate-900">{selectedComponent.direction || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Chainage / Abs. Loc</span>
                    <span className="font-mono tabular-nums text-slate-900">
                      {selectedComponent.chainageKm || selectedComponent.absoluteLocationMeters || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Layer / Layout</span>
                    <span className="font-mono text-slate-800">
                      {selectedComponent.layer || selectedComponent.pageOrLayout || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Confidence</span>
                    <span className="font-mono tabular-nums text-slate-900">
                      {Math.round(selectedComponent.confidence * 100)}%
                    </span>
                  </div>
                </div>

                {Object.keys(selectedComponent.properties).length > 0 && (
                  <div className="pt-2 border-t border-slate-100">
                    <span className="text-slate-500 font-semibold block mb-1.5">Extracted Properties</span>
                    <dl className="space-y-1">
                      {Object.entries(selectedComponent.properties).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2">
                          <dt className="text-slate-500">{k}</dt>
                          <dd className="font-mono text-slate-900 text-right">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}

                <div className="pt-2 border-t border-slate-100">
                  <span className="text-slate-500 font-semibold block mb-1.5">
                    Linked Relationships ({relatedEdges.length})
                  </span>
                  {relatedEdges.length === 0 ? (
                    <p className="text-slate-500">No direct edges linked to this element.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {relatedEdges.map((edge) => (
                        <li key={edge.id} className="p-2 bg-slate-50 border border-slate-200 rounded">
                          <div className="flex items-center gap-1.5 font-mono font-semibold text-slate-900">
                            <span>{edge.fromLabel}</span>
                            <ArrowRight className="w-3 h-3 text-blue-600" />
                            <span>{edge.toLabel}</span>
                          </div>
                          <p className="text-[11px] text-slate-600 mt-0.5">{edge.description}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <span className="text-slate-500 block">Source Trace</span>
                  <span className="text-slate-700">{selectedComponent.sourceTrace}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Relationships Table */
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                <tr className="text-[11px] font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Source Element</th>
                  <th className="py-2.5 px-4">Relationship Type</th>
                  <th className="py-2.5 px-4">Target Element</th>
                  <th className="py-2.5 px-4">Engineering Association</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredRelationships.map((rel) => (
                  <tr key={rel.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {rel.fromLabel}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">
                      {rel.type.replace(/_/g, ' ')}
                    </td>
                    <td className="py-2.5 px-4 font-mono font-semibold text-blue-800 whitespace-nowrap">
                      {rel.toLabel}
                    </td>
                    <td className="py-2.5 px-4 text-slate-700">{rel.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
