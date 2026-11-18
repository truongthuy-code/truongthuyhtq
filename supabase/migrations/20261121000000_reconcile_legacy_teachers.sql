-- =========================================================================
-- Supabase Migration: 20261121000000_reconcile_legacy_teachers.sql
-- Mục tiêu:
--   1. Tạo bảng sao lưu snapshot trước đồng bộ: public.legacy_teacher_sync_backups.
--   2. Sửa lỗi get_my_account_state() và các hàm admin RPC bị kẹt/lỗi khi tài khoản
--      giáo viên cũ tồn tại trong auth.users hoặc sở hữu đề thi/thư mục nhưng thiếu
--      bản ghi public.profiles hoặc bị lệch trạng thái giữa các bảng.
--   3. Xây dựng hàm admin_fetch_all_teacher_accounts() truy vấn hợp nhất FULL OUTER
--      tất cả nguồn (auth.users, profiles, user_roles, teacher_registrations,
--      exams, exam_folders) không giới hạn 1.000 dòng.
--   4. Xây dựng hàm admin_reconcile_legacy_teachers(p_apply, p_cutoff) phân loại
--      chính xác các nhóm A–G + Unresolved, hỗ trợ dry-run và đồng bộ idempotent,
--      tuyệt đối không tự duyệt đăng ký mới (F), không mở khóa/bỏ từ chối (G),
--      không biến học sinh thành giáo viên, không xóa dữ liệu đề thi/thư mục/bài nộp.
--   5. Tự động chạy 1 lượt đồng bộ an toàn khi apply migration.
-- =========================================================================
SET statement_timeout = 0;

-- 1. BẢNG LƯU BACKUP TRƯỚC KHI ĐỒNG BỘ HÀNG LOẠT
CREATE TABLE IF NOT EXISTS public.legacy_teacher_sync_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  user_id uuid NOT NULL,
  email text,
  classification_group text NOT NULL,
  action_taken text NOT NULL,
  before_profile jsonb,
  before_roles jsonb,
  before_registration jsonb,
  before_auth_meta jsonb,
  after_profile jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legacy_teacher_sync_backups_batch_idx
  ON public.legacy_teacher_sync_backups (batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS legacy_teacher_sync_backups_user_idx
  ON public.legacy_teacher_sync_backups (user_id, created_at DESC);

ALTER TABLE public.legacy_teacher_sync_backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin manage sync backups" ON public.legacy_teacher_sync_backups;
CREATE POLICY "super_admin manage sync backups" ON public.legacy_teacher_sync_backups
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

GRANT SELECT, INSERT ON public.legacy_teacher_sync_backups TO authenticated;
GRANT ALL ON public.legacy_teacher_sync_backups TO service_role;

-- 2. HÀM PHỤ TRỢ TẠO USERNAME DUY NHẤT (TRÁNH LỖI TRÙNG UNIQUE INDEX profiles_username_lower_idx)
CREATE OR REPLACE FUNCTION public._resolve_unique_teacher_username(
  p_user_id uuid,
  p_email text,
  p_raw_username text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base text;
  v_candidate text;
  v_short_id text := substr(replace(p_user_id::text, '-', ''), 1, 6);
BEGIN
  v_base := NULLIF(lower(regexp_replace(trim(COALESCE(p_raw_username, '')), '[^a-zA-Z0-9._-]', '', 'g')), '');
  IF v_base IS NULL THEN
    v_base := NULLIF(lower(regexp_replace(split_part(trim(COALESCE(p_email, '')), '@', 1), '[^a-zA-Z0-9._-]', '', 'g')), '');
  END IF;
  IF v_base IS NULL OR length(v_base) < 2 THEN
    v_base := 'gv_' || substr(replace(p_user_id::text, '-', ''), 1, 8);
  END IF;

  v_candidate := v_base;
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(username) = lower(v_candidate)
      AND id <> p_user_id
      AND COALESCE(is_deleted, false) = false
  ) THEN
    v_candidate := v_base || '_' || v_short_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(username) = lower(v_candidate)
      AND id <> p_user_id
      AND COALESCE(is_deleted, false) = false
  ) THEN
    v_candidate := 'gv_' || replace(p_user_id::text, '-', '');
  END IF;

  RETURN v_candidate;
END;
$$;

REVOKE ALL ON FUNCTION public._resolve_unique_teacher_username(uuid, text, text) FROM PUBLIC, anon;

