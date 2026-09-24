
CREATE TABLE public.exams (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  questions JSONB NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 45,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  shuffle_questions BOOLEAN NOT NULL DEFAULT false,
  shuffle_options BOOLEAN NOT NULL DEFAULT false,
  scoring_mode TEXT NOT NULL DEFAULT 'per_question',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.submissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  student_name TEXT NOT NULL,
  student_class TEXT NOT NULL,
  answers JSONB NOT NULL,
  score NUMERIC NOT NULL DEFAULT 0,
  max_score NUMERIC NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_submissions_exam ON public.submissions(exam_id);

ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can insert exams" ON public.exams FOR INSERT WITH CHECK (true);
CREATE POLICY "anyone can read exams" ON public.exams FOR SELECT USING (true);

CREATE POLICY "anyone can insert submissions" ON public.submissions FOR INSERT WITH CHECK (true);
CREATE POLICY "anyone can read submissions" ON public.submissions FOR SELECT USING (true);
