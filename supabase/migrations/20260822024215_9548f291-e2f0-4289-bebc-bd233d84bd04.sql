ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS instant_feedback boolean NOT NULL DEFAULT false;

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

CREATE OR REPLACE FUNCTION public.check_question_answer(p_exam_id uuid, p_question_id text, p_answer jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.exams%ROWTYPE;
  v_q jsonb;
  v_status text;
  v_item jsonb;
  v_chosen jsonb;
  v_val jsonb;
  v_ok_items int := 0;
  v_total int := 0;
  v_studentSaysTrue boolean;
  v_items jsonb := '[]'::jsonb;
  v_correctAns text;
  v_given text;
  v_ok boolean;
BEGIN
  SELECT * INTO v_row FROM public.exams WHERE id = p_exam_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam not found'; END IF;
  IF NOT COALESCE(v_row.instant_feedback, false) OR v_row.display_mode <> 'quizizz' THEN
    RAISE EXCEPTION 'Tính năng phản hồi tức thì không được bật cho đề này';
  END IF;
  v_status := public.exam_status(v_row.open_at, v_row.close_at, v_row.manual_closed);
  IF v_status = 'not_open' THEN RAISE EXCEPTION 'Đề thi chưa được mở'; END IF;

  -- Phần I: trắc nghiệm 4 phương án
  SELECT q INTO v_q FROM jsonb_array_elements(COALESCE(v_row.questions->'partI', '[]'::jsonb)) AS q
    WHERE q->>'id' = p_question_id;
  IF FOUND THEN
    v_ok := p_answer IS NOT NULL AND (p_answer #>> '{}') = (v_q->>'answer');
    RETURN jsonb_build_object(
      'type', 'mc',
      'correct', v_ok,
      'answer', v_q->>'answer',
      'explanation', v_q->'explanation'
    );
  END IF;

  -- Phần II: Đúng/Sai nhiều ý
  SELECT q INTO v_q FROM jsonb_array_elements(COALESCE(v_row.questions->'partII', '[]'::jsonb)) AS q
    WHERE q->>'id' = p_question_id;
  IF FOUND THEN
    v_chosen := COALESCE(p_answer, '{}'::jsonb);
    FOR v_item IN SELECT jsonb_array_elements(COALESCE(v_q->'items', '[]'::jsonb)) LOOP
      v_total := v_total + 1;
      v_studentSaysTrue := NULL;
      IF jsonb_typeof(v_chosen) = 'array' THEN
        v_studentSaysTrue := v_chosen ? (v_item->>'key');
      ELSIF jsonb_typeof(v_chosen) = 'object' THEN
        v_val := v_chosen->(v_item->>'key');
        IF v_val IS NOT NULL AND jsonb_typeof(v_val) = 'boolean' THEN
          v_studentSaysTrue := (v_val)::text::boolean;
        END IF;
      END IF;
      IF v_studentSaysTrue IS NOT NULL
         AND v_studentSaysTrue = COALESCE((v_item->>'correct')::boolean, false) THEN
        v_ok_items := v_ok_items + 1;
      END IF;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'key', v_item->>'key',
        'correct', COALESCE((v_item->>'correct')::boolean, false),
        'student', v_studentSaysTrue
      ));
    END LOOP;
    RETURN jsonb_build_object(
      'type', 'tf',
      'correct', v_ok_items = v_total AND v_total > 0,
      'okItems', v_ok_items,
      'totalItems', v_total,
      'items', v_items,
      'explanation', v_q->'explanation'
    );
  END IF;

  -- Phần III: trả lời ngắn
  SELECT q INTO v_q FROM jsonb_array_elements(COALESCE(v_row.questions->'partIII', '[]'::jsonb)) AS q
    WHERE q->>'id' = p_question_id;
  IF FOUND THEN
    v_correctAns := lower(trim(public.strip_rich(v_q->>'answer')));
    v_given := lower(trim(COALESCE(p_answer #>> '{}', '')));
    v_ok := v_given = v_correctAns AND v_given <> '';
    IF NOT v_ok AND v_given <> '' AND v_correctAns <> ''
       AND v_given ~ '^-?[0-9]+([\.,][0-9]+)?$'
       AND v_correctAns ~ '^-?[0-9]+([\.,][0-9]+)?$'
       AND abs(replace(v_given, ',', '.')::numeric - replace(v_correctAns, ',', '.')::numeric) < 1e-6 THEN
      v_ok := true;
    END IF;
    RETURN jsonb_build_object(
      'type', 'sa',
      'correct', v_ok,
      'answer', v_q->>'answer',
      'explanation', v_q->'explanation'
    );
  END IF;

  RAISE EXCEPTION 'question not found';
END;
$function$;