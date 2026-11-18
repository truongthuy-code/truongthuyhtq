-- =========================================================================
-- Supabase Migration: 20261120000000_super_admin_system.sql
-- Mục tiêu:
--   1. Thiết lập 01 tài khoản SUPER_ADMIN duy nhất: bichthuylqd@gmail.com
--      (Idempotent 100%, giữ nguyên mật khẩu/dữ liệu nếu đã tồn tại;
--       nếu tạo mới thì mật khẩu khởi tạo là 123456 + must_change_password = true).
--   2. Quy trình đăng ký giáo viên phải chờ SUPER_ADMIN phê duyệt
--      (PENDING -> APPROVED / REJECTED / LOCKED), không thể tự đăng nhập hay tạo đề khi chưa duyệt.
--   3. Bảo toàn dữ liệu hiện có (backfill giáo viên active hiện tại -> APPROVED).
--   4. Khắc phục lỗ hổng leo thang đặc quyền (CWE-269: KHÔNG tin cậy raw_user_meta_data->>'role').
--   5. Bổ sung bảng teacher_registrations, admin_activity_logs, cột soft-delete cho exams/folders,
--      và toàn bộ hàm RPC SECURITY DEFINER cho bảng điều khiển Super Admin.
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. MỞ RỘNG ENUM app_role
DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN
    CREATE TYPE public.app_role AS ENUM ('super_admin', 'admin', 'teacher', 'student');
END $$;

DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'student';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. ĐẢM BẢO BẢNG exam_folders & CỘT LIÊN QUAN TỒN TẠI (IDEMPOTENT)
CREATE TABLE IF NOT EXISTS public.exam_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT 'sky',
  icon TEXT DEFAULT 'folder',
  parent_id UUID REFERENCES public.exam_folders(id) ON DELETE SET NULL,
  teacher_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.exam_folders
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.exam_folders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID;

ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES public.exam_folders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID;

CREATE INDEX IF NOT EXISTS exams_created_by_idx ON public.exams(created_by);
CREATE INDEX IF NOT EXISTS exams_is_deleted_idx ON public.exams(is_deleted);
CREATE INDEX IF NOT EXISTS exam_folders_teacher_parent_idx ON public.exam_folders(teacher_id, parent_id);

-- 3. MỞ RỘNG BẢNG public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS role text DEFAULT 'teacher',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by uuid,
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS avatar text;

-- Ràng buộc check approval_status an toàn
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_approval_status_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_approval_status_check
      CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED', 'LOCKED'));
  END IF;
END $$;

-- Backfill các bản ghi hiện có (không ghi đè giáo viên đang hoạt động)
UPDATE public.profiles
SET approval_status = CASE
  WHEN is_deleted = true THEN 'LOCKED'
  WHEN lower(COALESCE(status, 'active')) = 'locked' THEN 'LOCKED'
  WHEN lower(COALESCE(status, 'active')) = 'pending' THEN 'PENDING'
  WHEN lower(COALESCE(status, 'active')) = 'rejected' THEN 'REJECTED'
  ELSE 'APPROVED'
END
WHERE approval_status IS NULL OR (
  lower(COALESCE(status, 'active')) = 'locked' AND approval_status <> 'LOCKED'
);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_idx
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL AND is_deleted = false;

CREATE INDEX IF NOT EXISTS profiles_approval_status_idx
  ON public.profiles (approval_status, is_deleted);

-- 4. TẠO BẢNG teacher_registrations
CREATE TABLE IF NOT EXISTS public.teacher_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  username text,
  full_name text NOT NULL,
  phone text,
  school_name text,
  subject_name text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  rejection_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  notification_sent boolean NOT NULL DEFAULT false,
  notification_channel text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teacher_registrations_status_idx
  ON public.teacher_registrations (status, created_at DESC);

ALTER TABLE public.teacher_registrations ENABLE ROW LEVEL SECURITY;

-- 5. TẠO BẢNG admin_activity_logs (NHẬT KÝ HOẠT ĐỘNG BẤT BIẾN VỚI GIÁO VIÊN)
CREATE TABLE IF NOT EXISTS public.admin_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  admin_id uuid,
  admin_email text,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  target_label text,
  before_data jsonb,
  after_data jsonb,
  outcome text NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'denied', 'error')),
  detail text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS admin_activity_logs_created_idx
  ON public.admin_activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_activity_logs_action_idx
  ON public.admin_activity_logs (action);

ALTER TABLE public.admin_activity_logs ENABLE ROW LEVEL SECURITY;

-- 6. HÀM KIỂM TRA QUYỀN NGHIÊM NGẶT (KHÔNG ĐỌC raw_user_meta_data->>'role')
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email text;
  v_app_role text;
BEGIN
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT lower(email), raw_app_meta_data->>'role'
  INTO v_email, v_app_role
  FROM auth.users
  WHERE id = _user_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Kiểm tra tài khoản không bị khóa hoặc xóa
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id
      AND (p.is_deleted = true OR lower(COALESCE(p.status, 'active')) = 'locked')
  ) THEN
    RETURN false;
  END IF;

  IF v_email = 'bichthuylqd@gmail.com' THEN
    RETURN true;
  END IF;

  IF v_app_role = 'super_admin' THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role::text = 'super_admin'
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO anon, authenticated, service_role;

-- Cập nhật public.is_admin để dùng is_super_admin + user_roles chính thống (loại bỏ raw_user_meta_data)
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

  IF public.is_super_admin(_user_id) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id
      AND (p.is_deleted = true OR lower(COALESCE(p.status, 'active')) = 'locked')
  ) THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role::text IN ('super_admin', 'admin')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO anon, authenticated, service_role;

