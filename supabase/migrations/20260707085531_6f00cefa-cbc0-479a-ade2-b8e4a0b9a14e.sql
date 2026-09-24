
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS started_at timestamptz;

DROP FUNCTION IF EXISTS public.submit_student_exam(uuid, text, text, jsonb, jsonb, integer);

CREATE OR REPLACE FUNCTION public.submit_student_exam(
  p_exam_id uuid,
  p_student_name text,
  p_student_class text,
  p_answers jsonb,
  p_violations jsonb DEFAULT '[]'::jsonb,
  p_violation_count integer DEFAULT 0,
  p_started_at timestamptz DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
    correct_count, wrong_count, violation_count, violations, started_at
  )
  VALUES (
    p_exam_id, p_student_name, p_student_class, p_answers,
    round(v_score::numeric, 2), round(v_max::numeric, 2),
    v_correct, v_wrong,
    COALESCE(p_violation_count, 0),
    COALESCE(p_violations, '[]'::jsonb),
    p_started_at
  )
  RETURNING id INTO v_sub_id;

  RETURN v_sub_id;
END;
$function$;
