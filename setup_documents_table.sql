-- Run this in your Supabase SQL Editor to create the documents table!

CREATE TABLE IF NOT EXISTS public.documents (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    case_id TEXT NOT NULL,
    file_id TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- SHARED FUNCTION: Sync is_public status from documents to child tables
-- This ensures child records inherited the visibility of the parent document
CREATE OR REPLACE FUNCTION public.sync_is_public_status()
RETURNS TRIGGER AS $$
BEGIN
    SELECT is_public INTO NEW.is_public
    FROM public.documents
    WHERE documents.file_id = NEW.file_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable Row Level Security
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own or public documents"
    ON public.documents FOR SELECT
    USING (auth.uid() = user_id OR is_public = TRUE);

CREATE POLICY "Users can insert their own documents"
    ON public.documents FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own documents"
    ON public.documents FOR UPDATE
    USING (auth.uid() = user_id);

-- New function to propagate is_public status on document update
CREATE OR REPLACE FUNCTION public.propagate_is_public_status()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.is_public IS DISTINCT FROM NEW.is_public) THEN
        -- Update ai_analysis
        UPDATE public.ai_analysis
        SET is_public = NEW.is_public
        WHERE file_id = NEW.file_id;

        -- Update ocr_results
        UPDATE public.ocr_results
        SET is_public = NEW.is_public
        WHERE file_id = NEW.file_id;

        -- Update document_chunks
        UPDATE public.document_chunks
        SET is_public = NEW.is_public
        WHERE file_id = NEW.file_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to propagate status
DROP TRIGGER IF EXISTS trigger_propagate_public_status ON public.documents;
CREATE TRIGGER trigger_propagate_public_status
    AFTER UPDATE ON public.documents
    FOR EACH ROW
    EXECUTE FUNCTION public.propagate_is_public_status();
