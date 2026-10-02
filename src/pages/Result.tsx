import { useEffect, useState } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import RichText from "@/components/RichText";
import QuizBackground from "@/components/QuizBackground";
import { Check, X, GraduationCap, ArrowLeft, Trophy, Sparkles, Home } from "lucide-react";
import { stripRich } from "@/lib/docxParser";
import { getTFValue } from "@/lib/grading";
import { getPublishedExamAnswerKey, getStudentSubmissions, getAllSubmissions } from "@/lib/studentStorage";
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
          allow_review: true,
          questions: sampleMatch?.questions || null,
        });
      }
    })();
  }, [id, location]);

  if (!sub) return (
    <div className="min-h-screen grid place-items-center relative">
      <QuizBackground />
      <div className="text-center text-muted-foreground font-bold relative z-10">Đang tải kết quả…</div>
    </div>
  );

  const total = sub.correct_count + sub.wrong_count;
  const allowReview = !!exam?.allow_review;
  const answers = sub.answers || {};

  // breakdown computed from exam.questions if review allowed (questions are present only then)
  const bd = (() => {
    if (!exam?.questions) return null;
    const ex = exam.questions;
    const p1 = ex.partI || []; const p2 = ex.partII || []; const p3 = ex.partIII || [];
    let p1c = 0; p1.forEach((q: any) => { if (answers[q.id] === q.answer) p1c++; });
    let p3c = 0;
    const numEq = (a: string, b: string) => {
      const na = parseFloat(a.replace(",", ".")); const nb = parseFloat(b.replace(",", "."));
      return !isNaN(na) && !isNaN(nb) && Math.abs(na - nb) < 1e-6;
    };
    p3.forEach((q: any) => {
      const g = String(answers[q.id] ?? "").trim().toLowerCase();
      const e = stripRich(String(q.answer ?? "")).trim().toLowerCase();
      if (g === e || numEq(g, e)) p3c++;
    });
    const perQ = p2.map((q: any) => {
      let ok = 0;
      q.items.forEach((it: any) => {
        const v = getTFValue(answers[q.id], it.key);
        if (v !== null && v === !!it.correct) ok++;
      });
      return { id: q.id, okItems: ok, totalItems: q.items.length };
    });
    return {
      p1: { correct: p1c, total: p1.length },
      p2: { total: p2.length, perQuestion: perQ },
      p3: { correct: p3c, total: p3.length },
    };
  })();

  const summary = (
    <Card className="p-6 sm:p-8 max-w-lg w-full text-center mx-auto shadow-xl rounded-3xl border-2 border-border/80 bg-card/95 backdrop-blur">
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Kết quả bài thi của</div>
      <div className="font-extrabold text-xl sm:text-2xl mt-1 text-foreground">{sub.student_name} • Lớp {sub.student_class}</div>

      <div className="my-6 py-7 px-4 rounded-3xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white shadow-xl shadow-indigo-500/25 relative overflow-hidden">
        <div className="absolute inset-0 bg-white/5 backdrop-blur-[1px] pointer-events-none" />
        <div className="text-xs uppercase font-bold tracking-widest opacity-90">Tổng điểm đạt được</div>
        <div className="text-7xl sm:text-8xl font-black leading-none mt-2 drop-shadow-md">{sub.score ?? 0}</div>
        <div className="text-sm font-semibold opacity-90 mt-2">Thang điểm: / {sub.max_score ?? 10} điểm</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4">
          <div className="text-3xl font-black text-emerald-600 dark:text-emerald-400">{sub.correct_count}</div>
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 mt-1">Câu trả lời đúng</div>
        </div>
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4">
          <div className="text-3xl font-black text-rose-600 dark:text-rose-400">{sub.wrong_count}</div>
          <div className="text-xs font-semibold text-rose-700 dark:text-rose-300 mt-1">Câu trả lời sai</div>
        </div>
      </div>

      {bd && (
        <div className="mt-6 space-y-3.5 text-left">
          {bd.p1.total > 0 && (
            <div className="rounded-2xl border border-border/80 bg-muted/30 p-3.5 sm:p-4">
              <div className="font-bold text-sm text-foreground">PHẦN I — Trắc nghiệm nhiều lựa chọn</div>
              <div className="text-xs text-muted-foreground mt-1">
                Số câu đúng: <b className="text-emerald-600 dark:text-emerald-400 font-bold">{bd.p1.correct}</b> / {bd.p1.total} câu
              </div>
            </div>
          )}
          {bd.p2.total > 0 && (
            <div className="rounded-2xl border border-border/80 bg-muted/30 p-3.5 sm:p-4">
              <div className="font-bold text-sm text-foreground">PHẦN II — Trắc nghiệm Đúng/Sai</div>
              <div className="text-xs text-muted-foreground mt-1">Số ý đúng từng câu:</div>
              <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
                {bd.p2.perQuestion.map((q, i) => (
                  <div key={q.id} className="flex justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-card border text-xs">
                    <span className="font-medium">Câu {i + 1}</span>
                    <span><b className="text-emerald-600 dark:text-emerald-400">{q.okItems}</b>/{q.totalItems} ý</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {bd.p3.total > 0 && (
            <div className="rounded-2xl border border-border/80 bg-muted/30 p-3.5 sm:p-4">
              <div className="font-bold text-sm text-foreground">PHẦN III — Trả lời ngắn</div>
              <div className="text-xs text-muted-foreground mt-1">
                Số câu đúng: <b className="text-emerald-600 dark:text-emerald-400 font-bold">{bd.p3.correct}</b> / {bd.p3.total} câu
              </div>
            </div>
          )}
        </div>
      )}

      {/* NÚT "🏠 VỀ TRANG CÁ NHÂN" SAU KHI NỘP BÀI - VỊ TRÍ NỔI BẬT DỄ NHÌN */}
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

  if (!allowReview || !exam) {
    return (
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

          {summary}

          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-center text-xs text-amber-800 dark:text-amber-300 space-y-2">
            <div className="font-bold text-sm">🔒 Đề thi đang mở (Giáo viên chưa đóng đề thi)</div>
            <div>
              Đáp án chính thức, lời giải chi tiết và đối chiếu câu đúng/sai sẽ tự động hiển thị sau khi Giáo viên đóng đề thi.
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
  }

  // Review mode
  const ex = exam.questions;
  const numCorrect = (sa: string, expected: string) => {
    const a = String(sa ?? "").trim().toLowerCase();
    const b = stripRich(String(expected ?? "")).trim().toLowerCase();
    if (a === b) return true;
    const na = parseFloat(a.replace(",", "."));
    const nb = parseFloat(b.replace(",", "."));
    return !isNaN(na) && !isNaN(nb) && Math.abs(na - nb) < 1e-6;
  };

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

        {summary}

        <Card className="p-5 sm:p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg text-foreground">Xem lại chi tiết bài làm & đáp án</h2>
            <Link
              to="/student"
              className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
            >
              <span>🏠</span> Về trang cá nhân
            </Link>
          </div>

          {ex.partI?.length > 0 && (
            <section className="space-y-4">
              <h3 className="font-semibold text-primary">PHẦN I — Trắc nghiệm</h3>
              {ex.partI.map((q: any, i: number) => {
                const chosen = answers[q.id];
                const ok = chosen === q.answer;
                return (
                  <div key={q.id} className={`rounded-lg border p-4 ${ok ? "border-success/40 bg-success/5" : "border-destructive/40 bg-destructive/5"}`}>
                    <div className="flex items-start gap-2">
                      {ok ? <Check className="size-5 text-success shrink-0 mt-0.5" /> : <X className="size-5 text-destructive shrink-0 mt-0.5" />}
                      <div className="font-medium"><span className="mr-1">Câu {i + 1}.</span><RichText text={q.text} /></div>
                    </div>
                    <div className="mt-3 space-y-1.5">
                      {q.options.map((opt: any) => {
                        const isCorrect = opt.key === q.answer;
                        const isChosen = opt.key === chosen;
                        const cls = isCorrect
                          ? "border-success bg-success/10"
                          : isChosen
                          ? "border-destructive bg-destructive/10"
                          : "border-border";
                        return (
                          <div key={opt.key} className={`flex items-start gap-2 rounded border p-2 text-sm ${cls}`}>
                            <b className="min-w-5">{opt.key}.</b>
                            <span className="flex-1"><RichText text={opt.text} /></span>
                            {isCorrect && <span className="text-xs text-success font-semibold">✓ Đáp án đúng</span>}
                            {isChosen && !isCorrect && <span className="text-xs text-destructive font-semibold">✗ Bạn chọn</span>}
                          </div>
                        );
                      })}
                      {!chosen && <div className="text-xs text-muted-foreground italic">Bạn chưa trả lời.</div>}
                    </div>
                    {q.explanation && (
                      <div className="mt-3 rounded-md border-l-2 border-primary/50 bg-primary/5 p-3">
                        <div className="text-xs font-semibold text-primary mb-1">Lời giải</div>
                        <div className="text-sm whitespace-pre-wrap"><RichText text={q.explanation} /></div>
                      </div>
                    )}
                  </div>
                );

              })}
            </section>
          )}

          {ex.partII?.length > 0 && (
            <section className="space-y-4">
              <h3 className="font-semibold text-primary">PHẦN II — Đúng/Sai</h3>
              {ex.partII.map((q: any, i: number) => {
                return (
                  <div key={q.id} className="rounded-lg border p-4">
                    <div className="font-medium mb-2"><span className="mr-1">Câu {i + 1}.</span><RichText text={q.text} /></div>
                    <div className="space-y-1.5">
                      {q.items.map((it: any) => {
                        const val = getTFValue(answers[q.id], it.key);
                        const ok = val !== null && val === !!it.correct;
                        return (
                          <div key={it.key} className={`flex items-start gap-2 rounded border p-2 text-sm ${val === null ? "border-border bg-muted/40" : ok ? "border-success bg-success/10" : "border-destructive bg-destructive/10"}`}>
                            <b className="min-w-5">{it.key})</b>
                            <span className="flex-1"><RichText text={it.text} /></span>
                            <span className="text-xs whitespace-nowrap">
                              Đáp án: <b className={it.correct ? "text-success" : "text-destructive"}>{it.correct ? "Đúng" : "Sai"}</b>
                              {" • "}
                              Bạn chọn: <b>{val === null ? "Chưa trả lời" : val ? "Đúng" : "Sai"}</b>
                              {val === null ? null : ok ? <Check className="inline size-3.5 text-success ml-1" /> : <X className="inline size-3.5 text-destructive ml-1" />}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {q.explanation && (
                      <div className="mt-3 rounded-md border-l-2 border-primary/50 bg-primary/5 p-3">
                        <div className="text-xs font-semibold text-primary mb-1">Lời giải</div>
                        <div className="text-sm whitespace-pre-wrap"><RichText text={q.explanation} /></div>
                      </div>
                    )}
                  </div>
                );

              })}
            </section>
          )}

          {ex.partIII?.length > 0 && (
            <section className="space-y-4">
              <h3 className="font-semibold text-primary">PHẦN III — Trả lời ngắn</h3>
              {ex.partIII.map((q: any, i: number) => {
                const given = answers[q.id] ?? "";
                const ok = numCorrect(given, q.answer);
                return (
                  <div key={q.id} className={`rounded-lg border p-4 ${ok ? "border-success/40 bg-success/5" : "border-destructive/40 bg-destructive/5"}`}>
                    <div className="flex items-start gap-2">
                      {ok ? <Check className="size-5 text-success shrink-0 mt-0.5" /> : <X className="size-5 text-destructive shrink-0 mt-0.5" />}
                      <div className="font-medium"><span className="mr-1">Câu {i + 1}.</span><RichText text={q.text} /></div>
                    </div>
                    <div className="mt-3 grid sm:grid-cols-2 gap-2 text-sm">
                      <div className={`rounded border p-2 ${ok ? "border-success bg-success/10" : "border-destructive bg-destructive/10"}`}>
                        <div className="text-xs text-muted-foreground">Đáp án của bạn</div>
                        <div className="font-medium break-words">{String(given) || <span className="italic text-muted-foreground">(bỏ trống)</span>}</div>
                      </div>
                      <div className="rounded border border-success bg-success/10 p-2">
                        <div className="text-xs text-muted-foreground">Đáp án đúng</div>
                        <div className="font-medium break-words"><RichText text={String(q.answer)} /></div>
                      </div>
                    </div>
                    {q.explanation && (
                      <div className="mt-3 rounded-md border-l-2 border-primary/50 bg-primary/5 p-3">
                        <div className="text-xs font-semibold text-primary mb-1">Lời giải</div>
                        <div className="text-sm whitespace-pre-wrap"><RichText text={q.explanation} /></div>
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
}
