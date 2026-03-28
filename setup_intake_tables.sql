-- Clinical Intake tables and reference data

-- 1. Reference Tables
CREATE TABLE IF NOT EXISTS public.icd10_codes (
    code TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    category TEXT,
    is_billable BOOLEAN DEFAULT TRUE,
    is_hcc BOOLEAN DEFAULT FALSE,
    hcc_category TEXT
);

CREATE TABLE IF NOT EXISTS public.cpt_codes (
    code TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    category TEXT
);

-- Indexes for text search
CREATE INDEX IF NOT EXISTS idx_icd10_description ON public.icd10_codes USING gin(to_tsvector('english', description));
CREATE INDEX IF NOT EXISTS idx_cpt_description ON public.cpt_codes USING gin(to_tsvector('english', description));

-- 2. Schema Modifications for ai_analysis
ALTER TABLE public.ai_analysis
    ADD COLUMN IF NOT EXISTS clinical_intake JSONB,
    ADD COLUMN IF NOT EXISTS intake_status TEXT DEFAULT 'pending'
    CHECK (intake_status IN ('pending', 'pass_1_complete', 'pass_2_complete', 'pass_3_complete', 'complete', 'failed')),
    ADD COLUMN IF NOT EXISTS intake_passes JSONB;

-- 3. Intake Decisions Table
CREATE TABLE IF NOT EXISTS public.intake_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id TEXT REFERENCES public.documents(file_id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,  -- 'diagnosis', 'medication', 'workup', 'flag'
    item_id TEXT NOT NULL,    -- matches id in clinical_intake JSON
    action TEXT NOT NULL,     -- 'accepted', 'rejected', 'edited', 'dismissed'
    edited_value JSONB,       -- only populated for 'edited' action
    reason TEXT,              -- optional, for 'dismissed' flags
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(file_id, user_id, item_type, item_id)
);

-- 4. RLS for intake_decisions
ALTER TABLE public.intake_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own decisions or view public" ON public.intake_decisions;
CREATE POLICY "Users manage own decisions or view public" ON public.intake_decisions
  FOR ALL USING (auth.uid() = user_id OR is_public = TRUE);

-- 5. Triggers for intake_decisions

-- Sync is_public from documents
CREATE OR REPLACE FUNCTION public.sync_intake_decisions_public_status()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.intake_decisions SET is_public = NEW.is_public
  WHERE file_id = NEW.file_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_intake_decisions_public ON public.documents;
CREATE TRIGGER sync_intake_decisions_public
  AFTER UPDATE OF is_public ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.sync_intake_decisions_public_status();

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_intake_decisions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS intake_decisions_updated_at ON public.intake_decisions;
CREATE TRIGGER intake_decisions_updated_at
  BEFORE UPDATE ON public.intake_decisions
  FOR EACH ROW EXECUTE FUNCTION public.update_intake_decisions_updated_at();

-- Inherit is_public on insert
DROP TRIGGER IF EXISTS trigger_sync_public_status_intake ON public.intake_decisions;
CREATE TRIGGER trigger_sync_public_status_intake
  BEFORE INSERT ON public.intake_decisions
  FOR EACH ROW EXECUTE FUNCTION public.sync_is_public_status();
