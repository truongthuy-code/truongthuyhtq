import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Users, Trophy } from "lucide-react";
import ExamMusicManager, { TeamMusicConfig, DEFAULT_MUSIC_CONFIG } from "./ExamMusicManager";

export type { TeamMusicConfig };
export { DEFAULT_MUSIC_CONFIG };

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
      : [{ name: "Nhóm 1" }, { name: "Nhóm 2" }],
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
  examTitle,
}: {
  value: TeamConfig;
  onChange: (v: TeamConfig) => void;
  examId?: string;
  examTitle?: string;
}) {
  const set = (patch: Partial<TeamConfig>) => onChange({ ...value, ...patch });
  const setMusic = (music: TeamMusicConfig) => onChange({ ...value, music });

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
              Thiết lập danh sách nhóm thi đấu, số lượng thành viên và bảng xếp hạng.
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
            <Trophy className="size-4 text-amber-500" /> Bảng xếp hạng trực tiếp máy chiếu
          </Label>
          <div className="text-xs text-muted-foreground mt-0.5">
            Hiển thị bảng xếp hạng đồ họa lớn chuẩn gameshow, tự động cập nhật điểm số realtime.
          </div>
        </div>
        <Switch checked={value.leaderboard} onCheckedChange={(v) => set({ leaderboard: v })} />
      </div>

      {/* ============================================================== */}
      {/* KHU VỰC QUẢN LÝ NHẠC NỀN THI ĐẤU RIÊNG CHO BÀI THI / HOẠT ĐỘNG */}
      {/* Luôn hiển thị đầy đủ, trực quan, không bị ẩn */}
      {/* ============================================================== */}
      <ExamMusicManager
        value={value.music}
        onChange={setMusic}
        examId={examId}
        examTitle={examTitle}
      />
    </div>
  );
}
