CREATE OR REPLACE FUNCTION public.set_current_timestamp_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS public.consultation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  status text NOT NULL DEFAULT 'recording',
  title text NULL,
  speaker_labels jsonb NOT NULL DEFAULT '{"doctor":"Doctor","patient":"Patient"}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consultation_sessions_status_check CHECK (status IN ('recording', 'paused', 'completed'))
);

CREATE TABLE IF NOT EXISTS public.consultation_transcript (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.consultation_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  speaker text NOT NULL,
  text text NOT NULL,
  timestamp double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consultation_transcript_speaker_check CHECK (speaker IN ('doctor', 'patient')),
  CONSTRAINT consultation_transcript_session_sequence_unique UNIQUE (session_id, sequence)
);

CREATE TABLE IF NOT EXISTS public.consultation_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.consultation_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  suggested_questions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  checklist_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1,
  is_final boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS consultation_sessions_case_id_idx
  ON public.consultation_sessions (case_id, user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS consultation_transcript_session_idx
  ON public.consultation_transcript (session_id, sequence);

CREATE INDEX IF NOT EXISTS consultation_summary_session_idx
  ON public.consultation_summary (session_id, version DESC);

DROP TRIGGER IF EXISTS consultation_sessions_set_updated_at ON public.consultation_sessions;
CREATE TRIGGER consultation_sessions_set_updated_at
BEFORE UPDATE ON public.consultation_sessions
FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

DROP TRIGGER IF EXISTS consultation_transcript_set_updated_at ON public.consultation_transcript;
CREATE TRIGGER consultation_transcript_set_updated_at
BEFORE UPDATE ON public.consultation_transcript
FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

DROP TRIGGER IF EXISTS consultation_summary_set_updated_at ON public.consultation_summary;
CREATE TRIGGER consultation_summary_set_updated_at
BEFORE UPDATE ON public.consultation_summary
FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

ALTER TABLE public.consultation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultation_transcript ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultation_summary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own consultation sessions" ON public.consultation_sessions;
CREATE POLICY "Users can view their own consultation sessions"
  ON public.consultation_sessions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own consultation sessions" ON public.consultation_sessions;
CREATE POLICY "Users can insert their own consultation sessions"
  ON public.consultation_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own consultation sessions" ON public.consultation_sessions;
CREATE POLICY "Users can update their own consultation sessions"
  ON public.consultation_sessions FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own consultation transcript" ON public.consultation_transcript;
CREATE POLICY "Users can view their own consultation transcript"
  ON public.consultation_transcript FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own consultation transcript" ON public.consultation_transcript;
CREATE POLICY "Users can insert their own consultation transcript"
  ON public.consultation_transcript FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own consultation transcript" ON public.consultation_transcript;
CREATE POLICY "Users can update their own consultation transcript"
  ON public.consultation_transcript FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own consultation summaries" ON public.consultation_summary;
CREATE POLICY "Users can view their own consultation summaries"
  ON public.consultation_summary FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own consultation summaries" ON public.consultation_summary;
CREATE POLICY "Users can insert their own consultation summaries"
  ON public.consultation_summary FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own consultation summaries" ON public.consultation_summary;
CREATE POLICY "Users can update their own consultation summaries"
  ON public.consultation_summary FOR UPDATE
  USING (auth.uid() = user_id);
