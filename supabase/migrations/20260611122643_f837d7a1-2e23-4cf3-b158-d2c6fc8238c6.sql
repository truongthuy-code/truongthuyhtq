
-- 1) SUBJECTS catalog
CREATE TABLE IF NOT EXISTS public.subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subjects TO anon, authenticated;
GRANT ALL ON public.subjects TO service_role;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subjects readable by all" ON public.subjects;
CREATE POLICY "subjects readable by all" ON public.subjects FOR SELECT USING (true);
DROP POLICY IF EXISTS "subjects admin manage" ON public.subjects;
CREATE POLICY "subjects admin manage" ON public.subjects FOR ALL
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.subjects(code,name,sort_order) VALUES
  ('toan','Toán',1),('ngu-van','Ngữ văn',2),('tieng-anh','Tiếng Anh',3),
  ('vat-li','Vật lí',4),('hoa-hoc','Hóa học',5),('sinh-hoc','Sinh học',6),
  ('lich-su','Lịch sử',7),('dia-li','Địa lí',8),('gdcd','GDCD',9),
  ('tin-hoc','Tin học',10),('cong-nghe','Công nghệ',11),
  ('gdktpl','Giáo dục kinh tế và pháp luật',12),('khac','Môn học khác',99)
ON CONFLICT (code) DO NOTHING;

-- 2) SCHOOLS
CREATE TABLE IF NOT EXISTS public.schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_key text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.schools TO anon, authenticated;
GRANT INSERT ON public.schools TO authenticated;
GRANT ALL ON public.schools TO service_role;
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "schools readable by all" ON public.schools;
CREATE POLICY "schools readable by all" ON public.schools FOR SELECT USING (true);
DROP POLICY IF EXISTS "schools authenticated insert" ON public.schools;
CREATE POLICY "schools authenticated insert" ON public.schools FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "schools admin manage" ON public.schools;
CREATE POLICY "schools admin manage" ON public.schools FOR ALL
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3) PROFILES extension
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subject_name text,
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS school_name text,
  ADD COLUMN IF NOT EXISTS profile_completed boolean NOT NULL DEFAULT false;

-- Allow all authenticated users to read profiles (needed for tree view of teachers)
DROP POLICY IF EXISTS "profiles readable by authenticated" ON public.profiles;
CREATE POLICY "profiles readable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);

-- 4) EXAMS extension
ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subject_name text,
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS school_name text,
  ADD COLUMN IF NOT EXISTS teacher_name text;

-- 5) Auto-fill trigger on exams from creator profile
CREATE OR REPLACE FUNCTION public.fill_exam_from_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE p public.profiles%ROWTYPE;
BEGIN
  IF NEW.created_by IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO p FROM public.profiles WHERE id = NEW.created_by;
  IF NOT FOUND THEN RETURN NEW; END IF;
  NEW.subject_id   := COALESCE(NEW.subject_id, p.subject_id);
  NEW.subject_name := COALESCE(NEW.subject_name, p.subject_name);
  NEW.school_id    := COALESCE(NEW.school_id, p.school_id);
  NEW.school_name  := COALESCE(NEW.school_name, p.school_name);
  NEW.teacher_name := COALESCE(NEW.teacher_name, p.full_name, p.email);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fill_exam_from_profile ON public.exams;
CREATE TRIGGER trg_fill_exam_from_profile
  BEFORE INSERT ON public.exams
  FOR EACH ROW EXECUTE FUNCTION public.fill_exam_from_profile();

-- 6) Backfill exams from existing profiles
UPDATE public.exams e SET
  subject_id   = COALESCE(e.subject_id, p.subject_id),
  subject_name = COALESCE(e.subject_name, p.subject_name),
  school_id    = COALESCE(e.school_id, p.school_id),
  school_name  = COALESCE(e.school_name, p.school_name),
  teacher_name = COALESCE(e.teacher_name, p.full_name, p.email)
FROM public.profiles p
WHERE p.id = e.created_by;

-- 7) Helper to upsert school by name
CREATE OR REPLACE FUNCTION public.upsert_school(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_key text; v_id uuid;
BEGIN
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN RETURN NULL; END IF;
  v_key := lower(regexp_replace(trim(p_name), '\s+', ' ', 'g'));
  SELECT id INTO v_id FROM public.schools WHERE name_key = v_key;
  IF v_id IS NULL THEN
    INSERT INTO public.schools(name, name_key) VALUES (trim(p_name), v_key) RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.upsert_school(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_school(text) TO authenticated;

-- 8) Grant admin role to bichthuylqd@gmail.com (if user already exists)
DO $$
DECLARE v_uid uuid;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = 'bichthuylqd@gmail.com' LIMIT 1;
  IF v_uid IS NOT NULL THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (v_uid, 'admin')
      ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
END $$;

-- 9) Trigger to auto-grant admin to bichthuylqd@gmail.com when she signs up
CREATE OR REPLACE FUNCTION public.grant_admin_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(NEW.email) = 'bichthuylqd@gmail.com' THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'admin')
      ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_grant_admin_on_signup ON auth.users;
CREATE TRIGGER trg_grant_admin_on_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.grant_admin_on_signup();

-- 10) Update exams policies to let admins manage all
DROP POLICY IF EXISTS "exams admin all" ON public.exams;
CREATE POLICY "exams admin all" ON public.exams FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
