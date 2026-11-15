import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Copy,
  QrCode,
  Download,
  Maximize2,
  ExternalLink,
  Plus,
  Users,
  Trash2,
  Sparkles,
  CheckCircle2,
  Link2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { saveAs } from "file-saver";
import ExamQRCodeModal from "@/components/ExamQRCodeModal";
import {
  ExamAssignment,
  getAssignmentsForExam,
  createAssignment,
  deleteAssignment,
  getExamPrimaryCode,
  getExamPrimaryShortCode,
  getExamShareUrl,
  syncExamAssignmentCodes,
  getExamPublicOrigin,
} from "@/lib/examAssignments";
import { ensureExamShortLink, getShortExamUrl } from "@/lib/shortLinks";

interface QuickExamShareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exam: any | null;
}

export default function QuickExamShareModal({
  open,
  onOpenChange,
  exam,
}: QuickExamShareModalProps) {
  const [assignments, setAssignments] = useState<ExamAssignment[]>([]);
  const [primaryCode, setPrimaryCode] = useState("");
  const [shortCode, setShortCode] = useState("");
  const [newClass, setNewClass] = useState("");
  const [newCustomCode, setNewCustomCode] = useState("");
  const [creatingAssign, setCreatingAssign] = useState(false);
  const [syncingCodes, setSyncingCodes] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [selectedQR, setSelectedQR] = useState<{
    open: boolean;
    title: string;
    code: string;
    url: string;
    className?: string;
  }>({
    open: false,
    title: "",
    code: "",
    url: "",
  });

  const syncModalResources = async (targetExam: any) => {
    setSyncingCodes(true);
    setSyncError(null);
    const errors: string[] = [];

    const syncRes = await syncExamAssignmentCodes(targetExam);
    if (!syncRes.success) {
      errors.push(syncRes.error || "Không thể đồng bộ mã bài thi lên máy chủ.");
    }

    const effectiveExam = syncRes.primaryCode
      ? {
          ...targetExam,
          team_config: {
            ...((targetExam.team_config as any) || {}),
            primary_code: syncRes.primaryCode,
          },
        }
      : targetExam;

    if (syncRes.primaryCode) {
      setPrimaryCode(syncRes.primaryCode);
    }

    try {
      const sl = await ensureExamShortLink({ exam: effectiveExam });
      if (sl?.shortCode) setShortCode(sl.shortCode);
    } catch (err: any) {
      errors.push(err?.message || "Không thể tạo hoặc lưu link ngắn bài thi.");
    }

    const list = await getAssignmentsForExam(targetExam.id, effectiveExam);
    const enrichedList = await Promise.all(
      list.map(async (item) => {
        if (item.shortCode) return item;
        try {
          const sl = await ensureExamShortLink({ exam: effectiveExam, assignment: item });
          return sl?.shortCode ? { ...item, shortCode: sl.shortCode } : item;
        } catch {
          return item;
        }
      })
    );
    setAssignments(enrichedList);
    if (errors.length > 0) {
      setSyncError(errors[0]);
    }
    setSyncingCodes(false);
  };

  useEffect(() => {
    if (open && exam?.id) {
      const pCode = getExamPrimaryCode(exam);
      setPrimaryCode(pCode);
      const existingShort = getExamPrimaryShortCode(exam);
      setShortCode(existingShort);
      syncModalResources(exam);
    }
  }, [open, exam]);

  if (!exam) return null;

  const publicOrigin = getExamPublicOrigin();
  const mainUrl = primaryCode
    ? `${publicOrigin}/take/${exam.id}?code=${encodeURIComponent(primaryCode)}`
    : `${publicOrigin}/take/${exam.id}`;
  const shortUrl = shortCode ? getShortExamUrl(shortCode) : "";
  const qrUrl = shortUrl || mainUrl;

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success(`Đã sao chép mã bài thi: ${code}`);
  };

  const copyShortLink = (url: string) => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    toast.success("Đã sao chép link ngắn bài thi");
  };

  const downloadQR = (codeToDownload: string, titleToDownload: string, urlToDownload: string, classLabel?: string) => {
    try {
      const canvas = document.createElement("canvas");
      const qrSize = 400;
      const pad = 40;
      const headerH = 110;
      const footerH = 90;

      canvas.width = qrSize + pad * 2;
      canvas.height = qrSize + headerH + footerH;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Background
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Header branding
      ctx.fillStyle = "#00B8A9";
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("HỆ THỐNG TẠO ĐỀ TRẮC NGHIỆM ONLINE", canvas.width / 2, 35);

      // Exam title
      ctx.fillStyle = "#1E293B";
      ctx.font = "bold 22px sans-serif";
      const shortTitle = titleToDownload.length > 32 ? titleToDownload.slice(0, 30) + "..." : titleToDownload;
      ctx.fillText(shortTitle, canvas.width / 2, 70);

      if (classLabel) {
        ctx.fillStyle = "#64748B";
        ctx.font = "bold 16px sans-serif";
        ctx.fillText(`Lớp / Đối tượng: ${classLabel}`, canvas.width / 2, 95);
      }

      // Convert SVG to image
      const qrImg = new Image();
      const svg = document.querySelector("#quick-qr-svg") as SVGElement;
      if (svg) {
        const svgData = new XMLSerializer().serializeToString(svg);
        const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
        const svgUrl = URL.createObjectURL(svgBlob);

        qrImg.onload = () => {
          ctx.drawImage(qrImg, pad, headerH, qrSize, qrSize);
          URL.revokeObjectURL(svgUrl);

          ctx.fillStyle = "#0F172A";
          ctx.font = "bold 26px monospace";
          ctx.fillText(`MÃ BÀI THI: ${codeToDownload}`, canvas.width / 2, headerH + qrSize + 40);

          ctx.fillStyle = "#64748B";
          ctx.font = "italic 15px sans-serif";
          ctx.fillText("Quét mã QR hoặc nhập mã bài thi để tham gia", canvas.width / 2, headerH + qrSize + 68);

          canvas.toBlob((blob) => {
            if (blob) {
              const safeName = codeToDownload.replace(/[^a-zA-Z0-9-]/g, "_");
              saveAs(blob, `QR_BaiThi_${safeName}.png`);
              toast.success("Đã tải ảnh mã QR bài thi về máy");
            }
          });
        };
        qrImg.src = svgUrl;
      }
    } catch (e: any) {
      toast.error("Lỗi tải mã QR: " + e.message);
    }
  };

  const handleCreateAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClass.trim()) {
      toast.error("Vui lòng nhập tên lớp hoặc đợt thi (ví dụ: 12A1)");
      return;
    }
    setCreatingAssign(true);
    try {
      const created = await createAssignment({
        exam,
        className: newClass.trim(),
        customCode: newCustomCode.trim() || undefined,
      });
      setAssignments((prev) => [created, ...prev]);
      setNewClass("");
      setNewCustomCode("");
      toast.success(`Đã tạo mã giao bài [${created.code}] cho lớp ${created.className}!`);
    } catch (err: any) {
      toast.error("Lỗi tạo lượt giao bài: " + err.message);
    } finally {
      setCreatingAssign(false);
    }
  };

  const handleDeleteAssignment = async (assignId: string, assignCode: string) => {
    if (!confirm(`Bạn có chắc muốn xóa mã giao bài ${assignCode}?`)) return;
    const ok = await deleteAssignment(exam.id, assignId);
    if (ok) {
      setAssignments((prev) => prev.filter((a) => a.id !== assignId));
      toast.success("Đã xóa lượt giao bài");
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl rounded-3xl p-6 sm:p-8 border-2 shadow-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-2 text-primary font-black text-xs uppercase tracking-wider mb-1">
              <Sparkles className="size-4" />
              <span>THÔNG TIN BÀI THI & MÃ QR</span>
            </div>
            <DialogTitle className="text-xl sm:text-2xl font-black text-foreground">
              {exam.title}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Chia sẻ link, mã bài thi hoặc chiếu mã QR để học sinh tham gia làm bài.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 my-2">
            {syncError && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs font-semibold flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertCircle className="size-4 shrink-0" />
                  <span>{syncError}</span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={syncingCodes}
                  onClick={() => syncModalResources(exam)}
                  className="h-7 px-2.5 text-xs border-destructive/40 text-destructive shrink-0 gap-1"
                >
                  <RefreshCw className={`size-3 ${syncingCodes ? "animate-spin" : ""}`} /> Thử lại
                </Button>
              </div>
            )}

            {/* 1. THÔNG TIN BÀI THI CHÍNH */}
            <div className="p-5 rounded-2xl bg-muted/40 border-2 flex flex-col md:flex-row items-center gap-5 justify-between">
              {/* QR Code */}
              <div className="p-3 bg-white rounded-2xl border shadow-sm flex flex-col items-center shrink-0">
                <QRCodeSVG
                  id="quick-qr-svg"
                  value={qrUrl}
                  size={150}
                  level="H"
                  includeMargin={false}
                />
                <span className="text-[10px] text-slate-500 font-bold mt-1.5">MÃ QR BÀI THI</span>
              </div>

              {/* Code & Links */}
              <div className="flex-1 w-full space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
                    <Label className="text-[11px] text-muted-foreground uppercase font-black tracking-wider">
                      Mã bài thi:
                    </Label>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                      Mã 6 chữ số
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="px-3.5 py-2.5 rounded-xl bg-card border-2 border-primary/30 font-mono text-2xl sm:text-3xl font-black text-primary tracking-widest flex-1 text-center select-all shadow-inner">
                      {primaryCode}
                    </div>
                    <Button
                      onClick={() => copyCode(primaryCode)}
                      size="sm"
                      className="h-11 px-4 rounded-xl font-black bg-primary text-primary-foreground gap-1.5 shrink-0 text-xs shadow-md"
                    >
                      <Copy className="size-3.5" /> Sao chép mã
                    </Button>
                  </div>
                </div>

                {/* Link làm bài ngắn (duy nhất) */}
                <div className="p-3 rounded-xl bg-primary/10 border border-primary/30 space-y-1.5">
                  <Label className="text-[11px] font-black uppercase tracking-wider text-primary flex items-center gap-1">
                    <Link2 className="size-3" /> LINK LÀM BÀI NGẮN
                  </Label>
                  <div className="flex flex-col sm:flex-row gap-1.5">
                    <Input
                      readOnly
                      value={shortUrl || "Đang tạo link ngắn..."}
                      aria-label="Link làm bài ngắn"
                      className="font-mono text-xs font-bold text-primary bg-background h-9 rounded-xl select-all"
                    />
                    <div className="flex gap-1.5 shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        disabled={!shortUrl}
                        onClick={() => copyShortLink(shortUrl)}
                        className="h-9 px-2.5 rounded-xl gap-1 font-bold text-xs bg-primary text-primary-foreground flex-1 sm:flex-initial"
                      >
                        <Copy className="size-3" /> Sao chép link ngắn
                      </Button>
                      {shortCode && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          asChild
                          className="h-9 px-2.5 rounded-xl gap-1 font-bold text-xs border-primary/30 bg-background"
                        >
                          <Link to={`/e/${shortCode}`} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="size-3" /> Mở link
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Nút Tạo QR Code (Phóng to) & Tải mã QR từ link ngắn */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button
                    disabled={!shortUrl}
                    onClick={() =>
                      setSelectedQR({
                        open: true,
                        title: exam.title,
                        code: primaryCode,
                        url: qrUrl,
                      })
                    }
                    className="rounded-xl font-bold text-xs bg-gradient-to-r from-primary to-sky-600 text-white shadow gap-1.5 h-10"
                  >
                    <Maximize2 className="size-3.5" /> Tạo QR Code
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!shortUrl}
                    onClick={() => downloadQR(primaryCode, exam.title, qrUrl)}
                    className="rounded-xl font-bold text-xs border-2 gap-1.5 h-10"
                  >
                    <Download className="size-3.5" /> Tải mã QR
                  </Button>
                </div>
              </div>
            </div>

            {/* 2. CÁC LƯỢT GIAO BÀI THEO LỚP */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm text-foreground flex items-center gap-1.5">
                    <Users className="size-4 text-primary" /> Lượt giao bài theo lớp ({assignments.length})
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    Tạo mã riêng cho từng lớp để dễ quản lý kết quả.
                  </p>
                </div>
              </div>

              {/* Form tạo mã cho lớp */}
              <form onSubmit={handleCreateAssignment} className="p-3 rounded-xl bg-muted/50 border flex flex-col sm:flex-row gap-2">
                <Input
                  placeholder="Tên lớp (VD: 12A1)..."
                  value={newClass}
                  onChange={(e) => setNewClass(e.target.value)}
                  className="h-9 text-xs rounded-lg"
                />
                <Input
                  placeholder="Mã tùy chọn..."
                  value={newCustomCode}
                  onChange={(e) => setNewCustomCode(e.target.value.toUpperCase())}
                  className="h-9 text-xs rounded-lg font-mono uppercase sm:w-36"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={creatingAssign}
                  className="h-9 px-3 rounded-lg text-xs font-bold shrink-0 bg-primary"
                >
                  <Plus className="size-3.5 mr-1" /> Thêm lớp
                </Button>
              </form>

              {/* List of class assignments */}
              {assignments.length > 0 && (
                <div className="divide-y rounded-xl border max-h-48 overflow-y-auto bg-card text-xs">
                  {assignments.map((a) => {
                    const aUrl = getExamShareUrl(a.examId, a.code);
                    const aShortUrl = a.shortCode ? getShortExamUrl(a.shortCode) : "";
                    const aQrUrl = aShortUrl || aUrl;
                    return (
                      <div key={a.id} className="p-2.5 flex items-center justify-between gap-2 hover:bg-muted/30">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold">Lớp {a.className}</span>:{" "}
                          <span className="font-mono font-black text-primary px-1.5 py-0.5 rounded bg-primary/10">
                            {a.code}
                          </span>
                          {a.shortCode && (
                            <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded bg-emerald-500/10 text-[11px]">
                              /e/{a.shortCode}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {aShortUrl && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => copyShortLink(aShortUrl)}
                              className="h-7 px-2 text-[11px] text-primary gap-1"
                              title="Sao chép link ngắn"
                            >
                              <Link2 className="size-3" /> Link ngắn
                            </Button>
                          )}
                          {a.shortCode && (
                            <Button
                              size="sm"
                              variant="ghost"
                              asChild
                              className="h-7 px-2 text-[11px]"
                              title="Mở link"
                            >
                              <Link to={`/e/${a.shortCode}`} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="size-3" />
                              </Link>
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => copyCode(a.code)}
                            className="h-7 px-2 text-[11px]"
                            title="Sao chép mã"
                          >
                            <Copy className="size-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setSelectedQR({
                                open: true,
                                title: exam.title,
                                code: a.code,
                                url: aQrUrl,
                                className: a.className,
                              })
                            }
                            className="h-7 px-2 text-[11px] gap-1 font-semibold"
                          >
                            <QrCode className="size-3" /> QR
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteAssignment(a.id, a.code)}
                            className="h-7 px-1.5 text-destructive hover:text-destructive"
                            title="Xóa"
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Bottom Actions */}
            <div className="pt-2 border-t flex flex-col sm:flex-row items-center justify-between gap-2">
              <Button asChild variant="outline" size="sm" className="rounded-xl text-xs w-full sm:w-auto">
                <Link to={`/exam/${exam.id}/share`} onClick={() => onOpenChange(false)}>
                  <ExternalLink className="size-3.5 mr-1" /> Mở trang quản lý giao bài đầy đủ
                </Link>
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="rounded-xl text-xs font-bold w-full sm:w-auto"
              >
                Đóng
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* QR Code Presentation & Download Modal */}
      <ExamQRCodeModal
        open={selectedQR.open}
        onOpenChange={(op) => setSelectedQR((prev) => ({ ...prev, open: op }))}
        examTitle={selectedQR.title}
        examCode={selectedQR.code}
        examUrl={selectedQR.url}
        className={selectedQR.className}
        teacherName={exam.teacher_name}
      />
    </>
  );
}
