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

export default function EditExam() {
  const { id } = useParams();
  const navigate = useNavigate();
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
    supabase.from("exams").select("*").eq("id", id).single().then(({ data, error }) => {
      if (error || !data) { toast.error("Không tải được đề"); navigate("/"); return; }
      setTitle(data.title);
      setDuration(data.duration_minutes);
      setMaxAttempts(data.max_attempts);
      setShuffleQ({ p1: data.shuffle_q_p1, p2: data.shuffle_q_p2, p3: data.shuffle_q_p3 });
      setShuffleO({ p1: data.shuffle_o_p1, p2: data.shuffle_o_p2, p3: data.shuffle_o_p3 });
      setScoring((data.scoring as any) || DEFAULT_SCORING);
      setAllowReview(data.allow_review);
      setDisplayMode(((data as any).display_mode as "standard" | "quizizz" | "team") || "standard");
      setTeamConfig(normalizeTeamConfig((data as any).team_config));
      setInstantFeedback(!!(data as any).instant_feedback);
      setLockMode({ ...DEFAULT_LOCK, ...((data as any).lock_mode || {}) });
      setSchedule({
        open_at: (data as any).open_at ?? null,
        close_at: (data as any).close_at ?? null,
        auto_submit_on_close: (data as any).auto_submit_on_close ?? true,
      });
      setLoading(false);
    });
  }, [id, navigate]);

  const onSave = async () => {
    if (!id) return;
    setSaving(true);
    const { error } = await supabase.from("exams").update({
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
      instant_feedback: displayMode === "quizizz" ? instantFeedback : false,
        team_config: teamConfig as any,
      lock_mode: lockMode as any,
      open_at: schedule.open_at,
      close_at: schedule.close_at,
      auto_submit_on_close: schedule.auto_submit_on_close,
    } as any).eq("id", id);
    setSaving(false);
    if (error) { toast.error("Lỗi lưu: " + error.message); return; }
    toast.success("Đã lưu cài đặt");
    navigate("/");
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

            {displayMode === "quizizz" && (
              <div className="flex items-center justify-between rounded-lg border p-3 mt-3 bg-background">
                <div className="pr-3">
                  <Label htmlFor="instant-fb" className="text-sm font-medium">💬 Hiển thị đáp án và giải thích ngay sau khi học sinh trả lời</Label>
                  <div className="text-xs text-muted-foreground mt-1">
                    Khi bật, học sinh sẽ được xem kết quả đúng/sai, đáp án đúng và lời giải ngay sau khi trả lời từng câu hỏi.
                  </div>
                </div>
                <Switch id="instant-fb" checked={instantFeedback} onCheckedChange={setInstantFeedback} />
              </div>
            )}
          </div>

          <ScheduleSettings value={schedule} onChange={setSchedule} />

          <LockModeSettings value={lockMode} onChange={setLockMode} />


          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label htmlFor="allow-review" className="text-sm font-medium">👁️ Cho phép xem lại đáp án sau khi nộp bài</Label>
              <div className="text-xs text-muted-foreground mt-1">
                Khi bật: học sinh thấy toàn bộ câu hỏi và đáp án đúng. Khi tắt: chỉ thấy điểm.
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
