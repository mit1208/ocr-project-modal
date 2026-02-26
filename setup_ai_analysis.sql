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
    is_complete BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.ai_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own ai analysis"
    ON public.ai_analysis FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own ai analysis"
    ON public.ai_analysis FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own ai analysis"
    ON public.ai_analysis FOR UPDATE
    USING (auth.uid() = user_id);
