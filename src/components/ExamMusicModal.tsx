import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Music, Save } from "lucide-react";
import ExamMusicManager, { TeamMusicConfig, DEFAULT_MUSIC_CONFIG } from "./ExamMusicManager";
import { normalizeTeamConfig, TeamConfig } from "./TeamModeSettings";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ExamMusicModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exam: {
    id: string;
    title: string;
    team_config?: any;
    display_mode?: string;
  } | null;
  onSaved?: () => void;
}

export default function ExamMusicModal({
  open,
  onOpenChange,
  exam,
  onSaved,
}: ExamMusicModalProps) {
  const [musicConfig, setMusicConfig] = useState<TeamMusicConfig>(DEFAULT_MUSIC_CONFIG);
  const [fullTeamConfig, setFullTeamConfig] = useState<TeamConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!exam) return;
    const normalized = normalizeTeamConfig(exam.team_config);
    setFullTeamConfig(normalized);
    setMusicConfig(normalized.music || DEFAULT_MUSIC_CONFIG);
  }, [exam, open]);

  const handleSave = async () => {
    if (!exam) return;
    try {
      setSaving(true);
      const baseTeamConfig = fullTeamConfig || normalizeTeamConfig(exam.team_config);
      const updatedTeamConfig: TeamConfig = {
        ...baseTeamConfig,
        music: musicConfig,
      };

      const { error } = await supabase
        .from("exams")
        .update({
          team_config: updatedTeamConfig as any,
        } as any)
        .eq("id", exam.id);

      if (error) throw error;

      toast.success(
        musicConfig.customName
          ? `Đã lưu nhạc "${musicConfig.customName}" cho bài thi "${exam.title}"!`
          : musicConfig.useDefault
          ? `Đã chọn nhạc mặc định cho bài thi "${exam.title}"!`
          : `Đã cập nhật cài đặt nhạc cho bài thi "${exam.title}"!`
      );

      onOpenChange(false);
      if (onSaved) onSaved();
    } catch (err: any) {
      toast.error("Không thể lưu cài đặt nhạc: " + (err?.message || "Lỗi kết nối"));
    } finally {
      setSaving(false);
    }
  };

  if (!exam) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl p-5 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-xl font-extrabold flex items-center gap-2 text-foreground">
            <span className="p-2 rounded-xl bg-pink-500/10 text-pink-600 dark:text-pink-400">
              <Music className="size-5" />
            </span>
            Quản lý nhạc nền bài thi & hoạt động
          </DialogTitle>
          <DialogDescription className="text-sm">
            Tải lên, phát thử và tùy chỉnh nhạc nền riêng cho bài thi:{" "}
            <span className="font-semibold text-foreground">{exam.title}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <ExamMusicManager
            value={musicConfig}
            onChange={setMusicConfig}
            examId={exam.id}
            examTitle={exam.title}
          />
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-end gap-2 pt-2 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="rounded-xl"
          >
            Đóng
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-gradient-to-r from-pink-600 via-rose-600 to-indigo-600 hover:opacity-95 text-white font-bold shadow-md shadow-pink-500/20 px-5"
          >
            {saving ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Save className="size-4 mr-2" />
            )}
            Lưu cài đặt nhạc
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
