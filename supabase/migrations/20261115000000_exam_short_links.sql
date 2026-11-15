-- Bổ sung bảng và RPC quản lý Link bài thi ngắn (/e/<SHORT_CODE>)
-- Giữ nguyên toàn bộ cơ chế link gốc, mã 6 số, bảo mật và thang điểm hiện tại.

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
  EXISTS (
    SELECT 1
    FROM public.exams e
    WHERE e.id = exam_short_links.exam_id
      AND (e.created_by = auth.uid() OR public.is_admin(auth.uid()))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.exams e
    WHERE e.id = exam_short_links.exam_id
      AND (e.created_by = auth.uid() OR public.is_admin(auth.uid()))
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_short_links TO authenticated;
GRANT ALL ON public.exam_short_links TO service_role;

-- RPC công khai (SECURITY DEFINER): chỉ trả về metadata định tuyến, KHÔNG lộ câu hỏi/đáp án/mật khẩu
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
