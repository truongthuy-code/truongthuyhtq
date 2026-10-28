-- Update get_submission_for_student to return questions if exam is closed OR allow_review is enabled
CREATE OR REPLACE FUNCTION public.get_submission_for_student(p_submission_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.submissions%ROWTYPE;
  e public.exams%ROWTYPE;
  v_is_closed boolean;
  v_allow_review boolean;
BEGIN
  SELECT * INTO s FROM public.submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'submission not found'; END IF;
  SELECT * INTO e FROM public.exams WHERE id = s.exam_id;

  v_is_closed := (COALESCE(e.manual_closed, false) = true) OR (COALESCE(e.status, '') = 'closed') OR (e.close_at IS NOT NULL AND e.close_at < now());
  v_allow_review := COALESCE(e.allow_review, false);

  RETURN jsonb_build_object(
    'submission', to_jsonb(s),
    'exam', jsonb_build_object(
      'id', e.id,
      'title', e.title,
      'allow_review', v_allow_review,
      'is_closed', v_is_closed,
      'manual_closed', e.manual_closed,
      'status', e.status,
      'close_at', e.close_at,
      'display_mode', e.display_mode,
      'scoring', e.scoring,
      'lock_mode', e.lock_mode,
      -- Cho phép học sinh xem đáp án nếu: (Đề đã đóng) OR (Học sinh đã nộp bài AND Đề được bật allow_review)
      'questions', CASE WHEN (v_is_closed OR v_allow_review) THEN e.questions ELSE NULL END
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_submission_for_student(uuid) TO anon, authenticated;
