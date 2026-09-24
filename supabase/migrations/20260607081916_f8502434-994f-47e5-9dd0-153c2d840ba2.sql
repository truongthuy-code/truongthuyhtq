
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS display_mode text NOT NULL DEFAULT 'standard';
ALTER TABLE public.exams ADD CONSTRAINT exams_display_mode_check CHECK (display_mode IN ('standard','quizizz'));

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
BEGIN
  SELECT * INTO v_row FROM public.exams WHERE id = p_exam_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam not found'; END IF;
  v_qs := v_row.questions;

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
    'questions', jsonb_build_object('partI', v_p1, 'partII', v_p2, 'partIII', v_p3)
  );
END;
$function$;
