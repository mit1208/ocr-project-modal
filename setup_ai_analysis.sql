CREATE TABLE IF NOT EXISTS public.ai_analysis (
  file_id text not null,
  user_id uuid null,
  document_type text null,
  clinical_summary text null,
  patients jsonb null,
  critical_flags jsonb null,
  abnormal_findings jsonb null,
  timeline jsonb null,
  timeline_index jsonb null,
  groups jsonb null,
  is_complete boolean null default false,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  audio_summary text null,
  is_public boolean null default false,
  body_map_regions jsonb null,
  summary text null,
  sections jsonb null,
  page_index jsonb null,
  document_index jsonb null,
  case_brief jsonb null,
  extracted_toc jsonb null,
  clinical_intake jsonb null,
  contradictions jsonb null,
  constraint ai_analysis_pkey primary key (file_id),
  constraint ai_analysis_user_id_fkey foreign KEY (user_id) references auth.users (id) ON DELETE CASCADE
) TABLESPACE pg_default;

-- Trigger to sync is_public status from documents table
DROP TRIGGER IF EXISTS trigger_sync_analysis_public ON public.ai_analysis;
CREATE TRIGGER trigger_sync_analysis_public
    BEFORE INSERT OR UPDATE ON public.ai_analysis
    FOR EACH ROW EXECUTE FUNCTION public.sync_is_public_status();

ALTER TABLE public.ai_analysis ENABLE ROW LEVEL SECURITY;

-- Note: body_map_regions is now part of the initial CREATE TABLE
ALTER TABLE public.ai_analysis
ADD COLUMN IF NOT EXISTS document_index jsonb,
ADD COLUMN IF NOT EXISTS timeline_index jsonb,
ADD COLUMN IF NOT EXISTS clinical_intake jsonb,
ADD COLUMN IF NOT EXISTS contradictions jsonb;

CREATE POLICY "Users can view their own or public ai analysis"
    ON public.ai_analysis FOR SELECT
    USING (auth.uid() = user_id OR is_public = TRUE);

CREATE POLICY "Users can insert their own ai analysis"
    ON public.ai_analysis FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own ai analysis"
    ON public.ai_analysis FOR UPDATE
    USING (auth.uid() = user_id);
