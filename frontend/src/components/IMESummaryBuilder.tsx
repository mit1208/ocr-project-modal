'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircleIcon,
  Cog6ToothIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { authedFetch, authedFetchJson, jsonRequest } from '@/lib/client/auth-fetch';
import IMEExport from './IMEExport';
import IMEPreferences from './IMEPreferences';
import type {
  ConsultationSessionData,
  ImePreferenceRecord,
  ImeSectionRecord,
  ImeSectionType,
  ImeTemplateRecord,
} from '@/lib/ime-types';
import { IME_SECTION_OPTIONS } from '@/lib/ime-types';

type IMESummaryBuilderProps = {
  caseId: string;
  onNavigateToPage?: (page: number) => void;
};

type ImeApiPayload = {
  data: {
    summary: {
      id: string;
      title?: string | null;
      status: 'draft' | 'in_progress' | 'completed';
      consultation_session_id?: string | null;
      sections: ImeSectionRecord[];
      steering_context?: Record<string, unknown> | null;
    } | null;
    sections: ImeSectionRecord[];
    consultation: ConsultationSessionData | null;
    templates: ImeTemplateRecord[];
    preferences: ImePreferenceRecord[];
    recordsReviewed: string[];
    availableConsultationSessionId?: string | null;
    section?: ImeSectionRecord | null;
    chatHistory?: Array<{ role: string; content: string; timestamp?: string }>;
  };
};

