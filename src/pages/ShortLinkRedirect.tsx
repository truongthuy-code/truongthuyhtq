import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { AlertCircle, KeyRound, Loader2, RefreshCw, WifiOff } from "lucide-react";
import QuizBackground from "@/components/QuizBackground";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { resolveShortLink } from "@/lib/shortLinks";
import type { ExamAccessErrorType } from "@/lib/examAccessLogger";

export default function ShortLinkRedirect() {
  const { code } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [errorState, setErrorState] = useState<{
    message: string;
    errorType?: ExamAccessErrorType;
  } | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setErrorState(null);

    (async () => {
      let rawCode = "";
      try {
        rawCode = decodeURIComponent(code || "").trim();
      } catch {
        rawCode = String(code || "").trim();
      }

      if (!rawCode) {
        if (!cancelled) {
          setErrorState({
            message: "Link bài thi không hợp lệ hoặc bị thiếu mã truy cập.",
            errorType: "validation",
          });
        }
        return;
      }

      const result = await resolveShortLink(rawCode);
      if (cancelled) return;

      if (result.success && result.targetUrl) {
        let finalTarget = result.targetUrl;
        const currentParams = new URLSearchParams(location.search);
        if (currentParams.get("autoStart") === "1" || currentParams.get("autoStart") === "true") {
          finalTarget += finalTarget.includes("?") ? "&autoStart=1" : "?autoStart=1";
        }
        navigate(finalTarget, {
          replace: true,
          state: {
            exam: result.exam,
            assignment: result.assignment,
            shortCode: result.shortLink?.shortCode || rawCode.toUpperCase(),
          },
        });
        return;
      }

      setErrorState({
        message: result.error || "Link bài thi không tồn tại, đã hết hạn hoặc bị vô hiệu hóa.",
        errorType: result.errorType || "not_found",
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [code, location.search, navigate, retryNonce]);

  if (errorState) {
    const isTransient =
      errorState.errorType === "network" ||
      errorState.errorType === "server" ||
      errorState.errorType === "unauthorized";

    const title = isTransient ? "Không thể kết nối máy chủ" : "Không tìm thấy bài thi";

    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center items-center p-4 relative selection:bg-primary/20">
        <QuizBackground />
        <Card className="p-8 sm:p-10 max-w-md w-full text-center relative z-10 rounded-3xl border-2 shadow-2xl bg-card/95 backdrop-blur space-y-5 animate-slide-up">
          <div className="size-20 rounded-3xl mx-auto grid place-items-center shadow-lg bg-destructive/10 text-destructive">
            {isTransient ? <WifiOff className="size-10" /> : <AlertCircle className="size-10" />}
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-black text-foreground">{title}</h1>
            <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
              {errorState.message}
            </p>
          </div>
          <div className="pt-2 space-y-2.5 border-t">
            {isTransient && (
              <Button
                type="button"
                onClick={() => setRetryNonce((n) => n + 1)}
                className="w-full h-11 rounded-xl font-bold gap-2"
              >
                <RefreshCw className="size-4" /> Thử kết nối lại
              </Button>
            )}
            <Button asChild variant={isTransient ? "outline" : "default"} className="w-full h-11 rounded-xl font-bold gap-2">
              <Link to="/take">
                <KeyRound className="size-4" /> Nhập mã bài thi khác
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full h-11 rounded-xl font-bold">
              <Link to="/student">Quay lại trang học sinh</Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4 relative">
      <QuizBackground />
      <div className="relative z-10 flex items-center gap-3 text-primary font-bold text-base sm:text-lg bg-card/90 backdrop-blur px-8 py-5 rounded-3xl shadow-xl border-2">
        <Loader2 className="size-6 animate-spin text-primary" />
        <span>Đang mở bài thi...</span>
      </div>
    </div>
  );
}
