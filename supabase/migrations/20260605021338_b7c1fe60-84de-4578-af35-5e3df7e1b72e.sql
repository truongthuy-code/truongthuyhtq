
-- ============================================================
-- 1. ROLES & PROFILES
-- ============================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'teacher');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin')
$$;

-- profile/role RLS
CREATE POLICY "users read own profile" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

-- ============================================================
-- 2. TRIGGER: AUTO-CREATE PROFILE + TEACHER ROLE ON SIGNUP
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'teacher')
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 3. EXAMS — ownership + restricted policies
-- ============================================================
ALTER TABLE public.exams ADD COLUMN created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.exams ADD COLUMN original_file_path text;

-- drop old wide-open policies
DROP POLICY IF EXISTS "anyone can delete exams" ON public.exams;
DROP POLICY IF EXISTS "anyone can insert exams" ON public.exams;
DROP POLICY IF EXISTS "anyone can read exams" ON public.exams;

REVOKE ALL ON public.exams FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exams TO authenticated;
GRANT ALL ON public.exams TO service_role;

CREATE POLICY "teachers read own exams, admins read all" ON public.exams FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "authenticated teachers create their exams" ON public.exams FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "owners or admins update exams" ON public.exams FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.is_admin(auth.uid()))
  WITH CHECK (created_by = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "owners or admins delete exams" ON public.exams FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.is_admin(auth.uid()));

-- ============================================================
-- 4. SUBMISSIONS — restricted
-- ============================================================
DROP POLICY IF EXISTS "anyone can delete submissions" ON public.submissions;
DROP POLICY IF EXISTS "anyone can insert submissions" ON public.submissions;
DROP POLICY IF EXISTS "anyone can read submissions" ON public.submissions;

REVOKE ALL ON public.submissions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.submissions TO authenticated;
GRANT ALL ON public.submissions TO service_role;

CREATE POLICY "owners/admins read submissions" ON public.submissions FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.exams e WHERE e.id = submissions.exam_id AND e.created_by = auth.uid())
  );
CREATE POLICY "owners/admins delete submissions" ON public.submissions FOR DELETE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.exams e WHERE e.id = submissions.exam_id AND e.created_by = auth.uid())
  );
-- (no public insert policy; inserts go through SECURITY DEFINER function below)

-- ============================================================
-- 5. PUBLIC (anon) RPCs: fetch sanitized exam, submit, get result
-- ============================================================

-- Strip "answer" / "correct" fields from each question
CREATE OR REPLACE FUNCTION public.get_exam_for_student(p_exam_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.exams%ROWTYPE;
  v_qs jsonb;
  v_p1 jsonb := '[]'::jsonb;
  v_p2 jsonb := '[]'::jsonb;
  v_p3 jsonb := '[]'::jsonb;
  v_item jsonb;
  v_clean jsonb;
  v_sub jsonb;
  v_sub_clean jsonb;
  v_sub_arr jsonb;
  v_sub_el jsonb;
BEGIN
  SELECT * INTO v_row FROM public.exams WHERE id = p_exam_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam not found'; END IF;
  v_qs := v_row.questions;

  -- Part I: remove "answer"
  FOR v_item IN SELECT jsonb_array_elements(COALESCE(v_qs->'partI', '[]'::jsonb)) LOOP
    v_clean := v_item - 'answer';
    v_p1 := v_p1 || jsonb_build_array(v_clean);
  END LOOP;

  -- Part II: remove "correct" from items
  FOR v_item IN SELECT jsonb_array_elements(COALESCE(v_qs->'partII', '[]'::jsonb)) LOOP
    v_sub_arr := '[]'::jsonb;
    FOR v_sub_el IN SELECT jsonb_array_elements(COALESCE(v_item->'items', '[]'::jsonb)) LOOP
      v_sub_arr := v_sub_arr || jsonb_build_array(v_sub_el - 'correct');
    END LOOP;
    v_clean := v_item - 'items' || jsonb_build_object('items', v_sub_arr);
    v_p2 := v_p2 || jsonb_build_array(v_clean);
  END LOOP;

  -- Part III: remove "answer"
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
    'questions', jsonb_build_object('partI', v_p1, 'partII', v_p2, 'partIII', v_p3)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_exam_for_student(uuid) TO anon, authenticated;

-- Strip rich content like the client (simple HTML-tag removal + trim)
CREATE OR REPLACE FUNCTION public.strip_rich(t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(regexp_replace(coalesce(t, ''), '<[^>]+>', '', 'g'))
$$;

-- Server-side grading + insertion
CREATE OR REPLACE FUNCTION public.submit_student_exam(
  p_exam_id uuid,
  p_student_name text,
  p_student_class text,
  p_answers jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
BEGIN
  IF p_student_name IS NULL OR length(trim(p_student_name)) = 0 THEN
    RAISE EXCEPTION 'student_name required';
  END IF;
  IF p_student_class IS NULL OR length(trim(p_student_class)) = 0 THEN
    RAISE EXCEPTION 'student_class required';
  END IF;

  SELECT * INTO v_row FROM public.exams WHERE id = p_exam_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam not found'; END IF;

  v_qs := v_row.questions;
  v_scoring := v_row.scoring;
  v_p1 := COALESCE((v_scoring->>'p1')::numeric, 0.25);
  v_p3 := COALESCE((v_scoring->>'p3')::numeric, 0.25);
  v_p2_map := COALESCE(v_scoring->'p2', '{"1":0.1,"2":0.25,"3":0.5,"4":1}'::jsonb);

  -- Part I
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

  -- Part II
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

  -- Part III
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

  INSERT INTO public.submissions(exam_id, student_name, student_class, answers, score, max_score, correct_count, wrong_count)
  VALUES (p_exam_id, p_student_name, p_student_class, p_answers,
          round(v_score::numeric, 2), round(v_max::numeric, 2), v_correct, v_wrong)
  RETURNING id INTO v_sub_id;

  RETURN v_sub_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_student_exam(uuid, text, text, jsonb) TO anon, authenticated;

-- Return submission and (optionally) full exam for review
CREATE OR REPLACE FUNCTION public.get_submission_for_student(p_submission_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.submissions%ROWTYPE;
  e public.exams%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'submission not found'; END IF;
  SELECT * INTO e FROM public.exams WHERE id = s.exam_id;
  RETURN jsonb_build_object(
    'submission', to_jsonb(s),
    'exam', jsonb_build_object(
      'id', e.id,
      'title', e.title,
      'allow_review', e.allow_review,
      'scoring', e.scoring,
      -- include full questions only if review enabled
      'questions', CASE WHEN e.allow_review THEN e.questions ELSE NULL END
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_submission_for_student(uuid) TO anon, authenticated;

-- Helper for teacher dashboard: get exam metadata + counts (covered by RLS)
-- (no new function needed; teacher uses normal select via RLS)

-- ============================================================
-- 6. STORAGE: private bucket policies
-- ============================================================
-- Bucket privacy itself is set via the storage tool. Add object policies:

DROP POLICY IF EXISTS "Public can read exam-files" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload exam-files" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update exam-files" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete exam-files" ON storage.objects;

CREATE POLICY "auth read own or admin exam-files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'exam-files' AND (owner = auth.uid() OR public.is_admin(auth.uid())));
CREATE POLICY "auth upload exam-files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'exam-files');
CREATE POLICY "auth update own exam-files" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'exam-files' AND (owner = auth.uid() OR public.is_admin(auth.uid())));
CREATE POLICY "auth delete own exam-files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'exam-files' AND (owner = auth.uid() OR public.is_admin(auth.uid())));
