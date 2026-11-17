-- =========================================================================
-- Supabase Migration: 20261119000000_multilevel_exam_folders.sql
-- Mục tiêu:
--   1. Đảm bảo bảng public.exam_folders & cột public.exams.folder_id tồn tại đầy đủ (Idempotent 100%).
--   2. Nâng cấp public.exam_folders hỗ trợ cấu trúc thư mục nhiều cấp (parent_id).
--   3. Bảo toàn 100% thư mục gốc hiện có (parent_id IS NULL) và toàn bộ đề thi, bài nộp, mã bài thi.
--   4. Ngăn chặn vòng lặp cha-con (self-parent / circular hierarchy) ngay tại tầng CSDL.
--   5. Đảm bảo public.is_admin(_user_id uuid) nhận diện chính xác Admin / Super Admin
--      và siết chặt Row Level Security (RLS): Giáo viên chỉ xem/tạo/sửa/xóa thư mục
--      của chính mình; Admin giữ quyền quản trị toàn hệ thống; khóa quyền đọc ẩn danh.
-- =========================================================================

-- 0. Đảm bảo helper public.is_admin(_user_id uuid) hoạt động đúng với Admin / Super Admin
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role::text IN ('admin', 'super_admin')
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM auth.users
    WHERE id = _user_id
      AND (
        lower(email) = 'admin@admin.com'
        OR (raw_user_meta_data->>'role') IN ('admin', 'super_admin')
        OR lower(COALESCE(raw_user_meta_data->>'username', '')) = 'admin'
      )
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = _user_id
      AND lower(COALESCE(email, '')) = 'admin@admin.com'
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO anon, authenticated, service_role;

-- 1. Đảm bảo bảng public.exam_folders tồn tại (nếu migration 20261112000000 chưa chạy trước đó)
CREATE TABLE IF NOT EXISTS public.exam_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT 'sky',
  icon TEXT DEFAULT 'folder',
  parent_id UUID REFERENCES public.exam_folders(id) ON DELETE SET NULL,
  teacher_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bổ sung cột parent_id nếu bảng exam_folders đã tồn tại từ migration trước đó
ALTER TABLE public.exam_folders
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.exam_folders(id) ON DELETE SET NULL;

-- Bổ sung cột folder_id vào public.exams (ON DELETE SET NULL để tuyệt đối không mất đề khi xóa thư mục)
ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES public.exam_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS exams_folder_id_idx
  ON public.exams(folder_id);

-- Ngăn thư mục tự làm cha của chính nó
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'exam_folders_no_self_parent'
      AND conrelid = 'public.exam_folders'::regclass
  ) THEN
    ALTER TABLE public.exam_folders
      ADD CONSTRAINT exam_folders_no_self_parent
      CHECK (parent_id IS NULL OR parent_id <> id);
  END IF;
END $$;

-- Index tối ưu truy vấn cây thư mục nhiều cấp theo teacher_id & parent_id
CREATE INDEX IF NOT EXISTS exam_folders_teacher_id_idx
  ON public.exam_folders(teacher_id);

CREATE INDEX IF NOT EXISTS exam_folders_created_at_idx
  ON public.exam_folders(created_at DESC);

CREATE INDEX IF NOT EXISTS exam_folders_name_idx
  ON public.exam_folders(lower(name));

CREATE INDEX IF NOT EXISTS exam_folders_parent_id_idx
  ON public.exam_folders(parent_id);

CREATE INDEX IF NOT EXISTS exam_folders_teacher_parent_idx
  ON public.exam_folders(teacher_id, parent_id);

