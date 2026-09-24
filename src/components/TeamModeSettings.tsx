import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Plus,
  Trash2,
  Users,
  Music,
  Play,
  Pause,
  Repeat,
  Volume2,
  Upload,
  CheckCircle2,
  FileAudio,
  Radio,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { uploadExamBattleMusic, resolvePlayableAudioUrl } from "@/lib/audioStorage";

export type TeamMusicConfig = {
  enabled: boolean;
  volume: number;
  loop?: boolean;
  useDefault?: boolean; // Nếu true, dùng nhạc synth mặc định; nếu false, ưu tiên custom audio nếu có
  customName?: string | null;
  customUrl?: string | null;
  idbKey?: string | null;
};

export type TeamConfig = {
  teams: { name: string }[];
  maxMembers: number;
  leaderboard: boolean;
  music: TeamMusicConfig;
};

export const DEFAULT_TEAM_CONFIG: TeamConfig = {
  teams: [{ name: "Nhóm 1" }, { name: "Nhóm 2" }],
  maxMembers: 5,
  leaderboard: true,
  music: {
    enabled: false,
    volume: 0.4,
    loop: true,
    useDefault: false,
    customName: null,
    customUrl: null,
    idbKey: null,
  },
};

export function normalizeTeamConfig(raw: any): TeamConfig {
  const cfg = raw || {};
  const rawMusic = cfg.music || {};
  return {
    teams: Array.isArray(cfg.teams)
      ? cfg.teams
          .map((t: any) => ({ name: String(t?.name ?? t ?? "").trim() }))
          .filter((t: any) => t.name)
      : [],
    maxMembers: Number.isFinite(+cfg.maxMembers) ? +cfg.maxMembers : 5,
    leaderboard: cfg.leaderboard !== false,
    music: {
      enabled: !!rawMusic.enabled,
      volume: Number.isFinite(+rawMusic.volume) ? +rawMusic.volume : 0.4,
      loop: rawMusic.loop !== false,
      useDefault: !!rawMusic.useDefault,
      customName: rawMusic.customName || null,
      customUrl: rawMusic.customUrl || null,
      idbKey: rawMusic.idbKey || null,
    },
  };
}

