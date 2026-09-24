ALTER TABLE public.exams DROP CONSTRAINT IF EXISTS exams_display_mode_check;
ALTER TABLE public.exams ADD CONSTRAINT exams_display_mode_check CHECK (display_mode IN ('standard', 'quizizz', 'team'));