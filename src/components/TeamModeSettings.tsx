import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Plus, Trash2, Users } from "lucide-react";

export type TeamConfig = {
  teams: { name: string }[];
  maxMembers: number;
  leaderboard: boolean;
  music: { enabled: boolean; volume: number };
};

export const DEFAULT_TEAM_CONFIG: TeamConfig = {
  teams: [{ name: "Nhóm 1" }, { name: "Nhóm 2" }],
  maxMembers: 5,
  leaderboard: true,
  music: { enabled: false, volume: 0.4 },
};

export function normalizeTeamConfig(raw: any): TeamConfig {
  const cfg = raw || {};
  return {
    teams: Array.isArray(cfg.teams)
      ? cfg.teams.map((t: any) => ({ name: String(t?.name ?? t ?? "").trim() })).filter((t: any) => t.name)
      : [],
    maxMembers: Number.isFinite(+cfg.maxMembers) ? +cfg.maxMembers : 5,
    leaderboard: cfg.leaderboard !== false,
    music: {
      enabled: !!cfg?.music?.enabled,
      volume: Number.isFinite(+cfg?.music?.volume) ? +cfg.music.volume : 0.4,
    },
  };
}

export default function TeamModeSettings({
  value,
  onChange,
}: {
  value: TeamConfig;
  onChange: (v: TeamConfig) => void;
}) {
  const set = (patch: Partial<TeamConfig>) => onChange({ ...value, ...patch });

  return (
    <div className="rounded-lg border p-4 space-y-4 bg-background">
      <div className="flex items-center gap-2">
        <Users className="size-4 text-primary" />
        <Label className="text-sm font-medium">Cấu hình chế độ Đội/Nhóm</Label>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Danh sách nhóm</Label>
        {value.teams.map((t, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={t.name}
              placeholder={`Nhóm ${i + 1}`}
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
              onClick={() => set({ teams: value.teams.filter((_, j) => j !== i) })}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => set({ teams: [...value.teams, { name: `Nhóm ${value.teams.length + 1}` }] })}
        >
          <Plus className="size-4 mr-1" /> Thêm nhóm
        </Button>
      </div>

      <div>
        <Label className="text-xs text-muted-foreground">Số thành viên tối đa mỗi nhóm (0 = không giới hạn)</Label>
        <Input
          type="number"
          min={0}
          value={value.maxMembers}
          onChange={(e) => set({ maxMembers: Math.max(0, +e.target.value || 0) })}
          className="mt-1 w-40"
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border p-3">
        <div className="pr-3">
          <Label className="text-sm font-medium">🏆 Bảng xếp hạng thời gian thực</Label>
          <div className="text-xs text-muted-foreground mt-1">Hiển thị thứ hạng các nhóm, cập nhật liên tục.</div>
        </div>
        <Switch checked={value.leaderboard} onCheckedChange={(v) => set({ leaderboard: v })} />
      </div>

      <div className="rounded-lg border p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="pr-3">
            <Label className="text-sm font-medium">🎵 Nhạc nền thi đấu</Label>
            <div className="text-xs text-muted-foreground mt-1">Phát nhạc nền lặp lại trong khi thi đấu.</div>
          </div>
          <Switch
            checked={value.music.enabled}
            onCheckedChange={(v) => set({ music: { ...value.music, enabled: v } })}
          />
        </div>
        {value.music.enabled && (
          <div>
            <Label className="text-xs text-muted-foreground">Âm lượng: {Math.round(value.music.volume * 100)}%</Label>
            <Slider
              className="mt-2"
              value={[Math.round(value.music.volume * 100)]}
              min={0}
              max={100}
              step={5}
              onValueChange={([v]) => set({ music: { ...value.music, volume: v / 100 } })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
