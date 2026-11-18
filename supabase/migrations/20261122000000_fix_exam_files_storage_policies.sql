-- Ensure exam-files bucket exists (private) and storage.objects RLS policies
-- properly allow authenticated teachers/admins to upload and access original exam files
-- without dropping into unauthenticated/broken legacy policy conflicts.

INSERT INTO storage.buckets (id, name, public)
VALUES ('exam-files', 'exam-files', false)
ON CONFLICT (id) DO NOTHING;

-- Drop legacy 20260507 policy names (with spaces) that 20260605 missed due to hyphens
DROP POLICY IF EXISTS "Public can read exam files" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload exam files" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete exam files" ON storage.objects;
DROP POLICY IF EXISTS "Public can read exam-files" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload exam-files" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update exam-files" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete exam-files" ON storage.objects;

DROP POLICY IF EXISTS "auth read own or admin exam-files" ON storage.objects;
DROP POLICY IF EXISTS "auth upload exam-files" ON storage.objects;
DROP POLICY IF EXISTS "auth update own exam-files" ON storage.objects;
DROP POLICY IF EXISTS "auth delete own exam-files" ON storage.objects;

-- Authenticated teachers & admins can read original exam files in exam-files bucket
-- (covers own files, library shared exams, duplicated exams, and legacy owner-null files)
CREATE POLICY "auth read exam-files"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'exam-files'
  AND (
    owner = auth.uid()
    OR owner IS NULL
    OR public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.exams e
      WHERE e.original_file_path = storage.objects.name
         OR e.original_file_url LIKE '%' || storage.objects.name || '%'
    )
  )
);

CREATE POLICY "auth upload exam-files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'exam-files');

CREATE POLICY "auth update own exam-files"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'exam-files' AND (owner = auth.uid() OR public.is_admin(auth.uid())));

CREATE POLICY "auth delete own exam-files"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'exam-files' AND (owner = auth.uid() OR public.is_admin(auth.uid())));
