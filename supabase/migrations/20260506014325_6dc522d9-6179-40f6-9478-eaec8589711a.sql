ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS scoring jsonb NOT NULL DEFAULT '{"p1":0.25,"p2":{"1":0.1,"2":0.25,"3":0.5,"4":1},"p3":0.25}'::jsonb;

CREATE POLICY "anyone can delete exams" ON public.exams FOR DELETE USING (true);
CREATE POLICY "anyone can delete submissions" ON public.submissions FOR DELETE USING (true);