-- Cập nhật public.has_role (uuid, text) và (uuid, app_role)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
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

  IF _role IN ('super_admin', 'admin') AND public.is_admin(_user_id) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role::text = _role
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, text) TO anon, authenticated, service_role;

-- Hàm kiểm tra giáo viên đã được duyệt & đang hoạt động
CREATE OR REPLACE FUNCTION public.is_approved_active_teacher(_user_id uuid)
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

  IF public.is_super_admin(_user_id) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = _user_id
      AND p.is_deleted = false
      AND lower(COALESCE(p.status, 'active')) = 'active'
      AND upper(COALESCE(p.approval_status, 'APPROVED')) = 'APPROVED'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_approved_active_teacher(uuid) TO anon, authenticated, service_role;

-- 7. TẠO HOẶC CHUẨN HÓA TÀI KHOẢN SUPER_ADMIN DUY NHẤT: bichthuylqd@gmail.com
DO $$
DECLARE
  v_super_id uuid;
  v_enc_pass text;
BEGIN
  -- Chuẩn hóa: Chỉ có DUY NHẤT tài khoản bichthuylqd@gmail.com giữ vai trò super_admin
  SELECT id INTO v_super_id
  FROM auth.users
  WHERE lower(email) = 'bichthuylqd@gmail.com'
  LIMIT 1;

  IF v_super_id IS NOT NULL THEN
    -- Tài khoản đã tồn tại -> BẢO TOÀN mật khẩu & dữ liệu hiện có (bài thi, thư mục...)
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"role":"super_admin"}'::jsonb,
        email_confirmed_at = COALESCE(email_confirmed_at, now())
    WHERE id = v_super_id;

    INSERT INTO public.profiles (
      id, email, full_name, username, role, status, approval_status,
      must_change_password, profile_completed, approved_at, is_deleted
    ) VALUES (
      v_super_id,
      'bichthuylqd@gmail.com',
      'Trương Thị Bích Thủy',
      'bichthuylqd',
      'super_admin',
      'active',
      'APPROVED',
      false,
      true,
      now(),
      false
    )
    ON CONFLICT (id) DO UPDATE
    SET email = 'bichthuylqd@gmail.com',
        role = 'super_admin',
        status = 'active',
        approval_status = 'APPROVED',
        is_deleted = false,
        profile_completed = true,
        approved_at = COALESCE(public.profiles.approved_at, now()),
        full_name = COALESCE(NULLIF(public.profiles.full_name, ''), 'Trương Thị Bích Thủy'),
        username = COALESCE(NULLIF(public.profiles.username, ''), 'bichthuylqd');
  ELSE
    -- Tài khoản chưa tồn tại -> Tạo mới với mật khẩu khởi tạo 123456 + bắt buộc đổi ở lần đăng nhập đầu
    v_super_id := gen_random_uuid();
    v_enc_pass := crypt('123456', gen_salt('bf', 10));

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token
    ) VALUES (
      '00000000-0000-4000-8000-000000000000',
      v_super_id,
      'authenticated',
      'authenticated',
      'bichthuylqd@gmail.com',
      v_enc_pass,
      now(),
      '{"provider":"email","providers":["email"],"role":"super_admin"}'::jsonb,
      '{"full_name":"Trương Thị Bích Thủy","username":"bichthuylqd"}'::jsonb,
      now(),
      now(),
      '',
      ''
    )
    ON CONFLICT (id) DO NOTHING;

    BEGIN
      INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id,
        last_sign_in_at, created_at, updated_at
      ) VALUES (
        v_super_id,
        v_super_id,
        jsonb_build_object('sub', v_super_id::text, 'email', 'bichthuylqd@gmail.com'),
        'email',
        v_super_id::text,
        now(),
        now(),
        now()
      )
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    INSERT INTO public.profiles (
      id, email, full_name, username, role, status, approval_status,
      must_change_password, profile_completed, approved_at, is_deleted
    ) VALUES (
      v_super_id,
      'bichthuylqd@gmail.com',
      'Trương Thị Bích Thủy',
      'bichthuylqd',
      'super_admin',
      'active',
      'APPROVED',
      true,
      true,
      now(),
      false
    )
    ON CONFLICT (id) DO UPDATE
    SET role = 'super_admin',
        status = 'active',
        approval_status = 'APPROVED',
        must_change_password = true,
        profile_completed = true,
        is_deleted = false;
  END IF;

  -- Gỡ quyền super_admin / admin khỏi mọi tài khoản khác (chỉ 01 Super Admin duy nhất)
  DELETE FROM public.user_roles
  WHERE role::text IN ('super_admin', 'admin')
    AND user_id <> v_super_id;

  -- Đảm bảo user_roles cho bichthuylqd@gmail.com
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_super_id, 'super_admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_super_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;

-- 8. TRIGGERS BẢO VỆ QUYỀN & QUY TRÌNH ĐĂNG KÝ CHỜ DUYỆT
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email text;
  v_username text;
  v_full_name text;
  v_phone text;
  v_school text;
  v_subject text;
  v_pre_approved boolean;
