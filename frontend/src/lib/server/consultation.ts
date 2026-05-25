import { GoogleGenerativeAI } from '@google/generative-ai';
import { createSupabaseServiceClient } from './slm';
import type {
  ConsultationSpeaker,
  ConsultationSummaryShape,
  SuggestedQuestion,
  ConsultationTranscriptEntry,
  ConsultationSessionData,
} from '../consultation-types';

export type ConsultationChecklistItem = {
  key: string;
  label: string;
  prompt: string;
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
      console.warn(`[Consultation Gemini] Attempt ${attempt} failed (${err.message}), retrying in ${Math.round(delay)}ms...`);
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

function formatJsonContext(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export async function loadConsultationSession(userId: string, sessionId: string): Promise<ConsultationSessionData | null> {
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
      ? (summaryRow.suggested_questions_json as SuggestedQuestion[])
      : [],
    version: typeof summaryRow.version === 'number' ? summaryRow.version : 0,
  };
}

export async function loadLatestConsultationForCase(userId: string, caseId: string): Promise<ConsultationSessionData | null> {
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

async function callGeminiJson<T>(prompt: string, fallback: T): Promise<T> {
  try {
    const model = getGeminiModel();
    const result = await withRetry(() => model.generateContent(prompt));
    const text = result.response.text();
    return safeJsonParse<T>(text, fallback);
  } catch (error) {
    console.error('[Consultation] Gemini JSON call failed:', error);
    return fallback;
  }
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

  const prompt = `You are assisting with a medical consultation.
  
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
