'use client';

import { useState } from 'react';
import {
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  LinkIcon,
  PencilIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ArrowDownTrayIcon,
  InboxIcon,
  SparklesIcon
} from '@heroicons/react/24/outline';

/* ─── Types ─── */

type IntakeProblem = {
  id: string;
  description: string;
  icd10_code?: string | null;
  icd10_description?: string | null;
  status?: string | null;
  source_pages?: number[];
  source_text?: string | null;
  flags?: string[];
  hcc_relevant?: boolean;
  validated?: boolean;
  confidence?: string | null;
};

type IntakeMedication = {
  id: string;
  name?: string | null;
  dose?: string | null;
  frequency?: string | null;
  prescriber?: string | null;
  source_pages?: number[];
  source_text?: string | null;
  flags?: string[];
};

type IntakeWorkup = {
  id: string;
  description?: string | null;
  cpt_code?: string | null;
  cpt_description?: string | null;
  date?: string | null;
  key_findings?: string | null;
  status?: string | null;
  validated?: boolean;
  source_pages?: number[];
  referenced_on_page?: number | null;
};

type IntakeFlag = {
  id: string;
  type?: string | null;
  severity?: string | null;
  description?: string | null;
  explanation?: string | null;
  suggested_action?: string | null;
  page?: number | null;
};

type ClinicalIntake = {
  problem_list?: IntakeProblem[];
  medications?: IntakeMedication[];
  completed_workup?: IntakeWorkup[];
  flags?: IntakeFlag[];
  suggested_next_steps?: string[];
};

type IntakeDecision = {
  item_type: string;
  item_id: string;
  action: string;
  edited_value?: any | null;
  reason?: string | null;
};

type IntakeData = {
  clinical_intake?: ClinicalIntake;
  partial_data?: any;
  decisions?: IntakeDecision[];
  intake_status?: string;
};

interface IntakeSheetProps {
  fileId: string;
  data: IntakeData | null;
  loading: boolean;
  onNavigateToPage?: (page: number) => void;
  onDecisionSave: (decision: IntakeDecision) => Promise<void>;
  onExport: (format: 'csv' | 'pdf' | 'fhir') => void;
  onOpenCodeSearch: (itemId: string, initialQuery: string) => void;
}

/* ─── Component ─── */

