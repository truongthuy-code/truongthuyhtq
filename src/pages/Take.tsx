import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getTFValue } from "@/lib/grading";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  Send,
  ShieldAlert,
  Maximize2,
  Loader2,
  Bookmark,
  Sparkles,
  LayoutGrid,
  ListOrdered,
  Flame,
  Award,
  AlertTriangle,
  RotateCcw,
  Eye,
} from "lucide-react";
import RichText from "@/components/RichText";
import QuizBackground from "@/components/QuizBackground";
import { useExamLock } from "@/hooks/useExamLock";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useStudentAuth } from "@/hooks/useStudentAuth";
import { saveStudentSubmission } from "@/lib/studentStorage";
import confetti from "canvas-confetti";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 4 gamified theme styles for options A, B, C, D inspired by quiz game shows
const OPTION_THEMES = [
  {
    letter: "A",
    cardBorder: "border-rose-300/80 dark:border-rose-800/80",
    cardBg: "bg-rose-50/50 hover:bg-rose-100/70 dark:bg-rose-950/20 dark:hover:bg-rose-950/40",
    badgeBg: "bg-gradient-to-br from-rose-500 to-rose-600 text-white shadow-sm shadow-rose-500/30",
    activeRing: "border-rose-500 bg-rose-500/15 ring-4 ring-rose-500/25",
  },
  {
    letter: "B",
    cardBorder: "border-sky-300/80 dark:border-sky-800/80",
    cardBg: "bg-sky-50/50 hover:bg-sky-100/70 dark:bg-sky-950/20 dark:hover:bg-sky-950/40",
    badgeBg: "bg-gradient-to-br from-sky-500 to-sky-600 text-white shadow-sm shadow-sky-500/30",
    activeRing: "border-sky-500 bg-sky-500/15 ring-4 ring-sky-500/25",
  },
  {
    letter: "C",
    cardBorder: "border-amber-300/80 dark:border-amber-800/80",
    cardBg: "bg-amber-50/50 hover:bg-amber-100/70 dark:bg-amber-950/20 dark:hover:bg-amber-950/40",
    badgeBg: "bg-gradient-to-br from-amber-500 to-amber-600 text-white shadow-sm shadow-amber-500/30",
    activeRing: "border-amber-500 bg-amber-500/15 ring-4 ring-amber-500/25",
  },
  {
    letter: "D",
    cardBorder: "border-emerald-300/80 dark:border-emerald-800/80",
    cardBg: "bg-emerald-50/50 hover:bg-emerald-100/70 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/40",
    badgeBg: "bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-sm shadow-emerald-500/30",
    activeRing: "border-emerald-500 bg-emerald-500/15 ring-4 ring-emerald-500/25",
  },
];