BEGIN
  v_email := lower(trim(COALESCE(NEW.email, '')));
  v_username := NULLIF(lower(trim(COALESCE(NEW.raw_user_meta_data->>'username', ''))), '');
  v_full_name := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''), split_part(v_email, '@', 1), 'Giáo viên');
  v_phone := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'phone', '')), '');
  v_school := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'school_name', '')), '');
  v_subject := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'subject_name', '')), '');
  v_pre_approved := COALESCE((NEW.raw_app_meta_data->>'pre_approved')::boolean, false);

  IF v_email = 'bichthuylqd@gmail.com' THEN
    INSERT INTO public.profiles (
      id, email, full_name, username, role, status, approval_status,
      must_change_password, profile_completed, approved_at, is_deleted
    ) VALUES (
      NEW.id,
      v_email,
      COALESCE(NULLIF(v_full_name, ''), 'Trương Thị Bích Thủy'),
      COALESCE(v_username, 'bichthuylqd'),
      'super_admin',
      'active',
      'APPROVED',
      false,
      true,
      now(),
      false
    )
    ON CONFLICT (id) DO UPDATE
    SET role = 'super_admin',
        status = 'active',
        approval_status = 'APPROVED',
        is_deleted = false;

    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'super_admin') ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  -- Mọi tài khoản đăng ký mới khác mặc định là teacher + PENDING (chặn leo thang role)
  INSERT INTO public.profiles (
    id, email, full_name, username, phone, school_name, subject_name,
    role, status, approval_status, must_change_password, profile_completed, is_deleted
  ) VALUES (
    NEW.id,
    v_email,
    v_full_name,
    v_username,
    v_phone,
    v_school,
    v_subject,
    'teacher',
    CASE WHEN v_pre_approved THEN 'active' ELSE 'pending' END,
    CASE WHEN v_pre_approved THEN 'APPROVED' ELSE 'PENDING' END,
    false,
    (v_full_name <> '' AND v_subject IS NOT NULL AND v_school IS NOT NULL),
    false
  )
  ON CONFLICT (id) DO UPDATE
  SET email = COALESCE(public.profiles.email, EXCLUDED.email),
      full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
      username = COALESCE(public.profiles.username, EXCLUDED.username),
      phone = COALESCE(public.profiles.phone, EXCLUDED.phone),
      school_name = COALESCE(public.profiles.school_name, EXCLUDED.school_name),
      subject_name = COALESCE(public.profiles.subject_name, EXCLUDED.subject_name);

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'teacher') ON CONFLICT DO NOTHING;

  IF NOT v_pre_approved THEN
    INSERT INTO public.teacher_registrations (
      user_id, email, username, full_name, phone, school_name, subject_name, status
    ) VALUES (
      NEW.id, v_email, v_username, v_full_name, v_phone, v_school, v_subject, 'PENDING'
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Đồng bộ grant_admin_on_signup cũ (chỉ cấp cho bichthuylqd@gmail.com)
CREATE OR REPLACE FUNCTION public.grant_admin_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(NEW.email) = 'bichthuylqd@gmail.com' THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'super_admin') ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

-- Chống tự ý sửa role, approval_status, status trên public.profiles
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_super boolean := false;
BEGIN
  -- Cho phép service_role / migrations / SECURITY DEFINER RPC (v_caller IS NULL khi chạy migration/service)
  IF current_setting('role', true) = 'service_role' OR v_caller IS NULL THEN
    IF TG_OP = 'DELETE' AND lower(COALESCE(OLD.email, '')) = 'bichthuylqd@gmail.com' THEN
      RAISE EXCEPTION 'Tuyệt đối không thể xóa tài khoản Super Admin gốc' USING ERRCODE = '42501';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_is_super := public.is_super_admin(v_caller);

  IF TG_OP = 'DELETE' THEN
    IF lower(COALESCE(OLD.email, '')) = 'bichthuylqd@gmail.com' OR OLD.role = 'super_admin' THEN
      RAISE EXCEPTION 'Tuyệt đối không thể xóa tài khoản Super Admin gốc' USING ERRCODE = '42501';
    END IF;
    IF NOT v_is_super THEN
      RAISE EXCEPTION 'Chỉ Super Admin mới có quyền xóa hồ sơ người dùng' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF NOT v_is_super THEN
    IF TG_OP = 'INSERT' THEN
      IF lower(COALESCE(NEW.email, '')) = 'bichthuylqd@gmail.com'
         OR COALESCE(NEW.role, 'teacher') IN ('admin', 'super_admin') THEN
        RAISE EXCEPTION 'Không được phép tự đăng ký hoặc gán quyền Quản trị viên' USING ERRCODE = '42501';
      END IF;
      NEW.role := 'teacher';
      NEW.status := 'pending';
      NEW.approval_status := 'PENDING';
      NEW.must_change_password := false;
      NEW.is_deleted := false;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.role IS DISTINCT FROM OLD.role
         OR NEW.status IS DISTINCT FROM OLD.status
         OR NEW.approval_status IS DISTINCT FROM OLD.approval_status
         OR NEW.must_change_password IS DISTINCT FROM OLD.must_change_password
         OR NEW.is_deleted IS DISTINCT FROM OLD.is_deleted THEN
        RAISE EXCEPTION 'Không có quyền thay đổi vai trò hoặc trạng thái phê duyệt tài khoản' USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSE
    -- Bảo vệ Super Admin không bị tự khóa hoặc hạ quyền
    IF TG_OP = 'UPDATE' AND (lower(COALESCE(OLD.email, '')) = 'bichthuylqd@gmail.com' OR OLD.role = 'super_admin') THEN
      NEW.role := 'super_admin';
      NEW.status := 'active';
      NEW.approval_status := 'APPROVED';
      NEW.is_deleted := false;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_privileged_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_privileged_fields
  BEFORE INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_privileged_fields();

