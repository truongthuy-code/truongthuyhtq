import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export type MissingItem = {
  id: string;
  label: string;
  part?: "I" | "II" | "III";
  idx?: number;
};

interface MissingAnswersAlertModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  missingQuestions: MissingItem[];
}

export default function MissingAnswersAlertModal({
  isOpen,
  onConfirm,
  missingQuestions,
}: MissingAnswersAlertModalProps) {
  // Prevent closing when user presses Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen]);

  if (!isOpen || missingQuestions.length === 0) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="missing-answers-title"
      aria-describedby="missing-answers-description"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs select-none"
      onClick={(e) => {
        // Strict requirement: clicking outside MUST NOT close the modal
        e.stopPropagation();
      }}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-slate-900 border border-amber-300/80 dark:border-amber-700/80 rounded-2xl shadow-2xl p-5 md:p-6 flex flex-col max-h-[90vh] text-left"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 pb-3 border-b border-border/70">
          <div className="size-11 rounded-xl bg-amber-100 dark:bg-amber-950/70 flex items-center justify-center shrink-0 border border-amber-300 dark:border-amber-700">
            <AlertTriangle className="size-6 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <div className="text-xs font-black tracking-widest text-amber-600 dark:text-amber-400 uppercase">
              ⚠️ CẢNH BÁO
            </div>
            <h2 id="missing-answers-title" className="text-lg font-bold text-foreground leading-tight">
              Phát hiện câu hỏi chưa có đáp án!
            </h2>
          </div>
        </div>

        {/* Content Body */}
        <div id="missing-answers-description" className="py-4 space-y-3 flex-1 overflow-hidden flex flex-col">
          <p className="text-sm text-foreground/90 leading-relaxed">
            Đề nguồn có <strong className="text-amber-600 dark:text-amber-400 font-bold">{missingQuestions.length} câu chưa xác định được đáp án đúng</strong>.
          </p>
          <p className="text-xs text-muted-foreground font-medium">
            Vui lòng kiểm tra và bổ sung đáp án cho các câu sau:
          </p>

          {/* Scrollable list of missing questions */}
          <div className="flex-1 overflow-y-auto max-h-56 rounded-xl border border-border/80 bg-slate-50 dark:bg-slate-950/60 p-3 space-y-1.5 divide-y divide-border/40">
            {missingQuestions.map((q, idx) => (
              <div
                key={q.id || idx}
                className="pt-1.5 first:pt-0 flex items-center gap-2 text-xs font-semibold text-foreground/90"
              >
                <span className="size-1.5 rounded-full bg-amber-500 shrink-0" />
                <span>{q.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Sticky Footer with confirm button */}
        <div className="pt-3 border-t border-border/70 mt-auto">
          <Button
            type="button"
            onClick={onConfirm}
            className="w-full bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-bold text-sm py-2.5 h-11 rounded-xl shadow-md transition-all active:scale-98 cursor-pointer"
          >
            OK, TÔI ĐÃ BIẾT
          </Button>
        </div>
      </div>
    </div>
  );
}
