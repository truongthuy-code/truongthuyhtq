import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { LockMode } from "@/hooks/useExamLock";
import { ShieldAlert } from "lucide-react";

export default function LockModeSettings({
  value, onChange,
}: { value: LockMode; onChange: (v: LockMode) => void }) {
  const set = (patch: Partial<LockMode>) => onChange({ ...value, ...patch });
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium flex items-center gap-2">
            <ShieldAlert className="size-4 text-warning" /> Chế độ khóa màn hình thi (Exam Lock Mode)
          </Label>
          <div className="text-xs text-muted-foreground mt-1">
            Phát hiện và ghi nhận khi học sinh chuyển tab / rời khỏi cửa sổ làm bài.
          </div>
        </div>
        <Switch checked={value.enabled} onCheckedChange={(v) => set({ enabled: v })} />
      </div>

      {value.enabled && (
        <div className="space-y-3 pt-2 border-t">
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <Checkbox checked={value.warnOnly} onCheckedChange={(v) => set({ warnOnly: !!v })} className="mt-0.5" />
            <span>Chỉ cảnh báo khi rời màn hình (không xử lý vi phạm)</span>
          </label>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <Checkbox checked={value.autoLog} onCheckedChange={(v) => set({ autoLog: !!v })} className="mt-0.5" />
            <span>Tự động ghi nhận vi phạm vào nhật ký</span>
          </label>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <Checkbox checked={value.penalty} onCheckedChange={(v) => set({ penalty: !!v })} className="mt-0.5" />
            <span>Trừ điểm khi vi phạm</span>
          </label>
          {value.penalty && (
            <div className="ml-6">
              <Label className="text-xs">Điểm trừ mỗi vi phạm</Label>
              <Input type="number" step="0.05" min={0} value={value.penaltyPerViolation}
                onChange={(e) => set({ penaltyPerViolation: +e.target.value })} className="mt-1 max-w-[140px]" />
            </div>
          )}
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <Checkbox checked={value.autoSubmit} onCheckedChange={(v) => set({ autoSubmit: !!v })} className="mt-0.5" />
            <span>Tự động nộp bài khi vượt quá số lần vi phạm</span>
          </label>
          <div>
            <Label className="text-xs">Số lần vi phạm cho phép</Label>
            <Input type="number" min={1} value={value.maxViolations}
              onChange={(e) => set({ maxViolations: +e.target.value })} className="mt-1 max-w-[140px]" />
          </div>
        </div>
      )}
    </div>
  );
}