-- 9. CẬP NHẬT ROW LEVEL SECURITY (RLS) TOÀN HỆ THỐNG

-- 9.1. public.profiles
DROP POLICY IF EXISTS "admin all profiles" ON public.profiles;
DROP POLICY IF EXISTS "super_admin all profiles" ON public.profiles;
CREATE POLICY "super_admin all profiles" ON public.profiles
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 9.2. public.user_roles
DROP POLICY IF EXISTS "admin all user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "super_admin all user_roles" ON public.user_roles;
CREATE POLICY "super_admin all user_roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 9.3. public.teacher_registrations
DROP POLICY IF EXISTS "super_admin manage teacher_registrations" ON public.teacher_registrations;
CREATE POLICY "super_admin manage teacher_registrations" ON public.teacher_registrations
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "teacher view own registration" ON public.teacher_registrations;
CREATE POLICY "teacher view own registration" ON public.teacher_registrations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.teacher_registrations TO authenticated;
GRANT ALL ON public.teacher_registrations TO service_role;

-- 9.4. public.admin_activity_logs (CHỈ Super Admin đọc; ghi thông qua RPC SECURITY DEFINER hoặc Super Admin)
DROP POLICY IF EXISTS "super_admin read activity logs" ON public.admin_activity_logs;
CREATE POLICY "super_admin read activity logs" ON public.admin_activity_logs
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "super_admin insert activity logs" ON public.admin_activity_logs;
CREATE POLICY "super_admin insert activity logs" ON public.admin_activity_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));

GRANT SELECT, INSERT ON public.admin_activity_logs TO authenticated;
GRANT ALL ON public.admin_activity_logs TO service_role;

-- 9.5. public.exams (Giáo viên bị khóa / chưa duyệt bị chặn ngay ở RLS; Super Admin toàn quyền)
DROP POLICY IF EXISTS "teachers read own exams, admins read all" ON public.exams;
DROP POLICY IF EXISTS "authenticated teachers create their exams" ON public.exams;
DROP POLICY IF EXISTS "owners or admins update exams" ON public.exams;
DROP POLICY IF EXISTS "owners or admins delete exams" ON public.exams;
DROP POLICY IF EXISTS "admin all exams" ON public.exams;
DROP POLICY IF EXISTS "exams admin all" ON public.exams;
DROP POLICY IF EXISTS "anyone can delete exams" ON public.exams;

CREATE POLICY "super_admin all exams" ON public.exams
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "approved teachers read own exams" ON public.exams
  FOR SELECT TO authenticated
  USING (
    COALESCE(is_deleted, false) = false
    AND created_by = auth.uid()
    AND public.is_approved_active_teacher(auth.uid())
  );

CREATE POLICY "approved teachers create own exams" ON public.exams
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.is_approved_active_teacher(auth.uid())
  );

CREATE POLICY "approved teachers update own exams" ON public.exams
  FOR UPDATE TO authenticated
  USING (
    COALESCE(is_deleted, false) = false
    AND created_by = auth.uid()
    AND public.is_approved_active_teacher(auth.uid())
  )
  WITH CHECK (
    created_by = auth.uid()
    AND public.is_approved_active_teacher(auth.uid())
  );

CREATE POLICY "approved teachers delete own exams" ON public.exams
  FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    AND public.is_approved_active_teacher(auth.uid())
  );

-- 9.6. public.exam_folders (Khóa giáo viên chưa duyệt / bị khóa)
DROP POLICY IF EXISTS "Teachers can view own folders" ON public.exam_folders;
DROP POLICY IF EXISTS "Teachers can create own folders" ON public.exam_folders;
DROP POLICY IF EXISTS "Teachers can update own folders" ON public.exam_folders;
DROP POLICY IF EXISTS "Teachers can delete own folders" ON public.exam_folders;

CREATE POLICY "super_admin all folders" ON public.exam_folders
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "approved teachers select own folders" ON public.exam_folders
  FOR SELECT TO authenticated
  USING (
    COALESCE(is_deleted, false) = false
    AND teacher_id = auth.uid()
    AND public.is_approved_active_teacher(auth.uid())
  );

CREATE POLICY "approved teachers insert own folders" ON public.exam_folders
  FOR INSERT TO authenticated
  WITH CHECK (
    teacher_id = auth.uid()
    AND public.is_approved_active_teacher(auth.uid())
    AND (parent_id IS NULL OR public.can_access_exam_folder(parent_id, auth.uid()))
  );

CREATE POLICY "approved teachers update own folders" ON public.exam_folders
  FOR UPDATE TO authenticated
  USING (
    COALESCE(is_deleted, false) = false
    AND teacher_id = auth.uid()
    AND public.is_approved_active_teacher(auth.uid())
  )
  WITH CHECK (
    teacher_id = auth.uid()
    AND public.is_approved_active_teacher(auth.uid())
    AND (parent_id IS NULL OR (parent_id <> id AND public.can_access_exam_folder(parent_id, auth.uid())))
  );

CREATE POLICY "approved teachers delete own folders" ON public.exam_folders
  FOR DELETE TO authenticated
  USING (
    teacher_id = auth.uid()
    AND public.is_approved_active_teacher(auth.uid())
  );

-- 9.7. public.submissions (Gỡ policy nguy hiểm cũ, chỉ Super Admin hoặc chủ đề đang hoạt động xem/xóa)
DROP POLICY IF EXISTS "anyone can delete submissions" ON public.submissions;
DROP POLICY IF EXISTS "admin all submissions" ON public.submissions;
DROP POLICY IF EXISTS "owners/admins read submissions" ON public.submissions;
DROP POLICY IF EXISTS "owners/admins delete submissions" ON public.submissions;

