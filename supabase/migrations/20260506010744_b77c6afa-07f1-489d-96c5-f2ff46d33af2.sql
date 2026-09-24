
ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS shuffle_q_p1 boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shuffle_q_p2 boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shuffle_q_p3 boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shuffle_o_p1 boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shuffle_o_p2 boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shuffle_o_p3 boolean NOT NULL DEFAULT false;
