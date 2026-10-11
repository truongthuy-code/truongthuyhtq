-- =========================================================================
-- Supabase Migration: 20261011083000_add_admin_role_and_permissions.sql
-- Mục tiêu: Bổ sung tài khoản Admin quản trị toàn hệ thống, RBAC & RLS Policies
-- Nguyên tắc: Idempotent 100%, bảo toàn dữ liệu Giáo viên, Học sinh, Bài thi.
-- =========================================================================

-- 1. EXTENSIONS & ENUMS
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Mở rộng enum role 'student' nếu chưa tồn tại
DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'student';
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN
    CREATE TYPE public.app_role AS ENUM ('admin', 'teacher', 'student');
END $$;

-- 2. SCHEMA EXTENSIONS (CHỈ ADD CỘT MỚI, KHÔNG XÓA / RESET BẤT KỲ CỘT HAY BẢNG NÀO)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS role text DEFAULT 'teacher',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- Đảm bảo username là duy nhất an toàn (chỉ áp dụng cho các bản ghi có username)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_idx 
  ON public.profiles (lower(username)) 
  WHERE username IS NOT NULL;

-- 3. HELPER FUNCTION: is_admin (TRÁNH ĐỆ QUY RLS TUYỆT ĐỐI)
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

  -- 1. Kiểm tra bảng phân quyền public.user_roles (Role = 'admin')
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'admin'
  ) THEN
    RETURN true;
  END IF;

  -- 2. Kiểm tra auth.users metadata hoặc email admin gốc
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = _user_id
      AND (
        lower(email) = 'admin@admin.com'
        OR (raw_user_meta_data->>'role') = 'admin'
        OR lower(raw_user_meta_data->>'username') = 'admin'
      )
  ) THEN
    RETURN true;
  END IF;

  -- 3. Kiểm tra public.profiles
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id
      AND (
        role = 'admin'
        OR lower(username) = 'admin'
        OR lower(email) = 'admin@admin.com'
      )
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO anon, authenticated, service_role;

-- 4. HELPER FUNCTION: has_role (ĐỒNG BỘ RBAC TOÀN HỆ THỐNG)
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

  IF _role = 'admin' AND public.is_admin(_user_id) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role::text = _role
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, text) TO anon, authenticated, service_role;

-- 5. SEED ADMIN GỐC (HOÀN TOÀN IDEMPOTENT - KHÔNG TRÙNG LẶP - KHÔNG RESET MẬT KHẨU NẾU ĐÃ ĐỔI)
DO $$
DECLARE
  v_admin_id uuid;
  v_existing_id uuid;
  v_enc_pass text;
BEGIN
  -- Tìm tài khoản admin hiện có (qua email, username hoặc id)
  SELECT id INTO v_existing_id
  FROM auth.users
  WHERE lower(email) = 'admin@admin.com'
     OR lower(raw_user_meta_data->>'username') = 'admin'
  LIMIT 1;

  IF v_existing_id IS NULL THEN
    SELECT id INTO v_existing_id
    FROM public.profiles
    WHERE lower(username) = 'admin' OR lower(email) = 'admin@admin.com'
    LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    -- Admin đã tồn tại: BẢO TOÀN TÀI KHOẢN, KHÔNG RESET MẬT KHẨU, KHÔNG RESET MUST_CHANGE_PASSWORD NẾU ĐÃ ĐỔI
    v_admin_id := v_existing_id;

    -- Đảm bảo quyền admin trong user_roles
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_admin_id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;

    -- Cập nhật profile đồng bộ
    UPDATE public.profiles
    SET role = 'admin',
        username = COALESCE(username, 'admin'),
        status = 'active',
        full_name = COALESCE(full_name, 'Quản trị viên Hệ thống')
    WHERE id = v_admin_id;

  ELSE
    -- Admin chưa tồn tại: Tạo mới 1 tài khoản duy nhất với mật khẩu khởi tạo 123456
    v_admin_id := 'b9e61e93-caa6-4e72-a534-55072d943ad2'::uuid;
    v_enc_pass := crypt('123456', gen_salt('bf', 10));

    -- Tạo trong auth.users
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token
    ) VALUES (
      '00000000-0000-4000-8000-000000000000',
      v_admin_id,
      'authenticated',
      'authenticated',
      'admin@admin.com',
      v_enc_pass,
      now(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      '{"full_name": "Quản trị viên Hệ thống", "username": "admin", "role": "admin", "must_change_password": true}'::jsonb,
      now(),
      now(),
      '',
      ''
    )
    ON CONFLICT (id) DO NOTHING;

    -- Tạo trong auth.identities nếu có
    BEGIN
      INSERT INTO auth.identities (
        id,
        user_id,
        identity_data,
        provider,
        provider_id,
        last_sign_in_at,
        created_at,
        updated_at
      ) VALUES (
        v_admin_id,
        v_admin_id,
        jsonb_build_object('sub', v_admin_id::text, 'email', 'admin@admin.com'),
        'email',
        v_admin_id::text,
        now(),
        now(),
        now()
      )
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    -- Tạo trong public.profiles với must_change_password = true
    INSERT INTO public.profiles (
      id,
      email,
      full_name,
      username,
      role,
      status,
      must_change_password,
      profile_completed
    ) VALUES (
      v_admin_id,
      'admin@admin.com',
      'Quản trị viên Hệ thống',
      'admin',
      'admin',
      'active',
      true,
      true
    )
    ON CONFLICT (id) DO UPDATE
    SET role = 'admin',
        username = 'admin',
        status = 'active';

    -- Gán quyền admin vào public.user_roles
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_admin_id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;

  END IF;
END $$;

-- 6. RLS POLICIES (CẤP TOÀN QUYỀN HỆ THỐNG CHO ADMIN, BẢO TOÀN QUYỀN GIÁO VIÊN VÀ HỌC SINH)

-- Profiles: Admin có toàn quyền quản trị
DROP POLICY IF EXISTS "admin all profiles" ON public.profiles;
CREATE POLICY "admin all profiles" ON public.profiles
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- User roles: Admin có toàn quyền quản trị roles
DROP POLICY IF EXISTS "admin all user_roles" ON public.user_roles;
CREATE POLICY "admin all user_roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Exams: Admin xem, sửa, xóa, tìm kiếm tất cả bài thi
DROP POLICY IF EXISTS "admin all exams" ON public.exams;
CREATE POLICY "admin all exams" ON public.exams
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Submissions: Admin xem và quản trị tất cả kết quả thi
DROP POLICY IF EXISTS "admin all submissions" ON public.submissions;
CREATE POLICY "admin all submissions" ON public.submissions
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Schools: Admin toàn quyền quản trị trường học
DROP POLICY IF EXISTS "admin all schools" ON public.schools;
CREATE POLICY "admin all schools" ON public.schools
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Subjects: Admin toàn quyền quản trị môn học
DROP POLICY IF EXISTS "admin all subjects" ON public.subjects;
CREATE POLICY "admin all subjects" ON public.subjects
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Exam teams: Admin quản trị nhóm thi
DROP POLICY IF EXISTS "admin all exam_teams" ON public.exam_teams;
CREATE POLICY "admin all exam_teams" ON public.exam_teams
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Team members: Admin quản trị thành viên nhóm
DROP POLICY IF EXISTS "admin all team_members" ON public.team_members;
CREATE POLICY "admin all team_members" ON public.team_members
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Team answers: Admin quản trị câu trả lời nhóm
DROP POLICY IF EXISTS "admin all team_answers" ON public.team_answers;
CREATE POLICY "admin all team_answers" ON public.team_answers
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
