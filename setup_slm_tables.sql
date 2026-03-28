CREATE TABLE IF NOT EXISTS public.slm_training_data (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    file_ids TEXT[] NOT NULL DEFAULT '{}',
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.slm_models (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    adapter_path TEXT,
    status TEXT NOT NULL,
    base_model TEXT NOT NULL DEFAULT 'Qwen/Qwen3-0.6B',
    training_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT slm_models_user_version_unique UNIQUE (user_id, version)
);

CREATE TABLE IF NOT EXISTS public.slm_feedback (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    doc_refs TEXT[] NOT NULL DEFAULT '{}',
    responses JSONB NOT NULL,
    scores JSONB,
    gold_response TEXT,
    model_version INTEGER NOT NULL,
    response_time_ms INTEGER,
    token_count INTEGER,
    used_in_training BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.slm_eval_snapshots (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    model_version INTEGER NOT NULL,
    eval_type TEXT NOT NULL,
    avg_score DOUBLE PRECISION,
    score_distribution JSONB,
    total_queries INTEGER,
    gold_response_rate DOUBLE PRECISION,
    avg_response_time_ms DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS slm_models_one_training_per_user
    ON public.slm_models (user_id)
    WHERE status = 'training';

CREATE INDEX IF NOT EXISTS slm_models_user_created_idx
    ON public.slm_models (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS slm_feedback_user_created_idx
    ON public.slm_feedback (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS slm_feedback_user_training_idx
    ON public.slm_feedback (user_id, used_in_training, created_at DESC);

CREATE INDEX IF NOT EXISTS slm_training_data_user_created_idx
    ON public.slm_training_data (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS slm_eval_snapshots_user_created_idx
    ON public.slm_eval_snapshots (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.update_slm_models_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.update_slm_feedback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS slm_models_updated_at ON public.slm_models;
CREATE TRIGGER slm_models_updated_at
    BEFORE UPDATE ON public.slm_models
    FOR EACH ROW EXECUTE FUNCTION public.update_slm_models_updated_at();

DROP TRIGGER IF EXISTS slm_feedback_updated_at ON public.slm_feedback;
CREATE TRIGGER slm_feedback_updated_at
    BEFORE UPDATE ON public.slm_feedback
    FOR EACH ROW EXECUTE FUNCTION public.update_slm_feedback_updated_at();

ALTER TABLE public.slm_training_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slm_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slm_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slm_eval_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own slm training data" ON public.slm_training_data;
DROP POLICY IF EXISTS "Users can insert their own slm training data" ON public.slm_training_data;
DROP POLICY IF EXISTS "Users can update their own slm training data" ON public.slm_training_data;
CREATE POLICY "Users can view their own slm training data"
    ON public.slm_training_data FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own slm training data"
    ON public.slm_training_data FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own slm training data"
    ON public.slm_training_data FOR UPDATE
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own slm models" ON public.slm_models;
DROP POLICY IF EXISTS "Users can insert their own slm models" ON public.slm_models;
DROP POLICY IF EXISTS "Users can update their own slm models" ON public.slm_models;
CREATE POLICY "Users can view their own slm models"
    ON public.slm_models FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own slm models"
    ON public.slm_models FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own slm models"
    ON public.slm_models FOR UPDATE
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own slm feedback" ON public.slm_feedback;
DROP POLICY IF EXISTS "Users can insert their own slm feedback" ON public.slm_feedback;
DROP POLICY IF EXISTS "Users can update their own slm feedback" ON public.slm_feedback;
CREATE POLICY "Users can view their own slm feedback"
    ON public.slm_feedback FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own slm feedback"
    ON public.slm_feedback FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own slm feedback"
    ON public.slm_feedback FOR UPDATE
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own slm eval snapshots" ON public.slm_eval_snapshots;
DROP POLICY IF EXISTS "Users can insert their own slm eval snapshots" ON public.slm_eval_snapshots;
DROP POLICY IF EXISTS "Users can update their own slm eval snapshots" ON public.slm_eval_snapshots;
CREATE POLICY "Users can view their own slm eval snapshots"
    ON public.slm_eval_snapshots FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own slm eval snapshots"
    ON public.slm_eval_snapshots FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own slm eval snapshots"
    ON public.slm_eval_snapshots FOR UPDATE
    USING (auth.uid() = user_id);
