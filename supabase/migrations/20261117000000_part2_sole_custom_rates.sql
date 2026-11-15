-- Điều chỉnh phương thức tính điểm Phần II – Đúng/Sai:
-- Chỉ sử dụng duy nhất Phương thức 2: Tỷ lệ giáo viên thiết lập ('custom_rates', mặc định 0%/10%/25%/50%/100%).
-- Đồng bộ trên chuẩn hóa thang 10, nộp bài chuẩn (submit_student_exam),
-- kiểm tra từng câu (check_question_answer) và chế độ đội nhóm (team_answer_question).

-- 1. Cập nhật normalize_scoring_to_scale10 bảo đảm p2Method luôn là 'custom_rates' và có p2Rates
CREATE OR REPLACE FUNCTION public.normalize_scoring_to_scale10(p_scoring jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_mode text;
  v_total_scale numeric;
  v_parts_sum numeric;
  v_factor numeric := 10;
  v_parts jsonb;
  v_per_q jsonb;
  v_p2_legacy jsonb;
  v_p2_rates jsonb;
BEGIN
  IF p_scoring IS NULL OR jsonb_typeof(p_scoring) <> 'object' THEN
    RETURN p_scoring;
  END IF;

  IF NOT (p_scoring ? 'parts') THEN
    RETURN p_scoring;
  END IF;

  v_p2_rates := COALESCE(
    CASE WHEN jsonb_typeof(p_scoring->'p2Rates') = 'object' THEN p_scoring->'p2Rates' ELSE NULL END,
    '{"1":10,"2":25,"3":50,"4":100}'::jsonb
  );

  v_mode := COALESCE(p_scoring->>'mode', '');
  IF v_mode = 'scale_10' THEN
    RETURN p_scoring || jsonb_build_object(
      'p2Method', 'custom_rates',
      'p2Rates', v_p2_rates
    );
  END IF;

  IF v_mode = 'scale_100' THEN
    v_total_scale := COALESCE((p_scoring->>'totalScale')::numeric, 0);
    v_parts_sum :=
      COALESCE((p_scoring->'parts'->>'p1')::numeric, 0) +
      COALESCE((p_scoring->'parts'->>'p2')::numeric, 0) +
      COALESCE((p_scoring->'parts'->>'p3')::numeric, 0);

    IF v_total_scale = 100 OR (v_total_scale <> 10 AND v_parts_sum > 10.5) THEN
      v_factor := CASE WHEN v_total_scale > 10.5 THEN v_total_scale / 10.0 ELSE 10.0 END;
      v_parts := jsonb_build_object(
        'p1', COALESCE((p_scoring->'parts'->>'p1')::numeric, 0) / v_factor,
        'p2', COALESCE((p_scoring->'parts'->>'p2')::numeric, 0) / v_factor,
        'p3', COALESCE((p_scoring->'parts'->>'p3')::numeric, 0) / v_factor
      );
      v_per_q := jsonb_build_object(
        'p1', COALESCE((p_scoring->'perQuestion'->>'p1')::numeric, 0) / v_factor,
        'p2', COALESCE((p_scoring->'perQuestion'->>'p2')::numeric, 0) / v_factor,
        'p3', COALESCE((p_scoring->'perQuestion'->>'p3')::numeric, 0) / v_factor
      );
      v_p2_legacy := CASE
        WHEN p_scoring ? 'p2' AND jsonb_typeof(p_scoring->'p2') = 'object' THEN
          jsonb_build_object(
            '1', COALESCE((p_scoring->'p2'->>'1')::numeric, 0) / v_factor,
            '2', COALESCE((p_scoring->'p2'->>'2')::numeric, 0) / v_factor,
            '3', COALESCE((p_scoring->'p2'->>'3')::numeric, 0) / v_factor,
            '4', COALESCE((p_scoring->'p2'->>'4')::numeric, 0) / v_factor
          )
        ELSE '{"1":0.1,"2":0.25,"3":0.5,"4":1}'::jsonb
      END;

      RETURN p_scoring || jsonb_build_object(
        'mode', 'scale_10',
        'totalScale', 10,
        'parts', v_parts,
        'perQuestion', v_per_q,
        'perItemP2', COALESCE((p_scoring->>'perItemP2')::numeric, 0) / v_factor,
        'p2Method', 'custom_rates',
        'p2Rates', v_p2_rates,
        'p1', COALESCE((p_scoring->>'p1')::numeric, 0) / v_factor,
        'p2', v_p2_legacy,
        'p3', COALESCE((p_scoring->>'p3')::numeric, 0) / v_factor
      );
    ELSE
      RETURN p_scoring || jsonb_build_object(
        'mode', 'scale_10',
        'totalScale', 10,
        'p2Method', 'custom_rates',
        'p2Rates', v_p2_rates
      );
    END IF;
  END IF;

  RETURN p_scoring;
END;
$function$;

-- 2. Cập nhật submit_student_exam: Phần II trên thang 10 luôn dùng phương thức tỷ lệ % giáo viên thiết lập ('custom_rates')
CREATE OR REPLACE FUNCTION public.submit_student_exam(
  p_exam_id uuid,
  p_student_name text,
  p_student_class text,
  p_answers jsonb,
  p_violations jsonb DEFAULT '[]'::jsonb,
  p_violation_count integer DEFAULT 0,
  p_started_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_duration_seconds integer DEFAULT NULL
)
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
  v_val jsonb;
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
  v_is_scale10 boolean := false;
  v_n1 int := 0;
  v_n2 int := 0;
  v_n3 int := 0;
  v_parts jsonb;
  v_pts_p1 numeric := 0;
  v_pts_p2 numeric := 0;
  v_pts_p3 numeric := 0;
  v_correct_p1 int := 0;
  v_p2_ratio_sum numeric := 0;
  v_correct_p3 int := 0;
  v_p2_method text := 'custom_rates';
  v_p2_rates jsonb := '{"1":10,"2":25,"3":50,"4":100}'::jsonb;
  v_q_ratio numeric := 0;
  v_rate_pct numeric := 0;
  v_per_q2 numeric := 0;
  v_q_earned numeric := 0;
  v_q_max numeric := 0;
  v_p2_idx int := 0;
  v_item_statuses jsonb;
  v_part2_summary jsonb := '[]'::jsonb;
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
  v_scoring := public.normalize_scoring_to_scale10(COALESCE(v_row.scoring, '{}'::jsonb));
  v_is_scale10 := (COALESCE(v_scoring->>'mode', '') IN ('scale_10', 'scale_100')) AND (v_scoring ? 'parts');

  v_n1 := jsonb_array_length(COALESCE(v_qs->'partI', '[]'::jsonb));
  v_n2 := jsonb_array_length(COALESCE(v_qs->'partII', '[]'::jsonb));
  v_n3 := jsonb_array_length(COALESCE(v_qs->'partIII', '[]'::jsonb));

  IF v_is_scale10 THEN
    v_parts := v_scoring->'parts';
    v_pts_p1 := CASE WHEN v_n1 > 0 THEN COALESCE((v_parts->>'p1')::numeric, 0) ELSE 0 END;
    v_pts_p2 := CASE WHEN v_n2 > 0 THEN COALESCE((v_parts->>'p2')::numeric, 0) ELSE 0 END;
    v_pts_p3 := CASE WHEN v_n3 > 0 THEN COALESCE((v_parts->>'p3')::numeric, 0) ELSE 0 END;
    v_max := v_pts_p1 + v_pts_p2 + v_pts_p3;
    v_per_q2 := CASE WHEN v_n2 > 0 THEN v_pts_p2 / v_n2::numeric ELSE 0 END;
    v_p2_method := 'custom_rates';
    v_p2_rates := COALESCE(
      CASE WHEN jsonb_typeof(v_scoring->'p2Rates') = 'object' THEN v_scoring->'p2Rates' ELSE NULL END,
      '{"1":10,"2":25,"3":50,"4":100}'::jsonb
    );
  ELSE
    v_p1 := COALESCE((v_scoring->>'p1')::numeric, 0.25);
    v_p3 := COALESCE((v_scoring->>'p3')::numeric, 0.25);
    v_p2_map := COALESCE(v_scoring->'p2', '{"1":0.1,"2":0.25,"3":0.5,"4":1}'::jsonb);
  END IF;

  -- Phần I
  FOR v_q IN SELECT jsonb_array_elements(COALESCE(v_qs->'partI', '[]'::jsonb)) LOOP
    v_id := v_q->>'id';
    IF NOT v_is_scale10 THEN v_max := v_max + v_p1; END IF;
    v_ans := p_answers->v_id;
    IF v_ans IS NOT NULL AND (v_ans #>> '{}') = (v_q->>'answer') THEN
      v_correct := v_correct + 1;
      v_correct_p1 := v_correct_p1 + 1;
      IF NOT v_is_scale10 THEN v_score := v_score + v_p1; END IF;
    ELSE
      v_wrong := v_wrong + 1;
    END IF;
  END LOOP;

  -- Phần II (Phương thức 2 duy nhất: Tỷ lệ giáo viên thiết lập)
  FOR v_q IN SELECT jsonb_array_elements(COALESCE(v_qs->'partII', '[]'::jsonb)) LOOP
    v_p2_idx := v_p2_idx + 1;
    v_id := v_q->>'id';
    IF NOT v_is_scale10 THEN v_max := v_max + COALESCE((v_p2_map->>'4')::numeric, 1); END IF;
    v_chosen := COALESCE(p_answers->v_id, '{}'::jsonb);
    v_ok_items := 0;
    v_total_items := 0;
    v_item_statuses := '[]'::jsonb;

    FOR v_item IN SELECT jsonb_array_elements(COALESCE(v_q->'items', '[]'::jsonb)) LOOP
      v_total_items := v_total_items + 1;
      v_studentSaysTrue := NULL;
      IF jsonb_typeof(v_chosen) = 'array' THEN
        v_studentSaysTrue := v_chosen ? (v_item->>'key');
      ELSIF jsonb_typeof(v_chosen) = 'object' THEN
        v_val := v_chosen->(v_item->>'key');
        IF v_val IS NOT NULL AND jsonb_typeof(v_val) = 'boolean' THEN
          v_studentSaysTrue := (v_val)::text::boolean;
        END IF;
      END IF;

      IF v_studentSaysTrue IS NULL THEN
        v_item_statuses := v_item_statuses || jsonb_build_array('blank');
      ELSIF v_studentSaysTrue = COALESCE((v_item->>'correct')::boolean, false) THEN
        v_ok_items := v_ok_items + 1;
        v_item_statuses := v_item_statuses || jsonb_build_array('correct');
      ELSE
        v_item_statuses := v_item_statuses || jsonb_build_array('wrong');
      END IF;
    END LOOP;

    IF v_is_scale10 THEN
      IF v_ok_items <= 0 OR v_total_items <= 0 THEN
        v_rate_pct := 0;
        v_q_ratio := 0;
      ELSE
        IF v_ok_items >= v_total_items THEN
          v_rate_pct := COALESCE((v_p2_rates->>'4')::numeric, 100);
        ELSE
          v_rate_pct := COALESCE((v_p2_rates->>LEAST(3, GREATEST(1, v_ok_items))::text)::numeric, 0);
        END IF;
        v_rate_pct := LEAST(100, GREATEST(0, v_rate_pct));
        v_q_ratio := v_rate_pct / 100.0;
      END IF;
      v_p2_ratio_sum := v_p2_ratio_sum + v_q_ratio;
      v_q_max := round(v_per_q2, 2);
      v_q_earned := round(v_per_q2 * v_q_ratio, 2);
    ELSE
      v_q_max := round(COALESCE((v_p2_map->>'4')::numeric, 1), 2);
      IF v_ok_items >= 1 THEN
        v_p2_pts := COALESCE((v_p2_map->>v_ok_items::text)::numeric, 0);
        v_score := v_score + v_p2_pts;
      ELSE
        v_p2_pts := 0;
      END IF;
      v_q_earned := round(v_p2_pts, 2);
      v_rate_pct := CASE WHEN v_q_max > 0 THEN round((v_p2_pts / COALESCE((v_p2_map->>'4')::numeric, 1)) * 100, 2) ELSE 0 END;
    END IF;

    v_part2_summary := v_part2_summary || jsonb_build_array(
      jsonb_build_object(
        'questionIndex', v_p2_idx,
        'id', v_id,
        'okItems', v_ok_items,
        'totalItems', v_total_items,
        'ratePercent', round(v_rate_pct, 2),
        'earnedScore', v_q_earned,
        'maxScore', v_q_max,
        'method', 'custom_rates',
        'itemStatuses', v_item_statuses
      )
    );

    IF v_ok_items = v_total_items AND v_total_items > 0 THEN
      v_correct := v_correct + 1;
    ELSE
      v_wrong := v_wrong + 1;
    END IF;
  END LOOP;

  -- Phần III
  FOR v_q IN SELECT jsonb_array_elements(COALESCE(v_qs->'partIII', '[]'::jsonb)) LOOP
    v_id := v_q->>'id';
    IF NOT v_is_scale10 THEN v_max := v_max + v_p3; END IF;
    v_correctAns := lower(trim(public.strip_rich(v_q->>'answer')));
    v_given := lower(trim(COALESCE(p_answers->>v_id, '')));
    IF v_given = v_correctAns AND v_given <> '' THEN
      v_correct := v_correct + 1;
      v_correct_p3 := v_correct_p3 + 1;
      IF NOT v_is_scale10 THEN v_score := v_score + v_p3; END IF;
    ELSIF v_given <> '' AND v_correctAns <> ''
       AND v_given ~ '^-?[0-9]+([\.,][0-9]+)?$'
       AND v_correctAns ~ '^-?[0-9]+([\.,][0-9]+)?$'
       AND abs(replace(v_given, ',', '.')::numeric - replace(v_correctAns, ',', '.')::numeric) < 1e-6 THEN
      v_correct := v_correct + 1;
      v_correct_p3 := v_correct_p3 + 1;
      IF NOT v_is_scale10 THEN v_score := v_score + v_p3; END IF;
    ELSE
      v_wrong := v_wrong + 1;
    END IF;
  END LOOP;

  IF v_is_scale10 THEN
    v_score :=
      (CASE WHEN v_n1 > 0 THEN (v_correct_p1::numeric / v_n1::numeric) * v_pts_p1 ELSE 0 END) +
      (CASE WHEN v_n2 > 0 THEN (v_p2_ratio_sum / v_n2::numeric) * v_pts_p2 ELSE 0 END) +
      (CASE WHEN v_n3 > 0 THEN (v_correct_p3::numeric / v_n3::numeric) * v_pts_p3 ELSE 0 END);
  END IF;

  v_lock := COALESCE(v_row.lock_mode, '{}'::jsonb);
  IF COALESCE((v_lock->>'enabled')::boolean, false)
     AND COALESCE((v_lock->>'penalty')::boolean, false)
     AND p_violation_count > 0 THEN
    v_penalty := COALESCE((v_lock->>'penaltyPerViolation')::numeric, 0) * p_violation_count;
    v_score := GREATEST(0, v_score - v_penalty);
  END IF;

  INSERT INTO public.submissions(
    exam_id, student_name, student_class, answers, score, max_score,
    correct_count, wrong_count, violation_count, violations, started_at, duration_seconds,
    scoring_snapshot, part2_summary
  )
  VALUES (
    p_exam_id, p_student_name, p_student_class, p_answers,
    round(v_score::numeric, 2), round(v_max::numeric, 2),
    v_correct, v_wrong,
    COALESCE(p_violation_count, 0),
    COALESCE(p_violations, '[]'::jsonb),
    p_started_at,
    p_duration_seconds,
    v_scoring,
    v_part2_summary
  )
  RETURNING id INTO v_sub_id;

  RETURN v_sub_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.submit_student_exam(uuid, text, text, jsonb, jsonb, integer, timestamp with time zone, integer) TO anon, authenticated;

-- 3. Cập nhật team_answer_question: Phần II trên thang 10 luôn dùng 'custom_rates'
CREATE OR REPLACE FUNCTION public.team_answer_question(p_team_id uuid, p_question_id text, p_answer jsonb, p_student_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_team public.exam_teams%ROWTYPE; v_row public.exams%ROWTYPE; v_q jsonb;
  v_scoring jsonb;
  v_p1 numeric; v_p3 numeric; v_p2 jsonb;
  v_pts numeric := 0; v_ok boolean := false;
  v_item jsonb; v_val jsonb; v_says boolean; v_okitems int := 0; v_total int := 0;
  v_correctAns text; v_given text;
  v_is_scale10 boolean := false;
  v_n1 int := 0; v_n2 int := 0; v_n3 int := 0;
  v_per_q1 numeric := 0; v_per_q2 numeric := 0; v_per_q3 numeric := 0;
  v_p2_rates jsonb := '{"1":10,"2":25,"3":50,"4":100}'::jsonb;
  v_rate_pct numeric := 0;
BEGIN
  SELECT * INTO v_team FROM public.exam_teams WHERE id = p_team_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'team not found'; END IF;
  SELECT * INTO v_row FROM public.exams WHERE id = v_team.exam_id;
  IF COALESCE(v_row.team_activity_ended,false) THEN RAISE EXCEPTION 'Hoạt động đã kết thúc'; END IF;
  IF v_team.finished_at IS NOT NULL THEN RAISE EXCEPTION 'Nhóm đã nộp bài'; END IF;
  IF EXISTS (SELECT 1 FROM public.team_answers WHERE team_id = p_team_id AND question_id = p_question_id) THEN
    RAISE EXCEPTION 'Câu hỏi này nhóm đã trả lời';
  END IF;

  v_scoring := public.normalize_scoring_to_scale10(COALESCE(v_row.scoring, '{}'::jsonb));
  v_is_scale10 := (COALESCE(v_scoring->>'mode', '') IN ('scale_10', 'scale_100')) AND (v_scoring ? 'parts');
  IF v_is_scale10 THEN
    v_n1 := jsonb_array_length(COALESCE(v_row.questions->'partI', '[]'::jsonb));
    v_n2 := jsonb_array_length(COALESCE(v_row.questions->'partII', '[]'::jsonb));
    v_n3 := jsonb_array_length(COALESCE(v_row.questions->'partIII', '[]'::jsonb));
    v_per_q1 := CASE WHEN v_n1 > 0 THEN COALESCE((v_scoring->'parts'->>'p1')::numeric, 0) / v_n1::numeric ELSE 0 END;
    v_per_q2 := CASE WHEN v_n2 > 0 THEN COALESCE((v_scoring->'parts'->>'p2')::numeric, 0) / v_n2::numeric ELSE 0 END;
    v_per_q3 := CASE WHEN v_n3 > 0 THEN COALESCE((v_scoring->'parts'->>'p3')::numeric, 0) / v_n3::numeric ELSE 0 END;
    v_p2_rates := COALESCE(
      CASE WHEN jsonb_typeof(v_scoring->'p2Rates') = 'object' THEN v_scoring->'p2Rates' ELSE NULL END,
      '{"1":10,"2":25,"3":50,"4":100}'::jsonb
    );
  ELSE
    v_p1 := COALESCE((v_scoring->>'p1')::numeric, 0.25);
    v_p3 := COALESCE((v_scoring->>'p3')::numeric, 0.25);
    v_p2 := COALESCE(v_scoring->'p2', '{"1":0.1,"2":0.25,"3":0.5,"4":1}'::jsonb);
  END IF;

  SELECT q INTO v_q FROM jsonb_array_elements(COALESCE(v_row.questions->'partI','[]'::jsonb)) AS q WHERE q->>'id' = p_question_id;
  IF FOUND THEN
    v_ok := p_answer IS NOT NULL AND (p_answer #>> '{}') = (v_q->>'answer');
    IF v_ok THEN v_pts := CASE WHEN v_is_scale10 THEN v_per_q1 ELSE v_p1 END; END IF;
  ELSE
    SELECT q INTO v_q FROM jsonb_array_elements(COALESCE(v_row.questions->'partII','[]'::jsonb)) AS q WHERE q->>'id' = p_question_id;
    IF FOUND THEN
      FOR v_item IN SELECT jsonb_array_elements(COALESCE(v_q->'items','[]'::jsonb)) LOOP
        v_total := v_total + 1;
        v_says := NULL;
        IF jsonb_typeof(COALESCE(p_answer,'{}'::jsonb)) = 'object' THEN
          v_val := p_answer->(v_item->>'key');
          IF v_val IS NOT NULL AND jsonb_typeof(v_val) = 'boolean' THEN v_says := (v_val)::text::boolean; END IF;
        ELSIF jsonb_typeof(COALESCE(p_answer,'[]'::jsonb)) = 'array' THEN
          v_says := p_answer ? (v_item->>'key');
        END IF;
        IF v_says IS NOT NULL AND v_says = COALESCE((v_item->>'correct')::boolean,false) THEN v_okitems := v_okitems + 1; END IF;
      END LOOP;
      IF v_is_scale10 THEN
        IF v_total > 0 AND v_okitems > 0 THEN
          IF v_okitems >= v_total THEN
            v_rate_pct := COALESCE((v_p2_rates->>'4')::numeric, 100);
          ELSE
            v_rate_pct := COALESCE((v_p2_rates->>LEAST(3, GREATEST(1, v_okitems))::text)::numeric, 0);
          END IF;
          v_rate_pct := LEAST(100, GREATEST(0, v_rate_pct));
          v_pts := (v_per_q2 * v_rate_pct) / 100.0;
        END IF;
      ELSE
        IF v_okitems >= 1 THEN
          v_pts := COALESCE((v_p2->>v_okitems::text)::numeric, 0);
          v_rate_pct := CASE WHEN COALESCE((v_p2->>'4')::numeric, 1) > 0 THEN (v_pts / COALESCE((v_p2->>'4')::numeric, 1)) * 100.0 ELSE 0 END;
        END IF;
      END IF;
      v_ok := v_total > 0 AND v_okitems = v_total;
    ELSE
      SELECT q INTO v_q FROM jsonb_array_elements(COALESCE(v_row.questions->'partIII','[]'::jsonb)) AS q WHERE q->>'id' = p_question_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'question not found'; END IF;
      v_correctAns := lower(trim(public.strip_rich(v_q->>'answer')));
      v_given := lower(trim(COALESCE(p_answer #>> '{}', '')));
      v_ok := v_given <> '' AND v_given = v_correctAns;
      IF NOT v_ok AND v_given <> '' AND v_correctAns <> ''
         AND v_given ~ '^-?[0-9]+([\.,][0-9]+)?$' AND v_correctAns ~ '^-?[0-9]+([\.,][0-9]+)?$'
         AND abs(replace(v_given,',','.')::numeric - replace(v_correctAns,',','.')::numeric) < 1e-6 THEN
        v_ok := true;
      END IF;
      IF v_ok THEN v_pts := CASE WHEN v_is_scale10 THEN v_per_q3 ELSE v_p3 END; END IF;
    END IF;
  END IF;

  INSERT INTO public.team_answers(team_id, exam_id, question_id, answer, is_correct, points, answered_by)
    VALUES (p_team_id, v_team.exam_id, p_question_id, p_answer, v_ok, v_pts, p_student_name);

  UPDATE public.exam_teams SET
    score = round((SELECT COALESCE(sum(points),0) FROM public.team_answers WHERE team_id = p_team_id)::numeric, 2),
    correct_count = (SELECT count(*) FROM public.team_answers WHERE team_id = p_team_id AND is_correct),
    answered_count = (SELECT count(*) FROM public.team_answers WHERE team_id = p_team_id),
    max_score = public.exam_max_score(v_team.exam_id)
  WHERE id = p_team_id;

  RETURN jsonb_build_object(
    'correct', v_ok, 'points', round(v_pts::numeric, 2),
    'answer', CASE WHEN COALESCE(v_row.instant_feedback,false) THEN v_q->'answer' ELSE NULL END,
    'explanation', CASE WHEN COALESCE(v_row.instant_feedback,false) THEN v_q->'explanation' ELSE NULL END,
    'okItems', v_okitems, 'totalItems', v_total,
    'ratePercent', round(v_rate_pct, 2)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.team_answer_question(uuid, text, jsonb, text) TO anon, authenticated;

-- 4. Cập nhật check_question_answer: trả về ratePercent, maxPoints, earnedPoints đồng bộ phương thức 2 ('custom_rates')
CREATE OR REPLACE FUNCTION public.check_question_answer(p_exam_id uuid, p_question_id text, p_answer jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.exams%ROWTYPE;
  v_scoring jsonb;
  v_is_scale10 boolean := false;
  v_n1 int := 0; v_n2 int := 0; v_n3 int := 0;
  v_per_q1 numeric := 0; v_per_q2 numeric := 0; v_per_q3 numeric := 0;
  v_p2_rates jsonb := '{"1":10,"2":25,"3":50,"4":100}'::jsonb;
  v_rate_pct numeric := 0;
  v_earned_pts numeric := 0;
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

  v_scoring := public.normalize_scoring_to_scale10(COALESCE(v_row.scoring, '{}'::jsonb));
  v_is_scale10 := (COALESCE(v_scoring->>'mode', '') IN ('scale_10', 'scale_100')) AND (v_scoring ? 'parts');
  IF v_is_scale10 THEN
    v_n1 := jsonb_array_length(COALESCE(v_row.questions->'partI', '[]'::jsonb));
    v_n2 := jsonb_array_length(COALESCE(v_row.questions->'partII', '[]'::jsonb));
    v_n3 := jsonb_array_length(COALESCE(v_row.questions->'partIII', '[]'::jsonb));
    v_per_q1 := CASE WHEN v_n1 > 0 THEN COALESCE((v_scoring->'parts'->>'p1')::numeric, 0) / v_n1::numeric ELSE 0 END;
    v_per_q2 := CASE WHEN v_n2 > 0 THEN COALESCE((v_scoring->'parts'->>'p2')::numeric, 0) / v_n2::numeric ELSE 0 END;
    v_per_q3 := CASE WHEN v_n3 > 0 THEN COALESCE((v_scoring->'parts'->>'p3')::numeric, 0) / v_n3::numeric ELSE 0 END;
    v_p2_rates := COALESCE(
      CASE WHEN jsonb_typeof(v_scoring->'p2Rates') = 'object' THEN v_scoring->'p2Rates' ELSE NULL END,
      '{"1":10,"2":25,"3":50,"4":100}'::jsonb
    );
  END IF;

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
    ) || CASE WHEN v_is_scale10 AND v_n1 > 0 THEN jsonb_build_object(
      'maxPoints', round(v_per_q1, 2),
      'earnedPoints', CASE WHEN v_ok THEN round(v_per_q1, 2) ELSE 0 END
    ) ELSE '{}'::jsonb END;
  END IF;

  -- Phần II: Đúng/Sai nhiều ý (chỉ dùng tỷ lệ % giáo viên thiết lập)
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

    IF v_ok_items <= 0 OR v_total <= 0 THEN
      v_rate_pct := 0;
    ELSIF v_ok_items >= v_total THEN
      v_rate_pct := COALESCE((v_p2_rates->>'4')::numeric, 100);
    ELSE
      v_rate_pct := COALESCE((v_p2_rates->>LEAST(3, GREATEST(1, v_ok_items))::text)::numeric, 0);
    END IF;
    v_rate_pct := LEAST(100, GREATEST(0, v_rate_pct));
    v_earned_pts := CASE WHEN v_is_scale10 AND v_n2 > 0 THEN round((v_per_q2 * v_rate_pct) / 100.0, 2) ELSE 0 END;

    RETURN jsonb_build_object(
      'type', 'tf',
      'correct', v_ok_items = v_total AND v_total > 0,
      'okItems', v_ok_items,
      'totalItems', v_total,
      'ratePercent', round(v_rate_pct, 2),
      'items', v_items,
      'explanation', v_q->'explanation'
    ) || CASE WHEN v_is_scale10 AND v_n2 > 0 THEN jsonb_build_object(
      'maxPoints', round(v_per_q2, 2),
      'earnedPoints', v_earned_pts
    ) ELSE '{}'::jsonb END;
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
    ) || CASE WHEN v_is_scale10 AND v_n3 > 0 THEN jsonb_build_object(
      'maxPoints', round(v_per_q3, 2),
      'earnedPoints', CASE WHEN v_ok THEN round(v_per_q3, 2) ELSE 0 END
    ) ELSE '{}'::jsonb END;
  END IF;

  RAISE EXCEPTION 'question not found';
END;
$function$;

GRANT EXECUTE ON FUNCTION public.check_question_answer(uuid, text, jsonb) TO anon, authenticated;