export default function TeamModeSettings({
  value,
  onChange,
  examId,
}: {
  value: TeamConfig;
  onChange: (v: TeamConfig) => void;
  examId?: string;
}) {
  const set = (patch: Partial<TeamConfig>) => onChange({ ...value, ...patch });
  const setMusic = (patch: Partial<TeamMusicConfig>) =>
    onChange({ ...value, music: { ...value.music, ...patch } });

  const [uploading, setUploading] = useState(false);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Dọn dẹp audio preview khi unmount hoặc đổi nhạc
  useEffect(() => {
    return () => {
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause();
        audioPreviewRef.current.src = "";
      }
    };
  }, []);

  // Xử lý chọn file nhạc từ máy tính / điện thoại
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Kiểm tra định dạng hỗ trợ: MP3, WAV, M4A, OGG
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
      // Dừng nhạc preview cũ nếu đang phát
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause();
        setIsPlayingPreview(false);
      }

      const res = await uploadExamBattleMusic(examId || "temp", file);
      setMusic({
        enabled: true,
        useDefault: false,
        customName: file.name,
        customUrl: res.url,
        idbKey: res.idbKey,
      });
      toast.success(`Đã tải nhạc "${file.name}" cho bài thi này!`);
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
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause();
      }
      setIsPlayingPreview(false);
      return;
    }

    // Nếu có customUrl hoặc idbKey
    if (value.music.customUrl || value.music.idbKey) {
      const url = await resolvePlayableAudioUrl(
        value.music.customUrl || undefined,
        value.music.idbKey || undefined
      );

      if (!url) {
        toast.error("Không tìm thấy file nhạc để phát thử");
        return;
      }

      if (!audioPreviewRef.current) {
        audioPreviewRef.current = new Audio();
        audioPreviewRef.current.onended = () => {
          if (!value.music.loop) {
            setIsPlayingPreview(false);
          }
        };
      }

      const audio = audioPreviewRef.current;
      audio.src = url;
      audio.volume = value.music.volume;
      audio.loop = !!value.music.loop;
      try {
        await audio.play();
        setIsPlayingPreview(true);
      } catch (err) {
        toast.error("Trình duyệt chặn phát âm thanh. Vui lòng thử lại.");
        setIsPlayingPreview(false);
      }
      return;
    }

    // Nếu không có file custom, thông báo chọn nhạc
    toast.info("Chưa có file nhạc riêng. Hãy bấm 'IMPORT NHẠC NỀN' để chọn file từ máy.");
  };

  // Cập nhật âm lượng khi đang preview
  const handleVolumeChange = (volPercent: number) => {
    const vol = volPercent / 100;
    setMusic({ volume: vol });
    if (audioPreviewRef.current) {
      audioPreviewRef.current.volume = vol;
    }
  };

  // Xóa nhạc riêng của bài thi
  const handleRemoveCustomMusic = () => {
    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause();
      setIsPlayingPreview(false);
    }
    setMusic({
      customName: null,
      customUrl: null,
      idbKey: null,
      useDefault: false,
    });
    toast.info("Đã xóa file nhạc riêng của bài thi này");
  };

  return (
    <div className="rounded-2xl border-2 border-indigo-200 dark:border-indigo-900/60 p-4 sm:p-5 space-y-5 bg-card/60 backdrop-blur-sm shadow-sm">
      {/* TIÊU ĐỀ KHỐI CẤU HÌNH */}
      <div className="flex items-center justify-between border-b pb-3">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 grid place-items-center">
            <Users className="size-4" />
          </div>
          <div>
            <Label className="text-base font-bold">Cấu hình chế độ Đội/Nhóm</Label>
            <p className="text-xs text-muted-foreground">
              Thiết lập danh sách nhóm, giới hạn thành viên và nhạc nền riêng cho bài thi này.
            </p>
          </div>
        </div>
      </div>

      {/* DANH SÁCH NHÓM THI ĐẤU */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Danh sách nhóm thi đấu
        </Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {value.teams.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={t.name}
                placeholder={`Nhóm ${i + 1}`}
                className="h-9 rounded-xl font-medium"
                onChange={(e) => {
                  const teams = [...value.teams];
                  teams[i] = { name: e.target.value };
                  set({ teams });
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 rounded-xl text-destructive hover:bg-destructive/10 shrink-0"
                onClick={() => set({ teams: value.teams.filter((_, j) => j !== i) })}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-xl border-dashed border-primary/40 text-primary font-semibold hover:bg-primary/5 mt-1"
          onClick={() =>
            set({ teams: [...value.teams, { name: `Nhóm ${value.teams.length + 1}` }] })
          }
        >
          <Plus className="size-4 mr-1" /> Thêm nhóm mới
        </Button>
      </div>

      {/* SỐ LƯỢNG THÀNH VIÊN TỐI ĐA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl bg-muted/30 p-3 border">
        <div>
          <Label className="text-sm font-medium">Số thành viên tối đa mỗi nhóm</Label>
          <div className="text-xs text-muted-foreground">Nhập 0 nếu không giới hạn số thành viên.</div>
        </div>
        <Input
          type="number"
          min={0}
          value={value.maxMembers}
          onChange={(e) => set({ maxMembers: Math.max(0, +e.target.value || 0) })}
          className="h-9 w-28 rounded-xl font-bold text-center"
        />
      </div>

      {/* BẢNG XẾP HẠNG THỜI GIAN THỰC */}
      <div className="flex items-center justify-between rounded-xl border p-3 bg-muted/20">
        <div className="pr-3">
          <Label className="text-sm font-semibold flex items-center gap-1.5">
            🏆 Bảng xếp hạng trực tiếp máy chiếu
          </Label>
          <div className="text-xs text-muted-foreground mt-0.5">
            Hiển thị bảng xếp hạng đồ họa lớn chuẩn gameshow, tự động cập nhật điểm số.
          </div>
        </div>
        <Switch checked={value.leaderboard} onCheckedChange={(v) => set({ leaderboard: v })} />
      </div>

      {/* ============================================================== */}
      {/* KHU VỰC QUẢN LÝ NHẠC NỀN THI ĐẤU RIÊNG CHO BÀI THI / HOẠT ĐỘNG */}
      {/* ============================================================== */}
      <div className="rounded-2xl border-2 border-pink-500/30 bg-gradient-to-br from-pink-500/5 via-purple-500/5 to-indigo-500/5 p-4 sm:p-5 space-y-4 shadow-sm">
        {/* Header nhạc nền */}
        <div className="flex items-center justify-between border-b border-pink-200/40 dark:border-pink-900/40 pb-3">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-xl bg-pink-500/15 text-pink-600 dark:text-pink-400 grid place-items-center">
              <Music className="size-4" />
            </div>
            <div>
              <div className="text-sm font-bold flex items-center gap-1.5 text-foreground">
                🎵 Nhạc nền thi đấu
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-pink-500/15 text-pink-600 dark:text-pink-300 border border-pink-500/20">
                  Dành riêng cho bài thi này
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Mỗi bài thi có thể cài đặt một bài nhạc riêng. Nhạc tự động phát lặp khi bắt đầu thi.
              </p>
            </div>
          </div>
          <Switch
            checked={value.music.enabled}
            onCheckedChange={(v) => setMusic({ enabled: v })}
          />
        </div>

        {value.music.enabled && (
          <div className="space-y-4 pt-1 animate-fade-in">
            {/* Input file ẩn hỗ trợ mp3, wav, m4a */}
            <input
              type="file"
              ref={fileInputRef}
              accept=".mp3,.wav,.m4a,.ogg,audio/*"
              className="hidden"
              onChange={handleFileChange}
            />

            {/* KHỐI NÚT IMPORT VÀ TRẠNG THÁI FILE */}
            <div className="rounded-xl border border-pink-200 dark:border-pink-900/60 bg-background/90 p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="size-11 rounded-xl bg-pink-500/10 text-pink-600 dark:text-pink-400 grid place-items-center shrink-0">
                    <FileAudio className="size-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-muted-foreground uppercase">
                      Tên bài nhạc / file:
                    </div>
                    <div className="font-bold text-sm text-foreground truncate mt-0.5">
                      {value.music.customName ? (
                        <span className="text-pink-600 dark:text-pink-400 flex items-center gap-1.5">
                          <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                          {value.music.customName}
                        </span>
                      ) : value.music.useDefault ? (
                        <span className="text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                          <Radio className="size-4 shrink-0" /> Nhạc mặc định hệ thống (WebAudio Synth)
                        </span>
                      ) : (
                        <span className="text-muted-foreground italic">
                          Chưa có nhạc riêng (Bấm import hoặc chọn nhạc mặc định bên dưới)
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* NÚT IMPORT NHẠC NỀN */}
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 text-white font-bold shadow-md shadow-pink-500/20 active:translate-y-0.5 transition-all"
                  >
                    <Upload className="size-4 mr-1.5" />
                    {uploading ? "Đang tải..." : "🎵 IMPORT NHẠC NỀN"}
                  </Button>

                  {value.music.customName && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleRemoveCustomMusic}
                      title="Xóa nhạc khỏi bài thi"
                      className="rounded-xl text-destructive hover:bg-destructive/10 border-destructive/30"
                    >
                      <Trash2 className="size-4 mr-1" /> Xóa nhạc
                    </Button>
                  )}
                </div>
              </div>

              {/* Hướng dẫn định dạng hỗ trợ */}
              <div className="text-[11px] text-muted-foreground flex items-center gap-2 pt-1 border-t border-border/50">
                <Sparkles className="size-3 text-pink-500" />
                <span>Hỗ trợ các định dạng phổ biến: <b>MP3, WAV, M4A</b> (Tối đa 25MB). Nhạc được lưu gắn liền theo bài thi này.</span>
              </div>
            </div>

            {/* BẢNG ĐIỀU KHIỂN: PHÁT THỬ - LẶP - ÂM LƯỢNG */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Cụm Phát thử & Phát lặp */}
              <div className="rounded-xl border p-3 bg-background/80 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={isPlayingPreview ? "destructive" : "secondary"}
                    onClick={togglePreview}
                    disabled={!value.music.customName && !value.music.useDefault}
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
                  <span className="text-xs text-muted-foreground hidden lg:inline">
                    {isPlayingPreview ? "Đang phát thử..." : "Nghe trước"}
                  </span>
                </div>

                {/* Bật/Tắt phát lặp */}
                <div className="flex items-center gap-2 border-l pl-3">
                  <Button
                    type="button"
                    size="sm"
                    variant={value.music.loop ? "default" : "outline"}
                    onClick={() => setMusic({ loop: !value.music.loop })}
                    className={`rounded-xl h-9 px-2.5 text-xs font-semibold flex items-center gap-1 ${
                      value.music.loop ? "bg-indigo-600 text-white" : ""
                    }`}
                  >
                    <Repeat className="size-3.5" />
                    <span>🔁 Lặp: {value.music.loop ? "Bật" : "Tắt"}</span>
                  </Button>
                </div>
              </div>

              {/* Điều chỉnh âm lượng */}
              <div className="rounded-xl border p-3 bg-background/80 flex flex-col justify-center space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Volume2 className="size-3.5 text-foreground" /> 🔊 Âm lượng bài thi:
                  </span>
                  <span className="font-bold text-foreground">
                    {Math.round(value.music.volume * 100)}%
                  </span>
                </div>
                <Slider
                  value={[Math.round(value.music.volume * 100)]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={([v]) => handleVolumeChange(v)}
                  className="cursor-pointer"
                />
              </div>
            </div>

            {/* TÙY CHỌN DÙNG NHẠC MẶC ĐỊNH HOẶC KHÔNG SỬ DỤNG */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl bg-muted/40 border text-xs">
              <div className="space-y-0.5">
                <div className="font-semibold text-foreground">
                  Lựa chọn khi chưa có nhạc riêng:
                </div>
                <div className="text-muted-foreground">
                  Nếu chưa tải file nhạc riêng, bạn có thể bật nhạc mặc định gameshow của hệ thống hoặc tắt nhạc.
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  size="sm"
                  variant={value.music.useDefault && !value.music.customName ? "default" : "outline"}
                  onClick={() => setMusic({ useDefault: true, customName: null, customUrl: null, idbKey: null })}
                  className="rounded-xl h-8 text-xs font-medium"
                >
                  <Radio className="size-3.5 mr-1" /> Dùng nhạc mặc định
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={!value.music.useDefault && !value.music.customName ? "secondary" : "ghost"}
                  onClick={() => setMusic({ useDefault: false, customName: null, customUrl: null, idbKey: null })}
                  className="rounded-xl h-8 text-xs font-medium"
                >
                  Không dùng nhạc
                </Button>
              </div>
            </div>

            <div className="text-[11px] text-muted-foreground italic px-1">
              * Ghi chú: Việc thay đổi nhạc của bài thi này hoàn toàn độc lập, không làm thay đổi nhạc của bất kỳ bài thi nào khác.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
