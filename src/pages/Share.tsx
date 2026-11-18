import { useEffect, useState, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Copy,
  ArrowLeft,
  BarChart3,
  Trophy,
  StopCircle,
  QrCode,
  Download,
  Maximize2,
  Plus,
  Trash2,
  Sparkles,
  Users,
  CheckCircle2,
  ExternalLink,
  Link2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { QRCodeSVG, QRCodeCanvas } from "qrcode.react";
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

export default function Share() {
  const { id } = useParams();
  const [exam, setExam] = useState<any>(null);
  const [assignments, setAssignments] = useState<ExamAssignment[]>([]);
  const [primaryCode, setPrimaryCode] = useState("");
  const [shortCode, setShortCode] = useState("");
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

  // Form tạo lượt giao bài mới theo lớp
  const [newClass, setNewClass] = useState("");
  const [newCustomCode, setNewCustomCode] = useState("");
  const [creatingAssign, setCreatingAssign] = useState(false);
  const [syncingCodes, setSyncingCodes] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);

  const syncExamResources = async (data: any) => {
    setSyncingCodes(true);
    setSyncError(null);
    const syncErrors: string[] = [];

    const syncRes = await syncExamAssignmentCodes(data);
    if (!syncRes.success) {
      syncErrors.push(syncRes.error || "Không thể đồng bộ mã bài thi lên máy chủ.");
    }

    const effectiveExam = syncRes.primaryCode
      ? {
          ...data,
          team_config: {
            ...((data.team_config as any) || {}),
            primary_code: syncRes.primaryCode,
          },
        }
      : data;

    if (syncRes.primaryCode) {
      setPrimaryCode(syncRes.primaryCode);
      setExam((prev: any) => (prev ? { ...prev, team_config: effectiveExam.team_config } : prev));
    }

    try {
      const sl = await ensureExamShortLink({ exam: effectiveExam });
      if (sl?.shortCode) setShortCode(sl.shortCode);
    } catch (err: any) {
      syncErrors.push(err?.message || "Không thể tạo hoặc lưu link ngắn bài thi.");
    }

    const list = await getAssignmentsForExam(data.id, effectiveExam);
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
    if (syncErrors.length > 0) {
      setSyncError(syncErrors[0]);
    }
    setSyncingCodes(false);
  };

  useEffect(() => {
    if (!id) return;
    setLoadError(null);
    supabase
      .from("exams")
      .select("*")
      .eq("id", id)
      .maybeSingle()
      .then(async ({ data, error }) => {
        if (error) {
          setLoadError("Không thể tải thông tin đề thi từ máy chủ: " + error.message);
          setSyncingCodes(false);
          return;
        }
        if (!data) {
          setLoadError("Không tìm thấy đề thi hoặc bạn không có quyền truy cập đề thi này.");
          setSyncingCodes(false);
          return;
        }
        setExam(data);
        const pCode = getExamPrimaryCode(data);
        setPrimaryCode(pCode);
        const existingShort = getExamPrimaryShortCode(data);
        if (existingShort) setShortCode(existingShort);
        await syncExamResources(data);
      });
  }, [id]);

  if (loadError) {
    return (
      <div className="container max-w-lg py-20 text-center space-y-4">
        <AlertCircle className="size-10 text-destructive mx-auto" />
        <p className="text-sm font-semibold text-destructive">{loadError}</p>
        <Button asChild variant="outline">
          <Link to="/">Quay lại trang chủ</Link>
        </Button>
      </div>
    );
  }

  if (!exam) return <div className="container py-20 text-center text-muted-foreground">Đang tải…</div>;

  const publicOrigin = getExamPublicOrigin();
  const mainUrl = primaryCode
    ? `${publicOrigin}/take/${id}?code=${encodeURIComponent(primaryCode)}`
    : `${publicOrigin}/take/${id}`;
  const primaryLinkCode = /^\d{6}$/.test(primaryCode) ? primaryCode : shortCode;
  const shortUrl = primaryLinkCode ? getShortExamUrl(primaryLinkCode) : "";
  const primaryLinkPath = primaryLinkCode
    ? /^\d{6}$/.test(primaryLinkCode)
      ? `/${primaryLinkCode}`
      : `/e/${primaryLinkCode}`
    : "";
  const qrUrl = shortUrl || mainUrl;
  const lbUrl = `${publicOrigin}/leaderboard/${id}`;
  const isTeam = exam.display_mode === "team";

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
      const container = document.createElement("div");
      document.body.appendChild(container);

      // Create a composite canvas
      const canvas = document.createElement("canvas");
      const qrSize = 400;
      const pad = 40;
      const headerH = 110;
      const footerH = 90;

      canvas.width = qrSize + pad * 2;
      canvas.height = qrSize + headerH + footerH;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Draw background
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Header branding
      ctx.fillStyle = "#00B8A9";
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("HỆ THỐNG TẠO ĐỀ TRẮC NGHIỆM ONLINE", canvas.width / 2, 35);

      // Title
      ctx.fillStyle = "#1E293B";
      ctx.font = "bold 22px sans-serif";
      const shortTitle = titleToDownload.length > 32 ? titleToDownload.slice(0, 30) + "..." : titleToDownload;
      ctx.fillText(shortTitle, canvas.width / 2, 70);

      if (classLabel) {
        ctx.fillStyle = "#64748B";
        ctx.font = "bold 16px sans-serif";
        ctx.fillText(`Lớp / Đối tượng: ${classLabel}`, canvas.width / 2, 95);
      }

      // Render temporary QR on hidden canvas
      const tempDiv = document.createElement("div");
      tempDiv.style.display = "none";
      document.body.appendChild(tempDiv);

      // Simple QR rendering onto final canvas using an Image
      const qrImg = new Image();
      // Use SVG Data URI from qrcode.react
      const svg = document.querySelector("#primary-qr-svg") as SVGElement;
      if (svg) {
        const svgData = new XMLSerializer().serializeToString(svg);
        const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
        const svgUrl = URL.createObjectURL(svgBlob);

        qrImg.onload = () => {
          ctx.drawImage(qrImg, pad, headerH, qrSize, qrSize);
          URL.revokeObjectURL(svgUrl);

          // Footer Code
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
              toast.success("Đã tải ảnh mã QR bài thi");
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

  const endActivity = async () => {
    const { error } = await supabase.from("exams").update({ team_activity_ended: true } as any).eq("id", id!);
    if (error) {
      toast.error("Lỗi: " + error.message);
      return;
    }
    setExam({ ...exam, team_activity_ended: true });
    toast.success("Đã kết thúc hoạt động");
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-16">
      {/* Top Header */}
      <header className="border-b bg-card/95 backdrop-blur sticky top-0 z-30 shadow-sm">
        <div className="container max-w-4xl flex items-center justify-between py-3.5 px-4">
          <Link to="/" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Quay lại trang chủ
          </Link>
          <div className="text-xs font-bold text-primary flex items-center gap-1.5">
            <Sparkles className="size-4" />
            <span>Tạo link & Mã bài thi</span>
          </div>
        </div>
      </header>

      <main className="container max-w-3xl py-8 px-4 space-y-6">
        {/* Success or Sync Warning badge */}
        {syncError ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-destructive/10 border border-destructive/30 p-4 rounded-2xl text-destructive">
            <div className="flex items-start gap-3">
              <AlertCircle className="size-5 shrink-0 mt-0.5" />
              <div className="text-sm font-semibold">
                Chưa đồng bộ xong mã bài thi lên máy chủ: {syncError}
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={syncingCodes}
              onClick={() => syncExamResources(exam)}
              className="gap-1.5 border-destructive/40 text-destructive shrink-0"
            >
              <RefreshCw className={`size-3.5 ${syncingCodes ? "animate-spin" : ""}`} /> Thử lại đồng bộ
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 p-4 rounded-2xl text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="size-6 shrink-0 text-emerald-500" />
            <div className="text-sm font-semibold">
              {syncingCodes
                ? "Đang đồng bộ mã bài thi và link ngắn lên hệ thống..."
                : <>Đề thi đã sẵn sàng! Học sinh có thể làm bài bằng <b>Link</b>, nhập <b>Mã bài thi</b>, hoặc quét <b>Mã QR</b>.</>}
            </div>
          </div>
        )}

        {/* 2. THÔNG TIN BÀI THI CHÍNH */}
        <Card className="p-6 sm:p-8 rounded-3xl border-2 shadow-xl bg-card">
          <div className="text-xs font-black uppercase tracking-wider text-primary mb-1">
            THÔNG TIN BÀI THI
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-foreground">{exam.title}</h1>
          <div className="mt-2 text-xs sm:text-sm text-muted-foreground flex flex-wrap gap-3">
            <span>⏱ Thời gian: <b>{exam.duration_minutes} phút</b></span>
            <span>•</span>
            <span>
              📝 Số câu:{" "}
              <b>
                {(exam.questions.partI?.length || 0) +
                  (exam.questions.partII?.length || 0) +
                  (exam.questions.partIII?.length || 0)} câu
              </b>
            </span>
            <span>•</span>
            <span>🔁 Số lần làm: <b>{exam.max_attempts}</b></span>
          </div>

          {/* QR Code & Mã bài thi Display */}
          <div className="mt-6 p-6 rounded-3xl bg-muted/40 border-2 flex flex-col md:flex-row items-center gap-6 justify-between">
            {/* QR Code */}
            <div className="p-4 bg-white rounded-2xl border shadow-sm flex flex-col items-center shrink-0">
              <QRCodeSVG
                id="primary-qr-svg"
                value={qrUrl}
                size={160}
                level="H"
                includeMargin={false}
              />
              <span className="text-[10px] text-slate-500 font-bold mt-2">MÃ QR BÀI THI</span>
            </div>

            {/* Code & Actions */}
            <div className="flex-1 w-full space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                  <Label className="text-xs text-muted-foreground uppercase font-black tracking-wider">
                    Mã bài thi:
                  </Label>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    Mã 6 chữ số để học sinh nhập vào làm bài
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="px-4 py-3 rounded-2xl bg-card border-2 border-primary/30 font-mono text-3xl sm:text-4xl font-black text-primary tracking-widest flex-1 text-center select-all shadow-inner">
                    {primaryCode}
                  </div>
                  <Button
                    onClick={() => copyCode(primaryCode)}
                    size="sm"
                    className="h-14 px-5 rounded-2xl font-black text-sm bg-gradient-to-r from-primary to-sky-600 hover:from-primary/90 hover:to-sky-600/90 text-white gap-2 shrink-0 shadow-md active:scale-[0.98] transition-all"
                  >
                    <Copy className="size-4" /> Sao chép mã
                  </Button>
                </div>
              </div>

              {/* Link làm bài ngắn (duy nhất) */}
              <div className="p-3.5 rounded-2xl bg-primary/10 border-2 border-primary/30 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Label className="text-xs font-black uppercase tracking-wider text-primary flex items-center gap-1.5">
                    <Link2 className="size-3.5" /> LINK LÀM BÀI NGẮN
                  </Label>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-background/80 text-primary border border-primary/20">
                    Dễ nhớ • Chiếu màn hình
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    readOnly
                    value={shortUrl || "Đang tạo link ngắn..."}
                    aria-label="Link làm bài ngắn"
                    className="font-mono text-sm font-bold text-primary bg-background h-10 rounded-xl select-all"
                  />
                  <div className="flex gap-2 shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      disabled={!shortUrl}
                      onClick={() => copyShortLink(shortUrl)}
                      className="h-10 px-3 rounded-xl gap-1.5 font-bold text-xs bg-primary text-primary-foreground flex-1 sm:flex-initial"
                    >
                      <Copy className="size-3.5" /> Sao chép link ngắn
                    </Button>
                    {primaryLinkPath && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        asChild
                        className="h-10 px-3 rounded-xl gap-1.5 font-bold text-xs border-primary/30 bg-background"
                      >
                        <Link to={primaryLinkPath} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="size-3.5" /> Mở link
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* Action buttons: Tạo / Phóng to QR & Tải QR từ link ngắn */}
              <div className="grid grid-cols-2 gap-2.5 pt-1">
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
                  className="rounded-xl font-bold text-xs sm:text-sm bg-gradient-to-r from-primary to-sky-600 text-white shadow gap-1.5 h-11"
                >
                  <Maximize2 className="size-4" /> Tạo QR Code
                </Button>
                <Button
                  variant="outline"
                  disabled={!shortUrl}
                  onClick={() => downloadQR(primaryCode, exam.title, qrUrl)}
                  className="rounded-xl font-bold text-xs sm:text-sm border-2 gap-1.5 h-11"
                >
                  <Download className="size-4" /> Tải mã QR
                </Button>
              </div>
            </div>
          </div>

          {/* Quick buttons */}
          <div className="mt-6 flex flex-wrap gap-2.5 justify-center sm:justify-start">
            <Button asChild variant="outline" className="rounded-xl font-bold">
              <Link to={`/exam/${id}/results`}>
                <BarChart3 className="size-4 mr-1.5" /> Xem kết quả làm bài
              </Link>
            </Button>
            {primaryLinkPath && (
              <Button asChild className="rounded-xl font-bold bg-primary text-primary-foreground">
                <Link to={primaryLinkPath} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4 mr-1.5" /> Thử làm bài (Xem trước)
                </Link>
              </Button>
            )}
          </div>

          {isTeam && (
            <div className="mt-6 rounded-2xl border-2 border-primary/40 bg-primary/5 p-5 text-left space-y-3">
              <div className="font-black text-sm flex items-center gap-2 text-foreground">
                <Trophy className="size-5 text-primary" /> Chế độ Đội / Nhóm thi đấu
              </div>
              <div className="flex gap-2">
                <Input readOnly value={lbUrl} className="font-mono text-xs rounded-xl" />
                <Button
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(lbUrl);
                    toast.success("Đã copy link bảng xếp hạng");
                  }}
                  className="rounded-xl font-bold text-xs"
                >
                  <Copy className="size-3.5" /> Copy
                </Button>
              </div>
              <div className="flex gap-2">
                <Button asChild variant="outline" className="flex-1 rounded-xl font-bold">
                  <Link to={`/leaderboard/${id}`} target="_blank">
                    Mở bảng xếp hạng
                  </Link>
                </Button>
                <Button
                  onClick={endActivity}
                  disabled={!!exam.team_activity_ended}
                  variant="destructive"
                  className="flex-1 rounded-xl font-bold"
                >
                  <StopCircle className="size-4 mr-2" />
                  {exam.team_activity_ended ? "Đã kết thúc" : "Kết thúc hoạt động"}
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* 8. QUẢN LÝ NHIỀU LƯỢT GIAO BÀI (THEO TỪNG LỚP) */}
        <Card className="p-6 sm:p-8 rounded-3xl border-2 shadow-xl bg-card space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-4">
            <div>
              <div className="text-xs font-black uppercase tracking-wider text-primary">
                QUẢN LÝ LƯỢT GIAO BÀI
              </div>
              <h2 className="text-xl font-black text-foreground">Giao bài theo từng lớp học</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Tạo mã bài thi và mã QR riêng biệt cho từng lớp (ví dụ: 12A1, 12A2, 10C3...).
              </p>
            </div>
          </div>

          {/* Form tạo lượt giao mới */}
          <form onSubmit={handleCreateAssignment} className="p-4 sm:p-5 rounded-2xl bg-muted/40 border-2 space-y-3">
            <div className="font-bold text-xs uppercase tracking-wide text-foreground">
              + Tạo mã bài thi cho lớp mới:
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold">Tên lớp / Nhóm đối tượng *</Label>
                <Input
                  placeholder="Ví dụ: 12A1, 12A2, Lớp Tin học..."
                  value={newClass}
                  onChange={(e) => setNewClass(e.target.value)}
                  className="rounded-xl mt-1 text-sm font-medium"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold">Mã bài thi tùy chỉnh (để trống để tự sinh)</Label>
                <Input
                  placeholder="Ví dụ: A1K8P2 (hoặc để tự sinh)"
                  value={newCustomCode}
                  onChange={(e) => setNewCustomCode(e.target.value.toUpperCase())}
                  className="rounded-xl mt-1 font-mono uppercase text-sm font-bold"
                />
              </div>
            </div>
            <Button
              type="submit"
              disabled={creatingAssign}
              className="w-full sm:w-auto rounded-xl font-bold bg-primary text-primary-foreground gap-1.5"
            >
              <Plus className="size-4" /> Tạo mã và QR cho lớp
            </Button>
          </form>

          {/* Danh sách lượt giao bài */}
          <div className="space-y-3">
            <div className="text-xs font-bold text-muted-foreground flex items-center justify-between">
              <span>Danh sách các lớp đã giao ({assignments.length} lượt):</span>
            </div>

            {assignments.length === 0 ? (
              <div className="text-center py-6 text-xs text-muted-foreground border-2 border-dashed rounded-2xl p-4">
                Chưa có lượt giao bài riêng cho từng lớp. Học sinh có thể dùng mã chính ở trên hoặc bạn có thể tạo mã riêng cho từng lớp ngay tại đây.
              </div>
            ) : (
              <div className="divide-y rounded-2xl border bg-card overflow-hidden">
                {assignments.map((assign) => {
                  const assignUrl = getExamShareUrl(assign.examId, assign.code);
                  const assignLinkCode = /^\d{6}$/.test(assign.code) ? assign.code : (assign.shortCode || "");
                  const assignShortUrl = assignLinkCode ? getShortExamUrl(assignLinkCode) : "";
                  const assignLinkPath = assignLinkCode
                    ? /^\d{6}$/.test(assignLinkCode)
                      ? `/${assignLinkCode}`
                      : `/e/${assignLinkCode}`
                    : "";
                  const assignQrUrl = assignShortUrl || assignUrl;
                  return (
                    <div key={assign.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="size-10 rounded-xl bg-primary/10 text-primary font-black text-sm flex items-center justify-center shrink-0 border border-primary/20">
                          <Users className="size-5" />
                        </div>
                        <div>
                          <div className="font-black text-base flex items-center gap-2 flex-wrap">
                            <span>Lớp: {assign.className}</span>
                            <span className="px-2 py-0.5 rounded-lg bg-primary/10 text-primary font-mono font-black text-xs">
                              {assign.code}
                            </span>
                            {assignShortUrl && (
                              <span className="px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-mono font-bold text-xs border border-emerald-500/20">
                                {assignShortUrl}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            Tạo lúc: {new Date(assign.createdAt).toLocaleDateString("vi-VN")}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => copyCode(assign.code)}
                          className="h-8 rounded-lg text-xs font-semibold gap-1"
                        >
                          <Copy className="size-3" /> Mã
                        </Button>
                        {assignShortUrl && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => copyShortLink(assignShortUrl)}
                            className="h-8 rounded-lg text-xs font-semibold gap-1 border-primary/30 text-primary"
                          >
                            <Link2 className="size-3" /> Sao chép link
                          </Button>
                        )}
                        {assignLinkPath && (
                          <Button
                            size="sm"
                            variant="outline"
                            asChild
                            className="h-8 rounded-lg text-xs font-semibold gap-1"
                          >
                            <Link to={assignLinkPath} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="size-3" /> Mở link
                            </Link>
                          </Button>
                        )}
                        <Button
                          size="sm"
                          className="h-8 rounded-lg text-xs font-bold bg-primary text-primary-foreground gap-1"
                          onClick={() =>
                            setSelectedQR({
                              open: true,
                              title: exam.title,
                              code: assign.code,
                              url: assignQrUrl,
                              className: assign.className,
                            })
                          }
                        >
                          <QrCode className="size-3" /> QR
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteAssignment(assign.id, assign.code)}
                          className="h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10 rounded-lg"
                          title="Xóa lượt giao này"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
      </main>

      {/* QR Code Presentation & Download Modal */}
      <ExamQRCodeModal
        open={selectedQR.open}
        onOpenChange={(open) => setSelectedQR((prev) => ({ ...prev, open }))}
        examTitle={selectedQR.title}
        examCode={selectedQR.code}
        examUrl={selectedQR.url}
        className={selectedQR.className}
        teacherName={exam.teacher_name}
      />
    </div>
  );
}