-- 3. HÀM PHỤ TRỢ TỰ ĐỘNG BỔ SUNG PROFILE NẾU THIẾU TỪ auth.users (KHI ADMIN THAO TÁC)
CREATE OR REPLACE FUNCTION public._ensure_profile_from_auth(
  p_user_id uuid,
  p_default_status text DEFAULT 'active',
  p_default_approval text DEFAULT 'APPROVED'
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_p public.profiles%ROWTYPE;
  v_auth record;
  v_tr public.teacher_registrations%ROWTYPE;
  v_email text;
  v_username text;
  v_full_name text;
BEGIN
  SELECT * INTO v_p FROM public.profiles WHERE id = p_user_id;
  IF FOUND THEN
    RETURN v_p;
  END IF;

  SELECT id, email, raw_user_meta_data, created_at
  INTO v_auth
  FROM auth.users
  WHERE id = p_user_id;

  SELECT * INTO v_tr FROM public.teacher_registrations WHERE user_id = p_user_id LIMIT 1;

  IF v_auth.id IS NULL AND v_tr.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_email := COALESCE(NULLIF(lower(trim(v_auth.email)), ''), NULLIF(lower(trim(v_tr.email)), ''));
  v_username := public._resolve_unique_teacher_username(
    p_user_id,
    v_email,
    COALESCE(v_tr.username, v_auth.raw_user_meta_data->>'username')
  );
  v_full_name := COALESCE(
    NULLIF(trim(v_tr.full_name), ''),
    NULLIF(trim(v_auth.raw_user_meta_data->>'full_name'), ''),
    NULLIF(split_part(COALESCE(v_email, ''), '@', 1), ''),
    'Giáo viên'
  );

  INSERT INTO public.profiles (
    id, email, full_name, username, phone, school_name, subject_name,
    role, status, approval_status, profile_completed, is_deleted, created_at, updated_at
  ) VALUES (
    p_user_id,
    v_email,
    v_full_name,
    v_username,
    COALESCE(v_tr.phone, NULLIF(trim(v_auth.raw_user_meta_data->>'phone'), '')),
    COALESCE(v_tr.school_name, NULLIF(trim(v_auth.raw_user_meta_data->>'school_name'), '')),
    COALESCE(v_tr.subject_name, NULLIF(trim(v_auth.raw_user_meta_data->>'subject_name'), '')),
    'teacher',
    p_default_status,
    p_default_approval,
    true,
    false,
    COALESCE(v_auth.created_at, v_tr.created_at, now()),
    now()
  )
  ON CONFLICT (id) DO UPDATE
  SET email = COALESCE(public.profiles.email, EXCLUDED.email),
      username = COALESCE(public.profiles.username, EXCLUDED.username),
      full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
      updated_at = now()
  RETURNING * INTO v_p;

  RETURN v_p;
END;
$$;

REVOKE ALL ON FUNCTION public._ensure_profile_from_auth(uuid, text, text) FROM PUBLIC, anon;

-- 4. CẬP NHẬT get_my_account_state() ĐỂ KHÔNG BAO GIỜ CHẶN NHẦM GIÁO VIÊN CŨ THIẾU PROFILE HOẶC LỆCH TRẠNG THÁI
CREATE OR REPLACE FUNCTION public.get_my_account_state()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_auth record;
  v_p public.profiles%ROWTYPE;
  v_tr public.teacher_registrations%ROWTYPE;
  v_is_super boolean;
  v_has_exams boolean := false;
  v_has_folders boolean := false;
  v_is_student boolean := false;
  v_eff_status text;
  v_eff_approval text;
  v_eff_role text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('authenticated', false);
  END IF;

  SELECT id, lower(email) AS email, raw_app_meta_data, raw_user_meta_data, banned_until, created_at
  INTO v_auth
  FROM auth.users
  WHERE id = v_uid;

  SELECT * INTO v_p FROM public.profiles WHERE id = v_uid;
  SELECT * INTO v_tr FROM public.teacher_registrations WHERE user_id = v_uid LIMIT 1;
  v_is_super := public.is_super_admin(v_uid);

  SELECT EXISTS(SELECT 1 FROM public.exams WHERE created_by = v_uid) INTO v_has_exams;
  SELECT EXISTS(SELECT 1 FROM public.exam_folders WHERE teacher_id = v_uid) INTO v_has_folders;

  SELECT (
    COALESCE(v_p.role, '') = 'student'
    OR COALESCE(v_auth.raw_app_meta_data->>'role', '') = 'student'
    OR COALESCE(v_auth.raw_user_meta_data->>'role', '') = 'student'
    OR EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_uid AND ur.role::text = 'student')
  ) AND NOT v_has_exams AND NOT v_has_folders
    AND COALESCE(v_p.role, '') <> 'teacher'
    AND NOT EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_uid AND ur.role::text IN ('teacher', 'admin', 'super_admin'))
  INTO v_is_student;

  IF v_is_super THEN
    v_eff_role := 'super_admin';
    v_eff_status := 'active';
    v_eff_approval := 'APPROVED';
  ELSIF v_is_student THEN
    v_eff_role := 'student';
    v_eff_status := COALESCE(v_p.status, 'active');
    v_eff_approval := COALESCE(v_p.approval_status, 'APPROVED');
  ELSE
    v_eff_role := COALESCE(NULLIF(v_p.role, ''), 'teacher');

    -- Thứ tự ưu tiên chuẩn xác: LOCKED > REJECTED > chứng cứ giáo viên cũ/đã duyệt > PENDING đăng ký mới
    IF COALESCE(v_p.is_deleted, false)
       OR lower(COALESCE(v_p.status, '')) = 'locked'
       OR upper(COALESCE(v_p.approval_status, '')) = 'LOCKED'
       OR (v_auth.banned_until IS NOT NULL AND v_auth.banned_until > now())
    THEN
      v_eff_status := 'locked';
      v_eff_approval := 'LOCKED';
    ELSIF (
      lower(COALESCE(v_p.status, '')) = 'rejected'
      OR upper(COALESCE(v_p.approval_status, '')) = 'REJECTED'
      OR upper(COALESCE(v_tr.status, '')) = 'REJECTED'
    ) AND (v_p.approved_at IS NULL OR (v_p.rejected_at IS NOT NULL AND v_p.rejected_at > v_p.approved_at)) THEN
      v_eff_status := 'rejected';
      v_eff_approval := 'REJECTED';
    ELSIF v_tr.id IS NOT NULL AND upper(v_tr.status) = 'PENDING'
          AND NOT v_has_exams AND NOT v_has_folders
          AND v_p.approved_at IS NULL
          AND upper(COALESCE(v_p.approval_status, '')) <> 'APPROVED'
    THEN
      v_eff_status := 'pending';
      v_eff_approval := 'PENDING';
    ELSIF v_p.id IS NOT NULL AND (
      (lower(COALESCE(v_p.status, '')) = 'active' AND upper(COALESCE(v_p.approval_status, '')) = 'APPROVED')
      OR v_p.approved_at IS NOT NULL
      OR v_has_exams
      OR v_has_folders
      OR v_tr.id IS NULL
    ) THEN
      -- Giáo viên cũ (kể cả khi lệch status='pending' hay thiếu profiles) nếu không có đơn PENDING mới -> ACTIVE
      v_eff_status := 'active';
      v_eff_approval := 'APPROVED';
    ELSIF lower(COALESCE(v_p.status, '')) = 'pending' OR upper(COALESCE(v_p.approval_status, '')) = 'PENDING' THEN
      v_eff_status := 'pending';
      v_eff_approval := 'PENDING';
    ELSE
      v_eff_status := 'active';
      v_eff_approval := 'APPROVED';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'authenticated', true,
    'id', v_uid,
    'email', COALESCE(v_p.email, v_auth.email),
    'username', COALESCE(v_p.username, v_tr.username, split_part(COALESCE(v_auth.email, ''), '@', 1)),
    'full_name', COALESCE(v_p.full_name, v_tr.full_name, v_auth.raw_user_meta_data->>'full_name'),
    'phone', COALESCE(v_p.phone, v_tr.phone),
    'school_name', COALESCE(v_p.school_name, v_tr.school_name),
    'subject_name', COALESCE(v_p.subject_name, v_tr.subject_name),
    'avatar', v_p.avatar,
    'role', v_eff_role,
    'status', v_eff_status,
    'approval_status', v_eff_approval,
    'rejection_reason', COALESCE(v_p.rejection_reason, v_tr.rejection_reason),
    'must_change_password', COALESCE(v_p.must_change_password, false),
    'profile_completed', COALESCE(v_p.profile_completed, false),
    'is_deleted', COALESCE(v_p.is_deleted, false),
    'is_super_admin', v_is_super,
    'missing_profile', (v_p.id IS NULL)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_account_state() TO authenticated;

