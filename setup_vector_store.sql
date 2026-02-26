-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create a table for document chunks and their embeddings (Normalized to save storage)
CREATE TABLE IF NOT EXISTS public.document_chunks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    file_id TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    page_number INTEGER,
    chunk_index INTEGER,
    start_offset INTEGER, -- Pointer to start of content in ocr_results
    end_offset INTEGER,   -- Pointer to end of content in ocr_results
    embedding vector(768), 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Match function joining with ocr_results to retrieve content only when needed
CREATE OR REPLACE FUNCTION match_document_chunks (
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  p_file_id text
)
RETURNS TABLE (
  id uuid,
  content text,
  file_id text,
  page_number int,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    -- Fetch content on the fly from ocr_results instead of storing a duplicate copy
    substring(ocr.text from dc.start_offset for (dc.end_offset - dc.start_offset)) as content,
    dc.file_id,
    dc.page_number,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM public.document_chunks dc
  JOIN public.ocr_results ocr ON dc.file_id = ocr.file_id AND dc.page_number = ocr.page
  WHERE dc.file_id = p_file_id
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- Index for vector similarity search
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx ON public.document_chunks 
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Enable RLS
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own document chunks"
    ON public.document_chunks FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own document chunks"
    ON public.document_chunks FOR INSERT
    WITH CHECK (auth.uid() = user_id);