export default function IntakeSheet({
  fileId,
  data,
  loading,
  onNavigateToPage,
  onDecisionSave,
  onExport,
  onOpenCodeSearch
}: IntakeSheetProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['problems', 'meds', 'workup', 'flags', 'steps']));
  const [exportOpen, setExportOpen] = useState(false);

  const toggleSection = (id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
        <p className="text-gray-500 font-medium">Loading Clinical Intake Sheet...</p>
      </div>
    );
  }

  const intake = data?.clinical_intake || data?.partial_data?.clinical_intake || {};
  const status = data?.intake_status || 'pending';
  const decisions = data?.decisions || [];

  const getDecision = (type: string, id: string) => decisions.find(d => d.item_type === type && d.item_id === id) || null;

  const isProcessing = status !== 'complete' && status !== 'failed';

  return (
    <div className="space-y-6">
      {/* Header & Export */}
      <div className="flex items-center justify-between pb-4 border-b">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Clinical Intake Sheet</h2>
          <p className="text-sm text-gray-500">Structured decision support from medical records</p>
        </div>
        <div className="flex items-center space-x-2">
          {isProcessing && (
            <div className="flex items-center text-sm text-amber-600 bg-amber-50 px-3 py-1 rounded-full animate-pulse border border-amber-200">
              <SparklesIcon className="w-4 h-4 mr-1.5" />
              Processing: {status.replace(/_/g, ' ')}...
            </div>
          )}
          <div className="relative">
            <button 
              disabled={isProcessing}
              onClick={() => setExportOpen(!exportOpen)}
              className={`flex items-center px-4 py-2 border rounded-lg shadow-sm text-sm font-medium transition-colors ${
                isProcessing 
                  ? 'bg-gray-50 text-gray-400 cursor-not-allowed border-gray-200' 
                  : 'bg-white text-gray-700 hover:bg-gray-50 border-gray-300'
              }`}
            >
              <ArrowDownTrayIcon className="w-4 h-4 mr-2" />
              Export
              <ChevronDownIcon className={`w-4 h-4 ml-2 transition-transform ${exportOpen ? 'rotate-180' : ''}`} />
            </button>
            
            {exportOpen && !isProcessing && (
              <>
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setExportOpen(false)}
                />
                <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden ring-1 ring-black ring-opacity-5 animate-in fade-in zoom-in duration-200 origin-top-right">
                  <div className="py-1">
                    <button 
                      onClick={() => { onExport('csv'); setExportOpen(false); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center"
                    >
                      <InboxIcon className="w-4 h-4 mr-3 text-gray-400" />
                      CSV (Accepted Items)
                    </button>
                    <button 
                      onClick={() => { onExport('pdf'); setExportOpen(false); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center"
                    >
                      <LinkIcon className="w-4 h-4 mr-3 text-gray-400" />
                      PDF Clinical Report
                    </button>
                    <button 
                      onClick={() => { onExport('fhir'); setExportOpen(false); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center border-t border-gray-100 mt-1"
                    >
                      <SparklesIcon className="w-4 h-4 mr-3 text-blue-500" />
                      <div>
                        <div>FHIR R4 Bundle</div>
                        <div className="text-[10px] text-gray-400">Beta v1.1</div>
                      </div>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {status === 'failed' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start">
          <ExclamationTriangleIcon className="w-5 h-5 text-red-600 mt-0.5 mr-3" />
          <div>
            <h3 className="text-sm font-bold text-red-800">Processing Failed</h3>
            <p className="text-sm text-red-700">The intake pipeline encountered an error. Showing partial or last known results.</p>
          </div>
        </div>
      )}

      {isProcessing && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start">
          <InformationCircleIcon className="w-5 h-5 text-blue-600 mt-0.5 mr-3" />
          <div className="flex-1">
            <h3 className="text-sm font-bold text-blue-800">Draft Status</h3>
            <p className="text-sm text-blue-700">The AI is still processing this document. Data below may update automatically.</p>
            <div className="mt-2 w-full bg-blue-100 rounded-full h-1.5">
              <div 
                className="bg-blue-600 h-1.5 rounded-full transition-all duration-1000" 
                style={{ width: status === 'pass_1_complete' ? '33%' : status === 'pass_2_complete' ? '66%' : '10%' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 1. Problem List */}
      <Section 
        title="1. Problem List" 
        id="problems" 
        count={intake.problem_list?.length} 
        isOpen={expandedSections.has('problems')} 
        onToggle={() => toggleSection('problems')}
      >
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-8"></th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">ICD-10</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Description</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-32">Status</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">Source</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100 text-sm">
              {intake.problem_list?.map((dx: IntakeProblem) => {
                const decision = getDecision('diagnosis', dx.id);
                const isRejected = decision?.action === 'rejected';
                return (
                  <tr key={dx.id} className={`${isRejected ? 'bg-gray-50 opacity-60' : ''} hover:bg-slate-50 group`}>
                    <td className="px-4 py-3">
                      <DecisionToggle 
                        action={decision?.action} 
                        processing={false}
                        onAction={(action) => onDecisionSave({ item_type: 'diagnosis', item_id: dx.id, action })} 
                      />
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-blue-600">
                      <button 
                        onClick={() => onOpenCodeSearch(dx.id, dx.description)}
                        className="hover:underline flex items-center"
                      >
                        {dx.icd10_code || '---'} {dx.hcc_relevant && <span className="ml-1 px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[9px] font-bold">HCC</span>}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-start">
                        <div>
                          <div className="font-medium text-gray-900">{dx.description}</div>
                          {dx.icd10_description && <div className="text-xs text-gray-500">{dx.icd10_description}</div>}
                        </div>
                        {dx.flags && dx.flags.length > 0 && (
                          <div className="ml-2 mt-0.5" title={`${dx.flags.length} issues detected`}>
                            <ExclamationTriangleIcon className="w-4 h-4 text-amber-500" />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                        dx.status === 'active' ? 'bg-green-50 text-green-700 border-green-200' : 
                        dx.status === 'resolved' ? 'bg-gray-100 text-gray-600 border-gray-200' : 
                        'bg-amber-50 text-amber-700 border-amber-200'
                      }`}>
                        {(dx.status || 'unknown').toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {dx.source_pages?.map(p => (
                          <button 
                            key={p} 
                            onClick={() => onNavigateToPage?.(p)}
                            className="bg-slate-50 hover:bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200 text-xs flex items-center transition-colors"
                          >
                            p. {p}
                            <LinkIcon className="w-2.5 h-2.5 ml-1" />
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {(!intake.problem_list || intake.problem_list.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    <InboxIcon className="w-10 h-10 mx-auto mb-2 opacity-20" />
                    No diagnoses extracted yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 2. Medications */}
      <Section 
        title="2. Medications" 
        id="meds" 
        count={intake.medications?.length} 
        isOpen={expandedSections.has('meds')} 
        onToggle={() => toggleSection('meds')}
      >
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-8"></th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Drug Name</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-32">Dose / Freq</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-32">Prescriber</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">Source</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100 text-sm">
              {intake.medications?.map((med: IntakeMedication) => {
                const decision = getDecision('medication', med.id);
                const isRejected = decision?.action === 'rejected';
                return (
                  <tr key={med.id} className={`${isRejected ? 'bg-gray-50 opacity-60' : ''} hover:bg-slate-50`}>
                    <td className="px-4 py-3">
                      <DecisionToggle 
                        action={decision?.action} 
                        processing={false}
                        onAction={(action) => onDecisionSave({ item_type: 'medication', item_id: med.id, action })} 
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center">
                        <span className="font-medium text-gray-900">{med.name}</span>
                        {med.flags && med.flags.length > 0 && (
                          <div className="ml-2" title={`${med.flags.length} issues detected`}>
                            <ExclamationTriangleIcon className="w-4 h-4 text-amber-500" />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {med.dose || '---'} {med.frequency}
                    </td>
                    <td className="px-4 py-3 text-gray-500 italic">{med.prescriber || 'unknown'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {med.source_pages?.map(p => (
                          <button key={p} onClick={() => onNavigateToPage?.(p)} className="bg-slate-50 text-slate-700 px-1.5 py-0.5 rounded border text-xs">p. {p}</button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {(!intake.medications || intake.medications.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">No medications extracted yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 3. Completed Workup */}
      <Section 
        title="3. Completed Workup" 
        id="workup" 
        count={intake.completed_workup?.length} 
        isOpen={expandedSections.has('workup')} 
        onToggle={() => toggleSection('workup')}
      >
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-8"></th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">CPT</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Description / Findings</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-32">Date / Status</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">Source</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100 text-sm">
              {intake.completed_workup?.map((p: IntakeWorkup) => {
                const decision = getDecision('workup', p.id);
                const isRejected = decision?.action === 'rejected';
                return (
                  <tr key={p.id} className={`${isRejected ? 'bg-gray-50 opacity-60' : ''} hover:bg-slate-50`}>
                    <td className="px-4 py-3">
                      <DecisionToggle 
                        action={decision?.action} 
                        processing={false}
                        onAction={(action) => onDecisionSave({ item_type: 'workup', item_id: p.id, action })} 
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-600">{p.cpt_code || '---'}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{p.description}</div>
                      {p.key_findings && <div className="text-xs text-blue-600 mt-1">Findings: {p.key_findings}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900 font-medium">{p.date || '---'}</div>
                      <div className={`text-[10px] uppercase font-bold ${p.status === 'completed' ? 'text-green-600' : 'text-amber-600 animate-pulse'}`}>
                        {p.status}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {p.source_pages?.map(pg => (
                          <button key={pg} onClick={() => onNavigateToPage?.(pg)} className="bg-slate-50 text-slate-700 px-1.5 py-0.5 rounded border text-xs">p. {pg}</button>
                        ))}
                        {p.referenced_on_page && (
                          <button onClick={() => onNavigateToPage?.(p.referenced_on_page!)} className="bg-red-50 text-red-700 px-1.5 py-0.5 rounded border border-red-100 text-[10px] font-bold">MISSING (ref p.{p.referenced_on_page})</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 4. Missing Data Flags */}
      <Section 
        title="4. Missing Data & Flags" 
        id="flags" 
        count={intake.flags?.length} 
        isOpen={expandedSections.has('flags')} 
        onToggle={() => toggleSection('flags')}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {intake.flags?.map((f: IntakeFlag) => {
            const decision = getDecision('flag', f.id);
            if (decision?.action === 'dismissed') return null;
            return (
              <div key={f.id} className={`p-4 rounded-xl border relative shadow-sm transition-all hover:shadow-md ${
                f.severity === 'critical' ? 'bg-red-50 border-red-200' : 
                f.severity === 'warning' ? 'bg-amber-50 border-amber-200' : 
                'bg-blue-50 border-blue-200'
              }`}>
                <div className="flex justify-between items-start mb-2">
                  <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                    f.severity === 'critical' ? 'bg-red-600 text-white' : 
                    f.severity === 'warning' ? 'bg-amber-600 text-white' : 
                    'bg-blue-600 text-white'
                  }`}>
                    {f.type?.replace(/_/g, ' ')}
                  </div>
                  <button 
                    onClick={() => onDecisionSave({ item_type: 'flag', item_id: f.id, action: 'dismissed' })}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <XCircleIcon className="w-5 h-5" />
                  </button>
                </div>
                <h4 className="font-bold text-gray-900 mb-1">{f.description}</h4>
                <p className="text-sm text-gray-700 mb-3 leading-relaxed">{f.explanation}</p>
                {f.suggested_action && (
                  <div className="bg-white/60 p-2 rounded-lg border border-white/50 text-xs text-gray-800 flex items-center shadow-inner">
                    <SparklesIcon className="w-4 h-4 mr-2 text-indigo-600" />
                    <span className="font-medium">Suggest: {f.suggested_action}</span>
                  </div>
                )}
                {f.page && (
                  <button onClick={() => onNavigateToPage?.(f.page!)} className="mt-3 text-[10px] font-bold text-blue-600 hover:underline">
                    View Reference (p. {f.page})
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* 5. Suggested Next Steps */}
      <Section 
        title="5. Suggested Next Steps" 
        id="steps" 
        count={intake.suggested_next_steps?.length} 
        isOpen={expandedSections.has('steps')} 
        onToggle={() => toggleSection('steps')}
      >
        <ul className="space-y-3">
          {intake.suggested_next_steps?.map((step: string, idx: number) => (
            <li key={idx} className="flex items-start p-4 bg-white border rounded-xl shadow-sm hover:border-blue-300 transition-all cursor-pointer group">
              <div className="w-5 h-5 rounded-full border-2 border-slate-300 mr-4 mt-0.5 flex-shrink-0 group-hover:border-blue-500 transition-colors" />
              <span className="text-slate-700 font-medium">{step}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

/* ─── Subcomponents ─── */

function Section({ title, id, count, isOpen, onToggle, children }: { 
  title: string; 
  id: string; 
  count?: number; 
  isOpen: boolean; 
  onToggle: () => void; 
  children: React.ReactNode 
}) {
  return (
    <div className="border bg-white rounded-2xl shadow-sm overflow-hidden">
      <button 
        onClick={onToggle}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center">
          <span className="text-lg font-bold text-slate-800">{title}</span>
          {count !== undefined && (
            <span className="ml-3 bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full text-xs font-bold ring-1 ring-slate-200">
              {count}
            </span>
          )}
        </div>
        {isOpen ? <ChevronDownIcon className="w-5 h-5 text-slate-400" /> : <ChevronRightIcon className="w-5 h-5 text-slate-400" />}
      </button>
      {isOpen && (
        <div className="px-6 pb-6 animate-in slide-in-from-top-1 duration-200">
          {children}
        </div>
      )}
    </div>
  );
}

function DecisionToggle({ action, onAction, processing }: { 
  action?: string; 
  onAction: (action: string) => void; 
  processing?: boolean 
}) {
  return (
    <div className="flex items-center space-x-2">
      <button 
        onClick={() => onAction(action === 'accepted' ? 'pending' : 'accepted')}
        disabled={processing}
        title="Accept item"
        className={`p-1.5 rounded-lg transition-all ${
          action === 'accepted' ? 'bg-green-100 text-green-700 shadow-sm' : 'bg-gray-50 text-gray-300 hover:bg-gray-100 hover:text-gray-500'
        }`}
      >
        <CheckCircleIcon className="w-5 h-5" />
      </button>
      <button 
        onClick={() => onAction(action === 'rejected' ? 'pending' : 'rejected')}
        disabled={processing}
        title="Reject item"
        className={`p-1.5 rounded-lg transition-all ${
          action === 'rejected' ? 'bg-red-100 text-red-700 shadow-sm' : 'bg-gray-50 text-gray-300 hover:bg-gray-100 hover:text-gray-500'
        }`}
      >
        <XCircleIcon className="w-5 h-5" />
      </button>
    </div>
  );
}
