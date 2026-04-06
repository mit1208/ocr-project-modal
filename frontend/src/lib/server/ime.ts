import { GoogleGenerativeAI } from '@google/generative-ai';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createSupabaseServiceClient } from './slm';

export type ConsultationSpeaker = 'doctor' | 'patient';
export type ImeSectionType =
  | 'demographics_history'
  | 'records_reviewed'
  | 'mechanism_of_injury'
  | 'current_complaints_functional_limitations'
  | 'diagnoses_treatment_timeline'
  | 'pre_existing_conditions'
  | 'suggested_physician_questions';

export type ImeSectionStatus = 'pending' | 'draft' | 'approved' | 'insufficient_data';

export type ConsultationChecklistItem = {
  key: string;
  label: string;
  prompt: string;
};

export type ConsultationSummaryShape = {
  chiefComplaint: string;
  historyOfPresentIllness: string;
  currentSymptoms: string;
  functionalLimitations: string;
  patientReportedHistory: string;
};

export type SuggestedQuestion = {
  key: string;
  label: string;
  covered: boolean;
  priority: 'high' | 'medium' | 'low';
  suggestedQuestion: string;
  rationale: string;
};

export type ImeSectionRecord = {
  type: ImeSectionType;
  label: string;
  status: ImeSectionStatus;
  content: string;
  lastInstruction?: string | null;
  updatedAt?: string | null;
};

