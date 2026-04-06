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

CREATE TABLE IF NOT EXISTS public.ime_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ime_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consultation_session_id uuid NULL REFERENCES public.consultation_sessions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft',
  title text NULL,
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  template_id uuid NULL REFERENCES public.ime_templates(id) ON DELETE SET NULL,
  steering_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ime_summaries_status_check CHECK (status IN ('draft', 'in_progress', 'completed'))
);

CREATE TABLE IF NOT EXISTS public.ime_section_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ime_summary_id uuid NOT NULL REFERENCES public.ime_summaries(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  section_type text NOT NULL,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ime_section_chats_summary_section_unique UNIQUE (ime_summary_id, section_type)
);

CREATE TABLE IF NOT EXISTS public.user_ime_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  preference_key text NOT NULL,
  preference_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence double precision NOT NULL DEFAULT 0.5,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_ime_preferences_user_key_unique UNIQUE (user_id, preference_key),
  CONSTRAINT user_ime_preferences_confidence_check CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX IF NOT EXISTS consultation_sessions_case_id_idx
  ON public.consultation_sessions (case_id, user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS consultation_transcript_session_idx
  ON public.consultation_transcript (session_id, sequence);

CREATE INDEX IF NOT EXISTS consultation_summary_session_idx
  ON public.consultation_summary (session_id, version DESC);

CREATE INDEX IF NOT EXISTS ime_summaries_case_id_idx
  ON public.ime_summaries (case_id, user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS ime_section_chats_summary_idx
  ON public.ime_section_chats (ime_summary_id, section_type);

CREATE INDEX IF NOT EXISTS user_ime_preferences_user_idx
  ON public.user_ime_preferences (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS ime_templates_user_idx
  ON public.ime_templates (user_id, updated_at DESC);

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

DROP TRIGGER IF EXISTS ime_templates_set_updated_at ON public.ime_templates;
CREATE TRIGGER ime_templates_set_updated_at
BEFORE UPDATE ON public.ime_templates
FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

DROP TRIGGER IF EXISTS ime_summaries_set_updated_at ON public.ime_summaries;
CREATE TRIGGER ime_summaries_set_updated_at
BEFORE UPDATE ON public.ime_summaries
FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

DROP TRIGGER IF EXISTS ime_section_chats_set_updated_at ON public.ime_section_chats;
CREATE TRIGGER ime_section_chats_set_updated_at
BEFORE UPDATE ON public.ime_section_chats
FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

DROP TRIGGER IF EXISTS user_ime_preferences_set_updated_at ON public.user_ime_preferences;
CREATE TRIGGER user_ime_preferences_set_updated_at
BEFORE UPDATE ON public.user_ime_preferences
FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

ALTER TABLE public.consultation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultation_transcript ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultation_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ime_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ime_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ime_section_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_ime_preferences ENABLE ROW LEVEL SECURITY;

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

DROP POLICY IF EXISTS "Users can view their own ime templates" ON public.ime_templates;
CREATE POLICY "Users can view their own ime templates"
  ON public.ime_templates FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own ime templates" ON public.ime_templates;
CREATE POLICY "Users can insert their own ime templates"
  ON public.ime_templates FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own ime templates" ON public.ime_templates;
CREATE POLICY "Users can update their own ime templates"
  ON public.ime_templates FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own ime templates" ON public.ime_templates;
CREATE POLICY "Users can delete their own ime templates"
  ON public.ime_templates FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own ime summaries" ON public.ime_summaries;
CREATE POLICY "Users can view their own ime summaries"
  ON public.ime_summaries FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own ime summaries" ON public.ime_summaries;
CREATE POLICY "Users can insert their own ime summaries"
  ON public.ime_summaries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own ime summaries" ON public.ime_summaries;
CREATE POLICY "Users can update their own ime summaries"
  ON public.ime_summaries FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own ime summaries" ON public.ime_summaries;
CREATE POLICY "Users can delete their own ime summaries"
  ON public.ime_summaries FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own ime section chats" ON public.ime_section_chats;
CREATE POLICY "Users can view their own ime section chats"
  ON public.ime_section_chats FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own ime section chats" ON public.ime_section_chats;
CREATE POLICY "Users can insert their own ime section chats"
  ON public.ime_section_chats FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own ime section chats" ON public.ime_section_chats;
CREATE POLICY "Users can update their own ime section chats"
  ON public.ime_section_chats FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own ime section chats" ON public.ime_section_chats;
CREATE POLICY "Users can delete their own ime section chats"
  ON public.ime_section_chats FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own ime preferences" ON public.user_ime_preferences;
CREATE POLICY "Users can view their own ime preferences"
  ON public.user_ime_preferences FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own ime preferences" ON public.user_ime_preferences;
CREATE POLICY "Users can insert their own ime preferences"
  ON public.user_ime_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own ime preferences" ON public.user_ime_preferences;
CREATE POLICY "Users can update their own ime preferences"
  ON public.user_ime_preferences FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own ime preferences" ON public.user_ime_preferences;
CREATE POLICY "Users can delete their own ime preferences"
  ON public.user_ime_preferences FOR DELETE
  USING (auth.uid() = user_id);
