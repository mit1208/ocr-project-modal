CREATE TABLE IF NOT EXISTS public.ocr_results (
  id uuid not null default gen_random_uuid (),
  user_id uuid null,
  file_id text not null,
  filename text null,
  page integer not null,
  text text null,
  created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  constraint ocr_results_pkey primary key (id),
  constraint ocr_results_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

-- Index for faster lookups during join with document_chunks
CREATE INDEX IF NOT EXISTS ocr_results_file_id_page_idx ON public.ocr_results(file_id, page);

-- Enable RLS
ALTER TABLE public.ocr_results ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own ocr results"
    ON public.ocr_results FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own ocr results"
    ON public.ocr_results FOR INSERT
    WITH CHECK (auth.uid() = user_id);