export type ImeTemplateRecord = {
  id: string;
  name: string;
  is_default: boolean;
  sections: unknown;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ImePreferenceRecord = {
  id: string;
  preference_key: string;
  preference_value: Record<string, unknown>;
  confidence: number;
  updated_at?: string | null;
};

export type ConsultationTranscriptEntry = {
  id: string;
  sequence: number;
  speaker: ConsultationSpeaker;
  text: string;
  timestamp: number;
  created_at?: string | null;
};

export type ConsultationSessionPayload = {
  id: string;
  case_id: string;
  status: 'recording' | 'paused' | 'completed';
  title?: string | null;
  started_at: string;
  ended_at?: string | null;
  speaker_labels?: Record<string, string> | null;
  transcript: ConsultationTranscriptEntry[];
  summary: ConsultationSummaryShape;
  suggestedQuestions: SuggestedQuestion[];
  version: number;
};

type DocumentRow = {
  case_id: string;
  file_id: string;
  filename: string;
  created_at: string;
};

type AnalysisRow = {
  file_id: string;
  document_type?: string | null;
  clinical_summary?: string | null;
  timeline?: unknown;
  timeline_index?: unknown;
  page_index?: unknown;
  document_index?: unknown;
  groups?: unknown;
  clinical_intake?: unknown;
  contradictions?: unknown;
};

type ConsultationSummaryRow = {
  summary_json?: unknown;
  suggested_questions_json?: unknown;
  version?: number | null;
};

type ConsultationSessionRow = {
  id: string;
  case_id: string;
  status: 'recording' | 'paused' | 'completed';
  title?: string | null;
  started_at: string;
  ended_at?: string | null;
  speaker_labels?: Record<string, string> | null;
};

type ImeSummaryRow = {
  id: string;
  case_id: string;
  status: 'draft' | 'in_progress' | 'completed';
  title?: string | null;
  consultation_session_id?: string | null;
  sections?: unknown;
  template_id?: string | null;
  steering_context?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type ImeSectionChatRow = {
  messages?: unknown;
};

type TimelineItem = {
  date?: string;
  event?: string;
  page?: number;
  category?: string;
  patient_name?: string | null;
};

type ImeCaseDocument = {
  fileId: string;
  filename: string;
  createdAt: string;
  documentType: string;
  clinicalSummary: string;
  timelineItems: TimelineItem[];
  documentIndexSummary: string[];
  pageIndexSummary: string[];
  intakeSummary: string[];
  contradictionSummary: string[];
};

export type ImeCaseContext = {
  caseId: string;
  documents: ImeCaseDocument[];
  recordsReviewed: string[];
  consultation: ConsultationSessionPayload | null;
  preferences: ImePreferenceRecord[];
  templates: ImeTemplateRecord[];
  timeline: TimelineItem[];
};

export const CONSULTATION_CHECKLIST: ConsultationChecklistItem[] = [
  {
    key: 'injury_date_mechanism',
    label: 'Date and mechanism of injury',
    prompt: 'Ask for the exact date of injury and how it happened.',
  },
  {
    key: 'pre_existing_conditions',
    label: 'Pre-existing conditions',
    prompt: 'Clarify any prior issues affecting the same body region before this injury.',
  },
  {
    key: 'current_symptoms',
    label: 'Current symptoms',
    prompt: 'Clarify pain level, symptom frequency, triggers, and relieving factors.',
  },
  {
    key: 'functional_limitations',
    label: 'Functional limitations',
    prompt: 'Ask how the condition affects daily living, mobility, self-care, and work capacity.',
  },
  {
    key: 'treatment_history',
    label: 'Treatment history',
    prompt: 'Review past treatment, current treatment, and whether it helped.',
  },
  {
    key: 'medication_history',
    label: 'Medication history',
    prompt: 'Review current and prior medications along with benefit or side effects.',
  },
  {
    key: 'diagnostic_imaging',
    label: 'Diagnostic imaging and tests',
    prompt: 'Ask about imaging, test results, and what the patient was told.',
  },
  {
    key: 'progress_regression',
    label: 'Progress or regression',
    prompt: 'Clarify whether the patient feels better, worse, or unchanged over time.',
  },
  {
    key: 'work_status',
    label: 'Work status and job demands',
    prompt: 'Ask about current work status, restrictions, and physical demands of the job.',
  },
  {
    key: 'prior_injuries_claims',
    label: 'Prior injuries or claims',
    prompt: 'Clarify prior injuries, prior claims, or similar episodes involving the same body region.',
  },
];

export const IME_SECTION_DEFINITIONS: { type: ImeSectionType; label: string; description: string }[] = [
  {
    type: 'demographics_history',
    label: 'Patient Demographics & History',
    description: 'Identify the patient, relevant background, and key history from the records and consultation.',
  },
  {
    type: 'records_reviewed',
    label: 'Records Reviewed',
    description: 'List all reviewed records with document type, date, and provider context when available.',
  },
  {
    type: 'mechanism_of_injury',
    label: 'Mechanism of Injury',
    description: 'Describe how the injury reportedly occurred and note any conflicting accounts.',
  },
  {
    type: 'current_complaints_functional_limitations',
    label: 'Current Complaints & Functional Limitations',
    description: 'Summarize current symptoms, pain behavior, and functional impact.',
  },
  {
    type: 'diagnoses_treatment_timeline',
    label: 'Relevant Diagnoses & Treatment Timeline',
    description: 'Summarize diagnoses, chronology, treatments, and notable imaging or testing.',
  },
  {
    type: 'pre_existing_conditions',
    label: 'Pre-Existing Conditions Assessment',
    description: 'Assess pre-existing findings that may overlap with the claimed injury.',
  },
  {
    type: 'suggested_physician_questions',
    label: 'Suggested IME Physician Questions',
    description: 'Surface unresolved gaps, contradictions, and follow-up questions for the examining physician.',
  },
];

export const EMPTY_SUMMARY: ConsultationSummaryShape = {
  chiefComplaint: '',
  historyOfPresentIllness: '',
  currentSymptoms: '',
  functionalLimitations: '',
  patientReportedHistory: '',
};

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getGeminiModel() {
  const genAI = new GoogleGenerativeAI(getRequiredEnv('GEMINI_API_KEY'));
  return genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelayMs = 500): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isRetryable = err?.status === 429 || err?.status === 503 || err?.message?.includes('RESOURCE_EXHAUSTED') || err?.message?.includes('overloaded');
      if (!isRetryable || attempt === maxRetries) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 200;
      console.warn(`[IME Gemini] Attempt ${attempt} failed (${err.message}), retrying in ${Math.round(delay)}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable');
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(stripCodeFence(value)) as T;
  } catch {
    return fallback;
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function summarizeIntake(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const intake = value as Record<string, unknown>;
  const problems = Array.isArray(intake.problem_list) ? intake.problem_list : [];
  const medications = Array.isArray(intake.medications) ? intake.medications : [];
  const workup = Array.isArray(intake.completed_workup) ? intake.completed_workup : [];

  const summaries: string[] = [];

  for (const item of problems.slice(0, 8)) {
    const row = item as Record<string, unknown>;
    const description = asString(row.description);
    const code = asString(row.icd10_code);
    if (description) {
      summaries.push(code ? `${description} (${code})` : description);
    }
  }

  for (const item of medications.slice(0, 5)) {
    const row = item as Record<string, unknown>;
    const name = asString(row.name);
    const dose = asString(row.dose);
    if (name) {
      summaries.push(dose ? `${name} ${dose}` : name);
    }
  }

  for (const item of workup.slice(0, 5)) {
    const row = item as Record<string, unknown>;
    const description = asString(row.description);
    const finding = asString(row.key_findings);
    if (description) {
      summaries.push(finding ? `${description}: ${finding}` : description);
    }
  }

  return summaries;
}

function summarizeContradictions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 8)
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const row = item as Record<string, unknown>;
      return asString(row.description) || asString(row.summary) || asString(row.type);
    })
    .filter(Boolean);
}

function summarizeIndexEntries(value: unknown): string[] {
  const entries: string[] = [];

  const pushRow = (row: Record<string, unknown>, fallbackKey?: string) => {
    const page = typeof row.page === 'number' ? `Page ${row.page}` : '';
    const title = asString(row.title) || asString(row.label) || asString(row.heading) || asString(row.section) || fallbackKey || '';
    const summary = asString(row.summary) || asString(row.description) || asString(row.text);
    const entry = [page, title, summary].filter(Boolean).join(': ').trim();
    if (entry) entries.push(entry);
  };

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 16)) {
      if (!item || typeof item !== 'object') continue;
      pushRow(item as Record<string, unknown>);
    }
    return entries;
  }

  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;

    if (Array.isArray(row.pages)) {
      for (const item of row.pages.slice(0, 16)) {
        if (!item || typeof item !== 'object') continue;
        pushRow(item as Record<string, unknown>);
      }
      return entries;
    }

    for (const [key, child] of Object.entries(row).slice(0, 16)) {
      if (!child || typeof child !== 'object') continue;
      pushRow(child as Record<string, unknown>, key);
    }
  }

  return entries;
}

function normalizeTimeline(value: unknown): TimelineItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const page = typeof row.page === 'number' ? row.page : undefined;
      const event = asString(row.event) || asString(row.description);
      if (!event) return null;
      return {
        date: asString(row.date),
        event,
        page,
        category: asString(row.category),
        patient_name: asString(row.patient_name) || null,
      } satisfies TimelineItem;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item)) as TimelineItem[];
}

function scoreTimelineItem(item: TimelineItem): number {
  const pageScore = item.page ? 1 : 0;
  const dateScore = item.date ? 1 : 0;
  return pageScore + dateScore;
}

function sortTimeline(items: TimelineItem[]): TimelineItem[] {
  return [...items].sort((a, b) => {
    const aDate = a.date ? Date.parse(a.date) : Number.NaN;
    const bDate = b.date ? Date.parse(b.date) : Number.NaN;
    if (Number.isFinite(aDate) && Number.isFinite(bDate) && aDate !== bDate) {
      return aDate - bDate;
    }
    return scoreTimelineItem(b) - scoreTimelineItem(a);
  });
}

function formatJsonContext(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function createDefaultImeSections(): ImeSectionRecord[] {
  const now = new Date().toISOString();
  return IME_SECTION_DEFINITIONS.map((section) => ({
    type: section.type,
    label: section.label,
    status: 'pending',
    content: '',
    updatedAt: now,
  }));
}

export function normalizeImeSections(raw: unknown): ImeSectionRecord[] {
  const existing = Array.isArray(raw) ? raw : [];
  const byType = new Map<ImeSectionType, ImeSectionRecord>();

  for (const item of existing) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const type = asString(row.type) as ImeSectionType;
    if (!IME_SECTION_DEFINITIONS.some((section) => section.type === type)) continue;
    byType.set(type, {
      type,
      label: asString(row.label) || IME_SECTION_DEFINITIONS.find((section) => section.type === type)?.label || type,
      status: (asString(row.status) as ImeSectionStatus) || 'pending',
      content: asString(row.content),
      lastInstruction: asString(row.lastInstruction) || null,
      updatedAt: asString(row.updatedAt) || null,
    });
  }

  return IME_SECTION_DEFINITIONS.map((section) => {
    const match = byType.get(section.type);
    return match || {
      type: section.type,
      label: section.label,
      status: 'pending',
      content: '',
      updatedAt: null,
    };
  });
}

async function callGeminiJson<T>(prompt: string, fallback: T): Promise<T> {
  try {
    const model = getGeminiModel();
    const result = await withRetry(() => model.generateContent(prompt));
    const text = result.response.text();
    return safeJsonParse<T>(text, fallback);
  } catch (error) {
    console.error('[IME] Gemini JSON call failed:', error);
    return fallback;
  }
}

export async function loadImePreferences(userId: string): Promise<ImePreferenceRecord[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from('user_ime_preferences')
    .select('id, preference_key, preference_value, confidence, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as ImePreferenceRecord[];
}

export async function loadImeTemplates(userId: string): Promise<ImeTemplateRecord[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from('ime_templates')
    .select('id, name, is_default, sections, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as ImeTemplateRecord[];
}

export async function loadConsultationSession(userId: string, sessionId: string): Promise<ConsultationSessionPayload | null> {
  const supabase = createSupabaseServiceClient();
  const { data: session, error: sessionError } = await supabase
    .from('consultation_sessions')
    .select('id, case_id, status, title, started_at, ended_at, speaker_labels')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .maybeSingle();

  if (sessionError) {
    throw new Error(sessionError.message);
  }

  if (!session) {
    return null;
  }

  const [{ data: transcriptRows, error: transcriptError }, { data: summaryRows, error: summaryError }] = await Promise.all([
    supabase
      .from('consultation_transcript')
      .select('id, sequence, speaker, text, timestamp, created_at')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .order('sequence', { ascending: true }),
    supabase
      .from('consultation_summary')
      .select('summary_json, suggested_questions_json, version')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .order('version', { ascending: false })
      .limit(1),
  ]);

  if (transcriptError) {
    throw new Error(transcriptError.message);
  }
  if (summaryError) {
    throw new Error(summaryError.message);
  }

  const summaryRow = ((summaryRows || [])[0] || {}) as ConsultationSummaryRow;
  const summaryData = summaryRow.summary_json && typeof summaryRow.summary_json === 'object'
    ? summaryRow.summary_json as Record<string, unknown>
    : {};

  return {
    ...(session as ConsultationSessionRow),
    transcript: (transcriptRows || []) as ConsultationTranscriptEntry[],
    summary: {
      chiefComplaint: asString(summaryData.chiefComplaint),
      historyOfPresentIllness: asString(summaryData.historyOfPresentIllness),
      currentSymptoms: asString(summaryData.currentSymptoms),
      functionalLimitations: asString(summaryData.functionalLimitations),
      patientReportedHistory: asString(summaryData.patientReportedHistory),
    },
    suggestedQuestions: Array.isArray(summaryRow.suggested_questions_json)
      ? summaryRow.suggested_questions_json as SuggestedQuestion[]
      : [],
    version: typeof summaryRow.version === 'number' ? summaryRow.version : 0,
  };
}

export async function loadLatestConsultationForCase(userId: string, caseId: string): Promise<ConsultationSessionPayload | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from('consultation_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('case_id', caseId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.id) {
    return null;
  }

  return loadConsultationSession(userId, data.id);
}

export async function loadImeSummary(userId: string, caseId: string): Promise<ImeSummaryRow | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from('ime_summaries')
    .select('id, case_id, status, title, consultation_session_id, sections, template_id, steering_context, created_at, updated_at')
    .eq('user_id', userId)
    .eq('case_id', caseId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data || null) as ImeSummaryRow | null;
}

export async function ensureImeSummary(options: {
  userId: string;
  caseId: string;
  consultationSessionId?: string | null;
  templateId?: string | null;
  title?: string | null;
}): Promise<ImeSummaryRow> {
  const existing = await loadImeSummary(options.userId, options.caseId);
  const supabase = createSupabaseServiceClient();

  if (existing) {
    const updatePayload: Record<string, unknown> = {};
    if (options.consultationSessionId !== undefined) {
      updatePayload.consultation_session_id = options.consultationSessionId;
    }
    if (options.templateId !== undefined) {
      updatePayload.template_id = options.templateId;
    }
    if (options.title !== undefined) {
      updatePayload.title = options.title;
    }
    if (Object.keys(updatePayload).length > 0) {
      const { data, error } = await supabase
        .from('ime_summaries')
        .update(updatePayload)
        .eq('id', existing.id)
        .select('id, case_id, status, title, consultation_session_id, sections, template_id, steering_context, created_at, updated_at')
        .single();

      if (error) {
        throw new Error(error.message);
      }
      return data as ImeSummaryRow;
    }

    return existing;
  }

  const { data, error } = await supabase
    .from('ime_summaries')
    .insert({
      user_id: options.userId,
      case_id: options.caseId,
      consultation_session_id: options.consultationSessionId || null,
      template_id: options.templateId || null,
      title: options.title || `IME Summary ${new Date().toLocaleDateString('en-US')}`,
      status: 'draft',
      sections: createDefaultImeSections(),
      steering_context: {},
    })
    .select('id, case_id, status, title, consultation_session_id, sections, template_id, steering_context, created_at, updated_at')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as ImeSummaryRow;
}

export async function buildImeCaseContext(options: {
  userId: string;
  caseId: string;
  consultationSessionId?: string | null;
}): Promise<ImeCaseContext> {
  const supabase = createSupabaseServiceClient();
  const { data: docs, error: docsError } = await supabase
    .from('documents')
    .select('case_id, file_id, filename, created_at')
    .eq('user_id', options.userId)
    .eq('case_id', options.caseId)
    .order('created_at', { ascending: true });

  if (docsError) {
    throw new Error(docsError.message);
  }

  const documents = (docs || []) as DocumentRow[];
  const fileIds = documents.map((doc) => doc.file_id);

  const { data: analyses, error: analysesError } = fileIds.length > 0
    ? await supabase
        .from('ai_analysis')
        .select('file_id, document_type, clinical_summary, timeline, timeline_index, page_index, document_index, groups, clinical_intake, contradictions')
        .in('file_id', fileIds)
    : { data: [], error: null };

  if (analysesError) {
    throw new Error(analysesError.message);
  }

  const analysisByFileId = new Map<string, AnalysisRow>();
  for (const row of (analyses || []) as AnalysisRow[]) {
    analysisByFileId.set(row.file_id, row);
  }

  const contextDocuments: ImeCaseDocument[] = documents.map((doc) => {
    const analysis = analysisByFileId.get(doc.file_id);
    const timelineItems = normalizeTimeline(analysis?.timeline_index || analysis?.timeline);
    return {
      fileId: doc.file_id,
      filename: doc.filename,
      createdAt: doc.created_at,
      documentType: asString(analysis?.document_type) || 'Medical record',
      clinicalSummary: asString(analysis?.clinical_summary),
      timelineItems,
      documentIndexSummary: summarizeIndexEntries(analysis?.document_index),
      pageIndexSummary: summarizeIndexEntries(analysis?.page_index),
      intakeSummary: summarizeIntake(analysis?.clinical_intake),
      contradictionSummary: summarizeContradictions(analysis?.contradictions),
    };
  });

  const timeline = sortTimeline(contextDocuments.flatMap((document) => document.timelineItems)).slice(0, 40);
  const recordsReviewed = contextDocuments.map((document) => {
    const dateLabel = document.createdAt ? new Date(document.createdAt).toLocaleDateString('en-US') : 'Undated';
    return `${document.filename} (${document.documentType}, uploaded ${dateLabel})`;
  });

  const consultation = options.consultationSessionId
    ? await loadConsultationSession(options.userId, options.consultationSessionId)
    : await loadLatestConsultationForCase(options.userId, options.caseId);

  const [preferences, templates] = await Promise.all([
    loadImePreferences(options.userId),
    loadImeTemplates(options.userId),
  ]);

  return {
    caseId: options.caseId,
    documents: contextDocuments,
    recordsReviewed,
    consultation,
    preferences,
    templates,
    timeline,
  };
}

function buildConsultationFallback(transcript: ConsultationTranscriptEntry[]): {
  summary: ConsultationSummaryShape;
  suggestedQuestions: SuggestedQuestion[];
} {
  const patientEntries = transcript.filter((entry) => entry.speaker === 'patient').map((entry) => entry.text);
  const doctorEntries = transcript.filter((entry) => entry.speaker === 'doctor').map((entry) => entry.text);
  const combinedPatient = patientEntries.join(' ').trim();

  const suggestedQuestions = CONSULTATION_CHECKLIST.map((item) => ({
    key: item.key,
    label: item.label,
    covered: false,
    priority: 'medium' as const,
    suggestedQuestion: item.prompt,
    rationale: 'Default follow-up prompt while structured coverage is still being established.',
  }));

  return {
    summary: {
      chiefComplaint: combinedPatient.slice(0, 220),
      historyOfPresentIllness: combinedPatient.slice(0, 500),
      currentSymptoms: combinedPatient.slice(0, 300),
      functionalLimitations: '',
      patientReportedHistory: doctorEntries.slice(0, 2).join(' '),
    },
    suggestedQuestions,
  };
}

export async function generateConsultationInsights(
  transcript: ConsultationTranscriptEntry[],
  previousSummary?: ConsultationSummaryShape | null,
): Promise<{ summary: ConsultationSummaryShape; suggestedQuestions: SuggestedQuestion[] }> {
  if (transcript.length === 0) {
    return {
      summary: previousSummary || EMPTY_SUMMARY,
      suggestedQuestions: CONSULTATION_CHECKLIST.map((item) => ({
        key: item.key,
        label: item.label,
        covered: false,
        priority: 'medium',
        suggestedQuestion: item.prompt,
        rationale: 'Topic has not been discussed yet.',
      })),
    };
  }

  const fallback = buildConsultationFallback(transcript);
  const transcriptText = transcript
    .map((entry) => `[${entry.sequence}] ${entry.speaker.toUpperCase()}: ${entry.text}`)
    .join('\n');

  const prompt = `You are assisting with an Independent Medical Examination consultation.

Return strict JSON with keys:
- summary: {
    "chiefComplaint": string,
    "historyOfPresentIllness": string,
    "currentSymptoms": string,
    "functionalLimitations": string,
    "patientReportedHistory": string
  }
- suggestedQuestions: array of {
    "key": string,
    "label": string,
    "covered": boolean,
    "priority": "high" | "medium" | "low",
    "suggestedQuestion": string,
    "rationale": string
  }

Keep the summary factual and concise. If a checklist item is already covered, mark it covered and do not ask a redundant question.

Checklist:
${formatJsonContext(CONSULTATION_CHECKLIST)}

Previous summary:
${formatJsonContext(previousSummary || EMPTY_SUMMARY)}

Transcript:
${transcriptText}`;

  const result = await callGeminiJson(prompt, fallback);
  const summaryRaw = result && typeof result === 'object' && 'summary' in (result as Record<string, unknown>)
    ? ((result as Record<string, unknown>).summary as Record<string, unknown>)
    : {};
  const questionsRaw = result && typeof result === 'object' && 'suggestedQuestions' in (result as Record<string, unknown>)
    ? (result as Record<string, unknown>).suggestedQuestions
    : [];

  const suggestedQuestions = Array.isArray(questionsRaw)
    ? questionsRaw.map((item) => {
        const row = item as Record<string, unknown>;
        return {
          key: asString(row.key),
          label: asString(row.label),
          covered: Boolean(row.covered),
          priority: (asString(row.priority) as SuggestedQuestion['priority']) || 'medium',
          suggestedQuestion: asString(row.suggestedQuestion),
          rationale: asString(row.rationale),
        };
      }).filter((item) => item.key && item.label && item.suggestedQuestion)
    : fallback.suggestedQuestions;

  return {
    summary: {
      chiefComplaint: asString(summaryRaw.chiefComplaint) || fallback.summary.chiefComplaint,
      historyOfPresentIllness: asString(summaryRaw.historyOfPresentIllness) || fallback.summary.historyOfPresentIllness,
      currentSymptoms: asString(summaryRaw.currentSymptoms) || fallback.summary.currentSymptoms,
      functionalLimitations: asString(summaryRaw.functionalLimitations) || fallback.summary.functionalLimitations,
      patientReportedHistory: asString(summaryRaw.patientReportedHistory) || fallback.summary.patientReportedHistory,
    },
    suggestedQuestions: suggestedQuestions.length > 0 ? suggestedQuestions : fallback.suggestedQuestions,
  };
}

function buildSectionFallback(sectionType: ImeSectionType, context: ImeCaseContext): string {
  switch (sectionType) {
    case 'records_reviewed':
      return context.recordsReviewed.length > 0
        ? context.recordsReviewed.map((item) => `- ${item}`).join('\n')
        : 'Insufficient data: no case documents were available for records reviewed.';
    case 'suggested_physician_questions':
      if (context.consultation?.suggestedQuestions?.length) {
        return context.consultation.suggestedQuestions
          .filter((question) => !question.covered)
          .map((question) => `- ${question.suggestedQuestion}`)
          .join('\n') || 'No outstanding consultation gaps were detected.';
      }
      return CONSULTATION_CHECKLIST.map((item) => `- ${item.prompt}`).join('\n');
    case 'diagnoses_treatment_timeline':
      if (context.timeline.length > 0) {
        return context.timeline
          .slice(0, 12)
          .map((item) => `- ${item.date || 'Undated'}: ${item.event}${item.page ? ` (page ${item.page})` : ''}`)
          .join('\n');
      }
      return context.documents
        .flatMap((document) => document.intakeSummary)
        .slice(0, 12)
        .map((item) => `- ${item}`)
        .join('\n') || 'Insufficient data to build a treatment timeline.';
    default: {
      const documentSummaries = context.documents
        .map((document) => document.clinicalSummary)
        .filter(Boolean)
        .slice(0, 4);
      if (documentSummaries.length > 0) {
        return documentSummaries.join('\n\n');
      }
      if (context.consultation) {
        return Object.values(context.consultation.summary).filter(Boolean).join('\n\n') || 'Insufficient data.';
      }
      return 'Insufficient data.';
    }
  }
}

function summarizePreferences(preferences: ImePreferenceRecord[], steeringContext?: Record<string, unknown> | null): string {
  const lines: string[] = [];
  for (const preference of preferences) {
    lines.push(`${preference.preference_key}: ${formatJsonContext(preference.preference_value)}`);
  }
  if (steeringContext && Object.keys(steeringContext).length > 0) {
    lines.push(`session_steering: ${formatJsonContext(steeringContext)}`);
  }
  return lines.length > 0 ? lines.join('\n') : 'No user preferences recorded yet.';
}

function buildSectionPrompt(options: {
  sectionType: ImeSectionType;
  context: ImeCaseContext;
  currentSections: ImeSectionRecord[];
  steeringContext?: Record<string, unknown> | null;
}) {
  const sectionDef = IME_SECTION_DEFINITIONS.find((section) => section.type === options.sectionType);
  const fallback = buildSectionFallback(options.sectionType, options.context);
  const consultationSnapshot = options.context.consultation
    ? {
        summary: options.context.consultation.summary,
        suggestedQuestions: options.context.consultation.suggestedQuestions.filter((item) => !item.covered),
        transcript: options.context.consultation.transcript.slice(-10),
      }
    : null;

  return {
    fallback,
    prompt: `You are drafting one section of a plaintiff-side Independent Medical Examination summary.

Return strict JSON:
{
  "content": string,
  "status": "draft" | "insufficient_data",
  "notes": string
}

Instructions:
- Section: ${sectionDef?.label}
- Goal: ${sectionDef?.description}
- Use only the supplied case context.
- If evidence is thin, say so explicitly and use status "insufficient_data".
- Do not invent providers, dates, diagnoses, or tests.
- Prefer clear prose with short paragraphs or bullet lists where appropriate.
- Mention contradictions when they matter.
- When page_index evidence is available, refer to the relevant page number in the prose.

User preferences:
${summarizePreferences(options.context.preferences, options.steeringContext)}

Current section states:
${formatJsonContext(options.currentSections.map((section) => ({
  type: section.type,
  status: section.status,
  content: section.content.slice(0, 800),
})))}

Case documents:
${formatJsonContext(options.context.documents)}

Case timeline:
${formatJsonContext(options.context.timeline.slice(0, 20))}

Consultation context:
${formatJsonContext(consultationSnapshot)}
`,
  };
}

export async function generateImeSection(options: {
  sectionType: ImeSectionType;
  context: ImeCaseContext;
  currentSections: ImeSectionRecord[];
  steeringContext?: Record<string, unknown> | null;
}): Promise<{ content: string; status: ImeSectionStatus; notes?: string }> {
  const { prompt, fallback } = buildSectionPrompt(options);
  const result = await callGeminiJson<{ content?: string; status?: ImeSectionStatus; notes?: string }>(prompt, {
    content: fallback,
    status: fallback.startsWith('Insufficient data') ? 'insufficient_data' : 'draft',
    notes: 'Fallback generated from local context.',
  });

  const content = asString(result.content) || fallback;
  const status = (asString(result.status) as ImeSectionStatus) || (content.startsWith('Insufficient data') ? 'insufficient_data' : 'draft');
  return {
    content,
    status,
    notes: asString(result.notes),
  };
}

function deriveSteeringContext(current: Record<string, unknown> | null | undefined, instruction: string): Record<string, unknown> {
  const next = { ...(current || {}) };
  const lower = instruction.toLowerCase();

  if (lower.includes('concise') || lower.includes('shorter')) {
    next.tone = 'concise';
  }
  if (lower.includes('more detail') || lower.includes('expand')) {
    next.detail_level = 'high';
  }
  if (lower.includes('icd-10') || lower.includes('icd10')) {
    next.include_icd10 = true;
  }
  if (lower.includes('work capacity') || lower.includes('vocational')) {
    next.emphasize_vocational_impact = true;
  }

  return next;
}

export async function refineImeSection(options: {
  sectionType: ImeSectionType;
  currentContent: string;
  instruction: string;
  context: ImeCaseContext;
  chatHistory: Array<{ role: string; content: string; timestamp?: string }>;
  steeringContext?: Record<string, unknown> | null;
}): Promise<{ content: string; status: ImeSectionStatus; steeringContext: Record<string, unknown> }> {
  const nextSteeringContext = deriveSteeringContext(options.steeringContext, options.instruction);
  const fallback = options.currentContent || buildSectionFallback(options.sectionType, options.context);

  const prompt = `You are refining a single IME summary section.

Return strict JSON:
{
  "content": string,
  "status": "draft" | "approved" | "insufficient_data"
}

Section type: ${options.sectionType}

Current content:
${options.currentContent || 'No current content yet.'}

User instruction:
${options.instruction}

Chat history:
${formatJsonContext(options.chatHistory)}

Case context:
${formatJsonContext({
  documents: options.context.documents,
  timeline: options.context.timeline.slice(0, 15),
  consultation: options.context.consultation
    ? {
        summary: options.context.consultation.summary,
        suggestedQuestions: options.context.consultation.suggestedQuestions.filter((item) => !item.covered),
      }
    : null,
  preferences: options.context.preferences,
  steeringContext: nextSteeringContext,
})}

Use the instruction to revise only this section.`;

  const result = await callGeminiJson<{ content?: string; status?: ImeSectionStatus }>(prompt, {
    content: fallback,
    status: 'draft',
  });

  return {
    content: asString(result.content) || fallback,
    status: (asString(result.status) as ImeSectionStatus) || 'draft',
    steeringContext: nextSteeringContext,
  };
}

export async function loadSectionChatHistory(summaryId: string, sectionType: ImeSectionType): Promise<Array<{ role: string; content: string; timestamp?: string }>> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from('ime_section_chats')
    .select('messages')
    .eq('ime_summary_id', summaryId)
    .eq('section_type', sectionType)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const row = (data || null) as ImeSectionChatRow | null;
  return Array.isArray(row?.messages) ? row!.messages as Array<{ role: string; content: string; timestamp?: string }> : [];
}

export async function upsertSectionChatHistory(options: {
  summaryId: string;
  userId: string;
  sectionType: ImeSectionType;
  messages: Array<{ role: string; content: string; timestamp?: string }>;
}) {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from('ime_section_chats')
    .upsert({
      ime_summary_id: options.summaryId,
      user_id: options.userId,
      section_type: options.sectionType,
      messages: options.messages,
    }, {
      onConflict: 'ime_summary_id,section_type',
    });

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateImeSummarySections(options: {
  summaryId: string;
  sections: ImeSectionRecord[];
  status?: 'draft' | 'in_progress' | 'completed';
  steeringContext?: Record<string, unknown> | null;
  title?: string | null;
  consultationSessionId?: string | null;
  templateId?: string | null;
}) {
  const supabase = createSupabaseServiceClient();
  const payload: Record<string, unknown> = {
    sections: options.sections,
  };

  if (options.status) payload.status = options.status;
  if (options.steeringContext !== undefined) payload.steering_context = options.steeringContext;
  if (options.title !== undefined) payload.title = options.title;
  if (options.consultationSessionId !== undefined) payload.consultation_session_id = options.consultationSessionId;
  if (options.templateId !== undefined) payload.template_id = options.templateId;

  const { data, error } = await supabase
    .from('ime_summaries')
    .update(payload)
    .eq('id', options.summaryId)
    .select('id, case_id, status, title, consultation_session_id, sections, template_id, steering_context, created_at, updated_at')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as ImeSummaryRow;
}

export function buildImeResponsePayload(options: {
  summary: ImeSummaryRow | null;
  context: ImeCaseContext;
}) {
  return {
    summary: options.summary
      ? {
          ...options.summary,
          sections: normalizeImeSections(options.summary.sections),
        }
      : null,
    sections: normalizeImeSections(options.summary?.sections),
    consultation: options.context.consultation,
    templates: options.context.templates,
    preferences: options.context.preferences,
    recordsReviewed: options.context.recordsReviewed,
    availableConsultationSessionId: options.context.consultation?.id || null,
  };
}

export async function buildImePdf(options: {
  caseId: string;
  title: string;
  sections: ImeSectionRecord[];
  recordsReviewed: string[];
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let currentPage = page;
  let y = 750;

  const ensureSpace = (needed = 36) => {
    if (y > needed) return;
    currentPage = pdf.addPage([612, 792]);
    y = 750;
  };

  const drawLine = (text: string, size = 11, weight: 'normal' | 'bold' = 'normal', color = rgb(0.17, 0.24, 0.39)) => {
    ensureSpace(size + 10);
    currentPage.drawText(text, {
      x: 48,
      y,
      size,
      font: weight === 'bold' ? bold : font,
      color,
      maxWidth: 516,
      lineHeight: size + 4,
    });
    y -= size + 8;
  };

  const wrapText = (text: string, size = 11) => {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';

    for (const word of words) {
      const nextLine = line ? `${line} ${word}` : word;
      const width = font.widthOfTextAtSize(nextLine, size);
      if (width > 500 && line) {
        lines.push(line);
        line = word;
      } else {
        line = nextLine;
      }
    }

    if (line) lines.push(line);
    return lines;
  };

  drawLine(options.title, 18, 'bold', rgb(0.07, 0.18, 0.34));
  drawLine(`Case ID: ${options.caseId}`, 10, 'normal', rgb(0.32, 0.39, 0.53));
  drawLine(`Generated: ${new Date().toLocaleString('en-US')}`, 10, 'normal', rgb(0.32, 0.39, 0.53));
  y -= 6;

  for (const section of options.sections) {
    ensureSpace(70);
    drawLine(section.label, 13, 'bold', rgb(0.09, 0.21, 0.42));
    const lines = wrapText(section.content || 'Insufficient data.', 11);
    for (const line of lines) {
      drawLine(line, 11);
    }
    y -= 8;
  }

  ensureSpace(70);
  drawLine('Records Reviewed Appendix', 13, 'bold', rgb(0.09, 0.21, 0.42));
  for (const record of options.recordsReviewed) {
    const lines = wrapText(`- ${record}`, 10);
    for (const line of lines) {
      drawLine(line, 10);
    }
  }

  return pdf.save();
}

export function buildImeWordHtml(options: {
  caseId: string;
  title: string;
  sections: ImeSectionRecord[];
  recordsReviewed: string[];
}): string {
  const sectionHtml = options.sections
    .map((section) => {
      const paragraphs = (section.content || 'Insufficient data.')
        .split(/\n{2,}/)
        .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br />')}</p>`)
        .join('');
      return `<section><h2>${section.label}</h2>${paragraphs}</section>`;
    })
    .join('');

  const recordsHtml = options.recordsReviewed.map((item) => `<li>${item}</li>`).join('');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${options.title}</title>
    <style>
      body { font-family: Georgia, serif; color: #1f2937; margin: 36px; line-height: 1.5; }
      h1, h2 { color: #0f2f58; }
      h1 { margin-bottom: 8px; }
      h2 { margin-top: 28px; margin-bottom: 10px; font-size: 18px; }
      p { margin: 0 0 12px; }
      ul { margin-top: 8px; }
      .meta { color: #475569; font-size: 12px; margin-bottom: 24px; }
    </style>
  </head>
  <body>
    <h1>${options.title}</h1>
    <div class="meta">Case ID: ${options.caseId}<br />Generated: ${new Date().toLocaleString('en-US')}</div>
    ${sectionHtml}
    <section>
      <h2>Records Reviewed Appendix</h2>
      <ul>${recordsHtml}</ul>
    </section>
  </body>
</html>`;
}