-- 2. Helper kiểm tra quyền sở hữu thư mục (SECURITY DEFINER để tránh đệ quy RLS)
CREATE OR REPLACE FUNCTION public.can_access_exam_folder(
  p_folder_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_folder_id IS NULL OR p_user_id IS NULL THEN false
    WHEN public.is_admin(p_user_id) THEN EXISTS (
      SELECT 1 FROM public.exam_folders f WHERE f.id = p_folder_id
    )
    ELSE EXISTS (
      SELECT 1
      FROM public.exam_folders f
      WHERE f.id = p_folder_id
        AND f.teacher_id = p_user_id
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION public.can_access_exam_folder(uuid, uuid) TO authenticated, service_role;

-- 3. Trigger ngăn chặn vòng lặp cha-con (circular reference) và kiểm tra quyền sở hữu thư mục cha
CREATE OR REPLACE FUNCTION public.validate_exam_folder_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_parent_teacher_id uuid;
  v_has_cycle boolean := false;
BEGIN
  IF NEW.name IS NULL OR length(trim(NEW.name)) = 0 THEN
    RAISE EXCEPTION 'Tên thư mục không được để trống' USING ERRCODE = '22023';
  END IF;
  NEW.name := trim(NEW.name);

  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'Thư mục không thể nằm bên trong chính nó' USING ERRCODE = '22023';
  END IF;

  SELECT f.teacher_id
  INTO v_parent_teacher_id
  FROM public.exam_folders f
  WHERE f.id = NEW.parent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Thư mục cha không tồn tại' USING ERRCODE = '23503';
  END IF;

  -- Đảm bảo thư mục con cùng giáo viên sở hữu với thư mục cha (trừ Admin)
  IF v_parent_teacher_id IS NOT NULL
     AND NEW.teacher_id IS NOT NULL
     AND v_parent_teacher_id <> NEW.teacher_id
     AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Không có quyền đặt thư mục vào thư mục của giáo viên khác' USING ERRCODE = '42501';
  END IF;

  -- Nếu đang UPDATE parent_id, kiểm tra NEW.parent_id có phải hậu duệ của NEW.id không
  IF TG_OP = 'UPDATE' AND OLD.id IS NOT NULL THEN
    WITH RECURSIVE descendants AS (
      SELECT id, parent_id
      FROM public.exam_folders
      WHERE parent_id = NEW.id
      UNION ALL
      SELECT child.id, child.parent_id
      FROM public.exam_folders child
      INNER JOIN descendants d ON child.parent_id = d.id
    )
    SELECT EXISTS (
      SELECT 1 FROM descendants WHERE id = NEW.parent_id
    ) INTO v_has_cycle;

    IF v_has_cycle THEN
      RAISE EXCEPTION 'Không thể di chuyển thư mục vào thư mục con của chính nó' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_exam_folder_hierarchy ON public.exam_folders;
CREATE TRIGGER trg_validate_exam_folder_hierarchy
  BEFORE INSERT OR UPDATE OF name, parent_id, teacher_id ON public.exam_folders
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_exam_folder_hierarchy();

-- Tự động cập nhật updated_at khi sửa thư mục
CREATE OR REPLACE FUNCTION public.touch_exam_folder_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_exam_folder_updated_at ON public.exam_folders;
CREATE TRIGGER trg_touch_exam_folder_updated_at
  BEFORE UPDATE ON public.exam_folders
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_exam_folder_updated_at();

-- 4. Siết chặt Row Level Security (RLS) trên public.exam_folders
ALTER TABLE public.exam_folders ENABLE ROW LEVEL SECURITY;

-- Gỡ policy anon công khai cũ để giáo viên không thể xem/lộ cấu trúc thư mục của người khác
DROP POLICY IF EXISTS "Public read folders" ON public.exam_folders;

-- 4.1. Quyền xem thư mục: chỉ chính giáo viên sở hữu hoặc Admin
DROP POLICY IF EXISTS "Teachers can view own folders" ON public.exam_folders;
CREATE POLICY "Teachers can view own folders" ON public.exam_folders
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR teacher_id = auth.uid()
  );

-- 4.2. Quyền tạo thư mục (cả thư mục gốc lẫn thư mục con):
-- Phải thuộc chính giáo viên đó (hoặc Admin), và nếu có parent_id thì parent_id cũng phải thuộc quyền quản lý
DROP POLICY IF EXISTS "Teachers can create own folders" ON public.exam_folders;
CREATE POLICY "Teachers can create own folders" ON public.exam_folders
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.is_admin(auth.uid()) OR teacher_id = auth.uid())
    AND (
      parent_id IS NULL
      OR public.can_access_exam_folder(parent_id, auth.uid())
    )
  );

-- 4.3. Quyền cập nhật / đổi tên / di chuyển thư mục:
DROP POLICY IF EXISTS "Teachers can update own folders" ON public.exam_folders;
CREATE POLICY "Teachers can update own folders" ON public.exam_folders
  FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR teacher_id = auth.uid()
  )
  WITH CHECK (
    (public.is_admin(auth.uid()) OR teacher_id = auth.uid())
    AND (
      parent_id IS NULL
      OR (
        parent_id <> id
        AND public.can_access_exam_folder(parent_id, auth.uid())
      )
    )
  );

-- 4.4. Quyền xóa thư mục:
DROP POLICY IF EXISTS "Teachers can delete own folders" ON public.exam_folders;
CREATE POLICY "Teachers can delete own folders" ON public.exam_folders
  FOR DELETE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR teacher_id = auth.uid()
  );

REVOKE ALL ON public.exam_folders FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_folders TO authenticated;
GRANT ALL ON public.exam_folders TO service_role;

-- Làm mới schema cache của PostgREST ngay lập tức
NOTIFY pgrst, 'reload schema';
