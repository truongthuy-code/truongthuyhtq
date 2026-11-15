-- ============================================================================
-- Migration: 20261118000000_fix_schools_rls_and_exam_code_sync.sql
-- Mục tiêu:
--   1. Khắc phục triệt để lỗi RLS:
--      "new row violates row-level security policy (USING expression) for table schools"
--      khi giáo viên tạo / chỉnh sửa / chia sẻ / đồng bộ mã bài thi 6 chữ số & link ngắn.
--   2. Áp dụng phân quyền RLS chặt chẽ theo giáo viên (created_by) & trường (school_id),
--      TUYỆT ĐỐI KHÔNG tắt RLS trên bảng public.schools và KHÔNG cho phép sửa chéo trường/chéo giáo viên.
--   3. Bổ sung RPC SECURITY DEFINER `sync_exam_codes_and_links` đồng bộ nguyên tử,
--      kiểm tra quyền sở hữu đề thi và chống trùng mã chéo đề trước khi ghi.
--   4. Tự động dọn dẹp khóa registry trong `public.schools` khi đề thi bị xóa.
--   5. Đảm bảo idempotent đầy đủ với `exam_short_links`, `check_exam_code_taken`,
--      `resolve_exam_access_code`, `resolve_exam_short_link`, và `exam_access_logs`.
-- ============================================================================

-- 1. Helper nhận diện khóa registry mã bài thi / link ngắn trong public.schools
CREATE OR REPLACE FUNCTION public.is_school_registry_key(p_name_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_name_key, '') LIKE 'assign_code:%'
      OR COALESCE(p_name_key, '') LIKE 'short_code:%'
      OR COALESCE(p_name_key, '') LIKE 'short_exam:%'
      OR COALESCE(p_name_key, '') LIKE 'short_assign:%';
$$;

GRANT EXECUTE ON FUNCTION public.is_school_registry_key(text) TO anon, authenticated, service_role;