function renderContentWithPageLinks(
  content: string,
  onNavigateToPage?: (page: number) => void,
) {
  if (!onNavigateToPage || !content) return content;

  // Match patterns like (p. 3), (p.3), (page 3), (pages 3, 5), (pp. 3-5)
  const parts = content.split(/(\(p(?:ages?|p)?\.?\s*[\d,\s–-]+\))/gi);
  if (parts.length === 1) return content;

  return parts.map((part, i) => {
    const match = part.match(/\(p(?:ages?|p)?\.?\s*([\d,\s–-]+)\)/i);
    if (!match) return part;

    const pageNums = match[1]
      .split(/[,\s–-]+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (pageNums.length === 0) return part;

    return (
      <span key={i}>
        {'('}
        {pageNums.map((page, j) => (
          <span key={j}>
            {j > 0 && ', '}
            <button
              type="button"
              onClick={() => onNavigateToPage(page)}
              className="text-blue-600 hover:text-blue-800 underline underline-offset-2 font-semibold cursor-pointer"
              title={`Go to page ${page}`}
            >
              p. {page}
            </button>
          </span>
        ))}
        {')'}
      </span>
    );
  });
}

export default function IMESummaryBuilder({ caseId, onNavigateToPage }: IMESummaryBuilderProps) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [sections, setSections] = useState<ImeSectionRecord[]>([]);
  const [summaryId, setSummaryId] = useState<string | null>(null);
  const [summaryTitle, setSummaryTitle] = useState('IME Summary');
  const [summaryStatus, setSummaryStatus] = useState<'draft' | 'in_progress' | 'completed'>('draft');
  const [consultation, setConsultation] = useState<ConsultationSessionData | null>(null);
  const [templates, setTemplates] = useState<ImeTemplateRecord[]>([]);
  const [preferences, setPreferences] = useState<ImePreferenceRecord[]>([]);
  const [recordsReviewed, setRecordsReviewed] = useState<string[]>([]);
  const [activeSectionType, setActiveSectionType] = useState<ImeSectionType>('demographics_history');
  const [chatMessage, setChatMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await authedFetchJson<ImeApiPayload>(`/api/ime/${encodeURIComponent(caseId)}`);
      setSummaryId(payload.data.summary?.id || null);
      setSummaryTitle(payload.data.summary?.title || 'IME Summary');
      setSummaryStatus(payload.data.summary?.status || 'draft');
      setSections(payload.data.sections || []);
      setConsultation(payload.data.consultation);
      setTemplates(payload.data.templates || []);
      setPreferences(payload.data.preferences || []);
      setRecordsReviewed(payload.data.recordsReviewed || []);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to load IME workspace.');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  const activeSection = useMemo(
    () => sections.find((section) => section.type === activeSectionType) || null,
    [activeSectionType, sections],
  );

  const saveSections = useCallback(async (nextSections: ImeSectionRecord[], nextStatus?: 'draft' | 'in_progress' | 'completed') => {
    const payload = await authedFetchJson<ImeApiPayload>(
      `/api/ime/${encodeURIComponent(caseId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: summaryTitle,
          status: nextStatus || summaryStatus,
          sections: nextSections,
        }),
      },
    );
    setSummaryId(payload.data.summary?.id || null);
    setSummaryTitle(payload.data.summary?.title || summaryTitle);
    setSummaryStatus(payload.data.summary?.status || (nextStatus || summaryStatus));
    setSections(payload.data.sections || nextSections);
    setConsultation(payload.data.consultation);
    setTemplates(payload.data.templates || []);
    setPreferences(payload.data.preferences || []);
    setRecordsReviewed(payload.data.recordsReviewed || []);
  }, [caseId, summaryStatus, summaryTitle]);

  const generateSection = useCallback(async (sectionType: ImeSectionType) => {
    setBusy(true);
    try {
      const payload = await authedFetchJson<ImeApiPayload>(
        `/api/ime/${encodeURIComponent(caseId)}/section/${sectionType}`,
        jsonRequest({ summaryId }),
      );
      setSummaryId(payload.data.summary?.id || summaryId);
      setSummaryTitle(payload.data.summary?.title || summaryTitle);
      setSummaryStatus(payload.data.summary?.status || 'in_progress');
      setSections(payload.data.sections || []);
      setConsultation(payload.data.consultation);
      setTemplates(payload.data.templates || []);
      setPreferences(payload.data.preferences || []);
      setRecordsReviewed(payload.data.recordsReviewed || []);
      setStatusMessage(`${IME_SECTION_OPTIONS.find((section) => section.type === sectionType)?.label || 'Section'} generated.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to generate IME section.');
    } finally {
      setBusy(false);
    }
  }, [caseId, summaryId, summaryTitle]);

  const approveActiveSection = useCallback(async () => {
    if (!activeSection) return;
    setBusy(true);
    try {
      const nextSections = sections.map((section) => (
        section.type === activeSection.type
          ? { ...section, status: 'approved' as const, updatedAt: new Date().toISOString() }
          : section
      ));
      const nextStatus = nextSections.every((section) => section.status === 'approved') ? 'completed' : 'in_progress';
      await saveSections(nextSections, nextStatus);
      setStatusMessage(`${activeSection.label} approved.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to approve section.');
    } finally {
      setBusy(false);
    }
  }, [activeSection, saveSections, sections]);

  const saveManualEdits = useCallback(async () => {
    setBusy(true);
    try {
      await saveSections(sections, summaryStatus === 'completed' ? 'completed' : 'in_progress');
      setStatusMessage('Section edits saved.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to save IME edits.');
    } finally {
      setBusy(false);
    }
  }, [saveSections, sections, summaryStatus]);

  const refineActiveSection = useCallback(async () => {
    if (!activeSection || !chatMessage.trim()) return;
    setBusy(true);
    try {
      const payload = await authedFetchJson<ImeApiPayload>(
        `/api/ime/${encodeURIComponent(caseId)}/section/${activeSection.type}/chat`,
        jsonRequest({
          summaryId,
          message: chatMessage.trim(),
        }),
      );
      setSummaryId(payload.data.summary?.id || summaryId);
      setSummaryTitle(payload.data.summary?.title || summaryTitle);
      setSummaryStatus(payload.data.summary?.status || 'in_progress');
      setSections(payload.data.sections || []);
      setConsultation(payload.data.consultation);
      setTemplates(payload.data.templates || []);
      setPreferences(payload.data.preferences || []);
      setRecordsReviewed(payload.data.recordsReviewed || []);
      setChatMessage('');
      setStatusMessage(`${activeSection.label} refined.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to refine IME section.');
    } finally {
      setBusy(false);
    }
  }, [activeSection, caseId, chatMessage, summaryId, summaryTitle]);

  const exportSummary = useCallback(async (format: 'pdf' | 'word') => {
    setBusy(true);
    try {
      const response = await authedFetch(`/api/ime/${encodeURIComponent(caseId)}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summaryId, format }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || 'Export failed.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = format === 'pdf' ? 'ime-summary.pdf' : 'ime-summary.doc';
      link.click();
      window.URL.revokeObjectURL(url);
      setStatusMessage(`IME summary exported as ${format.toUpperCase()}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to export IME summary.');
    } finally {
      setBusy(false);
    }
  }, [caseId, summaryId]);

  const savePreference = useCallback(async (key: string, value: Record<string, unknown>, confidence?: number) => {
    const payload = await authedFetchJson<{ data: ImePreferenceRecord[] }>(
      '/api/ime/preferences',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferenceKey: key,
          preferenceValue: value,
          confidence,
        }),
      },
    );
    setPreferences(payload.data || []);
    setStatusMessage(`Preference "${key}" saved.`);
  }, []);

  const deletePreference = useCallback(async (key: string) => {
    const payload = await authedFetchJson<{ data: ImePreferenceRecord[] }>(
      '/api/ime/preferences',
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferenceKey: key }),
      },
    );
    setPreferences(payload.data || []);
    setStatusMessage(`Preference "${key}" removed.`);
  }, []);

  const createTemplate = useCallback(async (name: string, isDefault: boolean, currentTemplateSections: ImeSectionRecord[]) => {
    const payload = await authedFetchJson<{ data: ImeTemplateRecord[] }>(
      '/api/ime/templates',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          isDefault,
          sections: currentTemplateSections,
        }),
      },
    );
    setTemplates(payload.data || []);
    setStatusMessage(`Template "${name}" saved.`);
  }, []);

  const deleteTemplate = useCallback(async (id: string) => {
    const payload = await authedFetchJson<{ data: ImeTemplateRecord[] }>(
      '/api/ime/templates',
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      },
    );
    setTemplates(payload.data || []);
    setStatusMessage('Template deleted.');
  }, []);

  if (loading) {
    return (
      <div className="p-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-4">
      <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-blue-50 p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-600">IME Summary Builder</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={summaryTitle}
                onChange={(event) => setSummaryTitle(event.target.value)}
                className="min-w-[260px] rounded-2xl border border-slate-200 bg-white px-4 py-2 text-lg font-bold text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
              />
              <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                summaryStatus === 'completed'
                  ? 'bg-emerald-100 text-emerald-700'
                  : summaryStatus === 'in_progress'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-200 text-slate-600'
              }`}>
                {summaryStatus.replace('_', ' ')}
              </span>
              {consultation && (
                <span className="rounded-full bg-purple-100 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-purple-700">
                  Consultation linked
                </span>
              )}
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600">
              Generate each IME section from document analysis, chronology, intake data, and the linked consultation. Use the per-section chat to refine content without disturbing approved sections.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowPreferences((value) => !value)}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50"
            >
              <Cog6ToothIcon className="h-5 w-5" />
              {showPreferences ? 'Hide' : 'Show'} Preferences
            </button>
            <button
              onClick={saveManualEdits}
              disabled={busy || sections.length === 0}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Save Edits
            </button>
          </div>
        </div>
        {statusMessage && (
          <div className="mt-4 rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm text-slate-600">
            {statusMessage}
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Sections</div>
            <div className="mt-4 space-y-2">
              {IME_SECTION_OPTIONS.map((option, index) => {
                const section = sections.find((item) => item.type === option.type);
                const active = option.type === activeSectionType;
                return (
                  <button
                    key={option.type}
                    onClick={() => setActiveSectionType(option.type)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      active ? 'border-blue-300 bg-blue-50 shadow-sm' : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Section {index + 1}</div>
                        <div className="mt-1 text-sm font-black text-slate-800">{option.label}</div>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${
                        section?.status === 'approved'
                          ? 'bg-emerald-100 text-emerald-700'
                          : section?.status === 'insufficient_data'
                            ? 'bg-amber-100 text-amber-700'
                            : section?.status === 'draft'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-slate-200 text-slate-600'
                      }`}>
                        {section?.status || 'pending'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <IMEExport disabled={busy || sections.length === 0} onExport={exportSummary} />

          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Records Reviewed</div>
            <div className="mt-4 space-y-2">
              {recordsReviewed.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  No case documents are available yet.
                </div>
              ) : recordsReviewed.map((record) => (
                <div key={record} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  {record}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Active Section</div>
                <h3 className="mt-2 text-lg font-bold text-slate-900">{activeSection?.label || 'Select a section'}</h3>
                {consultation && (
                  <p className="mt-2 text-sm text-slate-600">
                    Consultation bridge active. Transcript-derived summary and gap questions are included in generation context.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => generateSection(activeSectionType)}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700 disabled:opacity-50"
                >
                  <SparklesIcon className="h-5 w-5" />
                  {activeSection?.content ? 'Regenerate' : 'Generate'}
                </button>
                <button
                  onClick={approveActiveSection}
                  disabled={busy || !activeSection?.content}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  <CheckCircleIcon className="h-5 w-5" />
                  Approve
                </button>
              </div>
            </div>

            <textarea
              value={activeSection?.content || ''}
              onChange={(event) => {
                setSections((current) => current.map((section) => (
                  section.type === activeSectionType
                    ? {
                        ...section,
                        content: event.target.value,
                        status: event.target.value.trim() ? 'draft' : section.status,
                        updatedAt: new Date().toISOString(),
                      }
                    : section
                )));
              }}
              rows={18}
              placeholder="Generate this section to draft content here."
              className="mt-4 w-full rounded-3xl border border-slate-200 px-4 py-4 text-sm leading-relaxed text-slate-700 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
            />

            {/* Source page links */}
            {activeSection?.sourcePages && activeSection.sourcePages.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Source Pages:</span>
                {activeSection.sourcePages.map((page) => (
                  <button
                    key={page}
                    type="button"
                    onClick={() => onNavigateToPage?.(page)}
                    className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 transition hover:bg-blue-100 hover:border-blue-300"
                  >
                    p. {page}
                  </button>
                ))}
              </div>
            )}

            {/* Rendered preview with clickable page links */}
            {activeSection?.content && onNavigateToPage && (
              <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Preview with page links</div>
                <div className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
                  {renderContentWithPageLinks(activeSection.content, onNavigateToPage)}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Refine This Section</div>
            <p className="mt-2 text-sm text-slate-600">Ask for concise wording, a stronger timeline, more emphasis on work limits, or better use of the consultation details.</p>
            <div className="mt-4 flex flex-col gap-3">
              <textarea
                value={chatMessage}
                onChange={(event) => setChatMessage(event.target.value)}
                rows={4}
                placeholder="Example: make this more concise and pull in any page-index evidence about prior injuries."
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
              />
              <div className="flex justify-end">
                <button
                  onClick={refineActiveSection}
                  disabled={busy || !chatMessage.trim()}
                  className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-black text-white transition hover:bg-black disabled:opacity-50"
                >
                  Apply Refinement
                </button>
              </div>
            </div>
          </div>

          {showPreferences && (
            <IMEPreferences
              preferences={preferences}
              templates={templates}
              currentSections={sections}
              onSavePreference={savePreference}
              onDeletePreference={deletePreference}
              onCreateTemplate={createTemplate}
              onDeleteTemplate={deleteTemplate}
            />
          )}
        </div>
      </div>
    </div>
  );
}
