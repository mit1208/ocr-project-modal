-- Chronology editing + per-case settings

CREATE TABLE IF NOT EXISTS public.case_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    case_id TEXT NOT NULL,
    incident_date DATE,
    gap_days_threshold INTEGER DEFAULT 30,
    preferred_columns JSONB,
    hidden_columns JSONB,
    column_order JSONB,
    naming_conventions JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (user_id, case_id)
);

ALTER TABLE public.case_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own case settings"
    ON public.case_settings FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own case settings"
    ON public.case_settings FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own case settings"
    ON public.case_settings FOR UPDATE
    USING (auth.uid() = user_id);

-- Versioned, editable chronology
CREATE TABLE IF NOT EXISTS public.chronology_versions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    file_id TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    label TEXT,
    comment TEXT,
    source TEXT DEFAULT 'user',
    base_version INTEGER,
    is_final BOOLEAN DEFAULT FALSE,
    data JSONB NOT NULL,
    columns JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (file_id, version)
);

ALTER TABLE public.chronology_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own chronology versions"
    ON public.chronology_versions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own chronology versions"
    ON public.chronology_versions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own chronology versions"
    ON public.chronology_versions FOR UPDATE
    USING (auth.uid() = user_id);
