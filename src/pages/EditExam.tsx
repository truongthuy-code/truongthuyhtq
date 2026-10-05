import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_SCORING, ScoringConfig } from "@/lib/grading";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import LockModeSettings from "@/components/LockModeSettings";
import { DEFAULT_LOCK, LockMode } from "@/hooks/useExamLock";
import ScheduleSettings, { Schedule } from "@/components/ScheduleSettings";
import TeamModeSettings, { DEFAULT_TEAM_CONFIG, TeamConfig, normalizeTeamConfig } from "@/components/TeamModeSettings";
import { useAuth } from "@/hooks/useAuth";
import { syncExamAssignmentCodes } from "@/lib/examAssignments";
import { withSupabaseAuthRetry } from "@/lib/supabaseAuthSync";
import { getLocalStoredExams, saveUnifiedExam } from "@/lib/allExamsStorage";

export default function EditExam() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(45);
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [shuffleQ, setShuffleQ] = useState({ p1: false, p2: false, p3: false });
  const [shuffleO, setShuffleO] = useState({ p1: false, p2: false, p3: false });
  const [scoring, setScoring] = useState<ScoringConfig>(DEFAULT_SCORING);
  const [allowReview, setAllowReview] = useState(false);
  const [displayMode, setDisplayMode] = useState<"standard" | "quizizz" | "team">("standard");
  const [teamConfig, setTeamConfig] = useState<TeamConfig>(DEFAULT_TEAM_CONFIG);
  const [instantFeedback, setInstantFeedback] = useState(false);
  const [lockMode, setLockMode] = useState<LockMode>(DEFAULT_LOCK);
  const [schedule, setSchedule] = useState<Schedule>({ open_at: null, close_at: null, auto_submit_on_close: true });

  useEffect(() => {
    if (!id) return;
    (async () => {
      let examData: any = null;
      try {
        const { data, error } = await supabase.from("exams").select("*").eq("id", id).maybeSingle();
        if (!error && data) examData = data;
      } catch {}

      if (!examData) {
        // Fallback to local unified exams store
        const localList = getLocalStoredExams();
        const found = localList.find((e) => e.id === id);
        if (found) examData = found;
      }

      if (!examData) {
        toast.error("Không tải được đề thi");
        navigate("/");
        return;
      }

      if (!isAdmin && user && examData.created_by && examData.created_by !== user.id) {
        toast.error("Bạn không có quyền chỉnh sửa đề thi của giáo viên khác");
        navigate("/");
        return;
      }

      setTitle(examData.title);
      setDuration(examData.duration_minutes || 45);
      setMaxAttempts(examData.max_attempts || 1);
      setShuffleQ({ p1: !!examData.shuffle_q_p1, p2: !!examData.shuffle_q_p2, p3: !!examData.shuffle_q_p3 });
      setShuffleO({ p1: !!examData.shuffle_o_p1, p2: !!examData.shuffle_o_p2, p3: !!examData.shuffle_o_p3 });
      setScoring((examData.scoring as any) || DEFAULT_SCORING);
      setAllowReview(!!examData.allow_review);
      setDisplayMode(((examData as any).display_mode as "standard" | "quizizz" | "team") || "standard");
      setTeamConfig(normalizeTeamConfig((examData as any).team_config));
      setInstantFeedback(!!(examData as any).instant_feedback);
      setLockMode({ ...DEFAULT_LOCK, ...((examData as any).lock_mode || {}) });
      setSchedule({
        open_at: (examData as any).open_at ?? null,
        close_at: (examData as any).close_at ?? null,
        auto_submit_on_close: (examData as any).auto_submit_on_close ?? true,
      });
      setLoading(false);
    })();
  }, [id, navigate, isAdmin, user]);

  const onSave = async () => {
    if (!id) return;
    setSaving(true);
    const updates = {
      title,
      duration_minutes: duration,
      max_attempts: maxAttempts,
      shuffle_questions: shuffleQ.p1 || shuffleQ.p2 || shuffleQ.p3,
      shuffle_options: shuffleO.p1 || shuffleO.p2 || shuffleO.p3,
      shuffle_q_p1: shuffleQ.p1, shuffle_q_p2: shuffleQ.p2, shuffle_q_p3: shuffleQ.p3,
      shuffle_o_p1: shuffleO.p1, shuffle_o_p2: shuffleO.p2, shuffle_o_p3: shuffleO.p3,
      scoring: scoring as any,
      allow_review: allowReview,
      display_mode: displayMode,
      instant_feedback: (displayMode === "standard" || displayMode === "quizizz") ? instantFeedback : false,
      team_config: teamConfig as any,
      lock_mode: lockMode as any,
      open_at: schedule.open_at,
      close_at: schedule.close_at,
      auto_submit_on_close: schedule.auto_submit_on_close,
    };

    try {
      await withSupabaseAuthRetry(async () => {
        return await supabase.from("exams").update(updates as any).eq("id", id);
      }, user as any);
    } catch (err: any) {
      console.warn("Supabase update error:", err);
    }

    // Save to unified local store as well
    const localList = getLocalStoredExams();
    const existing = localList.find((e) => e.id === id);
    saveUnifiedExam({
      ...(existing || { id, created_at: new Date().toISOString() }),
      ...updates,
    } as any);

    syncExamAssignmentCodes({
      id,
      title,
      duration_minutes: duration,
      open_at: schedule.open_at,
      close_at: schedule.close_at,
      team_config: teamConfig as any,
    }).catch(() => {});

    setSaving(false);
    toast.success("Đã lưu cài đặt đề thi thành công!");
    navigate(isAdmin ? "/admin" : "/");
  };

  if (loading) return <div className="min-h-screen grid place-items-center text-muted-foreground">Đang tải…</div>;

  return (
    <div className="min-h-screen bg-gradient-soft">
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="container flex items-center justify-between py-4">
          <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Trang chủ
          </Link>
          <div className="font-semibold">Sửa cài đặt đề thi</div>
          <div />
        </div>
      </header>

      <main className="container max-w-3xl py-10">
        <Card className="p-6 space-y-5">
          <div>
            <Label>Tên đề thi</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Thời gian (phút)</Label>
              <Input type="number" min={1} value={duration} onChange={(e) => setDuration(+e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Số lần được làm</Label>
              <Input type="number" min={1} value={maxAttempts} onChange={(e) => setMaxAttempts(+e.target.value)} className="mt-1" />
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium mb-2">Xáo thứ tự câu hỏi theo phần</div>
              <div className="grid grid-cols-3 gap-3">
                {(["p1","p2","p3"] as const).map((k, i) => (
                  <div key={k} className="flex items-center justify-between rounded-md border p-2">
                    <Label htmlFor={`sq-${k}`} className="text-xs">Phần {["I","II","III"][i]}</Label>
                    <Switch id={`sq-${k}`} checked={shuffleQ[k]} onCheckedChange={(v) => setShuffleQ({ ...shuffleQ, [k]: v })} />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium mb-2">Xáo thứ tự đáp án theo phần</div>
              <div className="grid grid-cols-3 gap-3">
                {(["p1","p2","p3"] as const).map((k, i) => (
                  <div key={k} className="flex items-center justify-between rounded-md border p-2">
                    <Label htmlFor={`so-${k}`} className="text-xs">Phần {["I","II","III"][i]}</Label>
                    <Switch id={`so-${k}`} checked={shuffleO[k]} onCheckedChange={(v) => setShuffleO({ ...shuffleO, [k]: v })} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-4 bg-muted/30">
            <div className="text-sm font-medium">Cài đặt điểm</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Phần I — điểm / câu</Label>
                <Input type="number" step="0.05" min={0} value={scoring.p1}
                  onChange={(e) => setScoring({ ...scoring, p1: +e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Phần III — điểm / câu</Label>
                <Input type="number" step="0.05" min={0} value={scoring.p3}
                  onChange={(e) => setScoring({ ...scoring, p3: +e.target.value })} className="mt-1" />
              </div>
            </div>
            <div>
              <div className="text-xs font-medium mb-1">Phần II — điểm theo số ý đúng</div>
              <div className="grid grid-cols-4 gap-2">
                {(["1","2","3","4"] as const).map((k) => (
                  <div key={k}>
                    <Label className="text-xs">Đúng {k} ý</Label>
                    <Input type="number" step="0.05" min={0} value={scoring.p2[k]}
                      onChange={(e) => setScoring({ ...scoring, p2: { ...scoring.p2, [k]: +e.target.value } })}
                      className="mt-1" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-lg border p-4 space-y-2">
            <Label className="text-sm font-medium">🖥️ Hình thức hiển thị bài kiểm tra</Label>
            <Select value={displayMode} onValueChange={(v) => setDisplayMode(v as "standard" | "quizizz" | "team")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Chế độ tiêu chuẩn (Hiển thị toàn bộ câu hỏi)</SelectItem>
                <SelectItem value="quizizz">Chế độ từng câu hỏi (Quizizz Mode)</SelectItem>
                  <SelectItem value="team">Chế độ Đội/Nhóm (thi đấu theo nhóm)</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground">
              Tiêu chuẩn: học sinh thấy toàn bộ câu, được phép quay lại sửa.
              Quizizz: mỗi lần 1 câu, không quay lại, tự lưu tiến độ.
            </div>

            {displayMode === "team" && (
              <div className="mt-3">
                <TeamModeSettings value={teamConfig} onChange={setTeamConfig} examId={id} />
              </div>
            )}

            {(displayMode === "standard" || displayMode === "quizizz") && (
              <div className="flex items-center justify-between rounded-xl border-2 p-3.5 mt-3 bg-card shadow-xs">
                <div className="pr-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Label htmlFor="instant-fb" className="text-sm font-bold text-foreground cursor-pointer">
                      💬 Hiển thị đáp án và giải thích ngay sau khi học sinh trả lời
                    </Label>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-black tracking-wide border ${
                      instantFeedback
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                        : "bg-muted text-muted-foreground border-border"
                    }`}>
                      {instantFeedback ? "BẬT" : "TẮT"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Khi bật, học sinh sẽ được xem kết quả đúng/sai, đáp án đúng và lời giải ngay sau khi trả lời từng câu hỏi (hoạt động cho cả trắc nghiệm 4 lựa chọn, Đúng/Sai và trả lời ngắn).
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-bold text-muted-foreground hidden sm:inline">
                    {instantFeedback ? "BẬT" : "TẮT"}
                  </span>
                  <Switch id="instant-fb" checked={instantFeedback} onCheckedChange={setInstantFeedback} />
                </div>
              </div>
            )}
          </div>

          <ScheduleSettings value={schedule} onChange={setSchedule} />

          <LockModeSettings value={lockMode} onChange={setLockMode} />


          <div className="flex items-center justify-between rounded-xl border border-border/80 bg-card p-4 hover:border-primary/40 transition-colors">
            <div className="space-y-1 pr-4">
              <div className="flex items-center gap-2">
                <Label htmlFor="allow-review" className="text-sm font-bold text-foreground cursor-pointer flex items-center gap-1.5">
                  <span>👁️</span>
                  <span>Xem lại đáp án sau khi nộp bài</span>
                </Label>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${allowReview ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/30" : "bg-muted text-muted-foreground border"}`}>
                  {allowReview ? "BẬT" : "TẮT"}
                </span>
              </div>
              <div className="text-xs text-muted-foreground leading-relaxed">
                {allowReview
                  ? "Học sinh sẽ được xem lại toàn bộ câu hỏi, đáp án đã chọn, đáp án đúng và giải thích chi tiết sau khi nộp bài."
                  : "Học sinh chỉ xem được điểm tổng kết và số câu đúng/sai. Toàn bộ nội dung câu hỏi và đáp án sẽ được bảo mật."}
              </div>
            </div>
            <Switch id="allow-review" checked={allowReview} onCheckedChange={setAllowReview} />
          </div>

          <Button onClick={onSave} disabled={saving || !title} className="w-full bg-gradient-primary">
            {saving ? <Loader2 className="size-4 animate-spin mr-2" /> : <Save className="size-4 mr-2" />}
            Lưu cài đặt
          </Button>
        </Card>
      </main>
    </div>
  );
}