CREATE POLICY "super_admin all submissions" ON public.submissions
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "approved teachers read own exam submissions" ON public.submissions
  FOR SELECT TO authenticated
  USING (
    public.is_approved_active_teacher(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.exams e
      WHERE e.id = submissions.exam_id AND e.created_by = auth.uid()
    )
  );

CREATE POLICY "approved teachers delete own exam submissions" ON public.submissions
  FOR DELETE TO authenticated
  USING (
    public.is_approved_active_teacher(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.exams e
      WHERE e.id = submissions.exam_id AND e.created_by = auth.uid()
    )
  );

-- 10. CẬP NHẬT get_exam_for_student ĐỂ LOẠI TRỪ ĐỀ ĐÃ SOFT-DELETE
CREATE OR REPLACE FUNCTION public.get_exam_for_student(p_exam_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.exams%ROWTYPE;
  v_qs jsonb;
  v_p1 jsonb := '[]'::jsonb;
  v_p2 jsonb := '[]'::jsonb;
  v_p3 jsonb := '[]'::jsonb;
  v_item jsonb;
  v_clean jsonb;
  v_sub_arr jsonb;
  v_sub_el jsonb;
  v_status text;
BEGIN
  SELECT * INTO v_row FROM public.exams WHERE id = p_exam_id AND COALESCE(is_deleted, false) = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam not found'; END IF;
  v_qs := v_row.questions;
  v_status := public.exam_status(v_row.open_at, v_row.close_at, v_row.manual_closed);

  IF v_status = 'open' THEN
    FOR v_item IN SELECT jsonb_array_elements(COALESCE(v_qs->'partI', '[]'::jsonb)) LOOP
      v_clean := v_item - 'answer' - 'explanation';
      v_p1 := v_p1 || jsonb_build_array(v_clean);
    END LOOP;
    FOR v_item IN SELECT jsonb_array_elements(COALESCE(v_qs->'partII', '[]'::jsonb)) LOOP
      v_sub_arr := '[]'::jsonb;
      FOR v_sub_el IN SELECT jsonb_array_elements(COALESCE(v_item->'items', '[]'::jsonb)) LOOP
        v_sub_arr := v_sub_arr || jsonb_build_array(v_sub_el - 'correct');
      END LOOP;
      v_clean := v_item - 'items' - 'explanation' || jsonb_build_object('items', v_sub_arr);
      v_p2 := v_p2 || jsonb_build_array(v_clean);
    END LOOP;
    FOR v_item IN SELECT jsonb_array_elements(COALESCE(v_qs->'partIII', '[]'::jsonb)) LOOP
      v_p3 := v_p3 || jsonb_build_array(v_item - 'answer' - 'explanation');
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'title', v_row.title,
    'duration_minutes', v_row.duration_minutes,
    'max_attempts', v_row.max_attempts,
    'shuffle_q_p1', v_row.shuffle_q_p1,
    'shuffle_q_p2', v_row.shuffle_q_p2,
    'shuffle_q_p3', v_row.shuffle_q_p3,
    'shuffle_o_p1', v_row.shuffle_o_p1,
    'shuffle_o_p2', v_row.shuffle_o_p2,
    'shuffle_o_p3', v_row.shuffle_o_p3,
    'shuffle_questions', v_row.shuffle_questions,
    'shuffle_options', v_row.shuffle_options,
    'allow_review', v_row.allow_review,
    'display_mode', v_row.display_mode,
    'instant_feedback', COALESCE(v_row.instant_feedback, false),
    'scoring', public.normalize_scoring_to_scale10(v_row.scoring),
    'lock_mode', v_row.lock_mode,
    'open_at', v_row.open_at,
    'close_at', v_row.close_at,
    'manual_closed', v_row.manual_closed,
    'auto_submit_on_close', v_row.auto_submit_on_close,
    'status', v_status,
    'questions', jsonb_build_object('partI', v_p1, 'partII', v_p2, 'partIII', v_p3)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_exam_for_student(uuid) TO anon, authenticated;

-- 11. CÁC HÀM RPC QUẢN TRỊ CHO SUPER ADMIN (HOẠT ĐỘNG TRỰC TIẾP QUA JWT)

-- 11.1. Lấy trạng thái tài khoản hiện tại từ DB (không suy diễn client)
CREATE OR REPLACE FUNCTION public.get_my_account_state()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_p public.profiles%ROWTYPE;
  v_is_super boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('authenticated', false);
  END IF;

  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_uid;
  SELECT * INTO v_p FROM public.profiles WHERE id = v_uid;
  v_is_super := public.is_super_admin(v_uid);

  RETURN jsonb_build_object(
    'authenticated', true,
    'id', v_uid,
    'email', COALESCE(v_p.email, v_email),
    'username', v_p.username,
    'full_name', v_p.full_name,
    'phone', v_p.phone,
    'school_name', v_p.school_name,
    'subject_name', v_p.subject_name,
    'avatar', v_p.avatar,
    'role', CASE WHEN v_is_super THEN 'super_admin' ELSE COALESCE(v_p.role, 'teacher') END,
    'status', CASE WHEN v_is_super THEN 'active' ELSE COALESCE(v_p.status, 'pending') END,
    'approval_status', CASE WHEN v_is_super THEN 'APPROVED' ELSE COALESCE(v_p.approval_status, 'PENDING') END,
    'rejection_reason', v_p.rejection_reason,
    'must_change_password', COALESCE(v_p.must_change_password, false),
    'profile_completed', COALESCE(v_p.profile_completed, false),
    'is_deleted', COALESCE(v_p.is_deleted, false),
    'is_super_admin', v_is_super
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_account_state() TO authenticated;

-- 11.2. Hoàn tất đổi mật khẩu lần đầu cho Super Admin
CREATE OR REPLACE FUNCTION public.complete_super_admin_first_password_change()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'Chỉ Super Admin mới có quyền thực hiện thao tác này' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET must_change_password = false,
      updated_at = now()
  WHERE id = v_uid;

  INSERT INTO public.admin_activity_logs (
    admin_id, admin_email, action, target_type, target_id, target_label,
    outcome, detail
  ) VALUES (
    v_uid, 'bichthuylqd@gmail.com', 'SUPER_ADMIN_PASSWORD_CHANGED', 'auth',
    v_uid::text, 'bichthuylqd@gmail.com', 'success',
    'Super Admin đã đổi mật khẩu khởi tạo và mở khóa hệ thống'
  );

  RETURN jsonb_build_object('ok', true, 'must_change_password', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_super_admin_first_password_change() TO authenticated;

-- 11.3. Ghi nhật ký hoạt động an toàn
CREATE OR REPLACE FUNCTION public.log_admin_activity(
  p_action text,
  p_target_type text,
  p_target_id text DEFAULT NULL,
  p_target_label text DEFAULT NULL,
  p_before_data jsonb DEFAULT NULL,
  p_after_data jsonb DEFAULT NULL,
  p_outcome text DEFAULT 'success',
  p_detail text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'Chỉ Super Admin mới có quyền ghi nhật ký quản trị' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  INSERT INTO public.admin_activity_logs (
    admin_id, admin_email, action, target_type, target_id, target_label,
    before_data, after_data, outcome, detail, metadata
  ) VALUES (
    v_uid,
    COALESCE(v_email, 'bichthuylqd@gmail.com'),
    p_action,
    p_target_type,
    p_target_id,
    p_target_label,
    p_before_data,
    p_after_data,
    CASE WHEN p_outcome IN ('success', 'denied', 'error') THEN p_outcome ELSE 'success' END,
    p_detail,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_admin_activity(text, text, text, text, jsonb, jsonb, text, text, jsonb) TO authenticated;

-- 11.4. Phê duyệt đăng ký giáo viên
CREATE OR REPLACE FUNCTION public.admin_approve_teacher(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_before public.profiles%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'Chỉ Super Admin mới có quyền phê duyệt giáo viên' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy tài khoản giáo viên';
  END IF;

  UPDATE public.profiles
  SET status = 'active',
      approval_status = 'APPROVED',
      approved_at = now(),
      approved_by = v_uid,
      rejection_reason = NULL,
      is_deleted = false,
      updated_at = now()
  WHERE id = p_user_id;

  UPDATE public.teacher_registrations
  SET status = 'APPROVED',
      rejection_reason = NULL,
      reviewed_by = v_uid,
      reviewed_at = now(),
      updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_user_id, 'teacher')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.admin_activity_logs (
    admin_id, admin_email, action, target_type, target_id, target_label,
    before_data, after_data, outcome, detail
  ) VALUES (
    v_uid, 'bichthuylqd@gmail.com', 'APPROVE_TEACHER', 'teacher',
    p_user_id::text, COALESCE(v_before.full_name, v_before.email),
    jsonb_build_object('status', v_before.status, 'approval_status', v_before.approval_status),
    jsonb_build_object('status', 'active', 'approval_status', 'APPROVED'),
    'success',
    'Phê duyệt tài khoản giáo viên ' || COALESCE(v_before.email, '')
  );

  RETURN jsonb_build_object('ok', true, 'user_id', p_user_id, 'approval_status', 'APPROVED');
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_approve_teacher(uuid) TO authenticated;

-- 11.5. Từ chối đăng ký giáo viên
CREATE OR REPLACE FUNCTION public.admin_reject_teacher(p_user_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_before public.profiles%ROWTYPE;
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'Chỉ Super Admin mới có quyền từ chối đăng ký' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy tài khoản giáo viên';
  END IF;

  IF lower(COALESCE(v_before.email, '')) = 'bichthuylqd@gmail.com' OR v_before.role = 'super_admin' THEN
    RAISE EXCEPTION 'Không thể từ chối tài khoản Super Admin gốc' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET status = 'rejected',
      approval_status = 'REJECTED',
      rejected_at = now(),
      rejected_by = v_uid,
      rejection_reason = COALESCE(v_reason, 'Hồ sơ đăng ký chưa được Quản trị viên phê duyệt'),
      updated_at = now()
  WHERE id = p_user_id;

  UPDATE public.teacher_registrations
  SET status = 'REJECTED',
      rejection_reason = COALESCE(v_reason, 'Hồ sơ đăng ký chưa được Quản trị viên phê duyệt'),
      reviewed_by = v_uid,
      reviewed_at = now(),
      updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.admin_activity_logs (
    admin_id, admin_email, action, target_type, target_id, target_label,
    before_data, after_data, outcome, detail
  ) VALUES (
    v_uid, 'bichthuylqd@gmail.com', 'REJECT_TEACHER', 'teacher',
    p_user_id::text, COALESCE(v_before.full_name, v_before.email),
    jsonb_build_object('status', v_before.status, 'approval_status', v_before.approval_status),
    jsonb_build_object('status', 'rejected', 'approval_status', 'REJECTED', 'reason', v_reason),
    'success',
    'Từ chối đăng ký giáo viên: ' || COALESCE(v_reason, 'Không nêu lý do')
  );

  RETURN jsonb_build_object('ok', true, 'user_id', p_user_id, 'approval_status', 'REJECTED');
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reject_teacher(uuid, text) TO authenticated;

-- 11.6. Khóa tài khoản giáo viên (bảo toàn 100% dữ liệu)
CREATE OR REPLACE FUNCTION public.admin_lock_teacher(p_user_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_before public.profiles%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'Chỉ Super Admin mới có quyền khóa tài khoản' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy tài khoản giáo viên';
  END IF;

  IF lower(COALESCE(v_before.email, '')) = 'bichthuylqd@gmail.com' OR v_before.role = 'super_admin' THEN
    RAISE EXCEPTION 'Không thể khóa tài khoản Super Admin gốc' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET status = 'locked',
      approval_status = 'LOCKED',
      locked_at = now(),
      locked_by = v_uid,
      updated_at = now()
  WHERE id = p_user_id;

  -- Thu hồi mọi refresh token hiện hành trong auth.sessions / auth.refresh_tokens (nếu quyền Postgres cho phép)
  BEGIN
    DELETE FROM auth.sessions WHERE user_id = p_user_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  INSERT INTO public.admin_activity_logs (
    admin_id, admin_email, action, target_type, target_id, target_label,
    before_data, after_data, outcome, detail
  ) VALUES (
    v_uid, 'bichthuylqd@gmail.com', 'LOCK_TEACHER', 'teacher',
    p_user_id::text, COALESCE(v_before.full_name, v_before.email),
    jsonb_build_object('status', v_before.status, 'approval_status', v_before.approval_status),
    jsonb_build_object('status', 'locked', 'approval_status', 'LOCKED', 'reason', p_reason),
    'success',
    'Khóa tài khoản giáo viên ' || COALESCE(v_before.email, '')
  );

  RETURN jsonb_build_object('ok', true, 'user_id', p_user_id, 'status', 'locked');
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_lock_teacher(uuid, text) TO authenticated;

-- 11.7. Mở khóa tài khoản giáo viên (khôi phục toàn bộ dữ liệu cũ)
CREATE OR REPLACE FUNCTION public.admin_unlock_teacher(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_before public.profiles%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'Chỉ Super Admin mới có quyền mở khóa tài khoản' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy tài khoản giáo viên';
  END IF;

  UPDATE public.profiles
  SET status = 'active',
      approval_status = 'APPROVED',
      locked_at = NULL,
      locked_by = NULL,
      is_deleted = false,
      deleted_at = NULL,
      updated_at = now()
  WHERE id = p_user_id;

  INSERT INTO public.admin_activity_logs (
    admin_id, admin_email, action, target_type, target_id, target_label,
    before_data, after_data, outcome, detail
  ) VALUES (
    v_uid, 'bichthuylqd@gmail.com', 'UNLOCK_TEACHER', 'teacher',
    p_user_id::text, COALESCE(v_before.full_name, v_before.email),
    jsonb_build_object('status', v_before.status, 'approval_status', v_before.approval_status),
    jsonb_build_object('status', 'active', 'approval_status', 'APPROVED'),
    'success',
    'Mở khóa tài khoản giáo viên ' || COALESCE(v_before.email, '')
  );

  RETURN jsonb_build_object('ok', true, 'user_id', p_user_id, 'status', 'active');
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_unlock_teacher(uuid) TO authenticated;

-- 11.8. Cập nhật hồ sơ giáo viên (Super Admin)
CREATE OR REPLACE FUNCTION public.admin_update_teacher(
  p_user_id uuid,
  p_full_name text DEFAULT NULL,
  p_username text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_school_name text DEFAULT NULL,
  p_subject_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_before public.profiles%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'Chỉ Super Admin mới có quyền chỉnh sửa giáo viên' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy giáo viên';
  END IF;

  UPDATE public.profiles
  SET full_name = COALESCE(NULLIF(trim(p_full_name), ''), full_name),
      username = COALESCE(NULLIF(lower(trim(p_username)), ''), username),
      phone = CASE WHEN p_phone IS NOT NULL THEN NULLIF(trim(p_phone), '') ELSE phone END,
      school_name = CASE WHEN p_school_name IS NOT NULL THEN NULLIF(trim(p_school_name), '') ELSE school_name END,
      subject_name = CASE WHEN p_subject_name IS NOT NULL THEN NULLIF(trim(p_subject_name), '') ELSE subject_name END,
      updated_at = now()
  WHERE id = p_user_id;

  INSERT INTO public.admin_activity_logs (
    admin_id, admin_email, action, target_type, target_id, target_label,
    before_data, after_data, outcome, detail
  ) VALUES (
    v_uid, 'bichthuylqd@gmail.com', 'UPDATE_TEACHER', 'teacher',
    p_user_id::text, COALESCE(p_full_name, v_before.full_name, v_before.email),
    jsonb_build_object('full_name', v_before.full_name, 'school_name', v_before.school_name, 'subject_name', v_before.subject_name, 'phone', v_before.phone),
    jsonb_build_object('full_name', p_full_name, 'school_name', p_school_name, 'subject_name', p_subject_name, 'phone', p_phone),
    'success',
    'Cập nhật thông tin hồ sơ giáo viên'
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_teacher(uuid, text, text, text, text, text) TO authenticated;

-- 11.9. Xóa hoặc Lưu trữ (Archive) tài khoản giáo viên (bảo vệ Super Admin tuyệt đối)
CREATE OR REPLACE FUNCTION public.admin_delete_teacher(
  p_user_id uuid,
  p_preserve_data boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_before public.profiles%ROWTYPE;
  v_exam_count int := 0;
  v_sub_count int := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'Chỉ Super Admin mới có quyền xóa tài khoản giáo viên' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy giáo viên';
  END IF;

  IF lower(COALESCE(v_before.email, '')) = 'bichthuylqd@gmail.com' OR v_before.role = 'super_admin' THEN
    RAISE EXCEPTION 'Tuyệt đối không thể xóa tài khoản Super Admin gốc' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_exam_count FROM public.exams WHERE created_by = p_user_id;
  SELECT count(*) INTO v_sub_count FROM public.submissions s JOIN public.exams e ON e.id = s.exam_id WHERE e.created_by = p_user_id;

  IF p_preserve_data THEN
    -- Chế độ Lưu trữ an toàn: vô hiệu hóa tài khoản, chuyển quyền sở hữu/lưu trữ dữ liệu đề thi & kết quả
    UPDATE public.profiles
    SET status = 'locked',
        approval_status = 'LOCKED',
        is_deleted = true,
        deleted_at = now(),
        updated_at = now()
    WHERE id = p_user_id;

    BEGIN
      DELETE FROM auth.sessions WHERE user_id = p_user_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  ELSE
    -- Xóa vĩnh viễn theo xác nhận rõ ràng của Super Admin
    DELETE FROM public.exam_folders WHERE teacher_id = p_user_id;
    DELETE FROM public.exams WHERE created_by = p_user_id;
    DELETE FROM public.teacher_registrations WHERE user_id = p_user_id;
    DELETE FROM public.user_roles WHERE user_id = p_user_id;
    DELETE FROM public.profiles WHERE id = p_user_id;
    BEGIN
      DELETE FROM auth.users WHERE id = p_user_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  INSERT INTO public.admin_activity_logs (
    admin_id, admin_email, action, target_type, target_id, target_label,
    before_data, after_data, outcome, detail
  ) VALUES (
    v_uid, 'bichthuylqd@gmail.com',
    CASE WHEN p_preserve_data THEN 'ARCHIVE_TEACHER' ELSE 'DELETE_TEACHER' END,
    'teacher', p_user_id::text, COALESCE(v_before.full_name, v_before.email),
    jsonb_build_object('email', v_before.email, 'exams', v_exam_count, 'submissions', v_sub_count),
    jsonb_build_object('preserved', p_preserve_data),
    'success',
    CASE WHEN p_preserve_data
      THEN 'Lưu trữ & vô hiệu hóa tài khoản giáo viên (bảo toàn đề thi & kết quả)'
      ELSE 'Xóa vĩnh viễn tài khoản giáo viên và dữ liệu liên quan'
    END
  );

  RETURN jsonb_build_object('ok', true, 'preserved', p_preserve_data, 'exams', v_exam_count, 'submissions', v_sub_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_teacher(uuid, boolean) TO authenticated;

-- 11.10. Xóa đề thi an toàn cho Super Admin (lưu trữ nếu đã có bài nộp trừ khi chọn xóa hẳn)
CREATE OR REPLACE FUNCTION public.admin_delete_exam(
  p_exam_id uuid,
  p_hard_delete boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_exam public.exams%ROWTYPE;
  v_sub_count int := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'Chỉ Super Admin mới có quyền thực hiện thao tác này' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_exam FROM public.exams WHERE id = p_exam_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy đề thi';
  END IF;

  SELECT count(*) INTO v_sub_count FROM public.submissions WHERE exam_id = p_exam_id;

  IF NOT p_hard_delete AND v_sub_count > 0 THEN
    -- Bảo toàn lịch sử kết quả học sinh: đánh dấu soft-delete & đóng đề
    UPDATE public.exams
    SET is_deleted = true,
        manual_closed = true,
        deleted_at = now(),
        deleted_by = v_uid
    WHERE id = p_exam_id;

    UPDATE public.exam_short_links SET is_active = false WHERE exam_id = p_exam_id;
  ELSE
    DELETE FROM public.exam_short_links WHERE exam_id = p_exam_id;
    DELETE FROM public.schools WHERE name_key = 'assign_code:' || p_exam_id::text OR name LIKE '%"examId":"' || p_exam_id::text || '"%';
    DELETE FROM public.exams WHERE id = p_exam_id;
  END IF;

  INSERT INTO public.admin_activity_logs (
    admin_id, admin_email, action, target_type, target_id, target_label,
    before_data, after_data, outcome, detail
  ) VALUES (
    v_uid, 'bichthuylqd@gmail.com',
    CASE WHEN (NOT p_hard_delete AND v_sub_count > 0) THEN 'SOFT_DELETE_EXAM' ELSE 'HARD_DELETE_EXAM' END,
    'exam', p_exam_id::text, v_exam.title,
    jsonb_build_object('title', v_exam.title, 'created_by', v_exam.created_by, 'submissions_count', v_sub_count),
    jsonb_build_object('hard_delete', p_hard_delete),
    'success',
    CASE WHEN (NOT p_hard_delete AND v_sub_count > 0)
      THEN 'Ẩn & đóng đề thi do đã có ' || v_sub_count || ' bài nộp (bảo toàn lịch sử kết quả)'
      ELSE 'Đã xóa vĩnh viễn đề thi'
    END
  );

  RETURN jsonb_build_object('ok', true, 'soft_deleted', (NOT p_hard_delete AND v_sub_count > 0), 'submissions_count', v_sub_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_exam(uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
