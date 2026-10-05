import { useEffect, useState } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import RichText from "@/components/RichText";
import QuizBackground from "@/components/QuizBackground";
import { Check, X, ShieldAlert, BookOpen, Lock } from "lucide-react";
import { stripRich } from "@/lib/docxParser";
import { getTFValue } from "@/lib/grading";
import { getPublishedExamAnswerKey, getAllSubmissions } from "@/lib/studentStorage";
import { findSampleExam } from "@/lib/sampleExams";
import confetti from "canvas-confetti";

export default function Result() {
  const { id } = useParams();
  const location = useLocation();
  const [sub, setSub] = useState<any>(() => (location.state as any)?.submission || null);
  const [exam, setExam] = useState<any>(() => (location.state as any)?.exam || null);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.rpc("get_submission_for_student", { p_submission_id: id! });
        if (!error && data) {
          const payload: any = data;
          const submission = payload.submission;
          let examObj = payload.exam;

          // If exam is closed via published answer key, unlock review
          if (!examObj?.questions && submission?.exam_id) {
            const pub = getPublishedExamAnswerKey(submission.exam_id);
            if (pub?.questions) {
              examObj = { ...examObj, allow_review: true, questions: pub.questions };
            }
          }

          setSub(submission);
          setExam(examObj);

          if (submission?.score >= 5) {
            try {
              confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
            } catch {}
          }
          return;
        }
      } catch {}

      // Fallback: check location state or student submissions in local storage
      const fromState = (location.state as any)?.submission;
      if (fromState) {
        setSub(fromState);
        if ((location.state as any)?.exam) {
          setExam((location.state as any).exam);
        }
        return;
      }

      const allSubs = getAllSubmissions();
      const matched = allSubs.find((s) => s.id === id);
      if (matched) {
        const sampleMatch = findSampleExam(matched.examId);
        setSub({
          id: matched.id,
          student_name: matched.studentName,
          student_class: matched.studentClass,
          score: matched.score,
          max_score: matched.maxScore,
          correct_count: matched.correctCount,
          wrong_count: matched.wrongCount,
          answers: matched.answers,
          exam_id: matched.examId,
          submitted_at: matched.submittedAt,
        });
        setExam({
          title: matched.examTitle,
          allow_review: sampleMatch?.allow_review ?? false,
          questions: sampleMatch?.questions || null,
        });
      }
    })();
  }, [id, location]);

  if (!sub) {
    return (
      <div className="min-h-screen grid place-items-center relative">
        <QuizBackground />
        <div className="text-center text-muted-foreground font-bold relative z-10">Đang tải kết quả…</div>
      </div>
    );
  }

  const total = (sub.correct_count ?? 0) + (sub.wrong_count ?? 0);
  const allowReviewAnswers = !!(exam?.allow_review ?? (exam as any)?.allowReviewAnswers ?? false);
  const answers = sub.answers || {};

  // Helper number matching for Part III
  const numCorrect = (sa: string, expected: string) => {
    const a = String(sa ?? "").trim().toLowerCase();
    const b = stripRich(String(expected ?? "")).trim().toLowerCase();
    if (a === b) return true;
    const na = parseFloat(a.replace(",", "."));
    const nb = parseFloat(b.replace(",", "."));
    return !isNaN(na) && !isNaN(nb) && Math.abs(na - nb) < 1e-6;
  };

  /**
   * Component Thẻ Tổng quan kết quả (Dùng chung cho cả 2 chế độ)
   */
  const renderSummaryCard = () => (
    <Card className="p-6 sm:p-8 max-w-lg w-full text-center mx-auto shadow-xl rounded-3xl border-2 border-border/80 bg-card/95 backdrop-blur">
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Kết quả bài thi của</div>
      <div className="font-extrabold text-xl sm:text-2xl mt-1 text-foreground">
        {sub.student_name} • Lớp {sub.student_class}
      </div>

      <div className="my-6 py-7 px-4 rounded-3xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white shadow-xl shadow-indigo-500/25 relative overflow-hidden">
        <div className="absolute inset-0 bg-white/5 backdrop-blur-[1px] pointer-events-none" />
        <div className="text-xs uppercase font-bold tracking-widest opacity-90">Tổng điểm đạt được</div>
        <div className="text-7xl sm:text-8xl font-black leading-none mt-2 drop-shadow-md">{sub.score ?? 0}</div>
        <div className="text-sm font-semibold opacity-90 mt-2">Thang điểm: / {sub.max_score ?? 10} điểm</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4">
          <div className="text-3xl font-black text-emerald-600 dark:text-emerald-400">{sub.correct_count ?? 0}</div>
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 mt-1">Câu trả lời đúng</div>
        </div>
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4">
          <div className="text-3xl font-black text-rose-600 dark:text-rose-400">{sub.wrong_count ?? 0}</div>
          <div className="text-xs font-semibold text-rose-700 dark:text-rose-300 mt-1">Câu trả lời sai</div>
        </div>
      </div>

      {/* NÚT "🏠 VỀ TRANG CÁ NHÂN" SAU KHI NỘP BÀI */}
      <div className="mt-6 pt-5 border-t border-border/80 space-y-2">
        <Link
          to="/student"
          className="inline-flex items-center justify-center gap-2.5 w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-700 hover:via-indigo-700 hover:to-violet-700 text-white font-black text-base shadow-xl shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:scale-[1.01] active:scale-[0.99] transition-all"
        >
          <span className="text-xl leading-none">🏠</span>
          <span>Về trang cá nhân</span>
        </Link>
        <p className="text-[11px] text-muted-foreground">
          Quay lại trang cá nhân học sinh để theo dõi toàn bộ điểm số và lịch sử bài thi
        </p>
      </div>

      <div className="text-[11px] text-muted-foreground mt-4 pt-3 border-t border-border/40">
        Tổng {total} câu {sub.submitted_at ? `• Đã nộp bài lúc ${new Date(sub.submitted_at).toLocaleString("vi-VN")}` : ""}
      </div>
    </Card>
  );

  /**
   * 6. KHI GIÁO VIÊN TẮT TÍNH NĂNG NÀY (allowReviewAnswers = false):
   * Chỉ hiển thị: Điểm, Số câu đúng, Số câu sai, Họ tên, Lớp.
   * KHÔNG hiển thị: Nội dung câu hỏi, Đáp án đúng, Đáp án học sinh chọn.
   */
  const renderSimpleResult = () => (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-6 px-3 sm:px-4 relative selection:bg-primary/20 flex flex-col justify-center items-center">
      <QuizBackground />
      <div className="max-w-md w-full space-y-4 relative z-10">
        {/* Top navigation header */}
        <div className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-card/90 backdrop-blur border shadow-sm">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-2xl shrink-0">🎓</span>
            <div className="min-w-0">
              <div className="font-bold text-sm truncate text-foreground">
                {exam?.title || "Kết quả bài kiểm tra"}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {sub.student_name} • Lớp {sub.student_class}
              </div>
            </div>
          </div>
          <Link
            to="/student"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 text-white font-bold text-xs shrink-0 shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            <span>🏠</span>
            <span>Trang cá nhân</span>
          </Link>
        </div>

        {renderSummaryCard()}

        {/* Thông báo giáo viên tắt tính năng xem lại đáp án */}
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-center text-xs text-amber-900 dark:text-amber-200 space-y-2">
          <div className="font-bold text-sm flex items-center justify-center gap-1.5">
            <Lock className="size-4 text-amber-600 dark:text-amber-400" />
            <span>Xem lại đáp án đã bị khóa</span>
          </div>
          <div className="leading-relaxed">
            Giáo viên đã cấu hình không cho phép xem lại chi tiết câu hỏi và đáp án sau khi hoàn thành bài thi này. Điểm số của bạn đã được lưu vào hệ thống.
          </div>
          <div className="pt-2">
            <Link to="/student" className="inline-flex items-center text-primary font-bold hover:underline">
              <span className="mr-1.5">🏠</span> Vào trang cá nhân học sinh để theo dõi lịch sử bài thi
            </Link>
          </div>
        </div>
      </div>
    </div>
  );

  /**
   * 2, 3, 4, 5. KHI GIÁO VIÊN BẬT TÍNH NĂNG NÀY (allowReviewAnswers = true):
   * Hiển thị: Điểm, Số câu đúng, Số câu sai, Họ tên, Lớp.
   * Danh sách câu hỏi kèm: Nội dung câu hỏi, Đáp án học sinh chọn, Đáp án đúng highlight màu xanh,
   * Đáp án sai của học sinh highlight màu đỏ, đối chiếu Phần I, Phần II, Phần III.
   */
  const renderReviewPage = () => {
    const ex = exam.questions;
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-6 px-3 relative selection:bg-primary/20">
        <QuizBackground />
        <div className="max-w-3xl mx-auto space-y-6 relative z-10">
          {/* Top header bar */}
          <div className="flex items-center justify-between gap-3 p-3.5 sm:p-4 rounded-2xl bg-card/90 backdrop-blur border shadow-sm">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-2xl shrink-0">🎓</span>
              <div className="min-w-0">
                <div className="font-bold text-sm sm:text-base truncate text-foreground">
                  {exam?.title || "Kết quả bài kiểm tra"}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {sub.student_name} • Lớp {sub.student_class}
                </div>
              </div>
            </div>
            <Link
              to="/student"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 text-white font-bold text-xs sm:text-sm shrink-0 shadow-md shadow-indigo-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              <span>🏠</span>
              <span className="hidden sm:inline">Về trang cá nhân</span>
              <span className="sm:hidden">Trang cá nhân</span>
            </Link>
          </div>

          {renderSummaryCard()}

          {/* Chi tiết từng câu hỏi & đáp án đối chiếu */}
          <Card className="p-5 sm:p-6 space-y-6">
            <div className="flex items-center justify-between border-b pb-4">
              <div className="flex items-center gap-2">
                <BookOpen className="size-5 text-primary" />
                <h2 className="font-bold text-lg text-foreground">Xem lại chi tiết bài làm & đáp án</h2>
              </div>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/30">
                Đã bật xem lại đáp án
              </span>
            </div>

            {/* PHẦN I: TRẮC NGHIỆM NHIỀU LỰA CHỌN */}
            {ex.partI?.length > 0 && (
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm sm:text-base text-primary uppercase tracking-wide">
                    PHẦN I — Trắc nghiệm nhiều lựa chọn
                  </h3>
                  <span className="text-xs text-muted-foreground">({ex.partI.length} câu)</span>
                </div>

                {ex.partI.map((q: any, i: number) => {
                  const chosen = answers[q.id];
                  const ok = chosen === q.answer;
                  return (
                    <div
                      key={q.id}
                      className={`rounded-2xl border p-4 sm:p-5 transition-all ${
                        ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-rose-500/40 bg-rose-500/5"
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        {ok ? (
                          <div className="size-6 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-0.5">
                            <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
                          </div>
                        ) : (
                          <div className="size-6 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0 mt-0.5">
                            <X className="size-4 text-rose-600 dark:text-rose-400" />
                          </div>
                        )}
                        <div className="font-medium text-foreground text-sm sm:text-base leading-relaxed">
                          <span className="font-bold mr-1.5 text-primary">Câu {i + 1}.</span>
                          <RichText text={q.text} />
                        </div>
                      </div>

                      <div className="mt-3.5 space-y-2">
                        {q.options.map((opt: any) => {
                          const isCorrect = opt.key === q.answer;
                          const isChosen = opt.key === chosen;

                          let cls = "border-border/70 bg-card text-foreground";
                          let badge = null;

                          if (isCorrect && isChosen) {
                            // Học sinh chọn đúng
                            cls = "border-emerald-500 bg-emerald-500/15 text-emerald-950 dark:text-emerald-100 ring-1 ring-emerald-500/50";
                            badge = (
                              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 shrink-0">
                                <Check className="size-3.5" /> Bạn chọn (Đúng)
                              </span>
                            );
                          } else if (isCorrect && !isChosen) {
                            // Đáp án đúng mà học sinh không chọn
                            cls = "border-emerald-500/80 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100 font-medium";
                            badge = (
                              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 shrink-0">
                                <Check className="size-3.5" /> Đáp án đúng
                              </span>
                            );
                          } else if (isChosen && !isCorrect) {
                            // Học sinh chọn sai
                            cls = "border-rose-500 bg-rose-500/15 text-rose-950 dark:text-rose-100 ring-1 ring-rose-500/50";
                            badge = (
                              <span className="text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1 shrink-0">
                                <X className="size-3.5" /> Bạn chọn (Sai)
                              </span>
                            );
                          }

                          return (
                            <div
                              key={opt.key}
                              className={`flex items-start justify-between gap-3 rounded-xl border p-3 text-sm transition-all ${cls}`}
                            >
                              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                <b className="min-w-6 font-bold">{opt.key}.</b>
                                <span className="flex-1 break-words">
                                  <RichText text={opt.text} />
                                </span>
                              </div>
                              {badge}
                            </div>
                          );
                        })}

                        {!chosen && (
                          <div className="text-xs text-rose-500 italic mt-1 font-semibold flex items-center gap-1">
                            <ShieldAlert className="size-3.5" /> Bạn chưa chọn đáp án cho câu này.
                          </div>
                        )}
                      </div>

                      {q.explanation && (
                        <div className="mt-3.5 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
                          <div className="text-xs font-bold text-primary mb-1 uppercase tracking-wide">
                            💡 Lời giải chi tiết
                          </div>
                          <div className="text-sm whitespace-pre-wrap text-foreground leading-relaxed">
                            <RichText text={q.explanation} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            )}

            {/* PHẦN II: ĐÚNG / SAI */}
            {ex.partII?.length > 0 && (
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm sm:text-base text-primary uppercase tracking-wide">
                    PHẦN II — Trắc nghiệm Đúng / Sai
                  </h3>
                  <span className="text-xs text-muted-foreground">({ex.partII.length} câu)</span>
                </div>

                {ex.partII.map((q: any, i: number) => {
                  return (
                    <div key={q.id} className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5 space-y-3">
                      <div className="font-medium text-foreground text-sm sm:text-base leading-relaxed">
                        <span className="font-bold mr-1.5 text-primary">Câu {i + 1}.</span>
                        <RichText text={q.text} />
                      </div>

                      <div className="space-y-2">
                        {q.items.map((it: any) => {
                          const val = getTFValue(answers[q.id], it.key);
                          const ok = val !== null && val === !!it.correct;

                          let itemCls = "border-border/70 bg-card";
                          if (val !== null) {
                            itemCls = ok
                              ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100"
                              : "border-rose-500/60 bg-rose-500/10 text-rose-950 dark:text-rose-100";
                          }

                          return (
                            <div
                              key={it.key}
                              className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-xl border p-3 text-sm ${itemCls}`}
                            >
                              <div className="flex items-start gap-2 flex-1 min-w-0">
                                <b className="min-w-6 font-bold">{it.key})</b>
                                <span className="flex-1 break-words">
                                  <RichText text={it.text} />
                                </span>
                              </div>

                              <div className="flex items-center gap-2 shrink-0 text-xs sm:self-center">
                                <span className="px-2 py-1 rounded-md bg-muted/60 text-muted-foreground border">
                                  Đáp án:{" "}
                                  <b className={it.correct ? "text-emerald-600 font-bold" : "text-rose-600 font-bold"}>
                                    {it.correct ? "Đúng" : "Sai"}
                                  </b>
                                </span>

                                <span className="px-2 py-1 rounded-md bg-muted/60 text-muted-foreground border">
                                  Bạn chọn:{" "}
                                  <b className="font-bold">
                                    {val === null ? "Chưa làm" : val ? "Đúng" : "Sai"}
                                  </b>
                                </span>

                                {val === null ? (
                                  <span className="px-2 py-1 rounded-full text-xs font-semibold bg-muted text-muted-foreground">
                                    Bỏ trống
                                  </span>
                                ) : ok ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">
                                    <Check className="size-3.5" /> Đúng
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-500/15 text-rose-600 border border-rose-500/30">
                                    <X className="size-3.5" /> Sai
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {q.explanation && (
                        <div className="mt-3.5 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
                          <div className="text-xs font-bold text-primary mb-1 uppercase tracking-wide">
                            💡 Lời giải chi tiết
                          </div>
                          <div className="text-sm whitespace-pre-wrap text-foreground leading-relaxed">
                            <RichText text={q.explanation} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            )}

            {/* PHẦN III: TRẢ LỜI NGẮN */}
            {ex.partIII?.length > 0 && (
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm sm:text-base text-primary uppercase tracking-wide">
                    PHẦN III — Trả lời ngắn
                  </h3>
                  <span className="text-xs text-muted-foreground">({ex.partIII.length} câu)</span>
                </div>

                {ex.partIII.map((q: any, i: number) => {
                  const given = answers[q.id] ?? "";
                  const ok = numCorrect(given, q.answer);
                  return (
                    <div
                      key={q.id}
                      className={`rounded-2xl border p-4 sm:p-5 ${
                        ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-rose-500/40 bg-rose-500/5"
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        {ok ? (
                          <div className="size-6 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-0.5">
                            <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
                          </div>
                        ) : (
                          <div className="size-6 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0 mt-0.5">
                            <X className="size-4 text-rose-600 dark:text-rose-400" />
                          </div>
                        )}
                        <div className="font-medium text-foreground text-sm sm:text-base leading-relaxed">
                          <span className="font-bold mr-1.5 text-primary">Câu {i + 1}.</span>
                          <RichText text={q.text} />
                        </div>
                      </div>

                      <div className="mt-3.5 grid sm:grid-cols-2 gap-3 text-sm">
                        <div
                          className={`rounded-xl border p-3.5 ${
                            ok
                              ? "border-emerald-500 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100"
                              : "border-rose-500 bg-rose-500/10 text-rose-950 dark:text-rose-100"
                          }`}
                        >
                          <div className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
                            <span>Đáp án của bạn</span>
                            <span className={ok ? "text-emerald-600 font-bold" : "text-rose-600 font-bold"}>
                              {ok ? "✓ Chính xác" : "✗ Chưa chính xác"}
                            </span>
                          </div>
                          <div className="font-bold text-base mt-1 break-words">
                            {String(given) || <span className="italic text-muted-foreground font-normal">(bỏ trống)</span>}
                          </div>
                        </div>

                        <div className="rounded-xl border border-emerald-500/80 bg-emerald-500/10 p-3.5 text-emerald-950 dark:text-emerald-100">
                          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                            Đáp án đúng của đề thi
                          </div>
                          <div className="font-bold text-base mt-1 break-words">
                            <RichText text={String(q.answer)} />
                          </div>
                        </div>
                      </div>

                      {q.explanation && (
                        <div className="mt-3.5 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
                          <div className="text-xs font-bold text-primary mb-1 uppercase tracking-wide">
                            💡 Lời giải chi tiết
                          </div>
                          <div className="text-sm whitespace-pre-wrap text-foreground leading-relaxed">
                            <RichText text={q.explanation} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            )}
          </Card>

          {/* NÚT VỀ TRANG CÁ NHÂN Ở CUỐI TRANG REVIEW */}
          <div className="flex justify-center pt-2 pb-10">
            <Link
              to="/student"
              className="inline-flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-700 hover:via-indigo-700 hover:to-violet-700 text-white font-black text-base shadow-xl shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:scale-[1.01] active:scale-[0.99] transition-all"
            >
              <span className="text-xl">🏠</span>
              <span>Về trang cá nhân</span>
            </Link>
          </div>
        </div>
      </div>
    );
  };

  // 7. YÊU CẦU KỸ THUẬT:
  // Sau khi học sinh nộp bài:
  // Kiểm tra cấu hình bài thi:
  // Nếu allowReviewAnswers = true (hoặc allow_review = true) và có questions: renderReviewPage()
  // Nếu false: renderSimpleResult()
  if (!allowReviewAnswers || !exam?.questions) {
    return renderSimpleResult();
  }

  return renderReviewPage();
}