-- 5. NÂNG CẤP CÁC HÀM RPC QUẢN TRỊ ĐỂ XỬ LÝ ĐƯỢC CẢ TÀI KHOẢN THIẾU PROFILE (NHÓM C/D)
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

  v_before := public._ensure_profile_from_auth(p_user_id, 'active', 'APPROVED');
  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy tài khoản giáo viên';
  END IF;

  UPDATE public.profiles
  SET role = CASE WHEN lower(COALESCE(email, '')) = 'bichthuylqd@gmail.com' THEN 'super_admin' ELSE 'teacher' END,
      status = 'active',
      approval_status = 'APPROVED',
      approved_at = now(),
      approved_by = v_uid,
      rejection_reason = NULL,
      is_deleted = false,
      deleted_at = NULL,
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

  v_before := public._ensure_profile_from_auth(p_user_id, 'rejected', 'REJECTED');
  IF v_before.id IS NULL THEN
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

  v_before := public._ensure_profile_from_auth(p_user_id, 'locked', 'LOCKED');
  IF v_before.id IS NULL THEN
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

  v_before := public._ensure_profile_from_auth(p_user_id, 'active', 'APPROVED');
  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy tài khoản giáo viên';
  END IF;

  UPDATE public.profiles
  SET status = 'active',
      approval_status = 'APPROVED',
      approved_at = COALESCE(approved_at, now()),
      approved_by = COALESCE(approved_by, v_uid),
      locked_at = NULL,
      locked_by = NULL,
      is_deleted = false,
      deleted_at = NULL,
      updated_at = now()
  WHERE id = p_user_id;

  UPDATE public.teacher_registrations
  SET status = 'APPROVED',
      reviewed_by = COALESCE(reviewed_by, v_uid),
      reviewed_at = COALESCE(reviewed_at, now()),
      updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_user_id, 'teacher')
  ON CONFLICT (user_id, role) DO NOTHING;

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

  v_before := public._ensure_profile_from_auth(p_user_id, 'active', 'APPROVED');
  IF v_before.id IS NULL THEN
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

