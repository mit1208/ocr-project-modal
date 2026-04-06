'use client';

import { useState } from 'react';
import type { ImePreferenceRecord, ImeSectionRecord, ImeTemplateRecord } from '@/lib/ime-types';

type IMEPreferencesProps = {
  preferences: ImePreferenceRecord[];
  templates: ImeTemplateRecord[];
  currentSections: ImeSectionRecord[];
  onSavePreference: (key: string, value: Record<string, unknown>, confidence?: number) => Promise<void>;
  onDeletePreference: (key: string) => Promise<void>;
  onCreateTemplate: (name: string, isDefault: boolean, sections: ImeSectionRecord[]) => Promise<void>;
  onDeleteTemplate: (id: string) => Promise<void>;
};

export default function IMEPreferences({
  preferences,
  templates,
  currentSections,
  onSavePreference,
  onDeletePreference,
  onCreateTemplate,
  onDeleteTemplate,
}: IMEPreferencesProps) {
  const [prefKey, setPrefKey] = useState('');
  const [prefValue, setPrefValue] = useState('{"value": ""}');
  const [templateName, setTemplateName] = useState('');
  const [templateDefault, setTemplateDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Preferences</div>
        <p className="mt-2 text-sm text-slate-600">Store reusable prompt guidance like tone, detail level, or required report elements.</p>
        <div className="mt-4 space-y-3">
          <input
            value={prefKey}
            onChange={(event) => setPrefKey(event.target.value)}
            placeholder="preference key"
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
          />
          <textarea
            value={prefValue}
            onChange={(event) => setPrefValue(event.target.value)}
            rows={5}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 font-mono text-xs outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={async () => {
                try {
                  setError(null);
                  await onSavePreference(prefKey, JSON.parse(prefValue));
                } catch (saveError) {
                  setError(saveError instanceof Error ? saveError.message : 'Failed to save preference.');
                }
              }}
              className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700"
            >
              Save Preference
            </button>
            {prefKey && (
              <button
                onClick={() => onDeletePreference(prefKey)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50"
              >
                Delete Selected
              </button>
            )}
          </div>
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        </div>

        {preferences.length > 0 && (
          <div className="mt-4 space-y-2">
            {preferences.map((preference) => (
              <button
                key={preference.id}
                onClick={() => {
                  setPrefKey(preference.preference_key);
                  setPrefValue(JSON.stringify(preference.preference_value, null, 2));
                }}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-slate-300 hover:bg-white"
              >
                <div className="text-sm font-black text-slate-800">{preference.preference_key}</div>
                <div className="mt-1 text-xs text-slate-500">Confidence {Math.round(preference.confidence * 100)}%</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Templates</div>
        <p className="mt-2 text-sm text-slate-600">Save the current section order and content scaffolding as a reusable IME template.</p>
        <div className="mt-4 space-y-3">
          <input
            value={templateName}
            onChange={(event) => setTemplateName(event.target.value)}
            placeholder="Template name"
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
          />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={templateDefault}
              onChange={(event) => setTemplateDefault(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            Make this the default template
          </label>
          <button
            onClick={() => onCreateTemplate(templateName, templateDefault, currentSections)}
            className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-black text-white transition hover:bg-black"
          >
            Save Current Layout
          </button>
        </div>

        {templates.length > 0 && (
          <div className="mt-4 space-y-2">
            {templates.map((template) => (
              <div key={template.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <div className="text-sm font-black text-slate-800">{template.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{template.is_default ? 'Default template' : 'Saved template'}</div>
                </div>
                <button
                  onClick={() => onDeleteTemplate(template.id)}
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
