import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  buildScale100Scoring,
  DEFAULT_PART_II_RATES,
  DEFAULT_SCORING,
  DEFAULT_TOTAL_SCALE,
  ExamStructureCounts,
  formatScore,
  getPartIIMethod,
  isScale100Scoring,
  normalizePartIIRates,
  PartIIMethod,
  PartIIRates,
  PartPoints,
  ScoringConfig,
  suggestDefaultPartPoints,
  validatePartIIRates,
  validateScale100Parts,
} from "@/lib/grading";
import { AlertTriangle, Calculator, CheckCircle2, Info, RotateCcw } from "lucide-react";

type ScoringConfigPanelProps = {
  counts: ExamStructureCounts;
  itemCountP2?: number;
  scoring: ScoringConfig;
  onChange: (next: ScoringConfig) => void;
  allowLegacyToggle?: boolean;
};

export default function ScoringConfigPanel({
  counts,
  itemCountP2 = 4,
  scoring,
  onChange,
  allowLegacyToggle = false,
}: ScoringConfigPanelProps) {
  const isScale100 = isScale100Scoring(scoring);
  const totalQuestions = counts.p1 + counts.p2 + counts.p3;

  const syntheticExam = {
    partI: Array.from({ length: counts.p1 }, (_, i) => ({ id: `p1_${i}` })),
    partII: Array.from({ length: counts.p2 }, (_, i) => ({
      id: `p2_${i}`,
      items: Array.from({ length: itemCountP2 }, (__, j) => ({ key: String.fromCharCode(97 + j) })),
    })),
    partIII: Array.from({ length: counts.p3 }, (_, i) => ({ id: `p3_${i}` })),
  };

  if (!isScale100) {
    return (
      <div className="space-y-3 rounded-xl border p-4 bg-muted/30">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div className="text-sm font-bold text-foreground">Cài đặt điểm (Thang điểm cũ)</div>
            <div className="text-xs text-muted-foreground">
              Đề thi này đang dùng cấu hình điểm nhập tay cho từng câu.
            </div>
          </div>
          {allowLegacyToggle && (
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={() => onChange(buildScale100Scoring(syntheticExam, undefined, scoring))}
              className="rounded-lg text-xs font-semibold gap-1.5 bg-primary"
            >
              <Calculator className="size-3.5" /> Chuyển sang Thang điểm 100
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Phần I — điểm / câu</Label>
            <Input
              type="number"
              step="0.05"
              min={0}
              value={scoring.p1}
              onChange={(e) => onChange({ ...scoring, p1: +e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Phần III — điểm / câu</Label>
            <Input
              type="number"
              step="0.05"
              min={0}
              value={scoring.p3}
              onChange={(e) => onChange({ ...scoring, p3: +e.target.value })}
              className="mt-1"
            />
          </div>
        </div>
        <div>
          <div className="text-xs font-medium mb-1">Phần II — điểm theo số ý đúng</div>
          <div className="grid grid-cols-4 gap-2">
            {(["1", "2", "3", "4"] as const).map((k) => (
              <div key={k}>
                <Label className="text-xs">Đúng {k} ý</Label>
                <Input
                  type="number"
                  step="0.05"
                  min={0}
                  value={scoring.p2[k]}
                  onChange={(e) =>
                    onChange({ ...scoring, p2: { ...scoring.p2, [k]: +e.target.value } })
                  }
                  className="mt-1"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const parts: PartPoints = scoring.parts;
  const validation = validateScale100Parts(parts, counts);
  const p2Method = getPartIIMethod(scoring);
  const p2Rates = normalizePartIIRates(scoring.p2Rates);
  const allowNonMonotonic = Boolean(scoring.allowNonMonotonicP2Rates);
  const rateValidation =
    p2Method === "custom_rates"
      ? validatePartIIRates(p2Rates, allowNonMonotonic)
      : { valid: true, hasRangeError: false, isNonMonotonic: false, message: null };
  const overallValid = validation.valid && (counts.p2 === 0 || rateValidation.valid);

  const handlePartChange = (partKey: keyof PartPoints, rawVal: string) => {
    const parsed = rawVal === "" ? 0 : Number(rawVal);
    const nextVal = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    const nextParts: PartPoints = {
      ...parts,
      [partKey]: nextVal,
    };
    onChange(buildScale100Scoring(syntheticExam, nextParts, scoring));
  };

  const handleResetSuggested = () => {
    const suggested = suggestDefaultPartPoints(counts, DEFAULT_TOTAL_SCALE);
    onChange(buildScale100Scoring(syntheticExam, suggested, scoring));
  };

  const handleP2MethodChange = (nextMethod: PartIIMethod) => {
    onChange(
      buildScale100Scoring(syntheticExam, parts, {
        ...scoring,
        p2Method: nextMethod,
        p2Rates,
      })
    );
  };

  const handleP2RateChange = (level: "1" | "2" | "3", rawVal: string) => {
    const parsed = rawVal === "" ? 0 : Number(rawVal);
    const nextRate = Number.isFinite(parsed) ? parsed : 0;
    const nextRates: PartIIRates = {
      ...p2Rates,
      [level]: nextRate,
      "4": 100,
    };
    onChange(
      buildScale100Scoring(syntheticExam, parts, {
        ...scoring,
        p2Method: "custom_rates",
        p2Rates: nextRates,
      })
    );
  };

  const handleResetP2Rates = () => {
    onChange(
      buildScale100Scoring(syntheticExam, parts, {
        ...scoring,
        p2Method: "custom_rates",
        p2Rates: { ...DEFAULT_PART_II_RATES },
        allowNonMonotonicP2Rates: false,
      })
    );
  };

  const handleToggleAllowNonMonotonic = (checked: boolean) => {
    onChange(
      buildScale100Scoring(syntheticExam, parts, {
        ...scoring,
        p2Method: "custom_rates",
        p2Rates,
        allowNonMonotonicP2Rates: checked,
      })
    );
  };

  const perQ1 = counts.p1 > 0 ? parts.p1 / counts.p1 : 0;
  const perQ2 = counts.p2 > 0 ? parts.p2 / counts.p2 : 0;
  const perItemP2 = counts.p2 > 0 && itemCountP2 > 0 ? perQ2 / itemCountP2 : 0;
  const perQ3 = counts.p3 > 0 ? parts.p3 / counts.p3 : 0;

  const isRepeating = (num: number, den: number) => {
    if (den <= 0) return false;
    const val = num / den;
    return Math.abs(Math.round(val * 100) / 100 - val) > 1e-7;
  };

  const rows: Array<{
    key: keyof PartPoints;
    title: string;
    subtitle: string;
    count: number;
    partScore: number;
    perQ: number;
    perItem?: number;
  }> = [
    {
      key: "p1",
      title: "Phần I",
      subtitle: "Trắc nghiệm 4 lựa chọn",
      count: counts.p1,
      partScore: parts.p1,
      perQ: perQ1,
    },
    {
      key: "p2",
      title: "Phần II",
      subtitle:
        p2Method === "custom_rates"
          ? "Đúng / Sai (tính theo tỷ lệ % GV thiết lập)"
          : `Đúng / Sai (chia đều ${itemCountP2} ý/câu)`,
      count: counts.p2,
      partScore: parts.p2,
      perQ: perQ2,
      perItem: perItemP2,
    },
    {
      key: "p3",
      title: "Phần III",
      subtitle: "Trả lời ngắn",
      count: counts.p3,
      partScore: parts.p3,
      perQ: perQ3,
    },
  ];

  return (
    <div className="space-y-3 rounded-xl border border-primary/25 p-4 bg-muted/20">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-foreground flex items-center gap-1.5">
              <Calculator className="size-4 text-primary" />
              Thiết lập thang điểm 100
            </span>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/25">
              Thang điểm: 100 điểm
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Chỉ cần nhập tổng điểm từng phần; hệ thống tự động chia đều điểm cho từng câu và từng ý Phần II.
          </p>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleResetSuggested}
            disabled={totalQuestions === 0}
            className="h-7 px-2.5 text-xs rounded-lg gap-1"
          >
            <RotateCcw className="size-3" /> Tự chia 100đ
          </Button>
          {allowLegacyToggle && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange({
                  ...DEFAULT_SCORING,
                  enable_min_correct_percentage: scoring.enable_min_correct_percentage,
                  min_correct_percentage_for_review: scoring.min_correct_percentage_for_review,
                })
              }
              className="h-7 px-2 text-[11px] text-muted-foreground rounded-lg"
            >
              Dùng thang điểm cũ
            </Button>
          )}
        </div>
      </div>

      {/* Bảng phân bổ điểm */}
      <div className="rounded-xl border bg-background overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-muted/50 border-b text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
          <div className="col-span-4">Phần thi</div>
          <div className="col-span-2 text-center">Số câu</div>
          <div className="col-span-3 text-center">Điểm phần</div>
          <div className="col-span-3 text-right">Điểm tự phân bổ</div>
        </div>

        <div className="divide-y">
          {rows.map((r) => {
            const disabled = r.count === 0;
            const repeatingQ = isRepeating(r.partScore, r.count);
            const repeatingItem =
              r.perItem !== undefined && r.count > 0 && isRepeating(r.partScore, r.count * itemCountP2);

            return (
              <div
                key={r.key}
                className={`grid grid-cols-12 gap-2 px-3 py-2.5 items-center text-xs ${
                  disabled ? "opacity-55 bg-muted/20" : ""
                }`}
              >
                <div className="col-span-4 min-w-0">
                  <div className="font-bold text-foreground">{r.title}</div>
                  <div className="text-[11px] text-muted-foreground leading-tight">{r.subtitle}</div>
                </div>

                <div className="col-span-2 text-center">
                  <span
                    className={`inline-flex items-center justify-center px-2 py-0.5 rounded-md font-bold text-xs ${
                      disabled
                        ? "bg-muted text-muted-foreground"
                        : "bg-primary/10 text-primary border border-primary/20"
                    }`}
                  >
                    {r.count} câu
                  </span>
                </div>

                <div className="col-span-3">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="any"
                    disabled={disabled}
                    aria-label={`Điểm ${r.title}`}
                    value={disabled ? 0 : r.partScore}
                    onChange={(e) => handlePartChange(r.key, e.target.value)}
                    className="h-8 text-center font-bold text-sm"
                  />
                </div>

                <div className="col-span-3 text-right space-y-0.5">
                  {disabled ? (
                    <span className="text-muted-foreground italic">0 đ</span>
                  ) : (
                    <>
                      <div className="font-bold text-foreground">
                        {repeatingQ ? "≈ " : ""}
                        {formatScore(r.perQ)} đ/câu
                      </div>
                      {r.perItem !== undefined && (
                        <div className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                          {r.key === "p2" && p2Method === "custom_rates" ? (
                            <span>
                              Tỷ lệ: {formatScore(p2Rates["1"])}% / {formatScore(p2Rates["2"])}% / {formatScore(p2Rates["3"])}% / 100%
                            </span>
                          ) : (
                            <span>
                              {repeatingItem ? "≈ " : ""}
                              {formatScore(r.perItem)} đ/ý
                            </span>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Tổng kết */}
        <div className="grid grid-cols-12 gap-2 px-3 py-2.5 bg-muted/40 border-t items-center text-xs font-bold">
          <div className="col-span-4 text-foreground">Tổng toàn bài</div>
          <div className="col-span-2 text-center text-foreground">{totalQuestions} câu</div>
          <div
            className={`col-span-3 text-center text-sm ${
              validation.valid ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
            }`}
          >
            {formatScore(validation.total)} / 100 điểm
          </div>
          <div className="col-span-3 text-right">
            {validation.valid ? (
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-3.5" /> Đủ 100đ
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-destructive">
                <AlertTriangle className="size-3.5" /> Chưa đủ/vượt
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Cảnh báo lỗi khi tổng != 100 */}
      {!validation.valid && validation.message && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive flex items-start gap-2"
        >
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>{validation.message}</span>
        </div>
      )}

      {/* KHU VỰC PHẦN II: THIẾT LẬP TỶ LỆ ĐIỂM THEO SỐ Ý ĐÚNG */}
      {(counts.p2 > 0 || p2Method === "custom_rates") && (
        <div className="rounded-xl border border-indigo-500/25 bg-background/90 p-3.5 space-y-3">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <div className="text-xs font-extrabold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
                THIẾT LẬP TỶ LỆ ĐIỂM THEO SỐ Ý ĐÚNG
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Áp dụng cho Phần II – Trắc nghiệm Đúng/Sai ({counts.p2} câu • {formatScore(perQ2)} điểm tối đa/câu).
              </p>
            </div>
            {p2Method === "custom_rates" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetP2Rates}
                className="h-7 px-2.5 text-[11px] rounded-lg gap-1 shrink-0"
              >
                <RotateCcw className="size-3" /> Khôi phục thiết lập mặc định
              </Button>
            )}
          </div>

          {/* Chọn phương thức tính điểm Phần II */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Phương thức tính điểm Phần II">
            <button
              type="button"
              role="radio"
              aria-checked={p2Method === "equal"}
              onClick={() => handleP2MethodChange("equal")}
              className={`text-left rounded-xl border p-2.5 transition-all ${
                p2Method === "equal"
                  ? "border-primary bg-primary/8 ring-1 ring-primary/40"
                  : "border-border hover:bg-muted/40"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-foreground">Phương thức 1: Chia đều từng ý</span>
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    p2Method === "equal"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  Mặc định
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1 leading-snug">
                Mỗi ý đúng nhận 1/{itemCountP2} điểm câu (25% / 50% / 75% / 100%).
              </div>
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={p2Method === "custom_rates"}
              onClick={() => handleP2MethodChange("custom_rates")}
              className={`text-left rounded-xl border p-2.5 transition-all ${
                p2Method === "custom_rates"
                  ? "border-indigo-600 bg-indigo-500/10 ring-1 ring-indigo-500/40"
                  : "border-border hover:bg-muted/40"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-foreground">Phương thức 2: Tỷ lệ giáo viên thiết lập</span>
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    p2Method === "custom_rates"
                      ? "bg-indigo-600 text-white"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  Tùy chỉnh %
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1 leading-snug">
                Tính điểm theo % tương ứng khi đúng 1/4, 2/4, 3/4, 4/4 ý (mặc định 10% / 25% / 50% / 100%).
              </div>
            </button>
          </div>

          {/* Bảng thiết lập tỷ lệ % khi chọn Phương thức 2 */}
          {p2Method === "custom_rates" && (
            <div className="space-y-2.5 pt-1">
              <div className="rounded-xl border overflow-hidden bg-card">
                <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-muted/50 border-b text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
                  <div className="col-span-5">Số ý trả lời đúng</div>
                  <div className="col-span-4 text-center">Tỷ lệ điểm câu hỏi</div>
                  <div className="col-span-3 text-right">Điểm / câu</div>
                </div>

                <div className="divide-y text-xs">
                  {/* Đúng 0 ý */}
                  <div className="grid grid-cols-12 gap-2 px-3 py-2 items-center bg-muted/20 text-muted-foreground">
                    <div className="col-span-5 font-medium">Đúng 0/4 ý</div>
                    <div className="col-span-4 text-center font-semibold">0% (cố định)</div>
                    <div className="col-span-3 text-right font-semibold">0 đ</div>
                  </div>

                  {/* Đúng 1/4, 2/4, 3/4 ý */}
                  {(["1", "2", "3"] as const).map((lvl) => {
                    const rateVal = p2Rates[lvl];
                    const earnedPreview = (perQ2 * (Number.isFinite(rateVal) ? Math.max(0, Math.min(100, rateVal)) : 0)) / 100;
                    const repPreview =
                      perQ2 > 0 && Math.abs(Math.round(earnedPreview * 100) / 100 - earnedPreview) > 1e-7;

                    return (
                      <div key={lvl} className="grid grid-cols-12 gap-2 px-3 py-2 items-center">
                        <div className="col-span-5 font-semibold text-foreground">
                          Đúng {lvl}/4 ý
                        </div>
                        <div className="col-span-4 flex items-center justify-center gap-1.5">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step="any"
                            aria-label={`Tỷ lệ đúng ${lvl}/4 ý`}
                            value={rateVal}
                            onChange={(e) => handleP2RateChange(lvl, e.target.value)}
                            className="h-8 w-20 text-center font-bold text-xs"
                          />
                          <span className="font-bold text-muted-foreground">%</span>
                        </div>
                        <div className="col-span-3 text-right font-bold text-indigo-600 dark:text-indigo-400">
                          {repPreview ? "≈ " : ""}
                          {formatScore(earnedPreview)} đ
                        </div>
                      </div>
                    );
                  })}

                  {/* Đúng 4/4 ý */}
                  <div className="grid grid-cols-12 gap-2 px-3 py-2 items-center bg-emerald-500/5">
                    <div className="col-span-5 font-bold text-foreground">Đúng 4/4 ý</div>
                    <div className="col-span-4 text-center font-bold text-emerald-600 dark:text-emerald-400">
                      100% <span className="text-[10px] font-medium text-muted-foreground">(Mặc định)</span>
                    </div>
                    <div className="col-span-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                      {isRepeating(parts.p2, counts.p2) ? "≈ " : ""}
                      {formatScore(perQ2)} đ
                    </div>
                  </div>
                </div>
              </div>

              {/* Cảnh báo sai phạm dữ liệu / thứ tự tỷ lệ */}
              {rateValidation.message && (
                <div
                  role="alert"
                  className={`rounded-lg border px-3 py-2 text-xs space-y-2 ${
                    rateValidation.hasRangeError || !rateValidation.valid
                      ? "border-destructive/40 bg-destructive/10 text-destructive"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                  }`}
                >
                  <div className="flex items-start gap-2 font-semibold">
                    <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                    <span>{rateValidation.message}</span>
                  </div>
                  {rateValidation.isNonMonotonic && !rateValidation.hasRangeError && (
                    <label className="flex items-center gap-2 cursor-pointer text-[11px] font-bold text-foreground pl-6 select-none">
                      <input
                        type="checkbox"
                        checked={allowNonMonotonic}
                        onChange={(e) => handleToggleAllowNonMonotonic(e.target.checked)}
                        className="rounded border-amber-500 accent-amber-600"
                      />
                      <span>Tôi đã kiểm tra và xác nhận sử dụng tỷ lệ không tăng dần này</span>
                    </label>
                  )}
                </div>
              )}

              {/* Hướng dẫn ngắn */}
              <div className="rounded-lg bg-muted/40 border px-3 py-2 text-[11px] text-muted-foreground flex items-start gap-2 leading-relaxed">
                <Info className="size-3.5 shrink-0 mt-0.5 text-indigo-600 dark:text-indigo-400" />
                <span>
                  Tỷ lệ phần trăm được tính trên điểm tối đa của chính câu hỏi Đúng/Sai đó (
                  <strong>P = {formatScore(perQ2)} điểm/câu</strong>), không phải tổng điểm cả Phần II. Điểm câu = P × Tỷ lệ / 100.
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {overallValid && (counts.p2 > 0 || isRepeating(parts.p1, counts.p1) || isRepeating(parts.p3, counts.p3)) && (
        <div className="text-[11px] text-muted-foreground leading-relaxed">
          {counts.p2 > 0 && (
            <span>
              • Phần II đang dùng phương thức{" "}
              <strong>
                {p2Method === "custom_rates"
                  ? `tỷ lệ giáo viên thiết lập (${formatScore(p2Rates["1"])}% / ${formatScore(p2Rates["2"])}% / ${formatScore(p2Rates["3"])}% / 100%)`
                  : "chia đều điểm theo từng ý"}
              </strong>
              .{" "}
            </span>
          )}
          {(isRepeating(parts.p1, counts.p1) || isRepeating(parts.p2, counts.p2 * itemCountP2) || isRepeating(parts.p3, counts.p3)) && (
            <span>
              • Số thập phân vô hạn tuần hoàn được tính toán chính xác nội bộ và chỉ làm tròn ở tổng điểm cuối cùng để bài làm đúng hết luôn đạt trọn <strong>100 điểm</strong>.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
