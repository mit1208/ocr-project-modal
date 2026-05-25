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