export default function Take() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { student, logout: studentLogout } = useStudentAuth();
  const [exam, setExam] = useState<any>(null);
  const [started, setStarted] = useState(false);
  const [name, setName] = useState("");
  const [klass, setKlass] = useState("");
  const [account, setAccount] = useState("");
  const [questions, setQuestions] = useState<any[]>([]);
  const [optionOrders, setOptionOrders] = useState<Record<string, string[]>>({});
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [bookmarks, setBookmarks] = useState<Record<string, boolean>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [finished, setFinished] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, any>>({});
  const [checking, setChecking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [navDrawerOpen, setNavDrawerOpen] = useState(false);
  // View mode in Standard mode: "single" (focused) or "all" (full continuous list)
  const [standardViewMode, setStandardViewMode] = useState<"single" | "all">("single");

  const submittedRef = useRef(false);
  const startedAtRef = useRef<string | null>(null);
  const isQuiz = exam?.display_mode === "quizizz";
  const instantFb = isQuiz && !!exam?.instant_feedback;
  const storageKey = useMemo(() => (id && name && klass ? `take:${id}:${name}:${klass}` : ""), [id, name, klass]);
  const doneKey = storageKey ? `${storageKey}:done` : "";

  // Auto-fill from student account if logged in
  useEffect(() => {
    if (student) {
      if (!name) setName(student.fullName);
      if (!klass) setKlass(student.className);
      if (!account) setAccount(student.account);
    }
  }, [student]);

  // Snapshot of live state for unload handler
  const liveRef = useRef<any>({});

  const lockCfg = exam?.lock_mode || null;
  const lock = useExamLock({
    active: started && !finished,
    lock: lockCfg,
    onAutoSubmit: () => {
      submit();
    },
  });

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("get_exam_for_student", { p_exam_id: id! });
      if (error) {
        toast.error("Không tải được đề: " + error.message);
        return;
      }
      if ((data as any)?.display_mode === "team") {
        navigate(`/team/${id}`, { replace: true });
        return;
      }
      setExam(data);
    })();
  }, [id, navigate]);

  // Persist progress
  useEffect(() => {
    if (!started || !storageKey) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          idx,
          answers,
          bookmarks,
          timeLeft,
          questions,
          optionOrders,
          feedback,
          startedAt: startedAtRef.current,
        })
      );
    } catch {}
  }, [started, storageKey, idx, answers, bookmarks, timeLeft, questions, optionOrders, feedback]);

  // Keep a live snapshot for the unload auto-submit
  useEffect(() => {
    liveRef.current = {
      started,
      finished,
      answers,
      name,
      klass,
      account,
      examTitle: exam?.title,
      violations: lock.violations,
      violationCount: lock.violationCount,
      doneKey,
      storageKey,
    };
  });

  // Auto-save & auto-grade when the student leaves the page without pressing NỘP BÀI
  useEffect(() => {
    if (!started) return;
    const flush = () => {
      const s = liveRef.current;
      if (!s.started || submittedRef.current) return;
      if (s.doneKey && localStorage.getItem(s.doneKey)) return;
      submittedRef.current = true;
      try {
        if (s.doneKey) localStorage.setItem(s.doneKey, "1");
      } catch {}
      try {
        if (s.storageKey) localStorage.removeItem(s.storageKey);
      } catch {}
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
    if (!name.trim() || !klass.trim()) {
      toast.error("Vui lòng nhập họ tên và lớp để bắt đầu");
      return;
    }

    const key = `take:${id}:${name}:${klass}`;
    if (localStorage.getItem(`${key}:done`)) {
      toast.error("Lượt làm bài này đã được nộp (hoặc đã tự động nộp khi bạn thoát trang).");
      return;
    }

    if (exam?.lock_mode?.enabled) {
      await lock.requestFullscreen();
    }

    // Khôi phục bài làm đang dở
    try {
      const raw =
        localStorage.getItem(key) ||
        (exam.display_mode === "quizizz" ? localStorage.getItem(`quizizz:${id}:${name}:${klass}`) : null);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.questions?.length) {
          setQuestions(saved.questions);
          setOptionOrders(saved.optionOrders || {});
          setAnswers(saved.answers || {});
          setBookmarks(saved.bookmarks || {});
          setFeedback(saved.feedback || {});
          setIdx(saved.idx || 0);
          setTimeLeft(saved.timeLeft ?? exam.duration_minutes * 60);
          startedAtRef.current = saved.startedAt || new Date().toISOString();
          setStarted(true);
          toast.info("Đã khôi phục bài làm đang dở của bạn. Chúc bạn làm bài tốt! 🎯");
          return;
        }
      }
    } catch {}

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
    const p1 = (sQ.p1 ? shuffle(ex.partI || []) : ex.partI || []).map((q: any) => ({ ...q, type: "mc", _part: 1 }));
    const p2 = (sQ.p2 ? shuffle(ex.partII || []) : ex.partII || []).map((q: any) => ({ ...q, type: "tf", _part: 2 }));
    const p3 = (sQ.p3 ? shuffle(ex.partIII || []) : ex.partIII || []).map((q: any) => ({ ...q, type: "sa", _part: 3 }));
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
    if (started && timeLeft <= 0 && !submittedRef.current) {
      toast.warning("Hết thời gian làm bài! Đang tự động nộp bài...");
      submit();
    }
    // eslint-disable-next-line
  }, [timeLeft, started]);

  // Auto-submit when exam close time passes (if enabled)
  useEffect(() => {
    if (!started || finished || !exam?.close_at) return;
    const closeMs = new Date(exam.close_at).getTime();
    const tick = () => {
      if (Date.now() >= closeMs && !submittedRef.current) {
        if (exam.auto_submit_on_close !== false) {
          toast.info("Đã đến thời gian đóng đề thi. Hệ thống tự động nộp bài.");
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

    // Trigger celebratory confetti effect
    try {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
      });
    } catch {}

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
    if (error) {
      toast.error(error.message);
      submittedRef.current = false;
      return;
    }
    if (doneKey) {
      try {
        localStorage.setItem(doneKey, "1");
      } catch {}
    }
    if (storageKey) {
      try {
        localStorage.removeItem(storageKey);
      } catch {}
    }

    // Save to student submission history linked to student account
    try {
      const durSecs = startedAtRef.current
        ? Math.max(0, Math.floor((Date.now() - new Date(startedAtRef.current).getTime()) / 1000))
        : null;
      const { data: subData } = await supabase.rpc("get_submission_for_student", { p_submission_id: data });
      const sInfo = (subData as any)?.submission;
      saveStudentSubmission({
        id: data,
        examId: id!,
        examTitle: exam?.title || "Đề kiểm tra",
        studentAccount: account.trim() || student?.account || `${name.trim()}_${klass.trim()}`,
        studentName: name.trim(),
        studentClass: klass.trim(),
        score: sInfo?.score ?? 0,
        maxScore: sInfo?.max_score ?? 10,
        correctCount: sInfo?.correct_count ?? 0,
        wrongCount: sInfo?.wrong_count ?? 0,
        answers: answers as any,
        startedAt: startedAtRef.current,
        submittedAt: new Date().toISOString(),
        durationSeconds: durSecs,
        status: "completed",
      });
    } catch (e) {
      console.error("Failed to link student submission:", e);
    }

    await lock.exitFullscreen();
    navigate(`/result/${data}`);
  };

  const confirmSubmit = async () => {
    setConfirmOpen(false);
    await submit();
  };

  const setAns = (qId: string, v: any) => setAnswers({ ...answers, [qId]: v });

  const setTF = (qq: any, key: string, val: boolean) =>
    setAnswers({
      ...answers,
      [qq.id]: {
        ...(answers[qq.id] && !Array.isArray(answers[qq.id]) ? answers[qq.id] : {}),
        [key]: val,
      },
    });

  const toggleBookmark = (qId: string) => {
    setBookmarks((prev) => {
      const next = { ...prev, [qId]: !prev[qId] };
      toast(next[qId] ? "⭐ Đã đánh dấu câu để xem lại sau" : "Đã bỏ đánh dấu câu", { duration: 1500 });
      return next;
    });
  };

  const isAnswered = (qq: any) => {
    const a = answers[qq.id];
    if (qq.type === "tf") {
      if (Array.isArray(a)) return a.length > 0;
      return !!a && typeof a === "object" && Object.values(a).some((v) => v === true || v === false);
    }
    return a !== undefined && a !== "" && a !== null;
  };

  // Lock overlay when anti-cheating full-screen violation occurs
  const lockOverlay = lock.enabled ? (
    <>
      <AlertDialog
        open={!!lock.warning}
        onOpenChange={(o) => {
          if (!o) lock.dismissWarning();
        }}
      >
        <AlertDialogContent className="rounded-3xl border-2 shadow-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive text-xl font-bold">
              <ShieldAlert className="size-6 text-destructive animate-pulse" /> Cảnh báo vi phạm quy chế thi
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base text-foreground/80 mt-2">
              {lock.warning}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => lock.dismissWarning()}
              className="bg-primary text-primary-foreground font-bold rounded-xl"
            >
              Tôi đã hiểu và tiếp tục làm bài
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {lock.violationCount > 0 && (
        <div className="fixed bottom-4 right-4 z-40 rounded-2xl bg-destructive text-destructive-foreground px-4 py-2 text-xs sm:text-sm font-bold shadow-xl flex items-center gap-2 border border-destructive-foreground/20 animate-bounce">
          <ShieldAlert className="size-4" /> Số lần vi phạm: {lock.violationCount}
        </div>
      )}
    </>
  ) : null;

  const answeredCount = questions.filter((qq: any) => isAnswered(qq)).length;
  const unansweredCount = questions.length - answeredCount;
  const bookmarkedCount = Object.values(bookmarks).filter(Boolean).length;

  // Hộp thoại xác nhận nộp bài chuyên nghiệp, rõ ràng, riêng biệt
  const submitDialog = (
    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogContent className="rounded-3xl border-2 shadow-2xl max-w-lg p-6 sm:p-8">
        <AlertDialogHeader className="text-center sm:text-left">
          <div className="size-14 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center mx-auto sm:mx-0 mb-3">
            <Send className="size-7" />
          </div>
          <AlertDialogTitle className="text-2xl font-black text-foreground">
            Xác nhận nộp bài thi?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-base text-foreground/80 mt-2 space-y-3">
            <div className="rounded-2xl bg-muted/60 p-4 border space-y-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Đã trả lời:</span>
                <span className="font-bold text-emerald-600 text-base">
                  {answeredCount} / {questions.length} câu
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Chưa trả lời:</span>
                <span className={`font-bold text-base ${unansweredCount > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                  {unansweredCount} câu
                </span>
              </div>
              {bookmarkedCount > 0 && (
                <div className="flex justify-between items-center pt-1 border-t">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Bookmark className="size-3.5 text-amber-500 fill-amber-500" /> Đang đánh dấu:
                  </span>
                  <span className="font-bold text-amber-600">{bookmarkedCount} câu</span>
                </div>
              )}
            </div>

            {unansweredCount > 0 ? (
              <p className="text-rose-600 font-semibold text-sm flex items-center gap-1.5">
                <AlertTriangle className="size-4 shrink-0" /> Bạn vẫn còn {unansweredCount} câu chưa hoàn thành. Bạn có chắc chắn muốn nộp bài?
              </p>
            ) : (
              <p className="text-emerald-600 font-medium text-sm flex items-center gap-1.5">
                <CheckCircle2 className="size-4 shrink-0" /> Bạn đã hoàn thành toàn bộ {questions.length} câu hỏi. Rất tuyệt vời!
              </p>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-6 flex-col-reverse sm:flex-row gap-2">
          <AlertDialogCancel className="rounded-xl font-bold py-3 text-base">
            Quay lại làm bài
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={confirmSubmit}
            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground font-black py-3 rounded-xl shadow-lg text-base"
          >
            Xác nhận nộp bài
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  // Màn hình loading
  if (!exam) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4">
        <QuizBackground />
        <div className="flex items-center gap-3 text-primary font-bold text-lg bg-card/80 backdrop-blur px-6 py-4 rounded-2xl shadow-lg border">
          <Loader2 className="size-6 animate-spin" />
          <span>Đang tải đề thi...</span>
        </div>
      </div>
    );
  }

  const fmtDt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("vi-VN") : "");

  // Màn hình đề chưa mở hoặc đã kết thúc
  if (!started && (exam.status === "not_open" || exam.status === "closed")) {
    const isNotOpen = exam.status === "not_open";
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 grid place-items-center p-4 relative selection:bg-primary/20">
        <QuizBackground />
        <Card className="p-8 sm:p-10 max-w-md w-full text-center relative z-10 rounded-3xl border-2 shadow-2xl bg-card/95 backdrop-blur">
          <div
            className={`size-20 rounded-3xl mx-auto mb-5 grid place-items-center shadow-lg ${
              isNotOpen ? "bg-amber-100 text-amber-600 shadow-amber-200" : "bg-destructive/10 text-destructive shadow-rose-200"
            }`}
          >
            <Clock className="size-10" />
          </div>
          <h1 className="text-2xl font-black text-foreground">{exam.title}</h1>
          {isNotOpen ? (
            <>
              <p className="mt-3 text-muted-foreground text-sm sm:text-base">
                Đề thi chưa được mở.
                <br />
                Vui lòng quay lại vào thời gian quy định bên dưới.
              </p>
              <div className="mt-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4 text-sm">
                <div className="font-bold text-amber-700 dark:text-amber-400">Thời gian mở đề:</div>
                <div className="text-primary font-black text-base mt-0.5">{fmtDt(exam.open_at)}</div>
              </div>
            </>
          ) : (
            <>
              <p className="mt-3 text-muted-foreground text-sm sm:text-base">Đề thi này đã kết thúc nhận bài.</p>
              {exam.close_at && (
                <div className="mt-5 rounded-2xl bg-destructive/10 border border-destructive/30 p-4 text-sm">
                  <div className="font-bold text-destructive">Thời gian đóng đề:</div>
                  <div className="text-destructive font-black text-base mt-0.5">{fmtDt(exam.close_at)}</div>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    );
  }

  // 14. MÀN HÌNH BẮT ĐẦU LÀM BÀI (GAME LOBBY - PHÒNG CHỜ HIỆN ĐẠI)
  if (!started) {
    const totalQCount =
      (exam.questions?.partI?.length || 0) +
      (exam.questions?.partII?.length || 0) +
      (exam.questions?.partIII?.length || 0);

    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center items-center p-4 relative selection:bg-primary/20">
        <QuizBackground />
        <Card className="p-6 sm:p-10 max-w-xl w-full relative z-10 rounded-3xl border-2 shadow-2xl bg-card/95 backdrop-blur animate-slide-up">
          {/* Header logo / Subtitle */}
          <div className="flex items-center gap-2 text-primary font-black text-xs sm:text-sm uppercase tracking-wider mb-2">
            <Sparkles className="size-4" />
            <span>Hệ thống tạo đề trắc nghiệm Online</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-black text-foreground tracking-tight leading-snug">
            {exam.title}
          </h1>

          {/* Quick stats pills */}
          <div className="mt-4 flex flex-wrap gap-2 text-xs sm:text-sm font-bold">
            <span className="px-3.5 py-1.5 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center gap-1.5">
              <Clock className="size-4" /> {exam.duration_minutes} phút
            </span>
            <span className="px-3.5 py-1.5 rounded-xl bg-sky-500/10 text-sky-600 border border-sky-500/20 flex items-center gap-1.5">
              <ListOrdered className="size-4" /> {totalQCount} câu hỏi
            </span>
            {exam.display_mode === "quizizz" ? (
              <span className="px-3.5 py-1.5 rounded-xl bg-purple-500/10 text-purple-600 border border-purple-500/20 flex items-center gap-1.5">
                🎯 Chế độ Từng câu hỏi
              </span>
            ) : (
              <span className="px-3.5 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 flex items-center gap-1.5">
                📄 Chế độ Toàn bộ câu hỏi
              </span>
            )}
          </div>

          {exam.display_mode === "quizizz" && (
            <div className="mt-4 text-xs sm:text-sm rounded-2xl bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/30 p-3.5 flex items-start gap-2.5">
              <Flame className="size-5 shrink-0 text-amber-500 mt-0.5" />
              <div>
                <b>Trải nghiệm Quizizz:</b> Mỗi lần hiển thị 1 câu hỏi tập trung. Hãy đọc kỹ và chọn phương án chính xác nhất trước khi chuyển câu!
              </div>
            </div>
          )}

          {exam.lock_mode?.enabled && (
            <div className="mt-3 text-xs sm:text-sm rounded-2xl bg-destructive/10 text-destructive border border-destructive/30 p-3.5 flex items-start gap-2.5">
              <ShieldAlert className="size-5 shrink-0 mt-0.5" />
              <div>
                <b>Chế độ thi giám sát toàn màn hình:</b> Vui lòng không chuyển tab, không rời khỏi màn hình trong khi làm bài để tránh bị ghi nhận vi phạm quy chế.
              </div>
            </div>
          )}

          {/* Form nhập thông tin thí sinh */}
          <div className="mt-6 space-y-3.5">
            <div>
              <Label className="font-bold text-sm text-foreground">Họ và tên học sinh *</Label>
              <Input
                placeholder="Nhập đầy đủ họ và tên..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1.5 h-12 rounded-xl text-base font-medium px-4 border-2"
                autoFocus
              />
            </div>
            <div>
              <Label className="font-bold text-sm text-foreground">Lớp học *</Label>
              <Input
                placeholder="Ví dụ: 12A1, 11B2..."
                value={klass}
                onChange={(e) => setKlass(e.target.value)}
                className="mt-1.5 h-12 rounded-xl text-base font-medium px-4 border-2"
              />
            </div>
            <div>
              <Label className="font-bold text-sm text-foreground">Tài khoản hoặc Email (tùy chọn)</Label>
              <Input
                placeholder="Nhập email hoặc mã học sinh nếu có..."
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className="mt-1.5 h-12 rounded-xl text-base font-medium px-4 border-2"
              />
            </div>
          </div>

          {student ? (
            <div className="mt-4 rounded-2xl border border-primary/30 bg-primary/5 p-3.5 text-xs sm:text-sm flex items-center justify-between">
              <div>
                <span className="font-bold text-primary">Tài khoản đăng nhập:</span> {student.fullName} ({student.className})
                <div className="text-muted-foreground text-xs">{student.account}</div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs h-8 text-muted-foreground hover:text-foreground font-semibold"
                onClick={() => {
                  studentLogout();
                  setName("");
                  setKlass("");
                  setAccount("");
                }}
              >
                Đổi tài khoản
              </Button>
            </div>
          ) : (
            <div className="mt-4 text-xs text-muted-foreground text-center">
              Đã có tài khoản học sinh?{" "}
              <Link to="/student/auth" state={{ from: `/take/${id}` }} className="text-primary font-bold hover:underline">
                Đăng nhập để đồng bộ kết quả
              </Link>
            </div>
          )}

          {/* Nút Bắt đầu nổi bật, hào hứng */}
          <Button
            onClick={start}
            size="lg"
            className="w-full mt-6 h-14 rounded-2xl text-lg sm:text-xl font-black bg-gradient-to-r from-primary to-sky-600 hover:from-primary/95 hover:to-sky-600/95 text-white shadow-xl shadow-primary/25 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2"
          >
            <Sparkles className="size-5" />
            <span>BẮT ĐẦU LÀM BÀI</span>
          </Button>

          <div className="mt-4 text-[11px] text-muted-foreground text-center">
            Tác giả: Trương Thị Bích Thủy – THPT Phan Bội Châu - TP Đà Nẵng
          </div>
        </Card>
      </div>
    );
  }

  // Current question data
  const q = questions[idx];
  const mins = Math.max(0, Math.floor(timeLeft / 60));
  const secs = Math.max(0, timeLeft % 60);

  const goNext = () => {
    if (idx >= questions.length - 1) {
      setFinished(true);
      try {
        confetti({ particleCount: 70, spread: 60, origin: { y: 0.5 } });
      } catch {}
    } else {
      setIdx(idx + 1);
    }
  };

  const goPrev = () => {
    if (idx > 0) setIdx(idx - 1);
  };

  const onMcSelect = (qId: string, v: string) => {
    if (instantFb && feedback[qId]) return;
    setAns(qId, v);
  };

  const fb = q ? feedback[q.id] : null;

  const checkAnswer = async () => {
    if (!instantFb || fb || !isAnswered(q) || checking) return;
    setChecking(true);
    const { data, error } = await supabase.rpc("check_question_answer", {
      p_exam_id: id!,
      p_question_id: q.id,
      p_answer: (answers[q.id] ?? null) as any,
    } as any);
    setChecking(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setFeedback((f) => ({ ...f, [q.id]: data }));
    if (data?.correct) {
      try {
        confetti({ particleCount: 40, spread: 50, origin: { y: 0.7 } });
      } catch {}
    }
  };

  const pct = questions.length ? Math.round(((idx + 1) / questions.length) * 100) : 0;
  const answeredPct = questions.length ? Math.round((answeredCount / questions.length) * 100) : 0;

  const toggleFs = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  };

  // Font size responsive calculation based on question text length
  const qLen = (q?.text || "").length;
  const qFontSizeClass =
    qLen < 110
      ? "text-[clamp(28px,3.2vw,44px)]"
      : qLen < 250
      ? "text-[clamp(24px,2.6vw,38px)]"
      : "text-[clamp(20px,2vw,32px)]";

  // Question navigation drawer / modal component
  const questionNavDrawer = (
    <div
      className={`fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity ${
        navDrawerOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      }`}
      onClick={() => setNavDrawerOpen(false)}
    >
      <div
        className="absolute bottom-0 sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 w-full sm:max-w-2xl bg-card rounded-t-3xl sm:rounded-3xl p-6 sm:p-8 shadow-2xl border max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 pb-3 border-b">
          <div className="flex items-center gap-2">
            <LayoutGrid className="size-5 text-primary" />
            <h3 className="font-black text-lg text-foreground">Danh sách câu hỏi ({questions.length} câu)</h3>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setNavDrawerOpen(false)} className="rounded-full">
            Đóng ✕
          </Button>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mb-4 bg-muted/40 p-3 rounded-2xl">
          <div className="flex items-center gap-1.5">
            <span className="size-3.5 rounded-md bg-emerald-500" /> Đã trả lời ({answeredCount})
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-3.5 rounded-md bg-amber-400" /> Đang đánh dấu ({bookmarkedCount})
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-3.5 rounded-md border-2 border-primary bg-primary/20" /> Đang xem
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-3.5 rounded-md bg-muted border border-border" /> Chưa làm ({unansweredCount})
          </div>
        </div>

        {/* Grid of question numbers */}
        <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-2.5">
          {questions.map((item, i) => {
            const isDone = isAnswered(item);
            const isMarked = !!bookmarks[item.id];
            const isCurrent = i === idx;

            return (
              <button
                key={item.id}
                onClick={() => {
                  setIdx(i);
                  setNavDrawerOpen(false);
                }}
                className={`relative h-11 rounded-xl font-black text-sm transition-all duration-200 flex items-center justify-center border-2 ${
                  isCurrent
                    ? "border-primary bg-primary text-primary-foreground shadow-md scale-105"
                    : isMarked
                    ? "border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
                    : isDone
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                    : "border-border bg-card hover:bg-muted text-muted-foreground"
                }`}
              >
                <span>{i + 1}</span>
                {isMarked && (
                  <span className="absolute -top-1.5 -right-1 text-amber-500 font-bold text-xs">⭐</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Action inside drawer */}
        <div className="mt-6 pt-4 border-t flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Tiến độ hoàn thành: <b className="text-foreground">{answeredPct}%</b>
          </div>
          <Button
            onClick={() => {
              setNavDrawerOpen(false);
              setConfirmOpen(true);
            }}
            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground font-black text-sm rounded-xl px-5"
          >
            <Send className="size-4 mr-1.5" /> Nộp bài
          </Button>
        </div>
      </div>
    </div>
  );

  // MÀN HÌNH HOÀN THÀNH TẤT CẢ CÂU (Finished state in single question mode)
  if (finished) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center items-center p-4 relative selection:bg-primary/20">
        <QuizBackground />
        {lockOverlay}
        {submitDialog}
        <Card className="p-8 sm:p-12 max-w-xl w-full text-center relative z-10 rounded-3xl border-2 shadow-2xl bg-card/95 backdrop-blur animate-slide-up">
          <div className="size-24 rounded-3xl bg-emerald-100 dark:bg-emerald-950/50 text-emerald-500 mx-auto mb-5 grid place-items-center shadow-xl shadow-emerald-500/20">
            <CheckCircle2 className="size-14 animate-bounce" />
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-foreground tracking-tight">
            BẠN ĐÃ LÀM XONG BÀI THI!
          </h2>
          <p className="text-muted-foreground mt-3 text-lg font-medium">
            Bạn đã trả lời <b className="text-emerald-600 font-black">{answeredCount}</b> /{" "}
            <b>{questions.length}</b> câu hỏi.
          </p>

          {unansweredCount > 0 && (
            <div className="mt-4 p-3 rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-sm font-semibold flex items-center justify-center gap-2">
              <AlertTriangle className="size-4" /> Bạn vẫn còn {unansweredCount} câu chưa làm.
            </div>
          )}

          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                setFinished(false);
                setIdx(0);
              }}
              className="flex-1 rounded-2xl font-bold py-6 text-base"
            >
              <RotateCcw className="size-4 mr-2" /> Xem lại các câu
            </Button>
            <Button
              onClick={() => setConfirmOpen(true)}
              size="lg"
              className="flex-1 bg-destructive hover:bg-destructive/90 text-destructive-foreground font-black text-lg py-6 rounded-2xl shadow-xl shadow-destructive/25 hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              <Send className="size-5 mr-2" /> NỘP BÀI THI
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // RENDER DẠNG CÂU HỎI & PHƯƠNG ÁN (Dùng chung cho cả Chế độ từng câu và Chế độ toàn bộ)
  const renderQuestionCard = (currentQ: any, questionIndex: number, isSingleView: boolean = true) => {
    const isCurrentMarked = !!bookmarks[currentQ.id];
    const qFb = feedback[currentQ.id];

    return (
      <Card
        key={currentQ.id}
        className={`w-full rounded-3xl border-2 border-border/80 bg-card/95 shadow-xl transition-all ${
          isSingleView ? "p-5 sm:p-8 lg:p-10 flex-1 flex flex-col justify-between" : "p-6 sm:p-8 mb-6"
        }`}
      >
        <div className="flex-1 flex flex-col justify-start">
          {/* Header câu hỏi: Số câu, Loại câu & Nút Đánh dấu */}
          <div className="flex items-center justify-between gap-3 mb-4 pb-2 border-b border-border/60">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="px-4 py-1.5 rounded-2xl bg-primary text-primary-foreground font-black text-sm sm:text-base tracking-wider shadow-sm flex items-center gap-1.5">
                <span>CÂU {questionIndex + 1}</span>
                <span className="text-primary-foreground/75 font-bold text-xs sm:text-sm">/ {questions.length}</span>
              </div>
              <div className="px-3.5 py-1 rounded-xl bg-primary/10 text-primary font-bold text-xs sm:text-sm border border-primary/20">
                {currentQ._part === 1
                  ? "PHẦN I • TRẮC NGHIỆM 4 LỰA CHỌN"
                  : currentQ._part === 2
                  ? "PHẦN II • TRẮC NGHIỆM ĐÚNG / SAI"
                  : "PHẦN III • TRẢ LỜI NGẮN"}
              </div>
            </div>

            {/* Nút đánh dấu xem lại */}
            <button
              type="button"
              onClick={() => toggleBookmark(currentQ.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-xs sm:text-sm border transition-all ${
                isCurrentMarked
                  ? "border-amber-400 bg-amber-400/20 text-amber-700 dark:text-amber-300 shadow-sm"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
              title="Đánh dấu câu hỏi để xem lại"
            >
              <Bookmark className={`size-4 ${isCurrentMarked ? "fill-amber-500 text-amber-500" : ""}`} />
              <span className="hidden sm:inline">{isCurrentMarked ? "Đã đánh dấu" : "Đánh dấu"}</span>
            </button>
          </div>

          {/* 3. NỘI DUNG CÂU HỎI: Cỡ chữ lớn, rõ ràng, bảng kế thừa font size */}
          <div
            className={`font-bold ${
              isSingleView ? qFontSizeClass : "text-xl sm:text-2xl"
            } leading-relaxed text-foreground tracking-tight mb-6 sm:mb-8 question-content`}
          >
            <RichText text={currentQ.text} />
          </div>

          {/* 4. PHƯƠNG ÁN TRẢ LỜI CHO PHẦN I (TRẮC NGHIỆM 4 LỰA CHỌN A, B, C, D) */}
          {currentQ.type === "mc" && (
            <RadioGroup
              value={answers[currentQ.id] || ""}
              onValueChange={(val) => onMcSelect(currentQ.id, val)}
              className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-5 w-full"
            >
              {(optionOrders[currentQ.id] || currentQ.options.map((o: any) => o.key)).map(
                (key: string, optIndex: number) => {
                  const opt = currentQ.options.find((o: any) => o.key === key)!;
                  const theme = OPTION_THEMES[optIndex % OPTION_THEMES.length];
                  const isChosen = answers[currentQ.id] === key;
                  const isCorrectOpt = !!qFb && qFb.answer === key;

                  return (
                    <label
                      key={key}
                      className={`group flex items-center gap-4 sm:gap-5 p-4 sm:p-5 lg:p-6 rounded-2xl sm:rounded-3xl border-2 sm:border-[2.5px] cursor-pointer transition-all duration-200 select-none shadow-sm ${
                        qFb
                          ? isCorrectOpt
                            ? "border-emerald-500 bg-emerald-500/15 ring-4 ring-emerald-500/30"
                            : isChosen
                            ? "border-rose-500 bg-rose-500/15 ring-4 ring-rose-500/30"
                            : "border-border/60 opacity-60"
                          : isChosen
                          ? `${theme.activeRing} shadow-md scale-[1.015]`
                          : `${theme.cardBorder} ${theme.cardBg} hover:shadow-md`
                      }`}
                    >
                      <RadioGroupItem value={key} id={`${currentQ.id}-${key}`} className="sr-only" disabled={!!qFb} />

                      {/* Huy hiệu A, B, C, D rực rỡ, trực quan phong cách Quizizz */}
                      <div
                        className={`size-12 sm:size-14 lg:size-16 rounded-2xl font-black text-xl sm:text-2xl lg:text-3xl flex items-center justify-center shrink-0 border-2 transition-transform ${
                          qFb
                            ? isCorrectOpt
                              ? "bg-emerald-500 text-white border-emerald-600 scale-105"
                              : isChosen
                              ? "bg-rose-500 text-white border-rose-600"
                              : "bg-muted text-muted-foreground border-border"
                            : isChosen
                            ? `${theme.badgeBg} border-white/50 scale-105 ring-2 ring-primary/40`
                            : `${theme.badgeBg} border-transparent group-hover:scale-105`
                        }`}
                      >
                        {theme.letter}
                      </div>

                      {/* Nội dung phương án */}
                      <span className="flex-1 text-[clamp(18px,1.9vw,28px)] font-semibold leading-snug text-foreground">
                        <RichText text={opt.text} />
                      </span>

                      {/* Nhãn kết quả tức thì */}
                      {isCorrectOpt && (
                        <span className="shrink-0 px-3 py-1.5 rounded-xl bg-emerald-500 text-white font-black text-xs sm:text-sm whitespace-nowrap shadow-sm">
                          ✅ ĐÚNG
                        </span>
                      )}
                      {qFb && isChosen && !isCorrectOpt && (
                        <span className="shrink-0 px-3 py-1.5 rounded-xl bg-rose-500 text-white font-black text-xs sm:text-sm whitespace-nowrap shadow-sm">
                          ❌ BẠN CHỌN
                        </span>
                      )}
                    </label>
                  );
                }
              )}
            </RadioGroup>
          )}

          {/* 6. CÂU HỎI ĐÚNG / SAI (PHẦN II) */}
          {currentQ.type === "tf" && (
            <div className="space-y-4 w-full">
              <div className="text-sm sm:text-base font-bold text-muted-foreground mb-1">
                Chọn <b className="text-emerald-600">Đúng</b> hoặc <b className="text-rose-600">Sai</b> cho từng ý:
              </div>
              {(optionOrders[currentQ.id] || currentQ.items.map((it: any) => it.key)).map(
                (key: string, itemIdx: number) => {
                  const it = currentQ.items.find((x: any) => x.key === key)!;
                  const val = getTFValue(answers[currentQ.id], it.key);
                  const label = String.fromCharCode(97 + itemIdx);
                  const fbIt = qFb?.items?.find((x: any) => x.key === it.key);
                  const itOk = fbIt ? fbIt.student !== null && fbIt.student === fbIt.correct : null;

                  return (
                    <div
                      key={it.key}
                      className={`rounded-2xl sm:rounded-3xl border-2 p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all shadow-sm ${
                        itOk === true
                          ? "border-emerald-500 bg-emerald-500/10"
                          : itOk === false
                          ? "border-rose-500 bg-rose-500/10"
                          : "border-border/90 bg-card hover:bg-muted/20"
                      }`}
                    >
                      <div className="flex items-start gap-3.5 flex-1">
                        <div className="size-10 sm:size-11 rounded-xl bg-muted border-2 border-border font-black text-lg sm:text-xl flex items-center justify-center shrink-0">
                          {label})
                        </div>
                        <div className="text-[clamp(17px,1.8vw,26px)] font-semibold leading-snug flex-1">
                          <RichText text={it.text} />
                          {fbIt && (
                            <span
                              className={`block mt-2 text-sm sm:text-base font-black ${
                                itOk ? "text-emerald-600" : "text-rose-600"
                              }`}
                            >
                              {itOk ? "✅ Chính xác" : `❌ Chưa đúng — Đáp án: ${fbIt.correct ? "Đúng" : "Sai"}`}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Hai nút [ ĐÚNG ] và [ SAI ] rõ ràng, trực quan, dễ bấm */}
                      <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
                        <button
                          type="button"
                          disabled={!!qFb}
                          onClick={() => setTF(currentQ, it.key, true)}
                          className={`px-6 sm:px-8 py-2.5 sm:py-3.5 rounded-xl sm:rounded-2xl text-base sm:text-xl font-black border-2 transition-all ${
                            val === true
                              ? "border-emerald-500 bg-emerald-500 text-white shadow-lg shadow-emerald-500/25 scale-105"
                              : "border-border bg-card hover:bg-muted text-foreground"
                          }`}
                        >
                          ĐÚNG
                        </button>
                        <button
                          type="button"
                          disabled={!!qFb}
                          onClick={() => setTF(currentQ, it.key, false)}
                          className={`px-6 sm:px-8 py-2.5 sm:py-3.5 rounded-xl sm:rounded-2xl text-base sm:text-xl font-black border-2 transition-all ${
                            val === false
                              ? "border-rose-500 bg-rose-500 text-white shadow-lg shadow-rose-500/25 scale-105"
                              : "border-border bg-card hover:bg-muted text-foreground"
                          }`}
                        >
                          SAI
                        </button>
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          )}

          {/* 7. CÂU HỎI TRẢ LỜI NGẮN (PHẦN III) */}
          {currentQ.type === "sa" && (
            <div className="mt-3 w-full max-w-3xl">
              <Label className="text-base sm:text-xl font-black text-foreground block mb-2">
                Nhập câu trả lời của bạn:
              </Label>
              <Input
                value={answers[currentQ.id] || ""}
                onChange={(e) => setAns(currentQ.id, e.target.value)}
                disabled={!!qFb}
                className="h-14 sm:h-18 text-xl sm:text-3xl font-black rounded-2xl px-5 border-2 shadow-inner bg-card text-foreground"
                placeholder="Nhập câu trả lời hoặc số liệu..."
                autoFocus={isSingleView}
              />
              <div className="mt-2 text-xs text-muted-foreground flex items-center justify-between">
                <span>
                  {answers[currentQ.id] ? (
                    <span className="text-emerald-600 font-bold">✓ Đã lưu câu trả lời</span>
                  ) : (
                    "Chưa nhập câu trả lời"
                  )}
                </span>
                <span>Chấm điểm tự động theo số liệu</span>
              </div>
              {qFb && (
                <div className="mt-4 text-lg sm:text-xl font-bold rounded-2xl bg-muted/60 p-4 border">
                  Đáp án chuẩn:{" "}
                  <b className="text-emerald-600">
                    <RichText text={qFb.answer} />
                  </b>
                </div>
              )}
            </div>
          )}

          {/* Hộp phản hồi tức thì (Instant Feedback) */}
          {qFb && (
            <div
              className={`mt-6 rounded-2xl border-2 p-5 shadow-sm ${
                qFb.correct ? "border-emerald-500 bg-emerald-500/10" : "border-rose-500 bg-rose-500/10"
              }`}
            >
              <div className={`font-black text-xl sm:text-2xl ${qFb.correct ? "text-emerald-600" : "text-rose-600"}`}>
                {qFb.correct ? "✅ CHÍNH XÁC!" : "❌ CHƯA CHÍNH XÁC"}
                {qFb.type === "tf" && (
                  <span className="ml-3 text-sm sm:text-base font-bold text-foreground">
                    (Đúng {qFb.okItems}/{qFb.totalItems} ý)
                  </span>
                )}
              </div>
              {qFb.type === "mc" && (
                <div className="mt-2 text-base sm:text-lg font-bold text-foreground">
                  Đáp án đúng:{" "}
                  <span className="text-emerald-600">
                    <b>
                      {(() => {
                        const order = optionOrders[currentQ.id] || currentQ.options.map((o: any) => o.key);
                        const pos = order.indexOf(qFb.answer);
                        return String.fromCharCode(65 + (pos < 0 ? 0 : pos));
                      })()}
                      .
                    </b>{" "}
                    <RichText text={currentQ.options.find((o: any) => o.key === qFb.answer)?.text || ""} />
                  </span>
                </div>
              )}
              {qFb.explanation && (
                <div className="mt-4 rounded-xl bg-card p-4 text-sm sm:text-base border">
                  <div className="font-black text-primary mb-1 flex items-center gap-1.5">
                    <Sparkles className="size-4" /> GIẢI THÍCH CHI TIẾT:
                  </div>
                  <div className="whitespace-pre-wrap leading-relaxed font-medium">
                    <RichText text={qFb.explanation} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    );
  };

  // =========================================================================
  // GIAO DIỆN CHÍNH (ÁP DỤNG ĐỒNG BỘ CẢ CHẾ ĐỘ TỪNG CÂU VÀ CHẾ ĐỘ TOÀN BỘ)
  // =========================================================================
  const showSingleMode = isQuiz || standardViewMode === "single";

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-between selection:bg-primary/20 relative">
      <QuizBackground />
      {lockOverlay}
      {submitDialog}
      {questionNavDrawer}

      {/* 2. THANH TRÊN CÙNG (HEADER) GỌN GÀNG, HIỆN ĐẠI */}
      <header className="border-b bg-card/95 backdrop-blur sticky top-0 z-30 shadow-sm">
        <div className="w-full max-w-[96vw] 2xl:max-w-[94vw] mx-auto py-2.5 px-3 sm:px-6 flex flex-wrap items-center justify-between gap-3">
          {/* Bên trái: Logo/Tên hệ thống & Tên đề thi */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/20">
              <Award className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-primary uppercase tracking-wider truncate max-w-[200px] sm:max-w-xs">
                Hệ thống trắc nghiệm online
              </div>
              <div className="font-black text-sm sm:text-base lg:text-lg truncate max-w-[200px] sm:max-w-sm lg:max-w-md text-foreground">
                {exam.title}
              </div>
            </div>
          </div>

          {/* Ở giữa: Tiến độ làm bài & Thanh tiến trình Quizizz */}
          <div className="flex items-center gap-3 flex-1 max-w-xs sm:max-w-sm md:max-w-md lg:max-w-lg mx-2">
            <div className="flex-1 flex flex-col gap-1">
              <div className="flex justify-between items-center text-xs font-bold text-muted-foreground">
                <span>
                  {showSingleMode ? (
                    <>
                      Câu <b className="text-foreground">{idx + 1}</b> / {questions.length}
                    </>
                  ) : (
                    <>
                      Đã làm <b className="text-emerald-600">{answeredCount}</b> / {questions.length}
                    </>
                  )}
                </span>
                <span className="flex items-center gap-1 text-primary">
                  <Flame className="size-3.5 fill-primary text-primary" />
                  {showSingleMode ? `${pct}%` : `${answeredPct}%`}
                </span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-muted/80 p-0.5 border overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary to-sky-500 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${showSingleMode ? pct : answeredPct}%` }}
                />
              </div>
            </div>
          </div>

          {/* Bên phải: Đồng hồ đếm ngược, Toàn màn hình & NÚT NỘP BÀI ĐẶT RIÊNG BIỆT */}
          <div className="flex items-center gap-2.5 shrink-0">
            {/* Đồng hồ đếm ngược */}
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-2xl border-2 font-mono font-black text-sm sm:text-lg shadow-sm ${
                timeLeft < 60
                  ? "text-destructive border-destructive bg-destructive/10 animate-pulse"
                  : "text-foreground bg-muted/50 border-border"
              }`}
            >
              <Clock className="size-4 shrink-0" />
              <span>
                {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
              </span>
            </div>

            {/* Chuyển đổi chế độ xem (Chỉ có ở Standard mode) */}
            {!isQuiz && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStandardViewMode((m) => (m === "single" ? "all" : "single"))}
                className="rounded-xl h-9 px-3 font-bold text-xs hidden md:flex items-center gap-1.5"
                title="Đổi chế độ xem câu hỏi"
              >
                {standardViewMode === "single" ? (
                  <>
                    <Eye className="size-3.5" /> <span>Xem toàn bộ</span>
                  </>
                ) : (
                  <>
                    <ListOrdered className="size-3.5" /> <span>Xem từng câu</span>
                  </>
                )}
              </Button>
            )}

            {/* Toàn màn hình */}
            <Button
              variant="outline"
              size="sm"
              onClick={toggleFs}
              className="rounded-xl h-9 px-2.5 font-bold text-xs hidden sm:flex items-center gap-1.5 hover:bg-muted"
              title="Bật/Tắt Toàn màn hình"
            >
              <Maximize2 className="size-3.5" />
            </Button>

            {/* 9. NÚT NỘP BÀI TẠI HEADER: Đặt tách biệt, nổi bật, an toàn tuyệt đối */}
            <Button
              onClick={() => setConfirmOpen(true)}
              size="sm"
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground font-black text-xs sm:text-sm px-3.5 sm:px-4 py-2 rounded-xl shadow-md transition-all active:scale-95"
            >
              <Send className="size-3.5 mr-1.5" />
              <span>NỘP BÀI</span>
            </Button>
          </div>
        </div>
      </header>

      {/* 3. KHU VỰC NỘI DUNG CHÍNH */}
      {showSingleMode ? (
        // ===== CHẾ ĐỘ TẬP TRUNG TỪNG CÂU HỎI (SINGLE QUESTION / QUIZIZZ MODE) =====
        <main className="flex-1 w-full max-w-[96vw] 2xl:max-w-[94vw] mx-auto px-2 sm:px-4 py-3 sm:py-5 flex flex-col justify-between relative z-10">
          {renderQuestionCard(q, idx, true)}

          {/* 8. THANH ĐIỀU HƯỚNG HIỆN ĐẠI PHÍA DƯỚI (NAVIGATION BAR) */}
          <div className="mt-4 sm:mt-6 w-full flex items-center justify-between gap-3 bg-card/90 backdrop-blur p-3 sm:p-4 rounded-3xl border shadow-lg">
            {/* Nút Câu trước */}
            <Button
              variant="outline"
              size="lg"
              onClick={goPrev}
              disabled={idx === 0}
              className="rounded-2xl font-bold text-sm sm:text-base px-4 sm:px-6 h-12 sm:h-14 border-2"
            >
              <ChevronLeft className="size-5 mr-1" />
              <span className="hidden sm:inline">Câu trước</span>
            </Button>

            {/* Nút mở Danh sách câu hỏi */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="lg"
                onClick={() => setNavDrawerOpen(true)}
                className="rounded-2xl font-bold text-xs sm:text-sm px-3 sm:px-5 h-12 sm:h-14 border-2 flex items-center gap-2"
              >
                <LayoutGrid className="size-4 text-primary" />
                <span>
                  Danh sách câu (<b className="text-primary">{answeredCount}</b>/{questions.length})
                </span>
              </Button>
            </div>

            {/* Nút Chuyển câu / Trả lời tiếp theo */}
            <div>
              {instantFb && !fb ? (
                <Button
                  onClick={checkAnswer}
                  size="lg"
                  disabled={!isAnswered(q) || checking}
                  className="bg-gradient-to-r from-primary to-sky-600 text-white font-black text-base sm:text-xl px-6 sm:px-10 h-12 sm:h-14 rounded-2xl shadow-xl shadow-primary/25 hover:scale-105 active:scale-95 transition-all"
                >
                  {checking && <Loader2 className="size-5 mr-2 animate-spin" />}
                  <span>KIỂM TRA</span>
                </Button>
              ) : (
                <Button
                  onClick={goNext}
                  size="lg"
                  className="bg-gradient-to-r from-primary to-sky-600 text-white font-black text-base sm:text-xl px-6 sm:px-10 h-12 sm:h-14 rounded-2xl shadow-xl shadow-primary/25 hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                >
                  <span>{idx >= questions.length - 1 ? "HOÀN THÀNH" : "CÂU TIẾP THEO"}</span>
                  <ChevronRight className="size-5" />
                </Button>
              )}
            </div>
          </div>
        </main>
      ) : (
        // ===== CHẾ ĐỘ TOÀN BỘ CÂU HỎI (ALL QUESTIONS SCROLLABLE LIST) =====
        <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 relative z-10">
          <div className="mb-4 flex items-center justify-between bg-card/90 backdrop-blur p-4 rounded-2xl border shadow-sm">
            <div className="text-sm font-bold text-foreground">
              Đang xem toàn bộ <b className="text-primary">{questions.length}</b> câu hỏi. Bạn có thể làm câu bất kỳ.
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNavDrawerOpen(true)}
              className="rounded-xl font-bold flex items-center gap-1.5"
            >
              <LayoutGrid className="size-4 text-primary" />
              <span>Mục lục câu hỏi</span>
            </Button>
          </div>

          <div className="space-y-6">
            {questions.map((item, qIdx) => renderQuestionCard(item, qIdx, false))}
          </div>

          {/* Nút Nộp bài ở cuối trang toàn bộ câu hỏi */}
          <div className="mt-8 mb-12 p-6 rounded-3xl bg-card border-2 shadow-xl text-center space-y-3">
            <h3 className="text-xl font-black text-foreground">Đã duyệt hết các câu hỏi trong đề!</h3>
            <p className="text-muted-foreground text-sm">
              Bạn đã hoàn thành <b className="text-emerald-600 font-bold">{answeredCount}</b> trên tổng số{" "}
              <b>{questions.length}</b> câu hỏi.
            </p>
            <Button
              onClick={() => setConfirmOpen(true)}
              size="lg"
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground font-black text-lg px-8 py-6 rounded-2xl shadow-xl shadow-destructive/25 hover:scale-105 active:scale-95 transition-all"
            >
              <Send className="size-5 mr-2" /> NỘP BÀI THI
            </Button>
          </div>
        </main>
      )}
    </div>
  );
}
