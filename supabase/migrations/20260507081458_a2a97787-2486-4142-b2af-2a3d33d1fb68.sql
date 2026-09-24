
-- Add original file url column to exams
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS original_file_url text;
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS original_file_name text;

-- Create storage bucket for original docx files
INSERT INTO storage.buckets (id, name, public)
VALUES ('exam-files', 'exam-files', true)
ON CONFLICT (id) DO NOTHING;

-- Public read/write policies for exam-files bucket
CREATE POLICY "Public can read exam files"
ON storage.objects FOR SELECT
USING (bucket_id = 'exam-files');

CREATE POLICY "Anyone can upload exam files"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'exam-files');

CREATE POLICY "Anyone can delete exam files"
ON storage.objects FOR DELETE
USING (bucket_id = 'exam-files');
