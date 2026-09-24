import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Music,
  Upload,
  Play,
  Pause,
  Repeat,
  Volume2,
  Trash2,
  Radio,
  FileAudio,
  CheckCircle2,
  Sparkles,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { uploadExamBattleMusic, resolvePlayableAudioUrl } from "@/lib/audioStorage";

export type TeamMusicConfig = {
  enabled: boolean;
  volume: number;
  loop?: boolean;
  useDefault?: boolean;
  customName?: string | null;
  customUrl?: string | null;
  idbKey?: string | null;
};

export const DEFAULT_MUSIC_CONFIG: TeamMusicConfig = {
  enabled: false,
  volume: 0.4,
  loop: true,
  useDefault: false,
  customName: null,
  customUrl: null,
  idbKey: null,
};

interface ExamMusicManagerProps {
  value: TeamMusicConfig;
  onChange: (v: TeamMusicConfig) => void;
  examId?: string;
  examTitle?: string;
  className?: string;
  compact?: boolean;
}

export default function ExamMusicManager({
  value,
  onChange,
  examId = "temp",
  examTitle,
  className = "",
  compact = false,
}: ExamMusicManagerProps) {
  const music = value || DEFAULT_MUSIC_CONFIG;

  const [uploading, setUploading] = useState(false);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Dọn dẹp audio preview khi component unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }
    };
  }, []);

  const updateMusic = (patch: Partial<TeamMusicConfig>) => {
    onChange({
      ...music,
      ...patch,
    });
  };

  // Tải file nhạc lên
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const nameLower = file.name.toLowerCase();
    const isSupported =
      nameLower.endsWith(".mp3") ||
      nameLower.endsWith(".wav") ||
      nameLower.endsWith(".m4a") ||
      nameLower.endsWith(".ogg") ||
      file.type.startsWith("audio/");

    if (!isSupported) {
      toast.error("Vui lòng chọn file âm thanh định dạng MP3, WAV hoặc M4A");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      toast.error("Dung lượng file nhạc không được vượt quá 25MB");
      return;
    }

    try {
      setUploading(true);
      if (audioRef.current) {
        audioRef.current.pause();
        setIsPlayingPreview(false);
      }

      const res = await uploadExamBattleMusic(examId, file);
      updateMusic({
        enabled: true,
        useDefault: false,
        customName: file.name,
        customUrl: res.url,
        idbKey: res.idbKey,
      });
      toast.success(`Đã chọn nhạc "${file.name}" cho bài thi!`);
    } catch (err: any) {
      toast.error("Không thể tải file nhạc: " + (err?.message || "Lỗi không xác định"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Phát thử hoặc dừng phát thử
  const togglePreview = async () => {
    if (isPlayingPreview) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setIsPlayingPreview(false);
      return;
    }

    // Nếu có file tùy chỉnh
    if (music.customUrl || music.idbKey) {
      const url = await resolvePlayableAudioUrl(music.customUrl || undefined, music.idbKey || undefined);
      if (!url) {
        toast.error("Không tìm thấy file nhạc để phát thử");
        return;
      }

      if (!audioRef.current) {
        audioRef.current = new Audio();
        audioRef.current.onended = () => {
          if (!music.loop) {
            setIsPlayingPreview(false);
          }
        };
      }

      const audio = audioRef.current;
      audio.src = url;
      audio.volume = music.volume;
      audio.loop = !!music.loop;
      try {
        await audio.play();
        setIsPlayingPreview(true);
      } catch {
        toast.error("Trình duyệt chặn tự động phát. Hãy bấm lại phát thử.");
        setIsPlayingPreview(false);
      }
      return;
    }

    // Nếu đang chọn nhạc mặc định
    if (music.useDefault) {
      toast.info("Đang dùng nhạc sôi động mặc định (WebAudio Synth) khi vào phòng thi.");
      return;
    }

    toast.info("Chưa có bài nhạc nào được chọn. Hãy bấm 'IMPORT NHẠC NỀN' để tải file lên.");
  };

  // Chỉnh âm lượng preview trực tiếp
  const handleVolumeChange = (volPercent: number) => {
    const vol = volPercent / 100;
    updateMusic({ volume: vol });
    if (audioRef.current) {
      audioRef.current.volume = vol;
    }
  };

  // Xóa nhạc riêng
  const handleRemoveCustomMusic = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlayingPreview(false);
    }
    updateMusic({
      customName: null,
      customUrl: null,
      idbKey: null,
      useDefault: false,
      enabled: false,
    });
    toast.info("Đã xóa nhạc của bài thi này");
  };

  return (
    <div
      className={`rounded-2xl border-2 border-pink-500/30 bg-gradient-to-br from-pink-500/5 via-purple-500/5 to-indigo-500/5 p-4 sm:p-5 space-y-4 shadow-sm ${className}`}
    >
      {/* Ẩn input file */}
      <input
        type="file"
        ref={fileInputRef}
        accept=".mp3,.wav,.m4a,.ogg,audio/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* HEADER SECTION */}
      <div className="flex items-center justify-between border-b border-pink-200/40 dark:border-pink-900/40 pb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="size-9 rounded-xl bg-pink-500/15 text-pink-600 dark:text-pink-400 grid place-items-center shrink-0">
            <Music className="size-5" />
          </div>
          <div>
            <div className="text-base font-bold flex items-center gap-2 text-foreground">
              <span>🎵 Nhạc nền thi đấu</span>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-pink-500/15 text-pink-700 dark:text-pink-300 border border-pink-500/30">
                Riêng cho bài thi này
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cài đặt bài nhạc riêng cho bài thi này. Nhạc phát tự động khi tổ chức thi đấu/hoạt động.
            </p>
          </div>
        </div>

        {/* Công tắc Bật / Tắt nhanh */}
        <div className="flex items-center gap-2">
          <Label htmlFor="music-enable-switch" className="text-xs font-semibold cursor-pointer">
            {music.enabled ? "Đang bật nhạc" : "Đang tắt nhạc"}
          </Label>
          <Switch
            id="music-enable-switch"
            checked={music.enabled}
            onCheckedChange={(checked) => {
              updateMusic({ enabled: checked });
              if (!checked && audioRef.current) {
                audioRef.current.pause();
                setIsPlayingPreview(false);
              }
            }}
          />
        </div>
      </div>

      {/* THÔNG TIN BÀI THI ÁP DỤNG */}
      {examTitle && (
        <div className="text-xs flex items-center gap-1.5 text-muted-foreground bg-background/50 px-3 py-1.5 rounded-lg border">
          <span className="font-semibold text-foreground">Áp dụng cho bài thi:</span>
          <span className="font-medium text-pink-600 dark:text-pink-400 truncate max-w-md">
            {examTitle}
          </span>
        </div>
      )}

      {/* KHỐI NÚT IMPORT & THÔNG TIN FILE */}
      <div className="rounded-xl border border-pink-200 dark:border-pink-900/60 bg-background/95 p-4 space-y-3 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-11 rounded-xl bg-pink-500/10 text-pink-600 dark:text-pink-400 grid place-items-center shrink-0">
              <FileAudio className="size-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Tên bài nhạc / file:
              </div>
              <div className="font-bold text-sm text-foreground truncate mt-0.5">
                {music.customName ? (
                  <span className="text-pink-600 dark:text-pink-400 flex items-center gap-1.5">
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                    {music.customName}
                  </span>
                ) : music.useDefault ? (
                  <span className="text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                    <Radio className="size-4 shrink-0 text-indigo-500" /> Nhạc mặc định sôi động (WebAudio Synth)
                  </span>
                ) : (
                  <span className="text-muted-foreground italic">
                    Chưa chọn nhạc (Bấm nút bên cạnh để tải file nhạc từ máy tính/điện thoại)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* CÁC NÚT IMPORT VÀ XÓA */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="default"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 text-white font-bold shadow-md shadow-pink-500/20 active:translate-y-0.5 transition-all h-10 px-4 text-xs sm:text-sm"
            >
              <Upload className="size-4 mr-1.5" />
              {uploading ? "Đang tải lên..." : "🎵 IMPORT NHẠC NỀN"}
            </Button>

            {music.customName && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRemoveCustomMusic}
                title="Xóa nhạc khỏi bài thi này"
                className="rounded-xl text-destructive hover:bg-destructive/10 border-destructive/30 h-10 px-3"
              >
                <Trash2 className="size-4 mr-1" /> Xóa
              </Button>
            )}
          </div>
        </div>

        {/* Hướng dẫn định dạng hỗ trợ */}
        <div className="text-[11px] text-muted-foreground flex items-center gap-2 pt-1 border-t border-border/50">
          <Sparkles className="size-3.5 text-pink-500 shrink-0" />
          <span>
            Hỗ trợ các định dạng: <b>MP3, WAV, M4A</b> (Tối đa 25MB). Nhạc được lưu gắn liền với bài thi này.
          </span>
        </div>
      </div>

      {/* BẢNG ĐIỀU KHIỂN: PHÁT THỬ - LẶP - ÂM LƯỢNG */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Cụm Phát thử & Phát lặp */}
        <div className="rounded-xl border p-3 bg-background/90 flex items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={isPlayingPreview ? "destructive" : "secondary"}
              onClick={togglePreview}
              disabled={!music.customName && !music.useDefault}
              className="rounded-xl font-bold h-9 px-3 flex items-center gap-1.5"
            >
              {isPlayingPreview ? (
                <>
                  <Pause className="size-4 fill-current" /> ⏸ Tạm dừng
                </>
              ) : (
                <>
                  <Play className="size-4 fill-current" /> ▶️ Phát thử
                </>
              )}
            </Button>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {isPlayingPreview ? "Đang nghe thử..." : "Nghe trước"}
            </span>
          </div>

          {/* Bật/Tắt phát lặp */}
          <div className="flex items-center gap-2 border-l pl-3">
            <Button
              type="button"
              size="sm"
              variant={music.loop ? "default" : "outline"}
              onClick={() => updateMusic({ loop: !music.loop })}
              className={`rounded-xl h-9 px-3 text-xs font-semibold flex items-center gap-1.5 ${
                music.loop ? "bg-indigo-600 text-white hover:bg-indigo-700" : ""
              }`}
            >
              <Repeat className="size-3.5" />
              <span>🔁 Lặp: {music.loop ? "Bật" : "Tắt"}</span>
            </Button>
          </div>
        </div>

        {/* Điều chỉnh âm lượng */}
        <div className="rounded-xl border p-3 bg-background/90 flex flex-col justify-center space-y-1.5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="flex items-center gap-1 text-muted-foreground">
              <Volume2 className="size-3.5 text-foreground" /> 🔊 Âm lượng:
            </span>
            <span className="font-bold text-foreground">{Math.round(music.volume * 100)}%</span>
          </div>
          <Slider
            value={[Math.round(music.volume * 100)]}
            min={0}
            max={100}
            step={5}
            onValueChange={([v]) => handleVolumeChange(v)}
            className="cursor-pointer"
          />
        </div>
      </div>

      {/* LỰA CHỌN DÙNG NHẠC MẶC ĐỊNH HOẶC KHÔNG SỬ DỤNG */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl bg-muted/40 border text-xs">
        <div className="space-y-0.5">
          <div className="font-semibold text-foreground flex items-center gap-1.5">
            <Info className="size-3.5 text-muted-foreground" />
            Nhạc mặc định & tùy chọn:
          </div>
          <div className="text-muted-foreground">
            Nếu chưa có file nhạc riêng, bạn có thể chọn phát nhạc sôi động mặc định hoặc không sử dụng nhạc.
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            size="sm"
            variant={music.useDefault && !music.customName ? "default" : "outline"}
            onClick={() => {
              updateMusic({
                enabled: true,
                useDefault: true,
                customName: null,
                customUrl: null,
                idbKey: null,
              });
              toast.success("Đã chọn nhạc sôi động mặc định cho bài thi này");
            }}
            className={`rounded-xl h-8 text-xs font-medium ${
              music.useDefault && !music.customName ? "bg-indigo-600 text-white" : ""
            }`}
          >
            <Radio className="size-3 mr-1" /> Dùng nhạc mặc định
          </Button>

          <Button
            type="button"
            size="sm"
            variant={!music.enabled || (!music.useDefault && !music.customName) ? "secondary" : "ghost"}
            onClick={() => {
              if (audioRef.current) {
                audioRef.current.pause();
                setIsPlayingPreview(false);
              }
              updateMusic({
                enabled: false,
                useDefault: false,
                customName: null,
                customUrl: null,
                idbKey: null,
              });
              toast.info("Đã tắt nhạc cho bài thi này");
            }}
            className="rounded-xl h-8 text-xs font-medium"
          >
            Không sử dụng nhạc
          </Button>
        </div>
      </div>

      <div className="text-[11px] text-muted-foreground italic px-1">
        * Lưu ý: Thay đổi nhạc của bài thi này là riêng biệt, hoàn toàn không ảnh hưởng đến bất kỳ bài thi nào khác của giáo viên.
      </div>
    </div>
  );
}
