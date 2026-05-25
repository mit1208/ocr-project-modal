export type ConsultationSpeaker = 'doctor' | 'patient';

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

export type ConsultationTranscriptEntry = {
  id: string;
  sequence: number;
  speaker: ConsultationSpeaker;
  text: string;
  timestamp: number;
  created_at?: string | null;
};

export type ConsultationSessionData = {
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

export type ImeSectionType =
  | 'demographics_history'
  | 'records_reviewed'
  | 'mechanism_of_injury'
  | 'current_complaints_functional_limitations'
  | 'diagnoses_treatment_timeline'
  | 'pre_existing_conditions'
  | 'suggested_physician_questions';

export type ImeSectionStatus = 'pending' | 'draft' | 'approved' | 'insufficient_data';

export type ImeSectionRecord = {
  type: ImeSectionType;
  label: string;
  status: ImeSectionStatus;
  content: string;
  sourcePages?: number[];
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

export const IME_SECTION_OPTIONS: Array<{ type: ImeSectionType; label: string }> = [
  { type: 'demographics_history', label: 'Demographics & History' },
  { type: 'records_reviewed', label: 'Records Reviewed' },
  { type: 'mechanism_of_injury', label: 'Mechanism of Injury' },
  { type: 'current_complaints_functional_limitations', label: 'Current Complaints' },
  { type: 'diagnoses_treatment_timeline', label: 'Diagnoses & Timeline' },
  { type: 'pre_existing_conditions', label: 'Pre-Existing Conditions' },
  { type: 'suggested_physician_questions', label: 'Physician Questions' },
];
