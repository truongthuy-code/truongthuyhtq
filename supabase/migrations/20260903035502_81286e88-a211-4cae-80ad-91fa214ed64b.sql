ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS team_config jsonb NOT NULL DEFAULT '{"maxMembers": 5, "leaderboard": true, "music": {"enabled": false, "volume": 0.4}, "teams": []}'::jsonb,
  ADD COLUMN IF NOT EXISTS team_activity_ended boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.exam_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  name text NOT NULL,
  score numeric NOT NULL DEFAULT 0,
  max_score numeric NOT NULL DEFAULT 0,
  correct_count integer NOT NULL DEFAULT 0,
  answered_count integer NOT NULL DEFAULT 0,
  finished_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_id, name)
);

GRANT SELECT ON public.exam_teams TO anon, authenticated;
GRANT UPDATE, DELETE ON public.exam_teams TO authenticated;
GRANT ALL ON public.exam_teams TO service_role;
ALTER TABLE public.exam_teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exam_teams public read" ON public.exam_teams FOR SELECT USING (true);
CREATE POLICY "exam_teams owner manage update" ON public.exam_teams FOR UPDATE TO authenticated
  USING (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM public.exams e WHERE e.id = exam_id AND e.created_by = auth.uid()))
  WITH CHECK (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM public.exams e WHERE e.id = exam_id AND e.created_by = auth.uid()));
CREATE POLICY "exam_teams owner delete" ON public.exam_teams FOR DELETE TO authenticated
  USING (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM public.exams e WHERE e.id = exam_id AND e.created_by = auth.uid()));

CREATE TABLE IF NOT EXISTS public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.exam_teams(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  student_name text NOT NULL,
  student_class text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, student_name, student_class)
);

GRANT SELECT ON public.team_members TO anon, authenticated;
GRANT DELETE ON public.team_members TO authenticated;
GRANT ALL ON public.team_members TO service_role;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_members public read" ON public.team_members FOR SELECT USING (true);
CREATE POLICY "team_members owner delete" ON public.team_members FOR DELETE TO authenticated
  USING (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM public.exams e WHERE e.id = exam_id AND e.created_by = auth.uid()));

CREATE TABLE IF NOT EXISTS public.team_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.exam_teams(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  question_id text NOT NULL,
  answer jsonb,
  is_correct boolean NOT NULL DEFAULT false,
  points numeric NOT NULL DEFAULT 0,
  answered_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, question_id)
);

GRANT SELECT ON public.team_answers TO anon, authenticated;
GRANT DELETE ON public.team_answers TO authenticated;
GRANT ALL ON public.team_answers TO service_role;
ALTER TABLE public.team_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_answers public read" ON public.team_answers FOR SELECT USING (true);
CREATE POLICY "team_answers owner delete" ON public.team_answers FOR DELETE TO authenticated
  USING (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM public.exams e WHERE e.id = exam_id AND e.created_by = auth.uid()));

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN NEW.updated_at = now(); RETURN NEW; END $fn$;

CREATE TRIGGER trg_exam_teams_updated BEFORE UPDATE ON public.exam_teams
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.exam_teams REPLICA IDENTITY FULL;
ALTER TABLE public.team_members REPLICA IDENTITY FULL;
ALTER TABLE public.team_answers REPLICA IDENTITY FULL;

DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.exam_teams; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.team_members; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.team_answers; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- Tổng điểm tối đa của đề
CREATE OR REPLACE FUNCTION public.exam_max_score(p_exam_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.exams%ROWTYPE; v_max numeric := 0; v_p1 numeric; v_p3 numeric; v_p2 jsonb; v_q jsonb;
BEGIN
  SELECT * INTO v_row FROM public.exams WHERE id = p_exam_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_p1 := COALESCE((v_row.scoring->>'p1')::numeric, 0.25);
  v_p3 := COALESCE((v_row.scoring->>'p3')::numeric, 0.25);
  v_p2 := COALESCE(v_row.scoring->'p2', '{"1":0.1,"2":0.25,"3":0.5,"4":1}'::jsonb);
  FOR v_q IN SELECT jsonb_array_elements(COALESCE(v_row.questions->'partI','[]'::jsonb)) LOOP v_max := v_max + v_p1; END LOOP;
  FOR v_q IN SELECT jsonb_array_elements(COALESCE(v_row.questions->'partII','[]'::jsonb)) LOOP v_max := v_max + COALESCE((v_p2->>'4')::numeric,1); END LOOP;
  FOR v_q IN SELECT jsonb_array_elements(COALESCE(v_row.questions->'partIII','[]'::jsonb)) LOOP v_max := v_max + v_p3; END LOOP;
  RETURN round(v_max, 2);
END $$;

GRANT EXECUTE ON FUNCTION public.exam_max_score(uuid) TO anon, authenticated;

-- Tham gia nhóm
CREATE OR REPLACE FUNCTION public.team_join(p_exam_id uuid, p_team_name text, p_student_name text, p_student_class text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.exams%ROWTYPE; v_team public.exam_teams%ROWTYPE; v_count int; v_maxm int;
BEGIN
  IF COALESCE(trim(p_team_name),'') = '' THEN RAISE EXCEPTION 'Tên nhóm không được để trống'; END IF;
  IF COALESCE(trim(p_student_name),'') = '' THEN RAISE EXCEPTION 'Tên học sinh không được để trống'; END IF;
  IF COALESCE(trim(p_student_class),'') = '' THEN RAISE EXCEPTION 'Lớp không được để trống'; END IF;
  SELECT * INTO v_row FROM public.exams WHERE id = p_exam_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam not found'; END IF;
  IF v_row.display_mode <> 'team' THEN RAISE EXCEPTION 'Đề thi không ở chế độ Đội/Nhóm'; END IF;
  IF COALESCE(v_row.team_activity_ended,false) THEN RAISE EXCEPTION 'Hoạt động đã kết thúc'; END IF;
  IF public.exam_status(v_row.open_at, v_row.close_at, v_row.manual_closed) <> 'open' THEN
    RAISE EXCEPTION 'Đề thi chưa mở hoặc đã đóng';
  END IF;

  SELECT * INTO v_team FROM public.exam_teams WHERE exam_id = p_exam_id AND name = trim(p_team_name);
  IF NOT FOUND THEN
    INSERT INTO public.exam_teams(exam_id, name, max_score)
      VALUES (p_exam_id, trim(p_team_name), public.exam_max_score(p_exam_id))
      RETURNING * INTO v_team;
  END IF;

  v_maxm := COALESCE((v_row.team_config->>'maxMembers')::int, 0);
  SELECT count(*) INTO v_count FROM public.team_members
    WHERE team_id = v_team.id AND NOT (student_name = trim(p_student_name) AND student_class = trim(p_student_class));
  IF v_maxm > 0 AND v_count >= v_maxm THEN RAISE EXCEPTION 'Nhóm đã đủ số thành viên tối đa'; END IF;

  INSERT INTO public.team_members(team_id, exam_id, student_name, student_class)
    VALUES (v_team.id, p_exam_id, trim(p_student_name), trim(p_student_class))
    ON CONFLICT (team_id, student_name, student_class) DO UPDATE SET last_seen_at = now();

  RETURN jsonb_build_object('team_id', v_team.id, 'team_name', v_team.name);
END $$;

GRANT EXECUTE ON FUNCTION public.team_join(uuid, text, text, text) TO anon, authenticated;

-- Nhóm trả lời một câu hỏi (chấm ngay, đồng bộ điểm nhóm)
CREATE OR REPLACE FUNCTION public.team_answer_question(p_team_id uuid, p_question_id text, p_answer jsonb, p_student_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_team public.exam_teams%ROWTYPE; v_row public.exams%ROWTYPE; v_q jsonb;
  v_p1 numeric; v_p3 numeric; v_p2 jsonb;
  v_pts numeric := 0; v_ok boolean := false;
  v_item jsonb; v_val jsonb; v_says boolean; v_okitems int := 0; v_total int := 0;
  v_correctAns text; v_given text;
BEGIN
  SELECT * INTO v_team FROM public.exam_teams WHERE id = p_team_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'team not found'; END IF;
  SELECT * INTO v_row FROM public.exams WHERE id = v_team.exam_id;
  IF COALESCE(v_row.team_activity_ended,false) THEN RAISE EXCEPTION 'Hoạt động đã kết thúc'; END IF;
  IF v_team.finished_at IS NOT NULL THEN RAISE EXCEPTION 'Nhóm đã nộp bài'; END IF;
  IF EXISTS (SELECT 1 FROM public.team_answers WHERE team_id = p_team_id AND question_id = p_question_id) THEN
    RAISE EXCEPTION 'Câu hỏi này nhóm đã trả lời';
  END IF;

  v_p1 := COALESCE((v_row.scoring->>'p1')::numeric, 0.25);
  v_p3 := COALESCE((v_row.scoring->>'p3')::numeric, 0.25);
  v_p2 := COALESCE(v_row.scoring->'p2', '{"1":0.1,"2":0.25,"3":0.5,"4":1}'::jsonb);

  SELECT q INTO v_q FROM jsonb_array_elements(COALESCE(v_row.questions->'partI','[]'::jsonb)) AS q WHERE q->>'id' = p_question_id;
  IF FOUND THEN
    v_ok := p_answer IS NOT NULL AND (p_answer #>> '{}') = (v_q->>'answer');
    IF v_ok THEN v_pts := v_p1; END IF;
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
      IF v_okitems >= 1 THEN v_pts := COALESCE((v_p2->>v_okitems::text)::numeric, 0); END IF;
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
      IF v_ok THEN v_pts := v_p3; END IF;
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
    'correct', v_ok, 'points', v_pts,
    'answer', CASE WHEN COALESCE(v_row.instant_feedback,false) THEN v_q->'answer' ELSE NULL END,
    'explanation', CASE WHEN COALESCE(v_row.instant_feedback,false) THEN v_q->'explanation' ELSE NULL END,
    'okItems', v_okitems, 'totalItems', v_total
  );
END $$;

GRANT EXECUTE ON FUNCTION public.team_answer_question(uuid, text, jsonb, text) TO anon, authenticated;

-- Nhóm hoàn thành bài
CREATE OR REPLACE FUNCTION public.team_finish(p_team_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.exam_teams SET finished_at = COALESCE(finished_at, now()) WHERE id = p_team_id;
END $$;

GRANT EXECUTE ON FUNCTION public.team_finish(uuid) TO anon, authenticated;

-- Trạng thái nhóm (khôi phục khi mất kết nối)
CREATE OR REPLACE FUNCTION public.get_team_state(p_team_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_team public.exam_teams%ROWTYPE;
BEGIN
  SELECT * INTO v_team FROM public.exam_teams WHERE id = p_team_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'team not found'; END IF;
  RETURN jsonb_build_object(
    'team', to_jsonb(v_team),
    'members', COALESCE((SELECT jsonb_agg(jsonb_build_object('student_name', m.student_name, 'student_class', m.student_class))
                          FROM public.team_members m WHERE m.team_id = p_team_id), '[]'::jsonb),
    'answers', COALESCE((SELECT jsonb_object_agg(a.question_id, jsonb_build_object('answer', a.answer, 'is_correct', a.is_correct, 'points', a.points, 'answered_by', a.answered_by))
                          FROM public.team_answers a WHERE a.team_id = p_team_id), '{}'::jsonb)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_team_state(uuid) TO anon, authenticated;

-- Bảng xếp hạng công khai
CREATE OR REPLACE FUNCTION public.get_team_leaderboard(p_exam_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.exams%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.exams WHERE id = p_exam_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam not found'; END IF;
  RETURN jsonb_build_object(
    'exam', jsonb_build_object('id', v_row.id, 'title', v_row.title, 'display_mode', v_row.display_mode,
                               'team_config', v_row.team_config, 'ended', COALESCE(v_row.team_activity_ended,false)),
    'teams', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.score DESC, t.finished_at ASC NULLS LAST, t.answered_count DESC)
                        FROM public.exam_teams t WHERE t.exam_id = p_exam_id), '[]'::jsonb),
    'members', COALESCE((SELECT jsonb_agg(jsonb_build_object('team_id', m.team_id, 'student_name', m.student_name, 'student_class', m.student_class))
                        FROM public.team_members m WHERE m.exam_id = p_exam_id), '[]'::jsonb)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_team_leaderboard(uuid) TO anon, authenticated;