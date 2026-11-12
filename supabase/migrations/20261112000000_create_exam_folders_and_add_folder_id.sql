-- =========================================================================
-- Supabase Migration: 20261112000000_create_exam_folders_and_add_folder_id.sql
-- Mục tiêu: Quản lý thư mục đề thi (exam_folders) & bổ sung folder_id vào exams
-- Nguyên tắc: Idempotent 100%, bảo toàn toàn bộ dữ liệu đề thi, bài nộp, mã đề
-- =========================================================================

-- 1. BẢNG QUẢN LÝ THƯ MỤC ĐỀ THI (public.exam_folders)
CREATE TABLE IF NOT EXISTS public.exam_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT 'sky',
  icon TEXT DEFAULT 'folder',
  teacher_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. INDEX TỐI ƯU TRUY VẤN
CREATE INDEX IF NOT EXISTS exam_folders_teacher_id_idx ON public.exam_folders(teacher_id);
CREATE INDEX IF NOT EXISTS exam_folders_created_at_idx ON public.exam_folders(created_at DESC);
CREATE INDEX IF NOT EXISTS exam_folders_name_idx ON public.exam_folders(lower(name));

-- 3. BỔ SUNG CỘT folder_id VÀO BẢNG exams
-- Khi xóa thư mục, ON DELETE SET NULL đảm bảo đề thi tự động trở về Chưa phân loại (folder_id = NULL)
DO $$ BEGIN
  ALTER TABLE public.exams 
    ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES public.exam_folders(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN 
  NULL; 
END $$;

CREATE INDEX IF NOT EXISTS exams_folder_id_idx ON public.exams(folder_id);

-- 4. THIẾT LẬP ROW LEVEL SECURITY (RLS)
ALTER TABLE public.exam_folders ENABLE ROW LEVEL SECURITY;

-- 4.1. Quyền xem thư mục:
-- - Admin xem được tất cả thư mục
-- - Giáo viên chỉ xem thư mục của chính mình (hoặc thư mục demo teacher_id IS NULL)
DROP POLICY IF EXISTS "Teachers can view own folders" ON public.exam_folders;
CREATE POLICY "Teachers can view own folders" ON public.exam_folders
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid()) OR
    teacher_id = auth.uid() OR
    teacher_id IS NULL
  );

-- 4.2. Quyền tạo thư mục:
-- - Giáo viên tạo thư mục với teacher_id là ID của chính mình
-- - Admin có toàn quyền tạo thư mục
DROP POLICY IF EXISTS "Teachers can create own folders" ON public.exam_folders;
CREATE POLICY "Teachers can create own folders" ON public.exam_folders
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid()) OR
    teacher_id = auth.uid() OR
    teacher_id IS NULL
  );

-- 4.3. Quyền cập nhật thư mục:
-- - Chỉ chủ sở hữu thư mục hoặc Admin mới được sửa
DROP POLICY IF EXISTS "Teachers can update own folders" ON public.exam_folders;
CREATE POLICY "Teachers can update own folders" ON public.exam_folders
  FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid()) OR
    teacher_id = auth.uid()
  )
  WITH CHECK (
    public.is_admin(auth.uid()) OR
    teacher_id = auth.uid()
  );

-- 4.4. Quyền xóa thư mục:
-- - Chỉ chủ sở hữu thư mục hoặc Admin mới được xóa
DROP POLICY IF EXISTS "Teachers can delete own folders" ON public.exam_folders;
CREATE POLICY "Teachers can delete own folders" ON public.exam_folders
  FOR DELETE TO authenticated
  USING (
    public.is_admin(auth.uid()) OR
    teacher_id = auth.uid()
  );

-- 4.5. Cho phép người dùng anon đọc thư mục nếu cần trong môi trường preview/demo
DROP POLICY IF EXISTS "Public read folders" ON public.exam_folders;
CREATE POLICY "Public read folders" ON public.exam_folders
  FOR SELECT TO anon
  USING (true);