-- 2. Helper kiểm tra quyền sở hữu / trường học của giáo viên đối với 1 dòng registry trong `public.schools`
CREATE OR REPLACE FUNCTION public.can_manage_school_registry_row(
  p_name_key text,
  p_name text,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_json jsonb;
  v_exam_id_text text;
  v_exam public.exams%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  -- Admin / Super Admin có toàn quyền quản trị
  IF public.is_admin(p_user_id) THEN
    RETURN true;
  END IF;

  -- Giáo viên không được phép sửa/xóa bản ghi trường học thật (non-registry)
  IF NOT public.is_school_registry_key(p_name_key) THEN
    RETURN false;
  END IF;

  -- Parse JSON metadata từ cột `name`
  BEGIN
    v_json := NULLIF(trim(COALESCE(p_name, '')), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  IF v_json IS NULL OR jsonb_typeof(v_json) <> 'object' THEN
    RETURN false;
  END IF;

  v_exam_id_text := trim(COALESCE(v_json->>'examId', ''));
  IF v_exam_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;

  SELECT *
  INTO v_exam
  FROM public.exams
  WHERE id = v_exam_id_text::uuid;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Đúng giáo viên tạo đề
  IF v_exam.created_by = p_user_id THEN
    RETURN true;
  END IF;

  -- Hỗ trợ đề legacy chưa có created_by: chỉ cho phép giáo viên cùng school_id hoặc cùng trường
  IF v_exam.created_by IS NULL THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
    IF FOUND THEN
      IF v_exam.school_id IS NOT NULL AND v_profile.school_id IS NOT NULL AND v_exam.school_id = v_profile.school_id THEN
        RETURN true;
      END IF;
      IF NULLIF(lower(trim(COALESCE(v_exam.school_name, ''))), '') IS NOT NULL
         AND lower(trim(v_exam.school_name)) = lower(trim(COALESCE(v_profile.school_name, ''))) THEN
        RETURN true;
      END IF;
    END IF;
  END IF;

  RETURN false;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.can_manage_school_registry_row(text, text, uuid) TO authenticated, service_role;

-- 3. Chuẩn hóa RLS & Privileges trên bảng `public.schools` (RLS luôn BẬT)
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.schools TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.schools TO authenticated;
GRANT ALL ON public.schools TO service_role;

CREATE INDEX IF NOT EXISTS schools_name_key_prefix_idx
  ON public.schools (name_key text_pattern_ops);

-- Gỡ các policy cũ quá rộng hoặc thiếu quyền UPDATE/DELETE theo chủ sở hữu
DROP POLICY IF EXISTS "schools readable by all" ON public.schools;
CREATE POLICY "schools readable by all"
ON public.schools
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "schools authenticated insert" ON public.schools;
DROP POLICY IF EXISTS "schools authenticated insert scoped" ON public.schools;
CREATE POLICY "schools authenticated insert scoped"
ON public.schools
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_admin(auth.uid())
  OR NOT public.is_school_registry_key(name_key)
  OR public.can_manage_school_registry_row(name_key, name, auth.uid())
);

DROP POLICY IF EXISTS "schools authenticated update registry" ON public.schools;
DROP POLICY IF EXISTS "schools authenticated update scoped" ON public.schools;
CREATE POLICY "schools authenticated update scoped"
ON public.schools
FOR UPDATE
TO authenticated
USING (
  public.is_admin(auth.uid())
  OR public.can_manage_school_registry_row(name_key, name, auth.uid())
)
WITH CHECK (
  public.is_admin(auth.uid())
  OR public.can_manage_school_registry_row(name_key, name, auth.uid())
);

DROP POLICY IF EXISTS "schools authenticated delete registry" ON public.schools;
DROP POLICY IF EXISTS "schools authenticated delete scoped" ON public.schools;
CREATE POLICY "schools authenticated delete scoped"
ON public.schools
FOR DELETE
TO authenticated
USING (
  public.is_admin(auth.uid())
  OR public.can_manage_school_registry_row(name_key, name, auth.uid())
);

-- 4. Đảm bảo bảng `exam_short_links` & `exam_access_logs` tồn tại idempotent
CREATE TABLE IF NOT EXISTS public.exam_short_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code text NOT NULL,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  assignment_id text,
  assignment_code text,
  class_name text,
  target_path text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS exam_short_links_short_code_upper_idx
  ON public.exam_short_links (upper(trim(short_code)));

CREATE UNIQUE INDEX IF NOT EXISTS exam_short_links_primary_exam_idx
  ON public.exam_short_links (exam_id)
  WHERE is_primary = true AND is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS exam_short_links_assignment_idx
  ON public.exam_short_links (exam_id, assignment_id)
  WHERE assignment_id IS NOT NULL AND is_active = true;

CREATE INDEX IF NOT EXISTS exam_short_links_exam_id_idx
  ON public.exam_short_links (exam_id);

ALTER TABLE public.exam_short_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "exam_short_links_owner_or_admin_all" ON public.exam_short_links;
CREATE POLICY "exam_short_links_owner_or_admin_all"
ON public.exam_short_links
FOR ALL
TO authenticated
USING (
  public.is_admin(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.exams e
    WHERE e.id = exam_short_links.exam_id
      AND e.created_by = auth.uid()
  )
)
WITH CHECK (
  public.is_admin(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.exams e
    WHERE e.id = exam_short_links.exam_id
      AND e.created_by = auth.uid()
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_short_links TO authenticated;
GRANT ALL ON public.exam_short_links TO service_role;

CREATE TABLE IF NOT EXISTS public.exam_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  exam_id uuid NULL REFERENCES public.exams(id) ON DELETE SET NULL,
  code_masked text NOT NULL,
  access_type text NOT NULL CHECK (access_type IN ('code', 'short_link', 'url_uuid', 'create_sync')),
  outcome text NOT NULL CHECK (outcome IN ('success', 'not_found', 'closed', 'not_open', 'expired', 'unauthorized', 'network_error', 'server_error', 'sync_error')),
  error_category text NULL,
  error_detail text NULL,
  app_env text NULL
);

CREATE INDEX IF NOT EXISTS exam_access_logs_created_at_idx
  ON public.exam_access_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS exam_access_logs_exam_id_idx
  ON public.exam_access_logs (exam_id);

ALTER TABLE public.exam_access_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "exam_access_logs_teacher_or_admin_select" ON public.exam_access_logs;
CREATE POLICY "exam_access_logs_teacher_or_admin_select"
ON public.exam_access_logs
FOR SELECT
TO authenticated
USING (
  public.is_admin(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.exams e
    WHERE e.id = exam_access_logs.exam_id
      AND e.created_by = auth.uid()
  )
);

GRANT SELECT ON public.exam_access_logs TO authenticated;
GRANT ALL ON public.exam_access_logs TO service_role;

-- 5. RPC kiểm tra trùng mã & tra cứu mã công khai cho học sinh
CREATE OR REPLACE FUNCTION public.check_exam_code_taken(p_code text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_raw text;
  v_norm text;
  v_unpadded text;
BEGIN
  v_raw := upper(trim(COALESCE(p_code, '')));
  IF v_raw = '' THEN
    RETURN true;
  END IF;

  IF v_raw ~ '^\d{1,6}$' THEN
    v_norm := lpad(v_raw, 6, '0');
  ELSE
    v_norm := v_raw;
  END IF;
  v_unpadded := regexp_replace(v_norm, '^0+', '');

  IF EXISTS (
    SELECT 1
    FROM public.exam_short_links sl
    WHERE upper(trim(sl.short_code)) = v_raw
       OR upper(trim(sl.short_code)) = v_norm
       OR upper(trim(COALESCE(sl.assignment_code, ''))) = v_norm
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.schools s
    WHERE s.name_key IN (
      'assign_code:' || v_raw,
      'assign_code:' || v_norm,
      'short_code:' || v_raw,
      'short_code:' || v_norm
    )
    OR (v_unpadded <> '' AND s.name_key = 'assign_code:' || v_unpadded)
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.exams e
    WHERE upper(trim(COALESCE(e.team_config->>'primary_code', ''))) IN (v_raw, v_norm, v_unpadded)
       OR upper(trim(COALESCE(e.team_config->>'primary_short_code', ''))) IN (v_raw, v_norm)
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements(COALESCE(e.team_config->'assignments', '[]'::jsonb)) AS a
         WHERE upper(trim(COALESCE(a->>'code', ''))) IN (v_raw, v_norm, v_unpadded)
            OR upper(trim(COALESCE(a->>'shortCode', ''))) IN (v_raw, v_norm)
       )
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.check_exam_code_taken(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.resolve_exam_short_link(p_short_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_code text;
  v_link public.exam_short_links%ROWTYPE;
  v_exam public.exams%ROWTYPE;
  v_status text;
BEGIN
  v_code := upper(trim(COALESCE(p_short_code, '')));
  IF v_code = '' OR length(v_code) < 4 THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT *
  INTO v_link
  FROM public.exam_short_links
  WHERE upper(trim(short_code)) = v_code
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT *
  INTO v_exam
  FROM public.exams
  WHERE id = v_link.exam_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  v_status := public.exam_status(v_exam.open_at, v_exam.close_at, v_exam.manual_closed);

  RETURN jsonb_build_object(
    'found', true,
    'short_code', v_link.short_code,
    'exam_id', v_link.exam_id,
    'assignment_id', v_link.assignment_id,
    'assignment_code', v_link.assignment_code,
    'class_name', v_link.class_name,
    'target_path', v_link.target_path,
    'is_primary', v_link.is_primary,
    'display_mode', v_exam.display_mode,
    'status', v_status
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_exam_short_link(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.resolve_exam_access_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_raw text;
  v_norm text;
  v_clean text;
  v_unpadded text;
  v_link public.exam_short_links%ROWTYPE;
  v_inactive_short boolean := false;
  v_school_json jsonb;
  v_exam public.exams%ROWTYPE;
  v_assign jsonb;
  v_status text;
  v_exam_id uuid;
  v_assign_id text;
  v_assign_code text;
  v_class_name text;
  v_short_code text;
BEGIN
  v_raw := upper(trim(COALESCE(p_code, '')));
  IF v_raw = '' THEN
    RETURN jsonb_build_object('found', false, 'reason', 'empty');
  END IF;

  IF v_raw ~ '^\d{1,6}$' THEN
    v_norm := lpad(v_raw, 6, '0');
  ELSE
    v_norm := v_raw;
  END IF;
  v_clean := regexp_replace(v_raw, '[^A-Z0-9]', '', 'g');
  v_unpadded := regexp_replace(v_norm, '^0+', '');

  -- 1. Kiểm tra exam_short_links
  SELECT *
  INTO v_link
  FROM public.exam_short_links
  WHERE upper(trim(short_code)) = v_raw
  ORDER BY is_active DESC, created_at DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_link.is_active THEN
      SELECT * INTO v_exam FROM public.exams WHERE id = v_link.exam_id;
      IF FOUND THEN
        v_status := public.exam_status(v_exam.open_at, v_exam.close_at, v_exam.manual_closed);
        RETURN jsonb_build_object(
          'found', true,
          'source', 'exam_short_links',
          'exam_id', v_exam.id,
          'assignment_id', v_link.assignment_id,
          'assignment_code', v_link.assignment_code,
          'class_name', COALESCE(v_link.class_name, 'Chung'),
          'short_code', v_link.short_code,
          'target_path', v_link.target_path,
          'is_primary', v_link.is_primary,
          'display_mode', v_exam.display_mode,
          'status', v_status
        );
      END IF;
    ELSE
      v_inactive_short := true;
    END IF;
  END IF;

  -- 2. Kiểm tra schools registry
  SELECT NULLIF(s.name, '')::jsonb
  INTO v_school_json
  FROM public.schools s
  WHERE s.name_key IN (
    'assign_code:' || v_norm,
    'assign_code:' || v_raw,
    'assign_code:' || v_clean,
    'short_code:' || v_raw
  )
     OR (v_unpadded <> '' AND s.name_key = 'assign_code:' || v_unpadded)
  ORDER BY CASE
    WHEN s.name_key = 'assign_code:' || v_norm THEN 1
    WHEN s.name_key = 'assign_code:' || v_raw THEN 2
    WHEN s.name_key = 'short_code:' || v_raw THEN 3
    ELSE 4
  END
  LIMIT 1;

  IF v_school_json IS NOT NULL AND COALESCE(v_school_json->>'examId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_exam_id := (v_school_json->>'examId')::uuid;
    SELECT * INTO v_exam FROM public.exams WHERE id = v_exam_id;
    IF FOUND THEN
      v_status := public.exam_status(v_exam.open_at, v_exam.close_at, v_exam.manual_closed);
      RETURN jsonb_build_object(
        'found', true,
        'source', 'schools',
        'exam_id', v_exam.id,
        'assignment_id', v_school_json->>'id',
        'assignment_code', COALESCE(v_school_json->>'code', v_school_json->>'assignmentCode', v_norm),
        'class_name', COALESCE(v_school_json->>'className', 'Chung'),
        'short_code', v_school_json->>'shortCode',
        'display_mode', v_exam.display_mode,
        'status', v_status
      );
    END IF;
  END IF;

  -- 3. Fallback trực tiếp từ public.exams.team_config
  SELECT e.*
  INTO v_exam
  FROM public.exams e
  WHERE upper(trim(COALESCE(e.team_config->>'primary_code', ''))) IN (v_raw, v_norm, v_clean)
     OR (v_unpadded <> '' AND upper(trim(COALESCE(e.team_config->>'primary_code', ''))) = v_unpadded)
     OR (NOT v_inactive_short AND upper(trim(COALESCE(e.team_config->>'primary_short_code', ''))) = v_raw)
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(COALESCE(e.team_config->'assignments', '[]'::jsonb)) AS a
       WHERE upper(trim(COALESCE(a->>'code', ''))) IN (v_raw, v_norm, v_clean)
          OR (v_unpadded <> '' AND upper(trim(COALESCE(a->>'code', ''))) = v_unpadded)
          OR (NOT v_inactive_short AND upper(trim(COALESCE(a->>'shortCode', ''))) = v_raw)
     )
  ORDER BY e.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    SELECT a
    INTO v_assign
    FROM jsonb_array_elements(COALESCE(v_exam.team_config->'assignments', '[]'::jsonb)) AS a
    WHERE upper(trim(COALESCE(a->>'code', ''))) IN (v_raw, v_norm, v_clean)
       OR (v_unpadded <> '' AND upper(trim(COALESCE(a->>'code', ''))) = v_unpadded)
       OR (NOT v_inactive_short AND upper(trim(COALESCE(a->>'shortCode', ''))) = v_raw)
    LIMIT 1;

    v_status := public.exam_status(v_exam.open_at, v_exam.close_at, v_exam.manual_closed);
    v_assign_id := COALESCE(v_assign->>'id', 'primary_' || v_exam.id::text);
    v_assign_code := COALESCE(
      NULLIF(v_assign->>'code', ''),
      NULLIF(v_exam.team_config->>'primary_code', ''),
      v_norm
    );
    v_class_name := COALESCE(NULLIF(v_assign->>'className', ''), 'Chung');
    v_short_code := COALESCE(
      NULLIF(v_assign->>'shortCode', ''),
      NULLIF(v_exam.team_config->>'primary_short_code', '')
    );

    RETURN jsonb_build_object(
      'found', true,
      'source', 'exams_team_config',
      'exam_id', v_exam.id,
      'assignment_id', v_assign_id,
      'assignment_code', v_assign_code,
      'class_name', v_class_name,
      'short_code', v_short_code,
      'display_mode', v_exam.display_mode,
      'status', v_status
    );
  END IF;

  RETURN jsonb_build_object('found', false, 'reason', CASE WHEN v_inactive_short THEN 'inactive' ELSE 'not_found' END);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_exam_access_code(text) TO anon, authenticated;

-- 6. RPC đồng bộ mã bài thi & link ngắn nguyên tử, bảo toàn phân quyền teacher_id / school_id
CREATE OR REPLACE FUNCTION public.sync_exam_codes_and_links(
  p_exam_id uuid,
  p_entries jsonb DEFAULT '[]'::jsonb,
  p_primary_code text DEFAULT NULL,
  p_short_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid;
  v_exam public.exams%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_authorized boolean := false;
  v_entry jsonb;
  v_key text;
  v_val text;
  v_val_json jsonb;
  v_existing_name text;
  v_existing_json jsonb;
  v_existing_exam_id text;
  v_synced_count int := 0;
  v_norm_primary text;
  v_norm_short text;
  v_team_cfg jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'permission denied: authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_exam FROM public.exams WHERE id = p_exam_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'exam_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF public.is_admin(v_uid) OR v_exam.created_by = v_uid THEN
    v_authorized := true;
  ELSIF v_exam.created_by IS NULL THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid;
    IF FOUND THEN
      IF (v_exam.school_id IS NOT NULL AND v_profile.school_id IS NOT NULL AND v_exam.school_id = v_profile.school_id)
         OR (NULLIF(lower(trim(COALESCE(v_exam.school_name, ''))), '') IS NOT NULL
             AND lower(trim(v_exam.school_name)) = lower(trim(COALESCE(v_profile.school_name, '')))) THEN
        v_authorized := true;
      END IF;
    END IF;
  END IF;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'permission denied: not exam owner' USING ERRCODE = '42501';
  END IF;

  v_norm_primary := upper(trim(COALESCE(p_primary_code, '')));
  IF v_norm_primary ~ '^\d{1,6}$' THEN
    v_norm_primary := lpad(v_norm_primary, 6, '0');
  END IF;
  v_norm_short := upper(trim(COALESCE(p_short_code, '')));

  IF jsonb_typeof(COALESCE(p_entries, '[]'::jsonb)) = 'array' THEN
    FOR v_entry IN SELECT jsonb_array_elements(COALESCE(p_entries, '[]'::jsonb)) LOOP
      v_key := trim(COALESCE(v_entry->>'name_key', ''));
      v_val := COALESCE(v_entry->>'name', '');

      IF v_key = '' OR NOT public.is_school_registry_key(v_key) THEN
        CONTINUE;
      END IF;

      BEGIN
        v_val_json := NULLIF(trim(v_val), '')::jsonb;
      EXCEPTION WHEN OTHERS THEN
        v_val_json := NULL;
      END;

      IF v_val_json IS NULL OR COALESCE(v_val_json->>'examId', '') <> p_exam_id::text THEN
        RAISE EXCEPTION 'invalid_registry_payload:%', v_key USING ERRCODE = '22023';
      END IF;

      SELECT s.name
      INTO v_existing_name
      FROM public.schools s
      WHERE s.name_key = v_key
      LIMIT 1;

      IF FOUND AND v_existing_name IS NOT NULL THEN
        BEGIN
          v_existing_json := NULLIF(trim(v_existing_name), '')::jsonb;
          v_existing_exam_id := trim(COALESCE(v_existing_json->>'examId', ''));
        EXCEPTION WHEN OTHERS THEN
          v_existing_json := NULL;
          v_existing_exam_id := '';
        END;

        IF v_existing_exam_id <> ''
           AND v_existing_exam_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND v_existing_exam_id <> p_exam_id::text THEN
          -- Nếu trùng trực tiếp với mã 6 số chính hoặc short code -> báo xung đột để client sinh mã mới
          IF v_key LIKE 'short_code:%'
             OR (v_norm_primary <> '' AND v_key IN ('assign_code:' || v_norm_primary, 'assign_code:' || regexp_replace(v_norm_primary, '^0+', ''))) THEN
            RAISE EXCEPTION 'code_conflict:%', v_key USING ERRCODE = '23505';
          ELSE
            -- Khóa legacy hash nếu trùng đề khác thì bỏ qua, không ghi đè đề khác
            CONTINUE;
          END IF;
        END IF;
      END IF;

      INSERT INTO public.schools (name_key, name)
      VALUES (v_key, v_val)
      ON CONFLICT (name_key) DO UPDATE
      SET name = EXCLUDED.name;

      v_synced_count := v_synced_count + 1;
    END LOOP;
  END IF;

  -- Backfill primary_code / primary_short_code lên exams.team_config nếu chưa có
  v_team_cfg := COALESCE(v_exam.team_config, '{}'::jsonb);
  IF (v_norm_primary <> '' AND COALESCE(v_team_cfg->>'primary_code', '') = '')
     OR (v_norm_short <> '' AND COALESCE(v_team_cfg->>'primary_short_code', '') = '') THEN
    IF v_norm_primary <> '' AND COALESCE(v_team_cfg->>'primary_code', '') = '' THEN
      v_team_cfg := jsonb_set(v_team_cfg, '{primary_code}', to_jsonb(v_norm_primary), true);
    END IF;
    IF v_norm_short <> '' AND COALESCE(v_team_cfg->>'primary_short_code', '') = '' THEN
      v_team_cfg := jsonb_set(v_team_cfg, '{primary_short_code}', to_jsonb(v_norm_short), true);
    END IF;

    UPDATE public.exams
    SET team_config = v_team_cfg
    WHERE id = p_exam_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'synced_count', v_synced_count,
    'exam_id', p_exam_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.sync_exam_codes_and_links(uuid, jsonb, text, text) TO authenticated, service_role;

-- 7. Trigger tự động dọn dẹp khóa registry trong `public.schools` khi xóa bài thi
CREATE OR REPLACE FUNCTION public.cleanup_schools_registry_on_exam_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  DELETE FROM public.schools s
  WHERE s.name_key = 'assign_code:' || lower(OLD.id::text)
     OR s.name_key = 'short_exam:' || OLD.id::text
     OR s.name_key LIKE 'short_assign:' || OLD.id::text || ':%'
     OR (
       public.is_school_registry_key(s.name_key)
       AND s.name LIKE '%"examId":"' || OLD.id::text || '"%'
     );
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cleanup_schools_registry_on_exam_delete ON public.exams;
CREATE TRIGGER trg_cleanup_schools_registry_on_exam_delete
  AFTER DELETE ON public.exams
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_schools_registry_on_exam_delete();

-- 8. RPC log_exam_access_event idempotent
CREATE OR REPLACE FUNCTION public.log_exam_access_event(
  p_exam_id uuid DEFAULT NULL,
  p_code_masked text DEFAULT '',
  p_access_type text DEFAULT 'code',
  p_outcome text DEFAULT 'not_found',
  p_error_category text DEFAULT NULL,
  p_error_detail text DEFAULT NULL,
  p_app_env text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_type text;
  v_outcome text;
  v_code text;
  v_detail text;
BEGIN
  v_type := CASE
    WHEN p_access_type IN ('code', 'short_link', 'url_uuid', 'create_sync') THEN p_access_type
    ELSE 'code'
  END;

  v_outcome := CASE
    WHEN p_outcome IN ('success', 'not_found', 'closed', 'not_open', 'expired', 'unauthorized', 'network_error', 'server_error', 'sync_error') THEN p_outcome
    ELSE 'server_error'
  END;

  v_code := left(regexp_replace(COALESCE(p_code_masked, ''), '[\r\n\t]+', ' ', 'g'), 64);
  v_detail := left(regexp_replace(COALESCE(p_error_detail, ''), '[\r\n\t]+', ' ', 'g'), 300);

  INSERT INTO public.exam_access_logs (
    exam_id,
    code_masked,
    access_type,
    outcome,
    error_category,
    error_detail,
    app_env
  )
  VALUES (
    p_exam_id,
    v_code,
    v_type,
    v_outcome,
    left(COALESCE(p_error_category, ''), 64),
    NULLIF(v_detail, ''),
    left(COALESCE(p_app_env, ''), 64)
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.log_exam_access_event(uuid, text, text, text, text, text, text) TO anon, authenticated;
