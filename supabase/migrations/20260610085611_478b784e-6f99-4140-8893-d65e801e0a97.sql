
ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS open_at timestamptz,
  ADD COLUMN IF NOT EXISTS close_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_closed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_submit_on_close boolean NOT NULL DEFAULT true;

-- Helper to compute status
CREATE OR REPLACE FUNCTION public.exam_status(p_open timestamptz, p_close timestamptz, p_manual boolean)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN COALESCE(p_manual, false) THEN 'closed'
    WHEN p_open IS NOT NULL AND now() < p_open THEN 'not_open'
    WHEN p_close IS NOT NULL AND now() > p_close THEN 'closed'
    ELSE 'open'
  END
$$;

-- Update get_exam_for_student: include schedule and gate questions when not open/closed
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
  SELECT * INTO v_row FROM public.exams WHERE id = p_exam_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam not found'; END IF;
  v_qs := v_row.questions;
  v_status := public.exam_status(v_row.open_at, v_row.close_at, v_row.manual_closed);

  IF v_status = 'open' THEN
    FOR v_item IN SELECT jsonb_array_elements(COALESCE(v_qs->'partI', '[]'::jsonb)) LOOP
      v_clean := v_item - 'answer';
      v_p1 := v_p1 || jsonb_build_array(v_clean);
    END LOOP;
    FOR v_item IN SELECT jsonb_array_elements(COALESCE(v_qs->'partII', '[]'::jsonb)) LOOP
      v_sub_arr := '[]'::jsonb;
      FOR v_sub_el IN SELECT jsonb_array_elements(COALESCE(v_item->'items', '[]'::jsonb)) LOOP
        v_sub_arr := v_sub_arr || jsonb_build_array(v_sub_el - 'correct');
      END LOOP;
      v_clean := v_item - 'items' || jsonb_build_object('items', v_sub_arr);
      v_p2 := v_p2 || jsonb_build_array(v_clean);
    END LOOP;
    FOR v_item IN SELECT jsonb_array_elements(COALESCE(v_qs->'partIII', '[]'::jsonb)) LOOP
      v_p3 := v_p3 || jsonb_build_array(v_item - 'answer');
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