-- 6. TRUY VẤN HỢP NHẤT TOÀN BỘ TÀI KHOẢN GIÁO VIÊN (FULL OUTER JOIN QUA TẤT CẢ NGUỒN, KHÔNG BỎ SÓT)
CREATE OR REPLACE FUNCTION public.admin_fetch_all_teacher_accounts(p_include_deleted boolean DEFAULT true)
RETURNS TABLE (
  id uuid,
  email text,
  username text,
  full_name text,
  phone text,
  school_name text,
  subject_name text,
  role text,
  status text,
  approval_status text,
  rejection_reason text,
  is_deleted boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  exam_count bigint,
  folder_count bigint,
  missing_profile boolean,
  missing_user_role boolean,
  auth_exists boolean,
  has_registration boolean,
  registration_status text,
  sync_group text,
  sync_warning text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cutoff timestamptz;
BEGIN
  IF v_uid IS NOT NULL THEN
    IF NOT public.is_super_admin(v_uid) THEN
      RAISE EXCEPTION 'Chỉ Super Admin mới có quyền xem toàn bộ tài khoản giáo viên' USING ERRCODE = '42501';
    END IF;
  ELSIF COALESCE(current_setting('request.jwt.claim.role', true), '') = 'anon'
     OR current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Truy cập bị từ chối' USING ERRCODE = '42501';
  END IF;

  SELECT min(tr.created_at) INTO v_cutoff FROM public.teacher_registrations tr;

  RETURN QUERY
  WITH
  exam_agg AS (
    SELECT e.created_by AS uid, count(*) FILTER (WHERE COALESCE(e.is_deleted, false) = false) AS cnt, count(*) AS total_cnt
    FROM public.exams e
    WHERE e.created_by IS NOT NULL
    GROUP BY e.created_by
  ),
  folder_agg AS (
    SELECT f.teacher_id AS uid, count(*) FILTER (WHERE COALESCE(f.is_deleted, false) = false) AS cnt, count(*) AS total_cnt
    FROM public.exam_folders f
    WHERE f.teacher_id IS NOT NULL
    GROUP BY f.teacher_id
  ),
  role_agg AS (
    SELECT
      ur.user_id AS uid,
      array_agg(DISTINCT ur.role::text) AS roles_arr,
      bool_or(ur.role::text = 'teacher') AS has_teacher_role,
      bool_or(ur.role::text = 'student') AS has_student_role,
      bool_or(ur.role::text IN ('super_admin', 'admin')) AS has_admin_role
    FROM public.user_roles ur
    GROUP BY ur.user_id
  ),
  all_ids AS (
    SELECT au.id AS uid FROM auth.users au
    UNION
    SELECT pr.id AS uid FROM public.profiles pr
    UNION
    SELECT ur.user_id AS uid FROM public.user_roles ur
    UNION
    SELECT tr.user_id AS uid FROM public.teacher_registrations tr WHERE tr.user_id IS NOT NULL
    UNION
    SELECT ea.uid FROM exam_agg ea
    UNION
    SELECT fa.uid FROM folder_agg fa
  ),
  assembled AS (
    SELECT
      ai.uid,
      au.id IS NOT NULL AS v_auth_exists,
      pr.id IS NULL AS v_missing_profile,
      NOT COALESCE(ra.has_teacher_role, false) AS v_missing_user_role,
      tr.id IS NOT NULL AS v_has_reg,
      tr.status AS v_reg_status,
      COALESCE(
        NULLIF(lower(trim(pr.email)), ''),
        NULLIF(lower(trim(au.email)), ''),
        NULLIF(lower(trim(tr.email)), ''),
        ''
      ) AS v_email,
      COALESCE(
        NULLIF(trim(pr.username), ''),
        NULLIF(trim(tr.username), ''),
        NULLIF(trim(au.raw_user_meta_data->>'username'), ''),
        NULLIF(split_part(COALESCE(pr.email, au.email, tr.email, ''), '@', 1), ''),
        'gv_' || substr(replace(ai.uid::text, '-', ''), 1, 6)
      ) AS v_username,
      COALESCE(
        NULLIF(trim(pr.full_name), ''),
        NULLIF(trim(tr.full_name), ''),
        NULLIF(trim(au.raw_user_meta_data->>'full_name'), ''),
        NULLIF(split_part(COALESCE(pr.email, au.email, tr.email, ''), '@', 1), ''),
        'Giáo viên'
      ) AS v_full_name,
      COALESCE(NULLIF(trim(pr.phone), ''), NULLIF(trim(tr.phone), ''), NULLIF(trim(au.raw_user_meta_data->>'phone'), ''), '') AS v_phone,
      COALESCE(NULLIF(trim(pr.school_name), ''), NULLIF(trim(tr.school_name), ''), NULLIF(trim(au.raw_user_meta_data->>'school_name'), ''), '') AS v_school,
      COALESCE(NULLIF(trim(pr.subject_name), ''), NULLIF(trim(tr.subject_name), ''), NULLIF(trim(au.raw_user_meta_data->>'subject_name'), ''), '') AS v_subject,
      pr.role AS v_p_role,
      pr.status AS v_p_status,
      pr.approval_status AS v_p_approval,
      pr.approved_at AS v_p_approved_at,
      pr.rejected_at AS v_p_rejected_at,
      pr.locked_at AS v_p_locked_at,
      COALESCE(pr.rejection_reason, tr.rejection_reason) AS v_rejection_reason,
      COALESCE(pr.is_deleted, false) AS v_is_deleted,
      COALESCE(pr.created_at, au.created_at, tr.created_at, now()) AS v_created_at,
      au.last_sign_in_at AS v_last_sign_in_at,
      au.email_confirmed_at AS v_email_confirmed_at,
      au.banned_until AS v_banned_until,
      au.created_at AS v_auth_created_at,
      au.raw_app_meta_data AS v_app_meta,
      au.raw_user_meta_data AS v_user_meta,
      COALESCE(ea.cnt, 0) AS v_exam_cnt,
      COALESCE(ea.total_cnt, 0) AS v_exam_total_cnt,
      COALESCE(fa.cnt, 0) AS v_folder_cnt,
      COALESCE(fa.total_cnt, 0) AS v_folder_total_cnt,
      COALESCE(ra.has_teacher_role, false) AS v_has_teacher_role,
      COALESCE(ra.has_student_role, false) AS v_has_student_role,
      COALESCE(ra.has_admin_role, false) AS v_has_admin_role
    FROM all_ids ai
    LEFT JOIN auth.users au ON au.id = ai.uid
    LEFT JOIN public.profiles pr ON pr.id = ai.uid
    LEFT JOIN public.teacher_registrations tr ON tr.user_id = ai.uid
    LEFT JOIN exam_agg ea ON ea.uid = ai.uid
    LEFT JOIN folder_agg fa ON fa.uid = ai.uid
    LEFT JOIN role_agg ra ON ra.uid = ai.uid
  ),
  filtered AS (
    SELECT
      s.*,
      (
        s.v_email = 'bichthuylqd@gmail.com'
        OR COALESCE(s.v_p_role, '') = 'super_admin'
        OR COALESCE(s.v_app_meta->>'role', '') = 'super_admin'
      ) AS is_super,
      (
        (
          COALESCE(s.v_p_role, '') = 'student'
          OR s.v_has_student_role
          OR COALESCE(s.v_app_meta->>'role', '') = 'student'
          OR COALESCE(s.v_user_meta->>'role', '') = 'student'
        )
        AND NOT s.v_has_teacher_role
        AND NOT s.v_has_admin_role
        AND COALESCE(s.v_p_role, '') NOT IN ('teacher', 'admin', 'super_admin')
        AND s.v_exam_total_cnt = 0
        AND s.v_folder_total_cnt = 0
        AND NOT s.v_has_reg
      ) AS is_pure_student
    FROM assembled s
  ),
  classified AS (
    SELECT
      f.*,
      (
        f.v_is_deleted
        OR lower(COALESCE(f.v_p_status, '')) = 'locked'
        OR upper(COALESCE(f.v_p_approval, '')) = 'LOCKED'
        OR (f.v_banned_until IS NOT NULL AND f.v_banned_until > now())
      ) AS flag_locked,
      (
        lower(COALESCE(f.v_p_status, '')) = 'rejected'
        OR upper(COALESCE(f.v_p_approval, '')) = 'REJECTED'
        OR upper(COALESCE(f.v_reg_status, '')) = 'REJECTED'
      ) AND (f.v_p_approved_at IS NULL OR (f.v_p_rejected_at IS NOT NULL AND f.v_p_rejected_at > f.v_p_approved_at)) AS flag_rejected,
      (
        f.v_has_reg
        AND upper(COALESCE(f.v_reg_status, '')) = 'PENDING'
        AND f.v_exam_total_cnt = 0
        AND f.v_folder_total_cnt = 0
        AND f.v_p_approved_at IS NULL
        AND upper(COALESCE(f.v_p_approval, '')) <> 'APPROVED'
      ) AS flag_true_pending
    FROM filtered f
    WHERE NOT f.is_super AND NOT f.is_pure_student
      AND (p_include_deleted OR NOT f.v_is_deleted)
  )
  SELECT
    c.uid AS id,
    c.v_email AS email,
    c.v_username AS username,
    c.v_full_name AS full_name,
    c.v_phone AS phone,
    c.v_school AS school_name,
    c.v_subject AS subject_name,
    COALESCE(NULLIF(c.v_p_role, ''), 'teacher') AS role,
    CASE
      WHEN c.flag_locked THEN 'locked'
      WHEN c.flag_rejected THEN 'rejected'
      WHEN c.flag_true_pending THEN 'pending'
      WHEN NOT c.v_missing_profile AND (lower(COALESCE(c.v_p_status, '')) = 'pending' OR upper(COALESCE(c.v_p_approval, '')) = 'PENDING')
           AND c.v_has_reg AND upper(COALESCE(c.v_reg_status, '')) = 'PENDING' THEN 'pending'
      ELSE 'active'
    END AS status,
    CASE
      WHEN c.flag_locked THEN 'LOCKED'
      WHEN c.flag_rejected THEN 'REJECTED'
      WHEN c.flag_true_pending THEN 'PENDING'
      WHEN NOT c.v_missing_profile AND (lower(COALESCE(c.v_p_status, '')) = 'pending' OR upper(COALESCE(c.v_p_approval, '')) = 'PENDING')
           AND c.v_has_reg AND upper(COALESCE(c.v_reg_status, '')) = 'PENDING' THEN 'PENDING'
      ELSE 'APPROVED'
    END AS approval_status,
    c.v_rejection_reason AS rejection_reason,
    c.v_is_deleted AS is_deleted,
    c.v_created_at AS created_at,
    c.v_last_sign_in_at AS last_sign_in_at,
    c.v_email_confirmed_at AS email_confirmed_at,
    c.v_exam_cnt AS exam_count,
    c.v_folder_cnt AS folder_count,
    c.v_missing_profile AS missing_profile,
    c.v_missing_user_role AS missing_user_role,
    c.v_auth_exists AS auth_exists,
    c.v_has_reg AS has_registration,
    c.v_reg_status AS registration_status,
    CASE
      WHEN NOT c.v_auth_exists THEN 'UNRESOLVED'
      WHEN c.flag_locked OR c.flag_rejected THEN 'G'
      WHEN c.flag_true_pending THEN 'F'
      WHEN c.v_missing_profile THEN 'C'
      WHEN (
        (lower(COALESCE(c.v_p_status, '')) <> 'active' AND upper(COALESCE(c.v_p_approval, '')) = 'APPROVED')
        OR (lower(COALESCE(c.v_p_status, '')) = 'active' AND upper(COALESCE(c.v_p_approval, '')) <> 'APPROVED')
        OR (c.v_has_reg AND upper(COALESCE(c.v_reg_status, '')) <> upper(COALESCE(c.v_p_approval, 'APPROVED')))
        OR c.v_missing_user_role
      ) THEN 'E'
      WHEN lower(COALESCE(c.v_p_status, '')) = 'pending' OR upper(COALESCE(c.v_p_approval, '')) = 'PENDING' THEN 'B'
      WHEN (
        COALESCE(c.v_p_role, '') <> 'teacher'
        OR NULLIF(trim(c.v_email), '') IS NULL
        OR c.v_username LIKE 'gv_%'
      ) THEN 'D'
      ELSE 'A'
    END AS sync_group,
    CASE
      WHEN NOT c.v_auth_exists THEN 'Dữ liệu đề thi/thư mục không có tài khoản auth.users gốc'
      WHEN c.v_missing_profile THEN 'Thiếu bản ghi trong bảng profiles (đã hợp nhất từ auth.users/dữ liệu giáo viên)'
      WHEN c.v_missing_user_role THEN 'Thiếu vai trò teacher trong bảng user_roles'
      ELSE NULL
    END AS sync_warning
  FROM classified c
  ORDER BY c.v_created_at DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_fetch_all_teacher_accounts(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_fetch_all_teacher_accounts(boolean) TO authenticated, service_role;

-- 7. HÀM ĐỐI SOÁT & ĐỒNG BỘ IDEMPOTENT TẤT CẢ TÀI KHOẢN GIÁO VIÊN CŨ (NHÓM A–G + BÁO CÁO 8 CHỈ SỐ)
CREATE OR REPLACE FUNCTION public.admin_reconcile_legacy_teachers(
  p_apply boolean DEFAULT false,
  p_cutoff timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_batch_id uuid := gen_random_uuid();
  v_cutoff timestamptz;
  v_total_auth_users bigint := 0;
  v_total_students_skipped bigint := 0;
  v_total_teachers_before bigint := 0;
  v_missing_profiles_count bigint := 0;
  v_legacy_pending_restored bigint := 0;
  v_status_mismatch_synced bigint := 0;
  v_new_pending_preserved bigint := 0;
  v_locked_rejected_preserved bigint := 0;
  v_group_a bigint := 0;
  v_group_b bigint := 0;
  v_group_c bigint := 0;
  v_group_d bigint := 0;
  v_group_e bigint := 0;
  v_group_f bigint := 0;
  v_group_g bigint := 0;
  v_unresolved_count bigint := 0;
  v_total_teachers_after bigint := 0;
  v_remaining_pending_legacy bigint := 0;
  v_remaining_missing_profiles bigint := 0;
  v_errors jsonb := '[]'::jsonb;
  v_discrepancies jsonb := '[]'::jsonb;
  v_rec record;
  v_before_profile jsonb;
  v_before_roles jsonb;
  v_before_reg jsonb;
  v_before_auth jsonb;
  v_after_profile jsonb;
  v_target_status text;
  v_target_approval text;
  v_resolved_username text;
  v_action_taken text;
  v_err_msg text;
BEGIN
  IF v_uid IS NOT NULL THEN
    IF NOT public.is_super_admin(v_uid) THEN
      RAISE EXCEPTION 'Chỉ Super Admin mới có quyền chạy đối soát & đồng bộ tài khoản' USING ERRCODE = '42501';
    END IF;
  ELSIF COALESCE(current_setting('request.jwt.claim.role', true), '') = 'anon'
     OR current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Truy cập bị từ chối' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_total_auth_users FROM auth.users;
  v_cutoff := COALESCE(p_cutoff, (SELECT min(created_at) FROM public.teacher_registrations), now());

  -- Đếm giáo viên hiển thị trong Super Admin trước đồng bộ (dựa trên bảng profiles hiện hữu)
  SELECT count(*) INTO v_total_teachers_before
  FROM public.profiles pr
  WHERE COALESCE(pr.is_deleted, false) = false
    AND lower(COALESCE(pr.email, '')) <> 'bichthuylqd@gmail.com'
    AND COALESCE(pr.role, 'teacher') NOT IN ('super_admin', 'student');

  -- Đếm học sinh thuần túy bị bỏ qua (không bao giờ gán nhầm thành giáo viên)
  WITH exam_agg AS (
    SELECT created_by AS uid FROM public.exams WHERE created_by IS NOT NULL GROUP BY created_by
  ),
  folder_agg AS (
    SELECT teacher_id AS uid FROM public.exam_folders WHERE teacher_id IS NOT NULL GROUP BY teacher_id
  )
  SELECT count(DISTINCT au.id) INTO v_total_students_skipped
  FROM auth.users au
  LEFT JOIN public.profiles pr ON pr.id = au.id
  LEFT JOIN public.teacher_registrations tr ON tr.user_id = au.id
  LEFT JOIN exam_agg ea ON ea.uid = au.id
  LEFT JOIN folder_agg fa ON fa.uid = au.id
  WHERE lower(COALESCE(au.email, '')) <> 'bichthuylqd@gmail.com'
    AND ea.uid IS NULL
    AND fa.uid IS NULL
    AND tr.id IS NULL
    AND COALESCE(pr.role, '') NOT IN ('teacher', 'admin', 'super_admin')
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = au.id AND ur.role::text IN ('teacher', 'admin', 'super_admin')
    )
    AND (
      COALESCE(pr.role, '') = 'student'
      OR COALESCE(au.raw_app_meta_data->>'role', '') = 'student'
      OR COALESCE(au.raw_user_meta_data->>'role', '') = 'student'
      OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = au.id AND ur.role::text = 'student')
    );

  -- Duyệt toàn bộ tài khoản giáo viên ứng viên từ tất cả bảng
  FOR v_rec IN
    SELECT * FROM public.admin_fetch_all_teacher_accounts(true)
  LOOP
    IF v_rec.sync_group = 'A' THEN
      v_group_a := v_group_a + 1;
      CONTINUE;
    END IF;

    IF v_rec.sync_group = 'UNRESOLVED' THEN
      v_unresolved_count := v_unresolved_count + 1;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'user_id', v_rec.id,
        'email', v_rec.email,
        'group', 'UNRESOLVED',
        'reason', COALESCE(v_rec.sync_warning, 'Thiếu bản ghi auth.users gốc')
      ));
      CONTINUE;
    END IF;

    IF v_rec.sync_group = 'B' THEN
      v_group_b := v_group_b + 1;
      v_legacy_pending_restored := v_legacy_pending_restored + 1;
    ELSIF v_rec.sync_group = 'C' THEN
      v_group_c := v_group_c + 1;
      v_missing_profiles_count := v_missing_profiles_count + 1;
    ELSIF v_rec.sync_group = 'D' THEN
      v_group_d := v_group_d + 1;
      v_status_mismatch_synced := v_status_mismatch_synced + 1;
    ELSIF v_rec.sync_group = 'E' THEN
      v_group_e := v_group_e + 1;
      v_status_mismatch_synced := v_status_mismatch_synced + 1;
    ELSIF v_rec.sync_group = 'F' THEN
      v_group_f := v_group_f + 1;
      v_new_pending_preserved := v_new_pending_preserved + 1;
      IF v_rec.missing_profile THEN
        v_missing_profiles_count := v_missing_profiles_count + 1;
      END IF;
    ELSIF v_rec.sync_group = 'G' THEN
      v_group_g := v_group_g + 1;
      v_locked_rejected_preserved := v_locked_rejected_preserved + 1;
      IF v_rec.missing_profile THEN
        v_missing_profiles_count := v_missing_profiles_count + 1;
      END IF;
    END IF;

    IF jsonb_array_length(v_discrepancies) < 500 THEN
      v_discrepancies := v_discrepancies || jsonb_build_array(jsonb_build_object(
        'user_id', v_rec.id,
        'email', v_rec.email,
        'full_name', v_rec.full_name,
        'sync_group', v_rec.sync_group,
        'missing_profile', v_rec.missing_profile,
        'missing_user_role', v_rec.missing_user_role,
        'exam_count', v_rec.exam_count,
        'folder_count', v_rec.folder_count,
        'approval_status', v_rec.approval_status,
        'sync_warning', v_rec.sync_warning
      ));
    END IF;

    IF NOT p_apply THEN
      CONTINUE;
    END IF;

    -- Thực thi đồng bộ từng tài khoản trong block cô lập lỗi (error isolation)
    BEGIN
      SELECT to_jsonb(p) INTO v_before_profile FROM public.profiles p WHERE p.id = v_rec.id;
      SELECT COALESCE(jsonb_agg(ur.role::text), '[]'::jsonb) INTO v_before_roles FROM public.user_roles ur WHERE ur.user_id = v_rec.id;
      SELECT to_jsonb(tr) INTO v_before_reg FROM public.teacher_registrations tr WHERE tr.user_id = v_rec.id LIMIT 1;
      SELECT jsonb_build_object('id', au.id, 'email', au.email, 'created_at', au.created_at, 'last_sign_in_at', au.last_sign_in_at)
      INTO v_before_auth FROM auth.users au WHERE au.id = v_rec.id;

      v_target_status := v_rec.status;
      v_target_approval := v_rec.approval_status;
      v_resolved_username := public._resolve_unique_teacher_username(v_rec.id, v_rec.email, v_rec.username);

      IF v_rec.sync_group = 'F' THEN
        v_action_taken := CASE WHEN v_rec.missing_profile THEN 'HYDRATE_PENDING_PROFILE' ELSE 'PRESERVE_NEW_PENDING' END;
        -- Chỉ tạo profile/user_role nếu bị thiếu cho đơn đăng ký mới, giữ nguyên trạng thái PENDING
        IF v_rec.missing_profile THEN
          INSERT INTO public.profiles (
            id, email, full_name, username, phone, school_name, subject_name,
            role, status, approval_status, profile_completed, is_deleted, created_at, updated_at
          ) VALUES (
            v_rec.id, NULLIF(v_rec.email, ''), v_rec.full_name, v_resolved_username,
            NULLIF(v_rec.phone, ''), NULLIF(v_rec.school_name, ''), NULLIF(v_rec.subject_name, ''),
            'teacher', 'pending', 'PENDING', true, false, v_rec.created_at, now()
          )
          ON CONFLICT (id) DO NOTHING;
        END IF;

        IF v_rec.missing_user_role THEN
          INSERT INTO public.user_roles (user_id, role) VALUES (v_rec.id, 'teacher') ON CONFLICT (user_id, role) DO NOTHING;
        END IF;

      ELSIF v_rec.sync_group = 'G' THEN
        v_action_taken := CASE WHEN v_rec.missing_profile THEN 'HYDRATE_LOCKED_REJECTED_PROFILE' ELSE 'SYNC_LOCKED_REJECTED_CONSISTENCY' END;
        -- Tuyệt đối KHÔNG mở khóa / bỏ từ chối tài khoản nhóm G; chỉ đồng bộ profile nếu thiếu hoặc lệch bảng
        IF v_rec.missing_profile THEN
          INSERT INTO public.profiles (
            id, email, full_name, username, phone, school_name, subject_name,
            role, status, approval_status, rejection_reason,
            profile_completed, is_deleted, created_at, updated_at
          ) VALUES (
            v_rec.id, NULLIF(v_rec.email, ''), v_rec.full_name, v_resolved_username,
            NULLIF(v_rec.phone, ''), NULLIF(v_rec.school_name, ''), NULLIF(v_rec.subject_name, ''),
            'teacher', v_target_status, v_target_approval, v_rec.rejection_reason,
            true, (v_target_approval = 'LOCKED' AND v_rec.is_deleted), v_rec.created_at, now()
          )
          ON CONFLICT (id) DO NOTHING;
        ELSE
          UPDATE public.profiles
          SET status = v_target_status,
              approval_status = v_target_approval,
              role = COALESCE(NULLIF(role, ''), 'teacher'),
              updated_at = now()
          WHERE id = v_rec.id
            AND (status IS DISTINCT FROM v_target_status OR approval_status IS DISTINCT FROM v_target_approval OR role IS NULL);
        END IF;

      ELSE
        -- Nhóm B, C, D, E: Khôi phục / bổ sung hồ sơ giáo viên cũ về active + APPROVED
        v_action_taken := CASE v_rec.sync_group
          WHEN 'C' THEN 'CREATE_MISSING_LEGACY_PROFILE'
          WHEN 'B' THEN 'RESTORE_LEGACY_PENDING_TO_ACTIVE'
          WHEN 'E' THEN 'REPAIR_CROSS_TABLE_MISMATCH'
          ELSE 'NORMALIZE_LEGACY_PROFILE_METADATA'
        END;

        INSERT INTO public.profiles (
          id, email, full_name, username, phone, school_name, subject_name,
          role, status, approval_status, approved_at, rejection_reason,
          profile_completed, is_deleted, created_at, updated_at
        ) VALUES (
          v_rec.id,
          NULLIF(v_rec.email, ''),
          v_rec.full_name,
          v_resolved_username,
          NULLIF(v_rec.phone, ''),
          NULLIF(v_rec.school_name, ''),
          NULLIF(v_rec.subject_name, ''),
          'teacher',
          'active',
          'APPROVED',
          now(),
          NULL,
          true,
          false,
          v_rec.created_at,
          now()
        )
        ON CONFLICT (id) DO UPDATE
        SET email = COALESCE(NULLIF(trim(public.profiles.email), ''), EXCLUDED.email),
            full_name = COALESCE(NULLIF(trim(public.profiles.full_name), ''), EXCLUDED.full_name),
            username = COALESCE(NULLIF(trim(public.profiles.username), ''), EXCLUDED.username),
            phone = COALESCE(NULLIF(trim(public.profiles.phone), ''), EXCLUDED.phone),
            school_name = COALESCE(NULLIF(trim(public.profiles.school_name), ''), EXCLUDED.school_name),
            subject_name = COALESCE(NULLIF(trim(public.profiles.subject_name), ''), EXCLUDED.subject_name),
            role = CASE WHEN public.profiles.role = 'super_admin' THEN 'super_admin' ELSE 'teacher' END,
            status = 'active',
            approval_status = 'APPROVED',
            approved_at = COALESCE(public.profiles.approved_at, now()),
            rejection_reason = NULL,
            is_deleted = false,
            updated_at = now();

        INSERT INTO public.user_roles (user_id, role)
        VALUES (v_rec.id, 'teacher')
        ON CONFLICT (user_id, role) DO NOTHING;

        -- Đồng bộ bảng teacher_registrations nếu có bản ghi cũ đang lệch PENDING
        UPDATE public.teacher_registrations
        SET status = 'APPROVED',
            rejection_reason = NULL,
            reviewed_at = COALESCE(reviewed_at, now()),
            updated_at = now()
        WHERE user_id = v_rec.id
          AND status <> 'APPROVED';
      END IF;

      SELECT to_jsonb(p) INTO v_after_profile FROM public.profiles p WHERE p.id = v_rec.id;

      INSERT INTO public.legacy_teacher_sync_backups (
        batch_id, user_id, email, classification_group, action_taken,
        before_profile, before_roles, before_registration, before_auth_meta, after_profile
      ) VALUES (
        v_batch_id, v_rec.id, v_rec.email, v_rec.sync_group, v_action_taken,
        v_before_profile, v_before_roles, v_before_reg, v_before_auth, v_after_profile
      );

    EXCEPTION WHEN OTHERS THEN
      v_err_msg := SQLERRM;
      v_unresolved_count := v_unresolved_count + 1;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'user_id', v_rec.id,
        'email', v_rec.email,
        'group', v_rec.sync_group,
        'reason', v_err_msg
      ));
      BEGIN
        INSERT INTO public.legacy_teacher_sync_backups (
          batch_id, user_id, email, classification_group, action_taken,
          before_profile, error_message
        ) VALUES (
          v_batch_id, v_rec.id, v_rec.email, v_rec.sync_group, 'ERROR',
          v_before_profile, v_err_msg
        );
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END;
  END LOOP;

  -- Kiểm tra lại sau đồng bộ (vòng xác minh thứ 2)
  SELECT count(*) INTO v_total_teachers_after
  FROM public.admin_fetch_all_teacher_accounts(false);

  SELECT count(*) INTO v_remaining_missing_profiles
  FROM public.admin_fetch_all_teacher_accounts(true)
  WHERE missing_profile = true AND sync_group <> 'UNRESOLVED';

  SELECT count(*) INTO v_remaining_pending_legacy
  FROM public.admin_fetch_all_teacher_accounts(true)
  WHERE sync_group IN ('B', 'C', 'D', 'E');

  IF p_apply THEN
    BEGIN
      INSERT INTO public.admin_activity_logs (
        admin_id, admin_email, action, target_type, target_id, target_label,
        after_data, outcome, detail
      ) VALUES (
        v_uid,
        'bichthuylqd@gmail.com',
        'RECONCILE_LEGACY_TEACHERS',
        'system',
        v_batch_id::text,
        'Đối soát & đồng bộ tài khoản giáo viên cũ',
        jsonb_build_object(
          'batch_id', v_batch_id,
          'total_auth_users', v_total_auth_users,
          'total_teachers_before', v_total_teachers_before,
          'missing_profiles_created', v_missing_profiles_count,
          'legacy_pending_restored', v_legacy_pending_restored,
          'status_mismatch_synced', v_status_mismatch_synced,
          'new_pending_preserved', v_new_pending_preserved,
          'locked_rejected_preserved', v_locked_rejected_preserved,
          'total_teachers_after', v_total_teachers_after,
          'unresolved_count', v_unresolved_count
        ),
        CASE WHEN v_unresolved_count = 0 THEN 'success' ELSE 'error' END,
        'Đồng bộ tài khoản giáo viên cũ: tạo mới ' || v_missing_profiles_count ||
        ' profile thiếu, khôi phục ' || v_legacy_pending_restored ||
        ' tài khoản bị PENDING, sửa lệch ' || v_status_mismatch_synced || ' tài khoản.'
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'applied', p_apply,
    'batch_id', v_batch_id,
    'cutoff', v_cutoff,
    'stats', jsonb_build_object(
      'total_auth_users', v_total_auth_users,
      'total_teachers_before', v_total_teachers_before,
      'missing_profiles_created', v_missing_profiles_count,
      'legacy_pending_restored', v_legacy_pending_restored,
      'status_mismatch_synced', v_status_mismatch_synced,
      'new_pending_preserved', v_new_pending_preserved,
      'locked_rejected_preserved', v_locked_rejected_preserved,
      'total_teachers_after', v_total_teachers_after,
      'total_students_skipped', v_total_students_skipped
    ),
    'group_counts', jsonb_build_object(
      'A', v_group_a,
      'B', v_group_b,
      'C', v_group_c,
      'D', v_group_d,
      'E', v_group_e,
      'F', v_group_f,
      'G', v_group_g,
      'UNRESOLVED', v_unresolved_count
    ),
    'verification', jsonb_build_object(
      'remaining_missing_profiles', v_remaining_missing_profiles,
      'remaining_unsynced_legacy', v_remaining_pending_legacy,
      'idempotent_clean', (v_remaining_missing_profiles = 0 AND v_remaining_pending_legacy = 0)
    ),
    'discrepancies', v_discrepancies,
    'unresolved_errors', v_errors
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reconcile_legacy_teachers(boolean, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_legacy_teachers(boolean, timestamptz) TO authenticated, service_role;

-- 8. TỰ ĐỘNG CHẠY ĐỒNG BỘ AN TOÀN 1 LẦN KHI ÁP DỤNG MIGRATION (IDEMPOTENT + BACKUP)
DO $$
DECLARE
  v_res jsonb;
BEGIN
  SELECT public.admin_reconcile_legacy_teachers(true, NULL) INTO v_res;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Auto reconciliation skipped or partial notice: %', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
