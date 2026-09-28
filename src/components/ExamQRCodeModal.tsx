import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { QRCodeSVG, QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";
import { Copy, Download, Maximize2, Minimize2, ExternalLink, QrCode, Sparkles } from "lucide-react";
import { saveAs } from "file-saver";

interface ExamQRCodeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examTitle: string;
  examCode: string;
  examUrl: string;
  className?: string;
  teacherName?: string;
}

export default function ExamQRCodeModal({
  open,
  onOpenChange,
  examTitle,
  examCode,
  examUrl,
  className,
  teacherName,
}: ExamQRCodeModalProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const copyCode = () => {
    navigator.clipboard.writeText(examCode);
    toast.success(`Đã sao chép mã bài thi: ${examCode}`);
  };

  const copyLink = () => {
    navigator.clipboard.writeText(examUrl);
    toast.success("Đã sao chép link làm bài");
  };

  const downloadQR = () => {
    try {
      // Find the canvas element inside hidden container
      const canvas = canvasRef.current?.querySelector("canvas");
      if (!canvas) {
        toast.error("Không tạo được ảnh QR để tải về");
        return;
      }

      // Create a nice branded composite canvas with white border and title
      const finalCanvas = document.createElement("canvas");
      const pad = 40;
      const headerHeight = 110;
      const footerHeight = 80;
      finalCanvas.width = canvas.width + pad * 2;
      finalCanvas.height = canvas.height + headerHeight + footerHeight;

      const ctx = finalCanvas.getContext("2d");
      if (!ctx) return;

      // Fill white background
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);

      // Header: App branding
      ctx.fillStyle = "#00B8A9";
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("HỆ THỐNG TẠO ĐỀ TRẮC NGHIỆM ONLINE", finalCanvas.width / 2, 35);

      // Exam Title
      ctx.fillStyle = "#1E293B";
      ctx.font = "bold 22px sans-serif";
      const titleToDraw = examTitle.length > 35 ? examTitle.slice(0, 32) + "..." : examTitle;
      ctx.fillText(titleToDraw, finalCanvas.width / 2, 70);

      if (className) {
        ctx.fillStyle = "#64748B";
        ctx.font = "normal 16px sans-serif";
        ctx.fillText(`Đối tượng: ${className}`, finalCanvas.width / 2, 95);
      }

      // Draw QR image
      ctx.drawImage(canvas, pad, headerHeight);

      // Footer: Exam Code & Call to Action
      ctx.fillStyle = "#0F172A";
      ctx.font = "bold 26px monospace";
      ctx.fillText(`MÃ BÀI: ${examCode}`, finalCanvas.width / 2, headerHeight + canvas.height + 40);

      ctx.fillStyle = "#64748B";
      ctx.font = "italic 15px sans-serif";
      ctx.fillText("Quét mã QR hoặc nhập mã bài thi để tham gia", finalCanvas.width / 2, headerHeight + canvas.height + 65);

      finalCanvas.toBlob((blob) => {
        if (blob) {
          const safeName = examCode.replace(/[^a-zA-Z0-9-]/g, "_");
          saveAs(blob, `QR_BaiThi_${safeName}.png`);
          toast.success("Đã tải ảnh mã QR bài thi về máy");
        }
      });
    } catch (e: any) {
      toast.error("Lỗi tải mã QR: " + e.message);
    }
  };

  return (
    <>
      {/* Hidden canvas used for generating crisp high-res downloadable PNG */}
      <div ref={canvasRef} className="hidden" aria-hidden="true">
        <QRCodeCanvas value={examUrl} size={500} level="H" includeMargin={true} />
      </div>

      {/* FULLSCREEN PRESENTATION MODE FOR PROJECTOR / TV */}
      {isFullscreen ? (
        <div className="fixed inset-0 z-[100] bg-slate-950/95 backdrop-blur-md flex flex-col justify-between items-center p-6 text-white select-none animate-fade-in">
          {/* Header Controls */}
          <div className="w-full max-w-4xl flex items-center justify-between">
            <div className="flex items-center gap-2 text-primary font-bold text-sm">
              <Sparkles className="size-4" />
              <span>CHẾ ĐỘ TRÌNH CHIẾU MÃ QR CHO HỌC SINH</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsFullscreen(false)}
              className="rounded-xl border-white/30 text-white hover:bg-white/10 gap-1.5"
            >
              <Minimize2 className="size-4" /> Thu nhỏ
            </Button>
          </div>

          {/* Main Presenter Stage */}
          <div className="my-auto flex flex-col items-center text-center max-w-2xl">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-white mb-2">
              {examTitle}
            </h1>
            {className && (
              <div className="text-lg sm:text-xl text-primary font-bold mb-4">
                Dành cho: {className}
              </div>
            )}

            {/* Giant QR Code Container */}
            <div className="p-6 sm:p-8 bg-white rounded-3xl shadow-2xl my-4 border-4 border-primary">
              <QRCodeSVG
                value={examUrl}
                size={window.innerWidth < 640 ? 260 : 360}
                level="H"
                includeMargin={false}
              />
            </div>

            {/* Huge Prominent Exam Code */}
            <div className="mt-4 flex flex-col sm:flex-row items-center gap-3">
              <div className="text-sm uppercase tracking-wider text-slate-400 font-medium">
                Hoặc nhập mã bài thi:
              </div>
              <div
                onClick={copyCode}
                className="px-6 py-2.5 rounded-2xl bg-white/15 border-2 border-primary text-primary font-mono text-3xl sm:text-4xl font-black tracking-widest cursor-pointer hover:bg-white/20 transition-all flex items-center gap-2"
                title="Nhấn để sao chép mã"
              >
                <span>{examCode}</span>
                <Copy className="size-5 opacity-70" />
              </div>
            </div>

            <p className="text-slate-300 text-sm sm:text-base mt-4 font-medium">
              👉 <b>Học sinh mở camera hoặc vào trang cá nhân HS quét mã QR để tham gia bài thi.</b>
            </p>
          </div>

          {/* Footer note */}
          <div className="text-xs text-slate-400">
            {teacherName ? `Giáo viên: ${teacherName} • ` : ""}Nhấn nút Thu nhỏ hoặc phím Esc để đóng
          </div>
        </div>
      ) : (
        /* STANDARD DIALOG */
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="max-w-md sm:max-w-lg rounded-3xl p-6 sm:p-8 border-2 shadow-2xl">
            <DialogHeader className="text-center">
              <div className="size-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-2">
                <QrCode className="size-6" />
              </div>
              <DialogTitle className="text-xl sm:text-2xl font-black text-foreground">
                Thông tin & Mã QR bài thi
              </DialogTitle>
              <DialogDescription className="text-sm font-medium text-foreground/80">
                {examTitle}
                {className && <span className="block text-primary font-bold">Lớp: {className}</span>}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col items-center mt-2 space-y-5">
              {/* QR Code Card */}
              <div className="p-5 bg-white rounded-3xl border-2 border-border shadow-md flex items-center justify-center">
                <QRCodeSVG value={examUrl} size={220} level="H" includeMargin={false} />
              </div>

              {/* Exam Code Display with Copy Button */}
              <div className="w-full rounded-2xl bg-muted/60 border p-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                    Mã bài thi (ngắn gọn)
                  </div>
                  <div className="text-2xl font-mono font-black text-primary tracking-wider">
                    {examCode}
                  </div>
                </div>
                <Button
                  onClick={copyCode}
                  size="sm"
                  className="rounded-xl font-bold bg-primary text-primary-foreground gap-1.5 shrink-0"
                >
                  <Copy className="size-4" /> Sao chép mã
                </Button>
              </div>

              {/* Share link box */}
              <div className="w-full space-y-1.5">
                <div className="text-xs font-bold text-muted-foreground">Link làm bài trực tiếp:</div>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={examUrl}
                    className="w-full text-xs font-mono px-3 py-2 rounded-xl bg-muted/40 border text-muted-foreground outline-none select-all"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyLink}
                    className="rounded-xl shrink-0 gap-1 text-xs"
                  >
                    <Copy className="size-3.5" /> Copy
                  </Button>
                </div>
              </div>

              {/* Action Buttons: Fullscreen & Download */}
              <div className="w-full grid grid-cols-2 gap-2.5 pt-1">
                <Button
                  onClick={() => setIsFullscreen(true)}
                  className="rounded-2xl font-bold text-sm bg-gradient-to-r from-primary to-sky-600 text-white shadow-md gap-1.5 py-5"
                >
                  <Maximize2 className="size-4" /> Phóng to mã QR
                </Button>
                <Button
                  variant="outline"
                  onClick={downloadQR}
                  className="rounded-2xl font-bold text-sm border-2 gap-1.5 py-5"
                >
                  <Download className="size-4" /> Tải ảnh QR
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