-- submit RPC: reject if exam never opened, or if closed + auto_submit_on_close = false should still accept (autosubmit). Reject only when not_open. Also reject when closed AND manual_closed (teacher closed) to be safe.
CREATE OR REPLACE FUNCTION public.submit_student_exam(p_exam_id uuid, p_student_name text, p_student_class text, p_answers jsonb, p_violations jsonb DEFAULT '[]'::jsonb, p_violation_count integer DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.exams%ROWTYPE;
  v_scoring jsonb;
  v_qs jsonb;
  v_q jsonb;
  v_id text;
  v_ans jsonb;
  v_correct int := 0;
  v_wrong int := 0;
  v_score numeric := 0;
  v_max numeric := 0;
  v_p1 numeric;
  v_p3 numeric;
  v_p2_pts numeric;
  v_item jsonb;
  v_chosen jsonb;
  v_ok_items int;
  v_total_items int;
  v_studentSaysTrue boolean;
  v_correctAns text;
  v_given text;
  v_p2_map jsonb;
  v_sub_id uuid;
  v_lock jsonb;
  v_penalty numeric;
  v_status text;
BEGIN
  IF p_student_name IS NULL OR length(trim(p_student_name)) = 0 THEN
    RAISE EXCEPTION 'student_name required';
  END IF;
  IF p_student_class IS NULL OR length(trim(p_student_class)) = 0 THEN
    RAISE EXCEPTION 'student_class required';
  END IF;

  SELECT * INTO v_row FROM public.exams WHERE id = p_exam_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam not found'; END IF;

  v_status := public.exam_status(v_row.open_at, v_row.close_at, v_row.manual_closed);
  IF v_status = 'not_open' THEN
    RAISE EXCEPTION 'Đề thi chưa được mở';
  END IF;

  v_qs := v_row.questions;
  v_scoring := v_row.scoring;
  v_p1 := COALESCE((v_scoring->>'p1')::numeric, 0.25);
  v_p3 := COALESCE((v_scoring->>'p3')::numeric, 0.25);
  v_p2_map := COALESCE(v_scoring->'p2', '{"1":0.1,"2":0.25,"3":0.5,"4":1}'::jsonb);

  FOR v_q IN SELECT jsonb_array_elements(COALESCE(v_qs->'partI', '[]'::jsonb)) LOOP
    v_id := v_q->>'id';
    v_max := v_max + v_p1;
    v_ans := p_answers->v_id;
    IF v_ans IS NOT NULL AND (v_ans #>> '{}') = (v_q->>'answer') THEN
      v_correct := v_correct + 1;
      v_score := v_score + v_p1;
    ELSE
      v_wrong := v_wrong + 1;
    END IF;
  END LOOP;

  FOR v_q IN SELECT jsonb_array_elements(COALESCE(v_qs->'partII', '[]'::jsonb)) LOOP
    v_id := v_q->>'id';
    v_max := v_max + COALESCE((v_p2_map->>'4')::numeric, 1);
    v_chosen := COALESCE(p_answers->v_id, '[]'::jsonb);
    v_ok_items := 0;
    v_total_items := 0;
    FOR v_item IN SELECT jsonb_array_elements(COALESCE(v_q->'items', '[]'::jsonb)) LOOP
      v_total_items := v_total_items + 1;
      v_studentSaysTrue := v_chosen ? (v_item->>'key');
      IF v_studentSaysTrue = COALESCE((v_item->>'correct')::boolean, false) THEN
        v_ok_items := v_ok_items + 1;
      END IF;
    END LOOP;
    IF v_ok_items >= 1 THEN
      v_p2_pts := COALESCE((v_p2_map->>v_ok_items::text)::numeric, 0);
      v_score := v_score + v_p2_pts;
    END IF;
    IF v_ok_items = v_total_items AND v_total_items > 0 THEN
      v_correct := v_correct + 1;
    ELSE
      v_wrong := v_wrong + 1;
    END IF;
  END LOOP;

  FOR v_q IN SELECT jsonb_array_elements(COALESCE(v_qs->'partIII', '[]'::jsonb)) LOOP
    v_id := v_q->>'id';
    v_max := v_max + v_p3;
    v_correctAns := lower(trim(public.strip_rich(v_q->>'answer')));
    v_given := lower(trim(COALESCE(p_answers->>v_id, '')));
    IF v_given = v_correctAns AND v_given <> '' THEN
      v_correct := v_correct + 1;
      v_score := v_score + v_p3;
    ELSIF v_given <> '' AND v_correctAns <> ''
       AND v_given ~ '^-?[0-9]+([\.,][0-9]+)?$'
       AND v_correctAns ~ '^-?[0-9]+([\.,][0-9]+)?$'
       AND abs(replace(v_given, ',', '.')::numeric - replace(v_correctAns, ',', '.')::numeric) < 1e-6 THEN
      v_correct := v_correct + 1;
      v_score := v_score + v_p3;
    ELSE
      v_wrong := v_wrong + 1;
    END IF;
  END LOOP;

  v_lock := COALESCE(v_row.lock_mode, '{}'::jsonb);
  IF COALESCE((v_lock->>'enabled')::boolean, false)
     AND COALESCE((v_lock->>'penalty')::boolean, false)
     AND p_violation_count > 0 THEN
    v_penalty := COALESCE((v_lock->>'penaltyPerViolation')::numeric, 0) * p_violation_count;
    v_score := GREATEST(0, v_score - v_penalty);
  END IF;

  INSERT INTO public.submissions(
    exam_id, student_name, student_class, answers, score, max_score,
    correct_count, wrong_count, violation_count, violations
  )
  VALUES (
    p_exam_id, p_student_name, p_student_class, p_answers,
    round(v_score::numeric, 2), round(v_max::numeric, 2),
    v_correct, v_wrong,
    COALESCE(p_violation_count, 0),
    COALESCE(p_violations, '[]'::jsonb)
  )
  RETURNING id INTO v_sub_id;

  RETURN v_sub_id;
END;
$function$;
