import React, { useState } from 'react';
import { BookOpen, RotateCcw, Settings2 } from 'lucide-react';
import {
  DEFAULT_EXTRACTION_SETTINGS,
  KAVACH_SPEC_TABLES,
  RFID_TAG_LEGEND_RULES,
  SPEC_DOCUMENT_INFO,
} from '../spec/kavachSpecSchema';
import type { ExtractionSettings, KavachTableId } from '../types/project';

interface SettingsWorkspaceProps {
  settings: ExtractionSettings;
  onUpdateSettings: (patch: Partial<ExtractionSettings>) => void;
  onResetSettings: () => void;
}

export function SettingsWorkspace({
  settings,
  onUpdateSettings,
  onResetSettings,
}: SettingsWorkspaceProps) {
  const [inspectTableId, setInspectTableId] = useState<KavachTableId>('table1_control');
  const inspectedSpec = KAVACH_SPEC_TABLES.find((t) => t.id === inspectTableId) || KAVACH_SPEC_TABLES[0];

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Specification Engine & Calculation Settings
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Configure the offline RDSO KAVACH calculation parameters and inspect the deterministic specification schema that drives local geometry extraction and validation (no API keys required).
          </p>
        </div>

        <button
          type="button"
          onClick={onResetSettings}
          className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-md flex items-center gap-1.5 whitespace-nowrap"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Restore RDSO Defaults
        </button>
      </div>

      {/* Configurable Engineering Calculation Parameters */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <Settings2 className="w-4 h-4 text-blue-700" />
          <h2 className="text-sm font-semibold text-slate-900">
            RDSO Engineering Calculation Parameters ({SPEC_DOCUMENT_INFO.code} {SPEC_DOCUMENT_INFO.amendment})
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Default Section Speed (kmph)
            </label>
            <input
              type="number"
              value={settings.defaultSectionSpeedKmph}
              onChange={(e) =>
                onUpdateSettings({
                  defaultSectionSpeedKmph: Number(e.target.value) || DEFAULT_EXTRACTION_SETTINGS.defaultSectionSpeedKmph,
                })
              }
              className="w-full px-3 py-1.5 font-mono bg-slate-50 border border-slate-300 rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <p className="text-[11px] text-slate-500 mt-1">Used for baseline uniform PSR if not stated on drawing.</p>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Single Turnout Speed (kmph) — Cl. I.2.12.1
            </label>
            <input
              type="number"
              value={settings.singleTurnoutSpeedKmph}
              onChange={(e) => onUpdateSettings({ singleTurnoutSpeedKmph: Number(e.target.value) || 30 })}
              className="w-full px-3 py-1.5 font-mono bg-slate-50 border border-slate-300 rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Multiple Turnout Speed (kmph) — Cl. I.2.12.1
            </label>
            <input
              type="number"
              value={settings.multiTurnoutSpeedKmph}
              onChange={(e) => onUpdateSettings({ multiTurnoutSpeedKmph: Number(e.target.value) || 15 })}
              className="w-full px-3 py-1.5 font-mono bg-slate-50 border border-slate-300 rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Station Entry Turnout Buffer (+m)
            </label>
            <input
              type="number"
              value={settings.stationEntryTurnoutBufferM}
              onChange={(e) => onUpdateSettings({ stationEntryTurnoutBufferM: Number(e.target.value) || 30 })}
              className="w-full px-3 py-1.5 font-mono bg-slate-50 border border-slate-300 rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <p className="text-[11px] text-slate-500 mt-1">Default +30 m per Cl. I.2.12.1(iii).</p>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Station Exit Turnout Buffer (+m)
            </label>
            <input
              type="number"
              value={settings.stationExitTurnoutBufferM}
              onChange={(e) => onUpdateSettings({ stationExitTurnoutBufferM: Number(e.target.value) || 10 })}
              className="w-full px-3 py-1.5 font-mono bg-slate-50 border border-slate-300 rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <p className="text-[11px] text-slate-500 mt-1">Default +10 m per Cl. I.2.12.1(iii).</p>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Distance Conservation Tolerance (±m)
            </label>
            <input
              type="number"
              value={settings.distanceToleranceMeters}
              onChange={(e) => onUpdateSettings({ distanceToleranceMeters: Math.max(0, Number(e.target.value) || 0) })}
              className="w-full px-3 py-1.5 font-mono bg-slate-50 border border-slate-300 rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 flex flex-wrap gap-6 text-xs">
          <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.includeTslTables}
              onChange={(e) => onUpdateSettings({ includeTslTables: e.target.checked })}
              className="rounded border-slate-300 text-blue-700"
            />
            <span>Include Temporary Single Line (TSL) Tables (Tables 6, 6B, 7)</span>
          </label>
          <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.flagMissingCompanionData}
              onChange={(e) => onUpdateSettings({ flagMissingCompanionData: e.target.checked })}
              className="rounded border-slate-300 text-blue-700"
            />
            <span>Flag Missing Companion Sheet Fields (Gradient Plan, OHE Layout, SIP)</span>
          </label>
        </div>
      </div>

      {/* Dynamic Specification Model Inspector */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-blue-700" />
            <h2 className="text-sm font-semibold text-slate-900">
              Configurable Specification Schema Dictionary
            </h2>
          </div>
          <select
            value={inspectTableId}
            onChange={(e) => setInspectTableId(e.target.value as KavachTableId)}
            className="px-3 py-1.5 text-xs font-medium bg-slate-50 border border-slate-300 rounded-md"
          >
            {KAVACH_SPEC_TABLES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.tableNumber}: {t.title}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
              <tr>
                <th className="py-2.5 px-4">Column Label</th>
                <th className="py-2.5 px-3">Clause</th>
                <th className="py-2.5 px-3">Source Doc</th>
                <th className="py-2.5 px-3">Required</th>
                <th className="py-2.5 px-4">Dynamic Extraction Methodology</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {inspectedSpec.columns.map((col) => (
                <tr key={col.key} className="hover:bg-slate-50/70">
                  <td className="py-2 px-4 font-semibold text-slate-900">
                    {col.group ? `${col.group} › ` : ''}
                    {col.label}
                  </td>
                  <td className="py-2 px-3 font-mono text-slate-500 whitespace-nowrap">{col.clauseRef}</td>
                  <td className="py-2 px-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                    {col.sourceDoc}
                  </td>
                  <td className="py-2 px-3 text-slate-700">{col.mandatory ? 'Mandatory' : 'Optional'}</td>
                  <td className="py-2 px-4 text-slate-600">{col.extractionRule}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* RFID Tag Classification Legend Reference */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">
            RFID Tag & Schematic Legend Classification Rules
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">
          {RFID_TAG_LEGEND_RULES.map((rule) => (
            <div key={rule.code} className="p-4 border-b border-slate-100 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-blue-800">[{rule.code}]</span>
                <span className="font-semibold text-slate-900">{rule.type}</span>
              </div>
              <p className="text-slate-600 mt-1">{rule.role}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Visual marker: {rule.visual}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
