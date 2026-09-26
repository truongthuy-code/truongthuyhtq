import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import RichText from "@/components/RichText";
import QuizBackground from "@/components/QuizBackground";
import { normalizeTeamConfig } from "@/components/TeamModeSettings";
import { LeaderboardBoard, rankTeams, LbTeam } from "./TeamLeaderboard";
import {
  ChevronLeft,
  ChevronRight,
  Users,
  Trophy,
  Send,
  CheckCircle2,
  Loader2,
  Flame,
  Award,
  Sparkles,
  RotateCcw,
} from "lucide-react";
import confetti from "canvas-confetti";
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

type Q = any;

function flatten(questions: any): Q[] {
  const out: Q[] = [];
  (questions?.partI || []).forEach((q: any) => out.push({ ...q, type: "mc", _part: 1 }));
  (questions?.partII || []).forEach((q: any) => out.push({ ...q, type: "tf", _part: 2 }));
  (questions?.partIII || []).forEach((q: any) => out.push({ ...q, type: "sa", _part: 3 }));
  return out;
}

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

export default function TeamTake() {
  const { id } = useParams();
  const [exam, setExam] = useState<any>(null);
  const [lb, setLb] = useState<any>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [name, setName] = useState("");
  const [klass, setKlass] = useState("");
  const [pickTeam, setPickTeam] = useState("");
  const [customTeam, setCustomTeam] = useState("");
  const [joining, setJoining] = useState(false);
  const [state, setState] = useState<any>(null);
  const [idx, setIdx] = useState(0);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [sending, setSending] = useState(false);
  const [finished, setFinished] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const cfg = useMemo(() => normalizeTeamConfig(lb?.exam?.team_config), [lb]);
  const storageKey = `teamplay:${id}`;

  const questions = useMemo(() => flatten(exam?.questions), [exam]);
  const answers: Record<string, any> = state?.answers || {};
  const answeredCount = Object.keys(answers).length;
  const team = state?.team;

  const loadLb = useCallback(async () => {
    const { data } = await supabase.rpc("get_team_leaderboard", { p_exam_id: id! } as any);
    if (data) setLb(data);
  }, [id]);

  const loadState = useCallback(async (tid: string) => {
    const { data, error } = await supabase.rpc("get_team_state", { p_team_id: tid } as any);
    if (error) {
      toast.error(error.message);
      return;
    }
    setState(data);
    if ((data as any)?.team?.finished_at) setFinished(true);
  }, []);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("get_exam_for_student", { p_exam_id: id! });
      if (error) {
        toast.error("Không tải được đề: " + error.message);
        return;
      }
      setExam(data);
    })();
    loadLb();
  }, [id, loadLb]);

  // Khôi phục phiên của thành viên khi tải lại trang
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s?.teamId) {
        setTeamId(s.teamId);
        setTeamName(s.teamName || "");
        setName(s.name || "");
        setKlass(s.klass || "");
        loadState(s.teamId);
      }
    } catch {}
  }, [storageKey, loadState]);

  // Đồng bộ thời gian thực trong nhóm + bảng xếp hạng
  useEffect(() => {
    if (!teamId) return;
    const ch = supabase
      .channel(`team-${teamId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_answers", filter: `team_id=eq.${teamId}` }, () =>
        loadState(teamId)
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "exam_teams", filter: `exam_id=eq.${id}` }, () => {
        loadState(teamId);
        loadLb();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "team_members", filter: `exam_id=eq.${id}` }, () => {
        loadState(teamId);
        loadLb();
      })
      .subscribe();
    const t = setInterval(() => {
      loadState(teamId);
      loadLb();
    }, 6000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, [teamId, id, loadState, loadLb]);

  const join = async () => {
    const tName = (customTeam || pickTeam).trim();
    if (!name.trim() || !klass.trim() || !tName) {
      toast.error("Vui lòng nhập đủ Tên, Lớp và Tên nhóm");
      return;
    }
    setJoining(true);
    const { data, error } = await supabase.rpc("team_join", {
      p_exam_id: id!,
      p_team_name: tName,
      p_student_name: name.trim(),
      p_student_class: klass.trim(),
    } as any);
    setJoining(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const tid = (data as any).team_id as string;
    setTeamId(tid);
    setTeamName((data as any).team_name);
    localStorage.setItem(
      storageKey,
      JSON.stringify({ teamId: tid, teamName: (data as any).team_name, name: name.trim(), klass: klass.trim() })
    );
    loadState(tid);
    loadLb();
    toast.success(`Đã gia nhập nhóm ${(data as any).team_name}! Chúc nhóm thi đấu xuất sắc! 🎉`);
  };

  const q = questions[idx];
  const qAns = q ? answers[q.id] : null;

  const setTF = (key: string, val: boolean) => {
    const cur = { ...(draft[q.id] || {}) };
    cur[key] = cur[key] === val ? null : val;
    setDraft({ ...draft, [q.id]: cur });
  };

  const submitAnswer = async () => {
    if (!q || !teamId || sending) return;
    const val = draft[q.id];
    if (val === undefined || val === null || (typeof val === "string" && !val.trim())) {
      toast.error("Vui lòng chọn hoặc nhập câu trả lời trước khi gửi");
      return;
    }
    setSending(true);
    const { error } = await supabase.rpc("team_answer_question", {
      p_team_id: teamId,
      p_question_id: q.id,
      p_answer: val as any,
      p_student_name: name,
    } as any);
    setSending(false);
    if (error) {
      toast.error(error.message);
      loadState(teamId);
      return;
    }
    await loadState(teamId);
    loadLb();
  };

  const finish = async () => {
    if (!teamId) return;
    await supabase.rpc("team_finish", { p_team_id: teamId } as any);
    setFinished(true);
    loadLb();
    try {
      confetti({ particleCount: 100, spread: 80, origin: { y: 0.6 } });
    } catch {}
  };

  if (!exam) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
        <QuizBackground />
        <div className="flex items-center gap-3 text-primary font-bold text-lg bg-card/80 backdrop-blur px-6 py-4 rounded-2xl shadow-lg border">
          <Loader2 className="size-6 animate-spin" />
          <span>Đang tải bài thi nhóm...</span>
        </div>
      </div>
    );
  }

  if (exam.status && exam.status !== "open") {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 grid place-items-center p-4 relative">
        <QuizBackground />
        <Card className="p-10 text-center max-w-md rounded-3xl border-2 shadow-2xl bg-card/95 backdrop-blur">
          <div className="text-5xl mb-4">⏳</div>
          <h2 className="text-2xl font-black">{exam.status === "not_open" ? "Đề thi chưa được mở" : "Đề thi đã đóng"}</h2>
          <p className="mt-2 text-sm text-muted-foreground">Vui lòng quay lại vào thời gian quy định.</p>
        </Card>
      </div>
    );
  }

  // ===== Màn hình tham gia nhóm (Team Lobby) =====
  if (!teamId) {
    const teamNames: string[] = [
      ...cfg.teams.map((t) => t.name),
      ...((lb?.teams || []) as LbTeam[]).map((t) => t.name),
    ].filter((v, i, a) => v && a.indexOf(v) === i);

    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4 relative selection:bg-primary/20">
        <QuizBackground />
        <Card className="p-8 sm:p-10 w-full max-w-md space-y-4 rounded-3xl border-2 shadow-2xl bg-card/95 backdrop-blur animate-slide-up">
          <div className="text-center">
            <div className="size-16 rounded-3xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3 shadow-md">
              <Users className="size-8" />
            </div>
            <div className="text-xs font-black text-primary uppercase tracking-wider mb-1">Chế độ thi đấu Đội / Nhóm</div>
            <h1 className="text-2xl font-black text-foreground">{exam.title}</h1>
            <p className="text-muted-foreground text-xs mt-1">Cùng đồng đội trả lời câu hỏi và leo hạng thời gian thực</p>
          </div>

          <div className="space-y-3.5 pt-2">
            <div>
              <Label className="font-bold text-xs">Họ và tên học sinh *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 h-12 rounded-xl text-base font-medium px-4 border-2"
                placeholder="Ví dụ: Nguyễn Văn A"
              />
            </div>
            <div>
              <Label className="font-bold text-xs">Lớp học *</Label>
              <Input
                value={klass}
                onChange={(e) => setKlass(e.target.value)}
                className="mt-1 h-12 rounded-xl text-base font-medium px-4 border-2"
                placeholder="Ví dụ: 12A1"
              />
            </div>

            {teamNames.length > 0 && (
              <div>
                <Label className="font-bold text-xs">Chọn nhóm đã có</Label>
                <Select
                  value={pickTeam}
                  onValueChange={(v) => {
                    setPickTeam(v);
                    setCustomTeam("");
                  }}
                >
                  <SelectTrigger className="mt-1 h-12 rounded-xl border-2 font-medium">
                    <SelectValue placeholder="— Chọn nhóm thi đấu —" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {teamNames.map((n) => (
                      <SelectItem key={n} value={n} className="font-medium">
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label className="font-bold text-xs">Hoặc tạo nhóm mới</Label>
              <Input
                value={customTeam}
                onChange={(e) => {
                  setCustomTeam(e.target.value);
                  setPickTeam("");
                }}
                className="mt-1 h-12 rounded-xl text-base font-medium px-4 border-2"
                placeholder="Nhập tên nhóm mới..."
              />
            </div>
          </div>

          <Button
            onClick={join}
            disabled={joining}
            className="w-full h-14 rounded-2xl text-lg font-black bg-gradient-to-r from-primary to-sky-600 hover:from-primary/95 text-white shadow-xl shadow-primary/25 mt-4"
          >
            {joining ? <Loader2 className="size-5 mr-2 animate-spin" /> : <Sparkles className="size-5 mr-2" />}
            VÀO PHÒNG THI ĐẤU
          </Button>

          {cfg.leaderboard && (
            <Link to={`/leaderboard/${id}`} className="block text-center text-xs font-bold text-primary hover:underline pt-2">
              🏆 Mở bảng xếp hạng trực tiếp
            </Link>
          )}
        </Card>
      </div>
    );
  }

  const teams: LbTeam[] = (lb?.teams || []) as LbTeam[];
  const myRank = rankTeams(teams).findIndex((t) => t.id === teamId) + 1;
  const members = (state?.members || []) as any[];
  const ended = !!lb?.exam?.ended;
  const allDone = questions.length > 0 && answeredCount >= questions.length;

  // ===== Màn hình kết thúc nhóm =====
  if (finished || ended) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 relative selection:bg-primary/20">
        <QuizBackground />
        <div className="container max-w-3xl py-8 space-y-6 relative z-10">
          <Card className="p-8 sm:p-10 text-center rounded-3xl border-2 shadow-2xl bg-card/95 backdrop-blur animate-slide-up">
            <div className="size-20 rounded-3xl bg-emerald-100 text-emerald-600 mx-auto mb-4 grid place-items-center shadow-lg">
              <CheckCircle2 className="size-12" />
            </div>
            <h2 className="text-3xl font-black text-foreground">Nhóm {teamName} đã hoàn thành!</h2>
            <div className="mt-4 flex flex-wrap justify-center gap-4 text-base">
              <span className="px-4 py-2 rounded-2xl bg-primary/10 text-primary font-black border border-primary/20">
                Tổng điểm: {Number(team?.score || 0).toFixed(2)}
              </span>
              <span className="px-4 py-2 rounded-2xl bg-emerald-500/10 text-emerald-600 font-black border border-emerald-500/20">
                Số câu đúng: {team?.correct_count || 0} / {questions.length}
              </span>
              {myRank > 0 && (
                <span className="px-4 py-2 rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300 font-black border border-amber-500/20 flex items-center gap-1">
                  <Trophy className="size-4" /> Thứ hạng #{myRank}
                </span>
              )}
            </div>
          </Card>

          <Card className="p-6 sm:p-8 rounded-3xl border-2 shadow-xl bg-card/95 backdrop-blur">
            <div className="flex items-center gap-2 font-black text-xl mb-4 text-foreground">
              <Trophy className="size-6 text-primary" /> BẢNG XẾP HẠNG THỜI GIAN THỰC
            </div>
            <LeaderboardBoard teams={teams} totalQuestions={questions.length} ended={ended} />
          </Card>
        </div>
      </div>
    );
  }

  const pct = questions.length ? Math.round((answeredCount / questions.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-between selection:bg-primary/20 relative">
      <QuizBackground />

      {/* Confirmation dialog when clicking finish team exam */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="rounded-3xl border-2 shadow-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-2xl font-black">Xác nhận kết thúc bài làm nhóm?</AlertDialogTitle>
            <AlertDialogDescription className="text-base text-foreground/80 mt-2">
              Nhóm <b className="text-primary">{teamName}</b> đã trả lời <b>{answeredCount}</b> / {questions.length} câu.
              Sau khi kết thúc, điểm số của nhóm sẽ được chốt lại trên bảng xếp hạng.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel className="rounded-xl font-bold">Tiếp tục làm bài</AlertDialogCancel>
            <AlertDialogAction onClick={finish} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground font-black rounded-xl">
              Xác nhận kết thúc
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 2. Thanh trên cùng phong cách Quizizz cho thi đấu nhóm */}
      <header className="border-b bg-card/95 backdrop-blur sticky top-0 z-30 shadow-sm">
        <div className="w-full max-w-5xl mx-auto py-2.5 px-4 flex flex-wrap items-center justify-between gap-3">
          {/* Tên nhóm & Thành viên */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-10 rounded-2xl bg-primary text-primary-foreground font-black text-base flex items-center justify-center shrink-0 shadow-sm">
              <Users className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="font-black text-base truncate flex items-center gap-2">
                <span>{teamName}</span>
                {myRank > 0 && (
                  <span className="px-2 py-0.5 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 font-black text-xs border border-amber-500/30 flex items-center gap-1">
                    <Trophy className="size-3" /> #{myRank}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {members.length} thành viên: {members.map((m) => m.student_name).join(", ")}
              </div>
            </div>
          </div>

          {/* Điểm & Tiến độ */}
          <div className="flex items-center gap-3 text-xs sm:text-sm font-bold">
            <span className="px-3 py-1.5 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center gap-1">
              <Flame className="size-4" /> Điểm: <b>{Number(team?.score || 0).toFixed(2)}</b>
            </span>
            <span className="px-3 py-1.5 rounded-xl bg-muted border">
              Đã làm: <b>{answeredCount}</b>/{questions.length}
            </span>
            <Button
              onClick={() => setConfirmOpen(true)}
              size="sm"
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground font-black text-xs px-3.5 py-1.5 rounded-xl shadow"
            >
              <Send className="size-3.5 mr-1" /> Kết thúc
            </Button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-muted/60">
          <div
            className="h-full bg-gradient-to-r from-primary to-sky-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </header>

      {/* 3. Khu vực câu hỏi thi đấu nhóm */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-5 space-y-4 relative z-10">
        {q && (
          <Card className="p-6 sm:p-8 rounded-3xl border-2 shadow-xl bg-card/95 backdrop-blur">
            <div className="flex items-center justify-between mb-4 pb-3 border-b flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="px-3.5 py-1 rounded-xl bg-primary text-primary-foreground font-black text-sm">
                  CÂU {idx + 1} / {questions.length}
                </span>
                <span className="px-3 py-1 rounded-xl bg-primary/10 text-primary font-bold text-xs">
                  {q._part === 1 ? "PHẦN I • TRẮC NGHIỆM" : q._part === 2 ? "PHẦN II • ĐÚNG/SAI" : "PHẦN III • TRẢ LỜI NGẮN"}
                </span>
              </div>

              {qAns && (
                <div
                  className={`px-3 py-1 rounded-xl text-xs sm:text-sm font-black border ${
                    qAns.is_correct
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-600"
                      : "border-rose-500 bg-rose-500/10 text-rose-600"
                  }`}
                >
                  {qAns.is_correct ? "✅ Nhóm đã trả lời đúng" : "❌ Nhóm đã trả lời sai"}
                  {qAns.answered_by ? ` (bởi ${qAns.answered_by})` : ""}
                </div>
              )}
            </div>

            <div className="font-bold text-xl sm:text-2xl leading-relaxed text-foreground mb-6 question-content">
              <RichText text={q.text} />
            </div>

            {/* Trắc nghiệm 4 lựa chọn A, B, C, D */}
            {q.type === "mc" && (
              <div className="grid sm:grid-cols-2 gap-4">
                {q.options.map((opt: any, i: number) => {
                  const theme = OPTION_THEMES[i % OPTION_THEMES.length];
                  const chosen = qAns ? qAns.answer === opt.key : draft[q.id] === opt.key;

                  return (
                    <button
                      key={opt.key}
                      type="button"
                      disabled={!!qAns}
                      onClick={() => setDraft({ ...draft, [q.id]: opt.key })}
                      className={`text-left flex items-center gap-4 p-4 sm:p-5 rounded-2xl border-2 transition-all select-none ${
                        chosen
                          ? `${theme.activeRing} shadow-md scale-[1.01]`
                          : `${theme.cardBorder} ${theme.cardBg} hover:shadow-md`
                      } disabled:cursor-not-allowed`}
                    >
                      <div
                        className={`size-12 rounded-xl font-black text-xl flex items-center justify-center shrink-0 ${theme.badgeBg}`}
                      >
                        {theme.letter}
                      </div>
                      <span className="flex-1 font-semibold text-base sm:text-lg text-foreground">
                        <RichText text={opt.text} />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Đúng / Sai */}
            {q.type === "tf" && (
              <div className="space-y-3">
                {q.items.map((it: any, i: number) => {
                  const cur = qAns ? qAns.answer?.[it.key] : draft[q.id]?.[it.key];
                  const label = String.fromCharCode(97 + i);

                  return (
                    <div
                      key={it.key}
                      className="rounded-2xl border-2 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card"
                    >
                      <div className="flex items-start gap-3 flex-1">
                        <span className="size-8 rounded-lg bg-muted border font-black text-sm flex items-center justify-center shrink-0">
                          {label})
                        </span>
                        <span className="font-semibold text-base flex-1">
                          <RichText text={it.text} />
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        <button
                          type="button"
                          disabled={!!qAns}
                          onClick={() => setTF(it.key, true)}
                          className={`px-5 py-2 rounded-xl font-black text-sm border-2 transition-all ${
                            cur === true
                              ? "border-emerald-500 bg-emerald-500 text-white shadow-md scale-105"
                              : "border-border hover:bg-muted"
                          }`}
                        >
                          ĐÚNG
                        </button>
                        <button
                          type="button"
                          disabled={!!qAns}
                          onClick={() => setTF(it.key, false)}
                          className={`px-5 py-2 rounded-xl font-black text-sm border-2 transition-all ${
                            cur === false
                              ? "border-rose-500 bg-rose-500 text-white shadow-md scale-105"
                              : "border-border hover:bg-muted"
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

            {/* Trả lời ngắn */}
            {q.type === "sa" && (
              <div className="mt-4">
                <Label className="font-bold text-base block mb-2">Đáp án của nhóm:</Label>
                <Input
                  value={qAns ? String(qAns.answer ?? "") : draft[q.id] || ""}
                  disabled={!!qAns}
                  onChange={(e) => setDraft({ ...draft, [q.id]: e.target.value })}
                  className="h-14 text-xl font-black rounded-2xl px-5 border-2"
                  placeholder="Nhập câu trả lời hoặc số liệu của nhóm..."
                />
              </div>
            )}

            {/* Điều hướng và Nút trả lời */}
            <div className="mt-6 pt-4 border-t flex items-center justify-between gap-3">
              <Button
                variant="outline"
                size="lg"
                onClick={() => setIdx(Math.max(0, idx - 1))}
                disabled={idx === 0}
                className="rounded-2xl font-bold"
              >
                <ChevronLeft className="size-4 mr-1" /> Câu trước
              </Button>

              {!qAns ? (
                <Button
                  onClick={submitAnswer}
                  disabled={sending}
                  size="lg"
                  className="rounded-2xl font-black px-6 bg-gradient-to-r from-primary to-sky-600 text-white shadow-lg"
                >
                  {sending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Send className="size-4 mr-2" />}
                  Trả lời cho nhóm
                </Button>
              ) : (
                <div className="text-xs sm:text-sm text-muted-foreground font-bold">
                  ✓ Câu này nhóm đã ghi nhận đáp án
                </div>
              )}

              <Button
                variant="outline"
                size="lg"
                onClick={() => setIdx(Math.min(questions.length - 1, idx + 1))}
                disabled={idx >= questions.length - 1}
                className="rounded-2xl font-bold"
              >
                Câu sau <ChevronRight className="size-4 ml-1" />
              </Button>
            </div>
          </Card>
        )}

        {/* Trạng thái làm bài của nhóm */}
        <Card className="p-5 rounded-3xl border-2 shadow-md bg-card/95 backdrop-blur">
          <div className="flex items-center justify-between mb-3">
            <span className="font-black text-sm text-foreground">Trạng thái các câu ({answeredCount}/{questions.length})</span>
            <span className="text-xs text-muted-foreground">Nhấn để chuyển nhanh</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {questions.map((qq, i) => {
              const a = answers[qq.id];
              return (
                <button
                  key={qq.id}
                  onClick={() => setIdx(i)}
                  className={`size-9 rounded-xl border-2 text-sm font-black transition-all ${
                    a
                      ? a.is_correct
                        ? "border-emerald-500 bg-emerald-500 text-white shadow-sm"
                        : "border-rose-500 bg-rose-500 text-white shadow-sm"
                      : "border-border hover:bg-muted text-muted-foreground"
                  } ${i === idx ? "ring-2 ring-primary ring-offset-2 scale-105" : ""}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </Card>

        {/* Bảng xếp hạng trực tiếp */}
        {cfg.leaderboard && (
          <Card className="p-5 rounded-3xl border-2 shadow-md bg-card/95 backdrop-blur">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 font-black text-sm">
                <Trophy className="size-4 text-primary" /> Bảng xếp hạng thời gian thực
              </div>
              <Link to={`/leaderboard/${id}`} target="_blank" className="text-xs font-bold text-primary hover:underline">
                Màn hình lớn ↗
              </Link>
            </div>
            <LeaderboardBoard teams={teams} totalQuestions={questions.length} />
          </Card>
        )}
      </main>
    </div>
  );
}
