CREATE TABLE IF NOT EXISTS public.ai_analysis (
    file_id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    document_type TEXT,
    clinical_summary TEXT,
    patients JSONB,
    critical_flags JSONB,
    abnormal_findings JSONB,
    timeline JSONB,
    groups JSONB,
    is_public BOOLEAN DEFAULT FALSE,
    is_complete BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Trigger to sync is_public status from documents table
DROP TRIGGER IF EXISTS trigger_sync_analysis_public ON public.ai_analysis;
CREATE TRIGGER trigger_sync_analysis_public
    BEFORE INSERT OR UPDATE ON public.ai_analysis
    FOR EACH ROW EXECUTE FUNCTION public.sync_is_public_status();

ALTER TABLE public.ai_analysis ENABLE ROW LEVEL SECURITY;

ALTER TABLE ai_analysis
ADD COLUMN IF NOT EXISTS body_map_regions JSONB DEFAULT NULL;

CREATE POLICY "Users can view their own or public ai analysis"
    ON public.ai_analysis FOR SELECT
    USING (auth.uid() = user_id OR is_public = TRUE);

CREATE POLICY "Users can insert their own ai analysis"
    ON public.ai_analysis FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own ai analysis"
    ON public.ai_analysis FOR UPDATE
    USING (auth.uid() = user_id);
