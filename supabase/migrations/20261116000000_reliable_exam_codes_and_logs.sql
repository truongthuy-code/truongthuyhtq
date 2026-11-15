-- Khắc phục triệt để lỗi đồng bộ & tra cứu mã bài thi / link ngắn
-- 1. Cấp quyền UPDATE/DELETE trên bảng public.schools cho các khóa registry mã bài thi/link ngắn
-- 2. Bổ sung RPC SECURITY DEFINER check_exam_code_taken & resolve_exam_access_code
-- 3. Bổ sung bảng exam_access_logs & RPC log_exam_access_event (chỉ giáo viên/admin đọc log kỹ thuật)

-- ============================================================
-- 1. FIX RLS CHO BẢNG public.schools (registry assign_code / short_code)
-- ============================================================
GRANT SELECT ON public.schools TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.schools TO authenticated;

DROP POLICY IF EXISTS "schools authenticated update registry" ON public.schools;
CREATE POLICY "schools authenticated update registry"
ON public.schools
FOR UPDATE
TO authenticated
USING (
  public.is_admin(auth.uid())
  OR name_key LIKE 'assign_code:%'
  OR name_key LIKE 'short_code:%'
  OR name_key LIKE 'short_exam:%'
  OR name_key LIKE 'short_assign:%'
)
WITH CHECK (
  public.is_admin(auth.uid())
  OR name_key LIKE 'assign_code:%'
  OR name_key LIKE 'short_code:%'
  OR name_key LIKE 'short_exam:%'
  OR name_key LIKE 'short_assign:%'
);

DROP POLICY IF EXISTS "schools authenticated delete registry" ON public.schools;
CREATE POLICY "schools authenticated delete registry"
ON public.schools
FOR DELETE
TO authenticated
USING (
  public.is_admin(auth.uid())
  OR name_key LIKE 'assign_code:%'
  OR name_key LIKE 'short_code:%'
  OR name_key LIKE 'short_exam:%'
  OR name_key LIKE 'short_assign:%'
);

-- Index hỗ trợ tìm kiếm nhanh prefix trên schools.name_key
CREATE INDEX IF NOT EXISTS schools_name_key_prefix_idx
  ON public.schools (name_key text_pattern_ops);

-- ============================================================
-- 2. RPC KIỂM TRA TRÙNG MÃ TOÀN HỆ THỐNG (KHÔNG BỊ CHẶN BỞI RLS)
-- ============================================================
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

  -- Kiểm tra bảng exam_short_links (bao gồm cả mã cũ để không tái phát hành trùng)
  IF EXISTS (
    SELECT 1
    FROM public.exam_short_links sl
    WHERE upper(trim(sl.short_code)) = v_raw
       OR upper(trim(sl.short_code)) = v_norm
       OR upper(trim(COALESCE(sl.assignment_code, ''))) = v_norm
  ) THEN
    RETURN true;
  END IF;

  -- Kiểm tra bảng schools registry
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

  -- Kiểm tra trực tiếp trên public.exams (primary_code, primary_short_code, và assignments[])
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

-- ============================================================
-- 3. RPC TRA CỨU MÃ LÀM BÀI / LINK NGẮN ĐỘC LẬP & CHÍNH XÁC
--    Chỉ trả metadata định tuyến, KHÔNG lộ câu hỏi/đáp án/mật khẩu
-- ============================================================
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
  v_display_mode text;
  v_source text := '';
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

  -- Bước 1: Kiểm tra exam_short_links trước
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

  -- Bước 2: Kiểm tra schools registry (assign_code:* hoặc short_code:*)
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

  -- Bước 3: Tra cứu trực tiếp trên public.exams (cứu cánh cho đề cũ hoặc đồng bộ trước đây bị sót)
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
    v_display_mode := v_exam.display_mode;
    v_source := 'exams_team_config';

    RETURN jsonb_build_object(
      'found', true,
      'source', v_source,
      'exam_id', v_exam.id,
      'assignment_id', v_assign_id,
      'assignment_code', v_assign_code,
      'class_name', v_class_name,
      'short_code', v_short_code,
      'display_mode', v_display_mode,
      'status', v_status
    );
  END IF;

  RETURN jsonb_build_object('found', false, 'reason', CASE WHEN v_inactive_short THEN 'inactive' ELSE 'not_found' END);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_exam_access_code(text) TO anon, authenticated;

-- ============================================================
-- 4. BẢNG LOG KỸ THUẬT LỖI TRUY CẬP MÃ (CHỈ GIÁO VIÊN / ADMIN XEM)
-- ============================================================
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
  -- Không để lỗi ghi log làm gián đoạn luồng thi của học sinh
  NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.log_exam_access_event(uuid, text, text, text, text, text, text) TO anon, authenticated;
