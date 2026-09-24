import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getTFValue } from "@/lib/grading";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Clock, SkipForward, CheckCircle2, Send, ShieldAlert, Maximize2, Loader2 } from "lucide-react";
import RichText from "@/components/RichText";
import { useExamLock } from "@/hooks/useExamLock";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";


function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function Take() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [exam, setExam] = useState<any>(null);
  const [started, setStarted] = useState(false);
  const [name, setName] = useState("");
  const [klass, setKlass] = useState("");
  const [questions, setQuestions] = useState<any[]>([]);
  const [optionOrders, setOptionOrders] = useState<Record<string, string[]>>({});
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [finished, setFinished] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, any>>({});
  const [checking, setChecking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const submittedRef = useRef(false);
  const startedAtRef = useRef<string | null>(null);
  const isQuiz = exam?.display_mode === "quizizz";
  const instantFb = isQuiz && !!exam?.instant_feedback;
  const storageKey = useMemo(() => (id && name && klass ? `take:${id}:${name}:${klass}` : ""), [id, name, klass]);
  const doneKey = storageKey ? `${storageKey}:done` : "";

  // Snapshot of live state for unload handler (refs avoid stale closures)
  const liveRef = useRef<any>({});

  const lockCfg = exam?.lock_mode || null;
  const lock = useExamLock({
    active: started && !finished,
    lock: lockCfg,
    onAutoSubmit: () => { submit(); },
  });

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("get_exam_for_student", { p_exam_id: id! });
      if (error) { toast.error("Không tải được đề: " + error.message); return; }
      if ((data as any)?.display_mode === "team") { navigate(`/team/${id}`, { replace: true }); return; }
      setExam(data);
    })();
  }, [id, navigate]);

  // Persist progress (both modes)
  useEffect(() => {
    if (!started || !storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ idx, answers, timeLeft, questions, optionOrders, feedback, startedAt: startedAtRef.current }));
    } catch {}
  }, [started, storageKey, idx, answers, timeLeft, questions, optionOrders, feedback]);

  // Keep a live snapshot for the unload auto-submit
  useEffect(() => {
    liveRef.current = { started, finished, answers, name, klass, violations: lock.violations, violationCount: lock.violationCount, doneKey, storageKey };
  });

  // Auto-save & auto-grade when the student leaves the page without pressing NỘP BÀI
  useEffect(() => {
    if (!started) return;
    const flush = () => {
      const s = liveRef.current;
      if (!s.started || submittedRef.current) return;
      if (s.doneKey && localStorage.getItem(s.doneKey)) return;
      submittedRef.current = true;
      try { if (s.doneKey) localStorage.setItem(s.doneKey, "1"); } catch {}
      try { if (s.storageKey) localStorage.removeItem(s.storageKey); } catch {}
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/submit_student_exam`;
      const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const body = JSON.stringify({
        p_exam_id: id,
        p_student_name: s.name,
        p_student_class: s.klass,
        p_answers: s.answers,
        p_violations: s.violations,
        p_violation_count: s.violationCount,
        p_started_at: startedAtRef.current,
        p_duration_seconds: startedAtRef.current
          ? Math.max(0, Math.floor((Date.now() - new Date(startedAtRef.current).getTime()) / 1000))
          : null,
      });
      try {
        fetch(url, {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
          body,
        });
      } catch {}
    };
    const onPageHide = () => flush();
    const onBeforeUnload = () => flush();
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      flush();
    };
    // eslint-disable-next-line
  }, [started, id]);


  const start = async () => {
    if (!name.trim() || !klass.trim()) { toast.error("Nhập họ tên và lớp"); return; }

    const key = `take:${id}:${name}:${klass}`;
    if (localStorage.getItem(`${key}:done`)) {
      toast.error("Lượt làm bài này đã được nộp (hoặc đã tự động nộp khi bạn thoát trang).");
      return;
    }

    if (exam?.lock_mode?.enabled) {
      await lock.requestFullscreen();
    }

    // Khôi phục bài làm đang dở (cả 2 chế độ)
    {
      try {
        const raw = localStorage.getItem(key) || (exam.display_mode === "quizizz" ? localStorage.getItem(`quizizz:${id}:${name}:${klass}`) : null);
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved.questions?.length) {
            setQuestions(saved.questions);
            setOptionOrders(saved.optionOrders || {});
            setAnswers(saved.answers || {});
            setFeedback(saved.feedback || {});
            setIdx(saved.idx || 0);
            setTimeLeft(saved.timeLeft ?? exam.duration_minutes * 60);
            startedAtRef.current = saved.startedAt || new Date().toISOString();
            setStarted(true);
            toast.info("Đã khôi phục bài làm đang dở của bạn.");
            return;
          }
        }
      } catch {}
    }


    const ex = exam.questions as any;
    const sQ = {
      p1: exam.shuffle_q_p1 ?? exam.shuffle_questions,
      p2: exam.shuffle_q_p2 ?? exam.shuffle_questions,
      p3: exam.shuffle_q_p3 ?? exam.shuffle_questions,
    };
    const sO = {
      p1: exam.shuffle_o_p1 ?? exam.shuffle_options,
      p2: exam.shuffle_o_p2 ?? exam.shuffle_options,
      p3: exam.shuffle_o_p3 ?? exam.shuffle_options,
    };
    const p1 = (sQ.p1 ? shuffle(ex.partI || []) : (ex.partI || [])).map((q: any) => ({ ...q, type: "mc", _part: 1 }));
    const p2 = (sQ.p2 ? shuffle(ex.partII || []) : (ex.partII || [])).map((q: any) => ({ ...q, type: "tf", _part: 2 }));
    const p3 = (sQ.p3 ? shuffle(ex.partIII || []) : (ex.partIII || [])).map((q: any) => ({ ...q, type: "sa", _part: 3 }));
    const qs = [...p1, ...p2, ...p3];
    const oo: Record<string, string[]> = {};
    qs.forEach((q: any) => {
      if (q.type === "mc" && sO.p1) oo[q.id] = shuffle(q.options.map((o: any) => o.key));
      if (q.type === "tf" && sO.p2) oo[q.id] = shuffle(q.items.map((it: any) => it.key));
    });
    setOptionOrders(oo);
    setQuestions(qs);
    setTimeLeft(exam.duration_minutes * 60);
    startedAtRef.current = new Date().toISOString();
    setStarted(true);
  };

  useEffect(() => {
    if (!started || finished) return;
    const t = setInterval(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [started, finished]);

  useEffect(() => {
    if (started && timeLeft <= 0 && !submittedRef.current) submit();
    // eslint-disable-next-line
  }, [timeLeft, started]);

  // Auto-submit when exam close time passes (if enabled)
  useEffect(() => {
    if (!started || finished || !exam?.close_at) return;
    const closeMs = new Date(exam.close_at).getTime();
    const tick = () => {
      if (Date.now() >= closeMs && !submittedRef.current) {
        if (exam.auto_submit_on_close !== false) {
          toast.info("Đã hết giờ đóng đề. Hệ thống tự động nộp bài.");
          submit();
        }
      }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [started, finished, exam]);


  const submit = async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    const { data, error } = await supabase.rpc("submit_student_exam", {
      p_exam_id: id!,
      p_student_name: name,
      p_student_class: klass,
      p_answers: answers as any,
      p_violations: lock.violations as any,
      p_violation_count: lock.violationCount,
      p_started_at: startedAtRef.current,
      p_duration_seconds: startedAtRef.current
        ? Math.max(0, Math.floor((Date.now() - new Date(startedAtRef.current).getTime()) / 1000))
        : null,
    } as any);
    if (error) { toast.error(error.message); submittedRef.current = false; return; }
    if (doneKey) try { localStorage.setItem(doneKey, "1"); } catch {}
    if (storageKey) try { localStorage.removeItem(storageKey); } catch {}
    await lock.exitFullscreen();
    navigate(`/result/${data}`);
  };

  const confirmSubmit = async () => {
    setConfirmOpen(false);
    await submit();
  };



  if (!exam) return <div className="container py-20 text-center text-muted-foreground">Đang tải…</div>;

  const fmtDt = (s: string | null | undefined) => s ? new Date(s).toLocaleString("vi-VN") : "";
  if (!started && (exam.status === "not_open" || exam.status === "closed")) {
    const isNotOpen = exam.status === "not_open";
    return (
      <div className="min-h-screen bg-gradient-soft grid place-items-center p-4">
        <Card className="p-8 max-w-md w-full text-center">
          <div className={`size-16 rounded-full mx-auto mb-4 grid place-items-center ${isNotOpen ? "bg-amber-100 text-amber-600" : "bg-destructive/10 text-destructive"}`}>
            <Clock className="size-8" />
          </div>
          <h1 className="text-xl font-bold">{exam.title}</h1>
          {isNotOpen ? (
            <>
              <p className="mt-3 text-muted-foreground">Đề thi chưa được mở.<br/>Vui lòng quay lại vào thời gian quy định.</p>
              <div className="mt-4 rounded-lg bg-muted/50 p-3 text-sm">
                <div className="font-medium">Thời gian mở đề</div>
                <div className="text-primary font-semibold">{fmtDt(exam.open_at)}</div>
              </div>
            </>
          ) : (
            <>
              <p className="mt-3 text-muted-foreground">Đề thi đã kết thúc.</p>
              {exam.close_at && (
                <div className="mt-4 rounded-lg bg-muted/50 p-3 text-sm">
                  <div className="font-medium">Thời gian đóng đề</div>
                  <div className="text-destructive font-semibold">{fmtDt(exam.close_at)}</div>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    );
  }

  if (!started) {
    return (
      <div className="min-h-screen bg-gradient-soft grid place-items-center p-4">
        <Card className="p-8 max-w-md w-full">
          <h1 className="text-2xl font-bold">{exam.title}</h1>
          <div className="mt-2 text-sm text-muted-foreground">
            Thời gian: {exam.duration_minutes} phút •{" "}
            {(exam.questions.partI?.length || 0) + (exam.questions.partII?.length || 0) + (exam.questions.partIII?.length || 0)} câu
            {exam.display_mode === "quizizz" && <span className="ml-2 inline-block px-2 py-0.5 rounded bg-primary/10 text-primary text-xs">Quizizz Mode</span>}
          </div>
          {exam.display_mode === "quizizz" && (
            <div className="mt-3 text-xs rounded-md bg-warning/10 text-black border border-warning/30 p-3">
              ⚠ Mỗi lần chỉ hiện 1 câu. Khi đã chuyển câu, <b>không được quay lại</b>.
            </div>
          )}
          {exam.lock_mode?.enabled && (
            <div className="mt-3 text-xs rounded-md bg-destructive/10 text-destructive border border-destructive/30 p-3 flex gap-2">
              <ShieldAlert className="size-4 shrink-0 mt-0.5" />
              <div>
                <b>Chế độ khóa màn hình thi.</b> Đề thi yêu cầu chế độ toàn màn hình. Vui lòng không chuyển sang ứng dụng hoặc cửa sổ khác trong thời gian làm bài.
                {!exam.lock_mode.warnOnly && exam.lock_mode.autoSubmit && (
                  <> Sau <b>{exam.lock_mode.maxViolations}</b> lần vi phạm, bài sẽ tự động nộp.</>
                )}
              </div>
            </div>
          )}
          <div className="mt-6 space-y-3">
            <div><Label>Họ và tên</Label><Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" /></div>
            <div><Label>Lớp</Label><Input value={klass} onChange={(e) => setKlass(e.target.value)} className="mt-1" /></div>
          </div>
          <Button onClick={start} className="w-full mt-6 bg-gradient-primary">
            {exam.lock_mode?.enabled && <Maximize2 className="size-4 mr-2" />}
            Bắt đầu làm bài
          </Button>
        </Card>
      </div>
    );
  }

  const q = questions[idx];
  const mins = Math.max(0, Math.floor(timeLeft / 60));
  const secs = Math.max(0, timeLeft % 60);

  const setAns = (v: any) => setAnswers({ ...answers, [q.id]: v });
  const setTF = (qq: any, key: string, val: boolean) =>
    setAnswers({ ...answers, [qq.id]: { ...(answers[qq.id] && !Array.isArray(answers[qq.id]) ? answers[qq.id] : {}), [key]: val } });
  const isAnswered = (qq: any) => {
    const a = answers[qq.id];
    if (qq.type === "tf") {
      if (Array.isArray(a)) return a.length > 0;
      return !!a && typeof a === "object" && Object.values(a).some((v) => v === true || v === false);
    }
    return a !== undefined && a !== "" && a !== null;
  };

  const lockOverlay = lock.enabled ? (
    <>
      <AlertDialog open={!!lock.warning} onOpenChange={(o) => { if (!o) lock.dismissWarning(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="size-5" /> Cảnh báo vi phạm
            </AlertDialogTitle>
            <AlertDialogDescription>{lock.warning}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => lock.dismissWarning()}>Tôi đã hiểu</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {lock.violationCount > 0 && (
        <div className="fixed bottom-3 right-3 z-40 rounded-full bg-destructive text-destructive-foreground px-3 py-1.5 text-xs font-semibold shadow-lg flex items-center gap-1.5">
          <ShieldAlert className="size-3.5" /> Vi phạm: {lock.violationCount}
        </div>
      )}
    </>
  ) : null;

  const answeredCount = questions.filter((qq: any) => isAnswered(qq)).length;

  const submitDialog = (
    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Xác nhận nộp bài</AlertDialogTitle>
          <AlertDialogDescription>
            Bạn có chắc chắn muốn nộp toàn bộ bài thi không? Sau khi nộp, bạn sẽ không thể tiếp tục làm bài.
            <span className="block mt-2 font-medium text-foreground">Đã trả lời: {answeredCount} / {questions.length} câu</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>HỦY</AlertDialogCancel>
          <AlertDialogAction onClick={confirmSubmit} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
            XÁC NHẬN NỘP BÀI
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );


  // ===== QUIZIZZ MODE (CHẾ ĐỘ TỪNG CÂU HỎI — TỐI ƯU TRÌNH CHIẾU MÁY CHIẾU/TV) =====
  if (isQuiz) {
    if (finished) {
      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 grid place-items-center p-4">
          {lockOverlay}
          {submitDialog}
          <Card className="p-8 sm:p-12 max-w-xl w-full text-center rounded-3xl border-2 shadow-2xl">
            <CheckCircle2 className="size-20 text-emerald-500 mx-auto mb-4 animate-bounce" />
            <h2 className="text-3xl sm:text-4xl font-black text-foreground tracking-tight">ĐÃ HOÀN THÀNH BÀI THI!</h2>
            <p className="text-muted-foreground mt-3 text-lg sm:text-xl font-medium">
              Bạn đã trả lời <b className="text-foreground">{answeredCount}</b> / <b>{questions.length}</b> câu hỏi.
            </p>
            <Button
              onClick={() => setConfirmOpen(true)}
              className="w-full mt-8 bg-destructive hover:bg-destructive/90 text-destructive-foreground font-black text-xl py-6 rounded-2xl shadow-xl active:scale-95 transition-all"
              size="lg"
            >
              <Send className="size-5 mr-2" /> NỘP BÀI THI
            </Button>
          </Card>
        </div>
      );
    }

    const goNext = () => {
      if (idx >= questions.length - 1) setFinished(true);
      else setIdx(idx + 1);
    };

    const onMcSelect = (v: string) => {
      if (instantFb && feedback[q.id]) return;
      setAns(v);
    };

    const fb = feedback[q.id];

    const checkAnswer = async () => {
      if (!instantFb || fb || !isAnswered(q) || checking) return;
      setChecking(true);
      const { data, error } = await supabase.rpc("check_question_answer", {
        p_exam_id: id!,
        p_question_id: q.id,
        p_answer: (answers[q.id] ?? null) as any,
      } as any);
      setChecking(false);
      if (error) { toast.error(error.message); return; }
      setFeedback((f) => ({ ...f, [q.id]: data }));
    };

    const pct = Math.round(((idx + 1) / questions.length) * 100);

    const toggleFs = () => {
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      } else {
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
    };

    // Tự động tính toán kích cỡ chữ linh hoạt theo độ dài câu hỏi
    const qLen = (q.text || "").length;
    const qFontSizeClass =
      qLen < 110
        ? "text-[clamp(30px,3.4vw,48px)]"
        : qLen < 250
        ? "text-[clamp(26px,2.8vw,42px)]"
        : "text-[clamp(22px,2.1vw,34px)]";

    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-between selection:bg-primary/20">
        {lockOverlay}
        {submitDialog}

        {/* 1. THANH TIÊU ĐỀ GỌN GÀNG, CHIẾM ÍT CHIỀU CAO */}
        <header className="border-b bg-card/95 backdrop-blur sticky top-0 z-30 shadow-sm">
          <div className="w-full max-w-[96vw] 2xl:max-w-[94vw] mx-auto py-2.5 px-3 sm:px-6 flex flex-wrap items-center justify-between gap-3">
            {/* Góc trái: Huy hiệu câu hỏi & Tên bài thi */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="px-4 py-1.5 rounded-full bg-primary text-primary-foreground font-black text-sm sm:text-base tracking-wider shrink-0 shadow-sm flex items-center gap-1.5">
                <span>CÂU {idx + 1}</span>
                <span className="text-primary-foreground/75 font-bold text-xs sm:text-sm">/ {questions.length}</span>
              </div>
              <div className="font-bold text-sm sm:text-base lg:text-lg truncate max-w-[220px] sm:max-w-md lg:max-w-lg text-foreground">
                {exam.title}
              </div>
            </div>

            {/* Ở giữa: Thanh tiến độ */}
            <div className="flex items-center gap-3 flex-1 max-w-xs sm:max-w-sm md:max-w-md lg:max-w-xl mx-2">
              <div className="flex-1 h-3 rounded-full bg-muted/80 p-0.5 border overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs sm:text-sm font-black text-muted-foreground w-11 text-right shrink-0">
                {pct}%
              </span>
            </div>

            {/* Góc phải: Đồng hồ đếm ngược & Nút toàn màn hình */}
            <div className="flex items-center gap-2.5 shrink-0">
              <div
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full border-2 font-mono font-black text-base sm:text-xl shadow-sm ${
                  timeLeft < 60
                    ? "text-destructive border-destructive/50 bg-destructive/10 animate-pulse"
                    : "text-foreground bg-muted/60 border-border"
                }`}
              >
                <Clock className="size-4 sm:size-5" />
                <span>{String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}</span>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={toggleFs}
                className="rounded-full h-9 px-3 font-bold text-xs sm:text-sm hidden sm:flex items-center gap-1.5 hover:bg-muted"
                title="Bật/Tắt chế độ Toàn màn hình máy chiếu"
              >
                <Maximize2 className="size-4" />
                <span>Toàn màn hình</span>
              </Button>
            </div>
          </div>
        </header>

        {/* 2. KHU VỰC CÂU HỎI MỞ RỘNG (CHIẾM 90-95% CHIỀU RỘNG VIEWPORT) */}
        <main className="flex-1 w-full max-w-[96vw] 2xl:max-w-[94vw] mx-auto px-2 sm:px-4 py-3 sm:py-5 flex flex-col justify-between">
          <Card className="flex-1 w-full rounded-[2rem] border-2 border-border/80 bg-card/95 shadow-xl p-5 sm:p-8 lg:p-10 flex flex-col justify-between transition-all">
            <div className="flex-1 flex flex-col justify-start">
              {/* Phân loại phần thi */}
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-xl bg-primary/10 text-primary font-black text-xs sm:text-sm tracking-wide self-start mb-4 border border-primary/20">
                <span>
                  {q._part === 1
                    ? "PHẦN I — TRẮC NGHIỆM 4 PHƯƠNG ÁN"
                    : q._part === 2
                    ? "PHẦN II — TRẮC NGHIỆM ĐÚNG / SAI"
                    : "PHẦN III — TRẢ LỜI NGẮN"}
                </span>
              </div>

              {/* NỘI DUNG CÂU HỎI: CỠ CHỮ GẤP ĐÔI, TỰ ĐỘNG CO GIÃN HỢP LÝ */}
              <div className={`font-bold ${qFontSizeClass} leading-[1.38] text-foreground tracking-tight mb-6 sm:mb-8`}>
                <RichText text={q.text} />
              </div>

              {/* PHƯƠNG ÁN TRẢ LỜI CÂU HỎI TRẮC NGHIỆM (A, B, C, D) */}
              {q.type === "mc" && (
                <RadioGroup
                  value={answers[q.id] || ""}
                  onValueChange={onMcSelect}
                  className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-6 w-full"
                >
                  {(optionOrders[q.id] || q.options.map((o: any) => o.key)).map((key: string, i: number) => {
                    const opt = q.options.find((o: any) => o.key === key)!;
                    const label = String.fromCharCode(65 + i);
                    const isChosen = answers[q.id] === key;
                    const isCorrectOpt = !!fb && fb.answer === key;

                    return (
                      <label
                        key={key}
                        className={`group flex items-center gap-4 sm:gap-6 p-4 sm:p-6 lg:p-7 rounded-2xl sm:rounded-3xl border-2 sm:border-[3px] cursor-pointer transition-all duration-200 select-none shadow-sm ${
                          fb
                            ? isCorrectOpt
                              ? "border-emerald-500 bg-emerald-500/15 ring-4 ring-emerald-500/30"
                              : isChosen
                              ? "border-rose-500 bg-rose-500/15 ring-4 ring-rose-500/30"
                              : "border-border/60 opacity-60"
                            : isChosen
                            ? "border-primary bg-primary/10 ring-4 ring-primary/20 shadow-md scale-[1.01]"
                            : "border-border/90 bg-card hover:bg-muted/40 hover:border-primary/50 hover:shadow-md"
                        }`}
                      >
                        <RadioGroupItem value={key} id={`${q.id}-${key}`} className="sr-only" disabled={!!fb} />
                        {/* Huy hiệu chữ cái A, B, C, D siêu lớn và nổi bật */}
                        <div
                          className={`size-14 sm:size-16 lg:size-20 rounded-2xl font-black text-2xl sm:text-3xl lg:text-4xl flex items-center justify-center shrink-0 border-2 transition-transform ${
                            fb
                              ? isCorrectOpt
                                ? "bg-emerald-500 text-white border-emerald-600 scale-105"
                                : isChosen
                                ? "bg-rose-500 text-white border-rose-600"
                                : "bg-muted text-muted-foreground border-border"
                              : isChosen
                              ? "bg-primary text-primary-foreground border-primary shadow-md scale-105"
                              : "bg-muted text-muted-foreground border-border group-hover:border-primary/50 group-hover:text-foreground"
                          }`}
                        >
                          {label}
                        </div>

                        {/* Văn bản phương án lớn gấp đôi, dễ đọc từ xa */}
                        <span className="flex-1 text-[clamp(20px,2.1vw,34px)] font-semibold leading-snug text-foreground">
                          <RichText text={opt.text} />
                        </span>

                        {isCorrectOpt && (
                          <span className="shrink-0 px-3 py-1.5 rounded-xl bg-emerald-500 text-white font-black text-xs sm:text-base whitespace-nowrap shadow-sm">
                            ✅ ĐÁP ÁN ĐÚNG
                          </span>
                        )}
                        {fb && isChosen && !isCorrectOpt && (
                          <span className="shrink-0 px-3 py-1.5 rounded-xl bg-rose-500 text-white font-black text-xs sm:text-base whitespace-nowrap shadow-sm">
                            ❌ BẠN ĐÃ CHỌN
                          </span>
                        )}
                      </label>
                    );
                  })}
                </RadioGroup>
              )}

              {/* PHẦN II — ĐÚNG / SAI */}
              {q.type === "tf" && (
                <div className="space-y-4 w-full">
                  <div className="text-base sm:text-xl font-bold text-muted-foreground mb-1">
                    Chọn <b className="text-emerald-600">Đúng</b> hoặc <b className="text-rose-600">Sai</b> cho từng ý dưới đây:
                  </div>
                  {(optionOrders[q.id] || q.items.map((it: any) => it.key)).map((key: string, i: number) => {
                    const it = q.items.find((x: any) => x.key === key)!;
                    const val = getTFValue(answers[q.id], it.key);
                    const label = String.fromCharCode(97 + i);
                    const fbIt = fb?.items?.find((x: any) => x.key === it.key);
                    const itOk = fbIt ? fbIt.student !== null && fbIt.student === fbIt.correct : null;

                    return (
                      <div
                        key={it.key}
                        className={`rounded-2xl sm:rounded-3xl border-2 sm:border-[3px] p-4 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all shadow-sm ${
                          itOk === true
                            ? "border-emerald-500 bg-emerald-500/10"
                            : itOk === false
                            ? "border-rose-500 bg-rose-500/10"
                            : "border-border/90 bg-card"
                        }`}
                      >
                        <div className="flex items-start gap-4 flex-1">
                          <div className="size-10 sm:size-12 rounded-xl bg-muted border-2 border-border font-black text-xl sm:text-2xl flex items-center justify-center shrink-0">
                            {label})
                          </div>
                          <div className="text-[clamp(18px,1.9vw,28px)] font-semibold leading-snug flex-1">
                            <RichText text={it.text} />
                            {fbIt && (
                              <span className={`block mt-2 text-base sm:text-lg font-black ${itOk ? "text-emerald-600" : "text-rose-600"}`}>
                                {itOk ? "✅ Chính xác" : `❌ Chưa chính xác — Đáp án đúng: ${fbIt.correct ? "Đúng" : "Sai"}`}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Nút bấm chọn Đúng / Sai cỡ lớn */}
                        <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
                          <button
                            type="button"
                            disabled={!!fb}
                            onClick={() => setTF(q, it.key, true)}
                            className={`px-6 sm:px-8 py-3 sm:py-4 rounded-xl sm:rounded-2xl text-lg sm:text-2xl font-black border-2 sm:border-[3px] transition-all ${
                              val === true
                                ? "border-emerald-500 bg-emerald-500 text-white shadow-lg scale-105"
                                : "border-border bg-card hover:bg-muted text-foreground"
                            }`}
                          >
                            ĐÚNG
                          </button>
                          <button
                            type="button"
                            disabled={!!fb}
                            onClick={() => setTF(q, it.key, false)}
                            className={`px-6 sm:px-8 py-3 sm:py-4 rounded-xl sm:rounded-2xl text-lg sm:text-2xl font-black border-2 sm:border-[3px] transition-all ${
                              val === false
                                ? "border-rose-500 bg-rose-500 text-white shadow-lg scale-105"
                                : "border-border bg-card hover:bg-muted text-foreground"
                            }`}
                          >
                            SAI
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* PHẦN III — TRẢ LỜI NGẮN */}
              {q.type === "sa" && (
                <div className="mt-4 w-full max-w-4xl">
                  <Label className="text-xl sm:text-3xl font-black text-foreground block mb-3">
                    Nhập câu trả lời của bạn:
                  </Label>
                  <Input
                    value={answers[q.id] || ""}
                    onChange={(e) => setAns(e.target.value)}
                    disabled={!!fb}
                    className="h-16 sm:h-22 text-2xl sm:text-4xl font-black rounded-2xl px-6 border-2 sm:border-[3px] shadow-inner bg-card text-foreground"
                    placeholder="Nhập đáp án tại đây…"
                    autoFocus
                  />
                  {fb && (
                    <div className="mt-4 text-xl sm:text-2xl font-bold">
                      Đáp án đúng: <b className="text-emerald-600"><RichText text={fb.answer} /></b>
                    </div>
                  )}
                </div>
              )}

              {/* HỘP HIỂN THỊ PHẢN HỒI NGAY (NẾU CÓ) */}
              {fb && (
                <div
                  className={`mt-6 rounded-2xl border-2 sm:border-[3px] p-5 sm:p-6 shadow-sm ${
                    fb.correct ? "border-emerald-500 bg-emerald-500/10" : "border-rose-500 bg-rose-500/10"
                  }`}
                >
                  <div className={`font-black text-2xl sm:text-3xl ${fb.correct ? "text-emerald-600" : "text-rose-600"}`}>
                    {fb.correct ? "✅ CHÍNH XÁC!" : "❌ CHƯA CHÍNH XÁC"}
                    {fb.type === "tf" && (
                      <span className="ml-3 text-base sm:text-lg font-bold text-foreground">
                        (Đúng {fb.okItems}/{fb.totalItems} ý)
                      </span>
                    )}
                  </div>
                  {fb.type === "mc" && (
                    <div className="mt-2 text-lg sm:text-xl font-bold text-foreground">
                      Đáp án đúng là:{" "}
                      <span className="text-emerald-600">
                        <b>{(() => {
                          const order = optionOrders[q.id] || q.options.map((o: any) => o.key);
                          const pos = order.indexOf(fb.answer);
                          return String.fromCharCode(65 + (pos < 0 ? 0 : pos));
                        })()}.</b>{" "}
                        <RichText text={q.options.find((o: any) => o.key === fb.answer)?.text || ""} />
                      </span>
                    </div>
                  )}
                  {fb.explanation && (
                    <div className="mt-4 rounded-xl bg-card p-4 sm:p-5 text-base sm:text-lg border">
                      <div className="font-black text-primary mb-1.5 flex items-center gap-2">
                        <span>💡 GIẢI THÍCH CHI TIẾT:</span>
                      </div>
                      <div className="whitespace-pre-wrap leading-relaxed font-medium">
                        <RichText text={fb.explanation} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* 3. THANH ĐIỀU HƯỚNG DÀNH RIÊNG CHO NỘP BÀI VÀ CHUYỂN CÂU (KHÔNG CHE PHỦ CÂU HỎI) */}
          <div className="mt-4 sm:mt-6 w-full flex items-center justify-between gap-4">
            {/* Nút Nộp bài nằm ở vị trí riêng biệt bên trái */}
            <Button
              onClick={() => setConfirmOpen(true)}
              size="lg"
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground font-black text-base sm:text-xl px-6 sm:px-8 py-4 sm:py-6 rounded-2xl shadow-xl border-2 border-white/20 active:scale-95 transition-all"
            >
              <Send className="size-5 mr-2" /> NỘP BÀI
            </Button>

            {/* Nút Chuyển câu / Trả lời nằm bên phải */}
            <div>
              {instantFb && !fb ? (
                <Button
                  onClick={checkAnswer}
                  size="lg"
                  disabled={!isAnswered(q) || checking}
                  className="bg-gradient-primary text-white font-black text-lg sm:text-2xl px-8 sm:px-14 py-4 sm:py-6 rounded-2xl shadow-xl hover:scale-105 active:scale-95 transition-all"
                >
                  {checking && <Loader2 className="size-6 mr-2 animate-spin" />} TRẢ LỜI
                </Button>
              ) : (
                <Button
                  onClick={goNext}
                  size="lg"
                  className="bg-gradient-primary text-white font-black text-lg sm:text-2xl px-8 sm:px-14 py-4 sm:py-6 rounded-2xl shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                >
                  <span>{idx >= questions.length - 1 ? "HOÀN THÀNH BÀI" : "CÂU TIẾP THEO"}</span>
                  <ChevronRight className="size-6" />
                </Button>
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ===== STANDARD MODE =====
  return (
    <div className="min-h-screen bg-gradient-soft">
      {lockOverlay}
      {submitDialog}

      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="container flex items-center justify-between py-3 gap-4">
          <div className="font-semibold truncate text-sm">{exam.title}</div>
          <div className={`flex items-center gap-2 font-mono font-semibold ${timeLeft < 60 ? "text-destructive" : ""}`}>
            <Clock className="size-4" />
            {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
          </div>
        </div>
      </header>

      <main className="container max-w-4xl py-6 grid lg:grid-cols-[1fr_240px] gap-6">
        <div className="space-y-4">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-2 gap-2">
              <div className="text-sm text-muted-foreground">Câu {idx + 1} / {questions.length}</div>
              <div className="text-xs font-semibold px-2 py-0.5 rounded bg-primary/10 text-primary">
                {q._part === 1 ? "PHẦN I — Trắc nghiệm" : q._part === 2 ? "PHẦN II — Đúng/Sai" : "PHẦN III — Trả lời ngắn"}
              </div>
            </div>
            <div className="font-medium text-lg"><RichText text={q.text} /></div>

            {q.type === "mc" && (
              <RadioGroup value={answers[q.id] || ""} onValueChange={setAns} className="mt-5 space-y-2">
                {(optionOrders[q.id] || q.options.map((o: any) => o.key)).map((key: string, i: number) => {
                  const opt = q.options.find((o: any) => o.key === key)!;
                  const label = String.fromCharCode(65 + i);
                  return (
                    <label key={key} className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted cursor-pointer has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
                      <RadioGroupItem value={key} id={`${q.id}-${key}`} />
                      <span><b className="mr-2">{label}.</b><RichText text={opt.text} /></span>
                    </label>
                  );
                })}
              </RadioGroup>
            )}

            {q.type === "tf" && (
              <div className="mt-5 space-y-2">
                <div className="text-xs text-muted-foreground">Chọn Đúng hoặc Sai cho từng ý</div>
                {(optionOrders[q.id] || q.items.map((it: any) => it.key)).map((key: string, i: number) => {
                  const it = q.items.find((x: any) => x.key === key)!;
                  const val = getTFValue(answers[q.id], it.key);
                  const label = String.fromCharCode(97 + i);
                  return (
                    <div key={it.key} className="rounded-lg border p-3 flex flex-col sm:flex-row sm:items-start gap-3">
                      <div className="flex items-center gap-2 shrink-0 order-first">
                        <button type="button" onClick={() => setTF(q, it.key, true)}
                          className={`px-3 py-1.5 rounded-md border text-sm font-medium transition ${val === true ? "border-success bg-success/10 text-success" : "hover:bg-muted"}`}>
                          Đúng
                        </button>
                        <button type="button" onClick={() => setTF(q, it.key, false)}
                          className={`px-3 py-1.5 rounded-md border text-sm font-medium transition ${val === false ? "border-destructive bg-destructive/10 text-destructive" : "hover:bg-muted"}`}>
                          Sai
                        </button>
                      </div>
                      <span className="flex-1"><b className="mr-2">{label})</b><RichText text={it.text} /></span>
                    </div>

                  );
                })}
              </div>
            )}

            {q.type === "sa" && (
              <div className="mt-5">
                <Label>Đáp án của bạn</Label>
                <Input value={answers[q.id] || ""} onChange={(e) => setAns(e.target.value)} className="mt-1" placeholder="Nhập đáp án…" />
              </div>
            )}
          </Card>

          <div className="flex flex-wrap gap-2 justify-between">
            <Button variant="outline" onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0}>
              <ChevronLeft className="size-4 mr-1" /> Câu trước
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setIdx(Math.min(questions.length - 1, idx + 1))}>
                <SkipForward className="size-4 mr-1" /> Bỏ qua
              </Button>
              <Button onClick={() => setIdx(idx + 1)} disabled={idx >= questions.length - 1}>
                Câu sau <ChevronRight className="size-4 ml-1" />
              </Button>

            </div>
          </div>
        </div>

        <aside className="lg:sticky lg:top-20 self-start">
          <Card className="p-4">
            <div className="text-sm font-semibold mb-3">Danh sách câu</div>
            <div className="grid grid-cols-6 lg:grid-cols-5 gap-2">
              {questions.map((qq, i) => {
                const done = isAnswered(qq);
                const current = i === idx;
                return (
                  <button
                    key={qq.id}
                    onClick={() => setIdx(i)}
                    className={`size-9 rounded-md text-sm font-medium transition border ${
                      current ? "bg-primary text-primary-foreground border-primary"
                        : done ? "bg-success/15 text-success border-success/30"
                        : "bg-muted text-muted-foreground border-transparent"
                    }`}
                  >{i + 1}</button>
                );
              })}
            </div>
            <div className="mt-3 text-xs space-y-1 text-muted-foreground">
              <div><span className="inline-block size-3 rounded bg-primary mr-1 align-middle" /> Đang làm</div>
              <div><span className="inline-block size-3 rounded bg-success/40 mr-1 align-middle" /> Đã làm</div>
              <div><span className="inline-block size-3 rounded bg-muted mr-1 align-middle" /> Chưa làm</div>
            </div>
            <div className="mt-4 pt-4 border-t">
              <Button onClick={() => setConfirmOpen(true)} size="lg" className="w-full bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold tracking-wide">
                <Send className="size-4 mr-2" /> NỘP BÀI
              </Button>
              <div className="mt-2 text-[11px] text-muted-foreground text-center">Nộp toàn bộ bài thi</div>
            </div>

          </Card>
        </aside>
      </main>
    </div>
  );
}
