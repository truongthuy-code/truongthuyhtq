import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CalendarClock } from "lucide-react";

export type Schedule = {
  open_at: string | null;
  close_at: string | null;
  auto_submit_on_close: boolean;
};

// Convert ISO string from DB to value for <input type="datetime-local">
export function isoToLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function localToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export default function ScheduleSettings({
  value,
  onChange,
}: {
  value: Schedule;
  onChange: (s: Schedule) => void;
}) {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <CalendarClock className="size-4 text-primary" /> ⏱️ Thời gian tổ chức bài thi
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Thời gian mở đề</Label>
          <Input
            type="datetime-local"
            value={isoToLocal(value.open_at)}
            onChange={(e) => onChange({ ...value, open_at: localToIso(e.target.value) })}
            className="mt-1"
          />
          <div className="text-[11px] text-muted-foreground mt-1">
            Bỏ trống: tự động lấy thời điểm tạo đề.
          </div>
        </div>
        <div>
          <Label className="text-xs">Thời gian đóng đề</Label>
          <Input
            type="datetime-local"
            value={isoToLocal(value.close_at)}
            onChange={(e) => onChange({ ...value, close_at: localToIso(e.target.value) })}
            className="mt-1"
          />
          <div className="text-[11px] text-muted-foreground mt-1">
            Bỏ trống: đề luôn mở cho đến khi đóng thủ công.
          </div>
        </div>
      </div>

      <div className="rounded-md border p-3 bg-muted/30 space-y-2">
        <div className="text-xs font-medium">Khi hết thời gian đóng đề (với học sinh đang làm)</div>
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {value.auto_submit_on_close
              ? "Tự động nộp bài ngay khi hết giờ."
              : "Cho phép học sinh hoàn thành bài đang làm."}
          </div>
          <Switch
            checked={value.auto_submit_on_close}
            onCheckedChange={(v) => onChange({ ...value, auto_submit_on_close: v })}
          />
        </div>
      </div>
    </div>
  );
}
