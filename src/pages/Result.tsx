import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import RichText from "@/components/RichText";
import { Check, X } from "lucide-react";
import { stripRich } from "@/lib/docxParser";
import { getTFValue } from "@/lib/grading";

export default function Result() {
  const { id } = useParams();
  const [sub, setSub] = useState<any>(null);
  const [exam, setExam] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("get_submission_for_student", { p_submission_id: id! });
      if (error || !data) return;
      const payload: any = data;
      setSub(payload.submission);
      setExam(payload.exam);
    })();
  }, [id]);

  if (!sub) return <div className="container py-20 text-center text-muted-foreground">Đang tải…</div>;

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
    <Card className="p-8 max-w-lg w-full text-center mx-auto">
      <div className="text-sm text-muted-foreground">Kết quả của</div>
      <div className="font-semibold text-lg">{sub.student_name} • Lớp {sub.student_class}</div>

      <div className="my-8 py-8 rounded-2xl bg-gradient-primary text-primary-foreground shadow-lg">
        <div className="text-sm uppercase tracking-wider opacity-90">Tổng điểm</div>
        <div className="text-8xl font-extrabold leading-none mt-2">{sub.score ?? 0}</div>
        <div className="text-base opacity-90 mt-2">/ {sub.max_score ?? 10} điểm</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-success/10 rounded-lg p-4">
          <div className="text-2xl font-bold text-success">{sub.correct_count}</div>
          <div className="text-xs text-muted-foreground">Câu đúng</div>
        </div>
        <div className="bg-destructive/10 rounded-lg p-4">
          <div className="text-2xl font-bold text-destructive">{sub.wrong_count}</div>
          <div className="text-xs text-muted-foreground">Câu sai</div>
        </div>
      </div>

      {bd && (
        <div className="mt-6 space-y-4 text-left">
          {bd.p1.total > 0 && (
            <div className="rounded-lg border p-4">
              <div className="font-semibold text-sm">PHẦN I — Trắc nghiệm</div>
              <div className="text-sm text-muted-foreground mt-1">
                Đúng <b className="text-success">{bd.p1.correct}</b> / {bd.p1.total} câu
              </div>
            </div>
          )}
          {bd.p2.total > 0 && (
            <div className="rounded-lg border p-4">
              <div className="font-semibold text-sm">PHẦN II — Đúng/Sai</div>
              <div className="text-xs text-muted-foreground mt-1">Số ý đúng từng câu:</div>
              <div className="mt-2 grid grid-cols-2 gap-1 text-sm">
                {bd.p2.perQuestion.map((q, i) => (
                  <div key={q.id} className="flex justify-between gap-2 px-2 py-1 rounded bg-muted/50">
                    <span>Câu {i + 1}</span>
                    <span><b className="text-success">{q.okItems}</b>/{q.totalItems} ý</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {bd.p3.total > 0 && (
            <div className="rounded-lg border p-4">
              <div className="font-semibold text-sm">PHẦN III — Trả lời ngắn</div>
              <div className="text-sm text-muted-foreground mt-1">
                Đúng <b className="text-success">{bd.p3.correct}</b> / {bd.p3.total} câu
              </div>
            </div>
          )}
        </div>
      )}

      <div className="text-xs text-muted-foreground mt-6">Tổng {total} câu • Nộp lúc {new Date(sub.submitted_at).toLocaleString("vi-VN")}</div>
    </Card>
  );

  if (!allowReview || !exam) {
    return (
      <div className="min-h-screen bg-gradient-soft grid place-items-center p-4">
        {summary}
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
    <div className="min-h-screen bg-gradient-soft py-6 px-3">
      <div className="max-w-3xl mx-auto space-y-6">
        {summary}

        <Card className="p-5 sm:p-6 space-y-6">
          <h2 className="font-semibold text-lg">Xem lại đáp án</h2>

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
      </div>
    </div>
  );
}
