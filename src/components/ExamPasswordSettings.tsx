import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { KeyRound, Eye, EyeOff, ShieldCheck, Lock } from "lucide-react";

export interface ExamPasswordConfig {
  requirePassword: boolean;
  password: string;
}

interface ExamPasswordSettingsProps {
  value: ExamPasswordConfig;
  onChange: (val: ExamPasswordConfig) => void;
  disabled?: boolean;
}

export default function ExamPasswordSettings({
  value,
  onChange,
  disabled = false,
}: ExamPasswordSettingsProps) {
  const [showPassword, setShowPassword] = useState(false);

  const handleToggle = (checked: boolean) => {
    onChange({
      ...value,
      requirePassword: checked,
    });
  };

  const handlePasswordChange = (newPassword: string) => {
    onChange({
      ...value,
      password: newPassword,
    });
  };

  return (
    <div className="rounded-xl border border-border/80 bg-card p-4 hover:border-primary/40 transition-colors space-y-3">
      {/* Header & Toggle Switch */}
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1 pr-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Label
              htmlFor="exam-password-toggle"
              className="text-sm font-bold text-foreground flex items-center gap-1.5 cursor-pointer"
            >
              <KeyRound className="size-4 text-amber-500" />
              <span>Mật khẩu bài thi</span>
            </Label>
            <span
              className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                value.requirePassword
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
                  : "bg-muted text-muted-foreground border-border"
              }`}
            >
              {value.requirePassword ? "BẬT" : "TẮT"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground leading-relaxed">
            {value.requirePassword
              ? "Bảo mật bài thi bằng mật khẩu. Học sinh nhận link phải nhập đúng mật khẩu mới được mở đề vào làm bài."
              : "Không yêu cầu mật khẩu. Học sinh có link làm bài có thể truy cập trực tiếp theo quy trình hiện tại."}
          </div>
        </div>

        <Switch
          id="exam-password-toggle"
          checked={value.requirePassword}
          onCheckedChange={handleToggle}
          disabled={disabled}
        />
      </div>

      {/* Input khi BẬT yêu cầu mật khẩu */}
      {value.requirePassword && (
        <div className="pt-3 border-t border-border/60 space-y-2 animate-in fade-in duration-200">
          <Label htmlFor="exam-password-input" className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Lock className="size-3.5 text-muted-foreground" />
            <span>Mật khẩu đề thi <span className="text-rose-500">*</span></span>
          </Label>

          <div className="relative max-w-md">
            <Input
              id="exam-password-input"
              type={showPassword ? "text" : "password"}
              placeholder="Nhập mật khẩu bài thi (ví dụ: ThiGK1_2026)..."
              value={value.password}
              onChange={(e) => handlePasswordChange(e.target.value)}
              disabled={disabled}
              className="h-10 pr-10 font-mono text-sm tracking-wide bg-background"
              autoComplete="off"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1 h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
              title={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
          </div>

          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 pt-0.5">
            <ShieldCheck className="size-3.5 text-emerald-600 shrink-0" />
            <span>
              Mật khẩu được lưu riêng theo từng đề và được mã hóa bảo mật. Học sinh không thể xem trực tiếp từ dữ liệu tải về.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
