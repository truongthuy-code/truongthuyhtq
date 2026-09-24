import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import RichText from "@/components/RichText";
import { normalizeTeamConfig } from "@/components/TeamModeSettings";
import { LeaderboardBoard, rankTeams, LbTeam } from "./TeamLeaderboard";
import {
  ChevronLeft, ChevronRight, Users, Trophy, Send, CheckCircle2, Loader2,
} from "lucide-react";

type Q = any;

function flatten(questions: any): Q[] {
  const out: Q[] = [];
  (questions?.partI || []).forEach((q: any) => out.push({ ...q, type: "mc", _part: 1 }));
  (questions?.partII || []).forEach((q: any) => out.push({ ...q, type: "tf", _part: 2 }));
  (questions?.partIII || []).forEach((q: any) => out.push({ ...q, type: "sa", _part: 3 }));
  return out;
}

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
    if (error) { toast.error(error.message); return; }
    setState(data);
    if ((data as any)?.team?.finished_at) setFinished(true);
  }, []);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("get_exam_for_student", { p_exam_id: id! });
      if (error) { toast.error("Không tải được đề: " + error.message); return; }
      setExam(data);
    })();
    loadLb();
  }, [id, loadLb]);

  // Khôi phục phiên của thành viên khi mất kết nối / tải lại trang
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
    } catch { /* ignore */ }
  }, [storageKey, loadState]);

  // Đồng bộ thời gian thực trong nhóm + bảng xếp hạng
  useEffect(() => {
    if (!teamId) return;
    const ch = supabase
      .channel(`team-${teamId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_answers", filter: `team_id=eq.${teamId}` }, () => loadState(teamId))
      .on("postgres_changes", { event: "*", schema: "public", table: "exam_teams", filter: `exam_id=eq.${id}` }, () => { loadState(teamId); loadLb(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "team_members", filter: `exam_id=eq.${id}` }, () => { loadState(teamId); loadLb(); })
      .subscribe();
    const t = setInterval(() => { loadState(teamId); loadLb(); }, 6000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [teamId, id, loadState, loadLb]);

  const join = async () => {
    const tName = (customTeam || pickTeam).trim();
    if (!name.trim() || !klass.trim() || !tName) { toast.error("Nhập đủ Tên, Lớp và Nhóm"); return; }
    setJoining(true);
    const { data, error } = await supabase.rpc("team_join", {
      p_exam_id: id!, p_team_name: tName, p_student_name: name.trim(), p_student_class: klass.trim(),
    } as any);
    setJoining(false);
    if (error) { toast.error(error.message); return; }
    const tid = (data as any).team_id as string;
    setTeamId(tid);
    setTeamName((data as any).team_name);
    localStorage.setItem(storageKey, JSON.stringify({ teamId: tid, teamName: (data as any).team_name, name: name.trim(), klass: klass.trim() }));
    loadState(tid);
    loadLb();
    toast.success(`Đã tham gia ${(data as any).team_name}`);
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
      toast.error("Chưa chọn/nhập câu trả lời"); return;
    }
    setSending(true);
    const { error } = await supabase.rpc("team_answer_question", {
      p_team_id: teamId, p_question_id: q.id, p_answer: val as any, p_student_name: name,
    } as any);
    setSending(false);
    if (error) { toast.error(error.message); loadState(teamId); return; }
    await loadState(teamId);
    loadLb();
  };

  const finish = async () => {
    if (!teamId) return;
    await supabase.rpc("team_finish", { p_team_id: teamId } as any);
    setFinished(true);
    loadLb();
    music.playVictory();
  };

  if (!exam) return <div className="min-h-screen grid place-items-center text-muted-foreground">Đang tải…</div>;

  if (exam.status && exam.status !== "open") {
    return (
      <div className="min-h-screen grid place-items-center p-4">
        <Card className="p-10 text-center max-w-md">
          <div className="text-4xl mb-3">⏳</div>
          <h2 className="text-xl font-bold">{exam.status === "not_open" ? "Đề thi chưa được mở" : "Đề thi đã đóng"}</h2>
        </Card>
      </div>
    );
  }

  // ===== Màn hình tham gia nhóm =====
  if (!teamId) {
    const teamNames: string[] = [
      ...cfg.teams.map((t) => t.name),
      ...((lb?.teams || []) as LbTeam[]).map((t) => t.name),
    ].filter((v, i, a) => v && a.indexOf(v) === i);

    return (
      <div className="min-h-screen bg-gradient-soft grid place-items-center p-4">
        <Card className="p-8 w-full max-w-md space-y-4">
          <div className="text-center">
            <div className="text-4xl mb-2">🤝</div>
            <h1 className="text-2xl font-black">{exam.title}</h1>
            <p className="text-muted-foreground text-sm mt-1">Chế độ thi đấu Đội/Nhóm</p>
          </div>
          <div>
            <Label>Họ và tên</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" placeholder="Nguyễn Văn A" />
          </div>
          <div>
            <Label>Lớp</Label>
            <Input value={klass} onChange={(e) => setKlass(e.target.value)} className="mt-1" placeholder="12A1" />
          </div>
          {teamNames.length > 0 && (
            <div>
              <Label>Chọn nhóm</Label>
              <Select value={pickTeam} onValueChange={(v) => { setPickTeam(v); setCustomTeam(""); }}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="— Chọn nhóm —" /></SelectTrigger>
                <SelectContent>
                  {teamNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Hoặc nhập tên nhóm mới</Label>
            <Input value={customTeam} onChange={(e) => { setCustomTeam(e.target.value); setPickTeam(""); }} className="mt-1" placeholder="Tên nhóm" />
          </div>
          <Button onClick={join} disabled={joining} className="w-full" size="lg">
            {joining ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Users className="size-4 mr-2" />} THAM GIA
          </Button>
          {cfg.leaderboard && (
            <Link to={`/leaderboard/${id}`} className="block text-center text-sm text-primary hover:underline">
              Xem bảng xếp hạng
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

  // ===== Kết thúc =====
  if (finished || ended) {
    return (
      <div className="min-h-screen bg-gradient-soft p-4">
        <div className="container max-w-3xl py-8 space-y-6">
          <Card className="p-8 text-center">
            <CheckCircle2 className="size-14 text-success mx-auto mb-3" />
            <h2 className="text-2xl font-black">Nhóm {teamName} đã hoàn thành!</h2>
            <div className="mt-2 text-lg">
              Điểm: <b className="text-primary">{Number(team?.score || 0).toFixed(2)}</b> · Câu đúng: <b>{team?.correct_count || 0}</b>
            </div>
            {myRank > 0 && <div className="mt-1 text-muted-foreground">Hạng hiện tại: #{myRank}</div>}
          </Card>
          <Card className="p-6">
            <div className="flex items-center gap-2 font-bold mb-4"><Trophy className="size-5 text-primary" /> BẢNG XẾP HẠNG</div>
            <LeaderboardBoard teams={teams} totalQuestions={questions.length} ended={ended} />
          </Card>
        </div>
      </div>
    );
  }

  const pct = questions.length ? Math.round((answeredCount / questions.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-gradient-soft flex flex-col">
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="container py-3 space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 font-bold truncate">
              <Users className="size-4 text-primary" /> {teamName}
              <span className="text-xs font-normal text-muted-foreground">({members.length} thành viên)</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span>Câu <b>{idx + 1}</b>/{questions.length}</span>
              <span>Đã trả lời <b>{answeredCount}</b></span>
              <span>Điểm <b className="text-primary">{Number(team?.score || 0).toFixed(2)}</b></span>
              {myRank > 0 && <span>Hạng <b>#{myRank}</b></span>}
            </div>
          </div>
          <Progress value={pct} className="h-2" />
        </div>
      </header>

      <main className="flex-1 container max-w-3xl py-6 space-y-4">
        {q && (
          <Card className="p-6 sm:p-8">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs font-semibold px-2 py-0.5 rounded bg-primary/10 text-primary">
                {q._part === 1 ? "PHẦN I — Trắc nghiệm" : q._part === 2 ? "PHẦN II — Đúng/Sai" : "PHẦN III — Trả lời ngắn"}
              </div>
              {qAns && (
                <div className={`text-sm font-bold ${qAns.is_correct ? "text-success" : "text-destructive"}`}>
                  {qAns.is_correct ? "✅ Nhóm trả lời đúng" : "❌ Nhóm trả lời sai"}
                  {qAns.answered_by ? ` — ${qAns.answered_by}` : ""}
                </div>
              )}
            </div>

            <div className="font-semibold text-lg sm:text-xl leading-relaxed">
              <RichText text={q.text} />
            </div>

            {q.type === "mc" && (
              <div className="mt-6 grid sm:grid-cols-2 gap-3">
                {q.options.map((opt: any, i: number) => {
                  const chosen = qAns ? qAns.answer === opt.key : draft[q.id] === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      disabled={!!qAns}
                      onClick={() => setDraft({ ...draft, [q.id]: opt.key })}
                      className={`text-left flex items-start gap-3 p-4 rounded-xl border-2 transition ${
                        chosen ? "border-primary bg-primary/10" : "hover:bg-muted"
                      } disabled:cursor-not-allowed`}
                    >
                      <b>{String.fromCharCode(65 + i)}.</b>
                      <span className="flex-1"><RichText text={opt.text} /></span>
                    </button>
                  );
                })}
              </div>
            )}

            {q.type === "tf" && (
              <div className="mt-6 space-y-3">
                {q.items.map((it: any, i: number) => {
                  const cur = qAns ? qAns.answer?.[it.key] : draft[q.id]?.[it.key];
                  return (
                    <div key={it.key} className="rounded-xl border-2 p-4 flex flex-col sm:flex-row sm:items-start gap-3">
                      <div className="flex items-center gap-2 shrink-0">
                        <button type="button" disabled={!!qAns} onClick={() => setTF(it.key, true)}
                          className={`px-4 py-2 rounded-lg border-2 font-semibold transition ${cur === true ? "border-success bg-success/10 text-success" : "hover:bg-muted"}`}>
                          Đúng
                        </button>
                        <button type="button" disabled={!!qAns} onClick={() => setTF(it.key, false)}
                          className={`px-4 py-2 rounded-lg border-2 font-semibold transition ${cur === false ? "border-destructive bg-destructive/10 text-destructive" : "hover:bg-muted"}`}>
                          Sai
                        </button>
                      </div>
                      <span className="flex-1"><b className="mr-2">{String.fromCharCode(97 + i)})</b><RichText text={it.text} /></span>
                    </div>
                  );
                })}
              </div>
            )}

            {q.type === "sa" && (
              <div className="mt-6">
                <Label>Đáp án của nhóm</Label>
                <Input
                  value={qAns ? String(qAns.answer ?? "") : (draft[q.id] || "")}
                  disabled={!!qAns}
                  onChange={(e) => setDraft({ ...draft, [q.id]: e.target.value })}
                  className="mt-2 h-12 text-lg"
                  placeholder="Nhập đáp án…"
                />
              </div>
            )}

            <div className="mt-6 flex items-center justify-between gap-3">
              <Button variant="outline" onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0}>
                <ChevronLeft className="size-4 mr-1" /> Câu trước
              </Button>
              {!qAns ? (
                <Button onClick={submitAnswer} disabled={sending}>
                  {sending ? <Loader2 className="size-4 mr-2 animate-spin" /> : null} Trả lời cho nhóm
                </Button>
              ) : (
                <div className="text-sm text-muted-foreground">Câu này nhóm đã trả lời</div>
              )}
              <Button variant="outline" onClick={() => setIdx(Math.min(questions.length - 1, idx + 1))} disabled={idx >= questions.length - 1}>
                Câu sau <ChevronRight className="size-4 ml-1" />
              </Button>
            </div>
          </Card>
        )}

        <Card className="p-4">
          <div className="text-sm font-semibold mb-2">Trạng thái làm bài của nhóm</div>
          <div className="flex flex-wrap gap-2">
            {questions.map((qq, i) => {
              const a = answers[qq.id];
              return (
                <button
                  key={qq.id}
                  onClick={() => setIdx(i)}
                  className={`size-9 rounded-lg border-2 text-sm font-semibold transition ${
                    a ? (a.is_correct ? "border-success bg-success/15" : "border-destructive bg-destructive/15") : "hover:bg-muted"
                  } ${i === idx ? "ring-2 ring-primary" : ""}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          <div className="text-xs text-muted-foreground mt-3">
            Thành viên: {members.map((m) => m.student_name).join(", ") || "—"}
          </div>
        </Card>

        {cfg.leaderboard && (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 font-semibold"><Trophy className="size-4 text-primary" /> Bảng xếp hạng</div>
              <Link to={`/leaderboard/${id}`} target="_blank" className="text-xs text-primary hover:underline">Mở màn hình lớn</Link>
            </div>
            <LeaderboardBoard teams={teams} totalQuestions={questions.length} />
          </Card>
        )}

        <div className="pb-10">
          <Button onClick={finish} size="lg" className="w-full bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold">
            <Send className="size-4 mr-2" /> {allDone ? "HOÀN THÀNH" : "KẾT THÚC BÀI CỦA NHÓM"}
          </Button>
        </div>
      </main>
    </div>
  );
}
