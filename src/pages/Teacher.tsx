import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { parseDocx, ParsedExam, hasRichContent } from "@/lib/docxParser";
import { parseTextExam } from "@/lib/textExamParser";
import { parsePdfExam } from "@/lib/pdfParser";
import { DEFAULT_SCORING, ScoringConfig } from "@/lib/grading";
import { supabase } from "@/integrations/supabase/client";
import { Upload, Loader2, FileText, ArrowLeft, AlertTriangle, Download, Image as ImageIcon, Keyboard } from "lucide-react";
import { Link } from "react-router-dom";
import RichText from "@/components/RichText";
import LockModeSettings from "@/components/LockModeSettings";
import { DEFAULT_LOCK, LockMode } from "@/hooks/useExamLock";
import ScheduleSettings, { Schedule } from "@/components/ScheduleSettings";
import TeamModeSettings, { DEFAULT_TEAM_CONFIG, TeamConfig, normalizeTeamConfig } from "@/components/TeamModeSettings";

type Issue = { part: "I" | "II" | "III"; idx: number; id: string; reason: string };

function validateExam(exam: ParsedExam): Issue[] {
  const issues: Issue[] = [];
  exam.partI.forEach((q, i) => {
    if (q.options.length !== 4) {
      issues.push({ part: "I", idx: i, id: q.id, reason: `Có ${q.options.length}/4 phương án` });
    } else {
      const empty = q.options.filter((o) => !hasRichContent(o.text)).map((o) => o.key);
      if (empty.length) issues.push({ part: "I", idx: i, id: q.id, reason: `Phương án ${empty.join(", ")} không có nội dung` });
      else if (!q.answer) issues.push({ part: "I", idx: i, id: q.id, reason: "Chưa đánh dấu đáp án (đỏ/gạch chân)" });
    }
  });
  exam.partII.forEach((q, i) => {
    if (q.items.length !== 4) {
      issues.push({ part: "II", idx: i, id: q.id, reason: `Có ${q.items.length}/4 ý` });
    } else {
      const empty = q.items.filter((it) => !hasRichContent(it.text)).map((it) => it.key);
      if (empty.length) issues.push({ part: "II", idx: i, id: q.id, reason: `Ý ${empty.join(", ")} không có nội dung` });
      else if (!q.items.some((it) => it.correct)) issues.push({ part: "II", idx: i, id: q.id, reason: "Không có ý nào được đánh dấu đúng" });
    }
  });
  exam.partIII.forEach((q, i) => {
    if (!q.answer || !q.answer.trim()) issues.push({ part: "III", idx: i, id: q.id, reason: "Thiếu dòng \"Đáp án: ...\"" });
  });
  return issues;
}

export default function Teacher() {
  const navigate = useNavigate();
  const docxInputRef = useRef<HTMLInputElement | null>(null);
  const docxReadSeq = useRef(0);
  const [parsing, setParsing] = useState(false);
  const [exam, setExam] = useState<ParsedExam | null>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(45);
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [shuffleQ, setShuffleQ] = useState({ p1: false, p2: false, p3: false });
  const [shuffleO, setShuffleO] = useState({ p1: false, p2: false, p3: false });
  const [scoring, setScoring] = useState<ScoringConfig>(DEFAULT_SCORING);
  const [allowReview, setAllowReview] = useState(false);
  const [displayMode, setDisplayMode] = useState<"standard" | "quizizz" | "team">("standard");
  const [teamConfig, setTeamConfig] = useState<TeamConfig>(DEFAULT_TEAM_CONFIG);
  const [instantFeedback, setInstantFeedback] = useState(false);
  const [lockMode, setLockMode] = useState<LockMode>(DEFAULT_LOCK);
  const [schedule, setSchedule] = useState<Schedule>({ open_at: null, close_at: null, auto_submit_on_close: true });
  const [saving, setSaving] = useState(false);

  const issues = useMemo(() => (exam ? validateExam(exam) : []), [exam]);
  const issueKey = (part: "I" | "II" | "III", idx: number) => `${part}-${idx}`;
  const issueSet = useMemo(() => new Set(issues.map((i) => issueKey(i.part, i.idx))), [issues]);
  const imageStats = useMemo(() => {
    const count = (s?: string | null) => ((s || "").match(/\u27E6IMG:/g) || []).length;
    let inQuestions = 0;
    let inOptions = 0;
    if (exam) {
      exam.partI.forEach((q) => {
        inQuestions += count(q.text);
        q.options.forEach((o) => (inOptions += count(o.text)));
      });
      exam.partII.forEach((q) => {
        inQuestions += count(q.text);
        q.items.forEach((it) => (inOptions += count(it.text)));
      });
      exam.partIII.forEach((q) => {
        inQuestions += count(q.text) + count(q.answer);
      });
    }
    return { inQuestions, inOptions, total: inQuestions + inOptions };
  }, [exam]);



  const [manualText, setManualText] = useState("");
  const [ocring, setOcring] = useState(false);

  const applyParsed = (parsed: ParsedExam, name: string, file: File | null) => {
    setExam(parsed);
    setOriginalFile(file);
    setTitle(name);
    const total = parsed.partI.length + parsed.partII.length + parsed.partIII.length;
    if (total === 0) toast.warning("Không phát hiện câu hỏi nào. Kiểm tra định dạng.");
    else toast.success(`Đã tách ${parsed.partI.length} câu Phần I, ${parsed.partII.length} câu Phần II, ${parsed.partIII.length} câu Phần III`);
  };

  const onDocxFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const f = input.files?.[0];
    if (!f) { input.value = ""; return; }
    const readId = ++docxReadSeq.current;
    setExam(null);
    setOriginalFile(null);
    setTitle("");
    if (!f.name.toLowerCase().endsWith(".docx")) {
      toast.error("Vui lòng chọn file .docx");
      input.value = "";
      return;
    }
    setParsing(true);
    try {
      const parsed = await parseDocx(f);
      if (readId !== docxReadSeq.current) return;
      applyParsed(parsed, f.name.replace(/\.docx$/i, ""), f);
    } catch (err: any) {
      if (readId === docxReadSeq.current) toast.error("Lỗi đọc file: " + err.message);
    } finally {
      if (readId === docxReadSeq.current) setParsing(false);
      if (docxInputRef.current) docxInputRef.current.value = "";
      input.value = "";
    }
  };

  const onPdfFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".pdf")) { toast.error("Vui lòng chọn file .pdf"); return; }
    setParsing(true);
    try {
      const parsed = await parsePdfExam(f);
      applyParsed(parsed, f.name.replace(/\.pdf$/i, ""), f);
    } catch (err: any) { toast.error("Lỗi đọc PDF: " + err.message); }
    finally { setParsing(false); }
  };

  const onImageFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fs = Array.from(e.target.files || []);
    if (!fs.length) return;
    setOcring(true);
    try {
      const dataUrls = await Promise.all(fs.map((f) => new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => rej(r.error);
        r.readAsDataURL(f);
      })));
      const { data, error } = await supabase.functions.invoke("ocr-exam", { body: { images: dataUrls } });
      if (error) throw error;
      const text = (data as any)?.text || "";
      if (!text.trim()) throw new Error("AI không trả về nội dung");
      setManualText(text);
      const parsed = parseTextExam(text);
      applyParsed(parsed, fs[0].name.replace(/\.[^.]+$/, ""), null);
    } catch (err: any) {
      toast.error("Lỗi OCR: " + (err.message || err));
    } finally { setOcring(false); }
  };

  const onManualParse = () => {
    if (!manualText.trim()) { toast.error("Vui lòng nhập nội dung đề"); return; }
    try {
      const parsed = parseTextExam(manualText);
      applyParsed(parsed, title || "De-thi-nhap-tay", null);
    } catch (err: any) { toast.error("Lỗi: " + err.message); }
  };

  const onCreate = async () => {
    if (!exam || !title) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Bạn cần đăng nhập"); navigate("/auth"); return; }
    setSaving(true);
    let original_file_url: string | null = null;
    let original_file_name: string | null = null;
    let original_file_path: string | null = null;
    if (originalFile) {
      const path = `${user.id}/${Date.now()}-${originalFile.name.replace(/[^\w.\-]+/g, "_")}`;
      const up = await supabase.storage.from("exam-files").upload(path, originalFile, {
        contentType: originalFile.type || "application/octet-stream",
        upsert: false,
      });
      if (up.error) {
        toast.error("Lỗi tải file gốc: " + up.error.message);
      } else {
        original_file_path = path;
        original_file_name = originalFile.name;
      }
    }
    const { data, error } = await supabase
      .from("exams")
      .insert({
        title,
        questions: exam as any,
        duration_minutes: duration,
        max_attempts: maxAttempts,
        shuffle_questions: shuffleQ.p1 || shuffleQ.p2 || shuffleQ.p3,
        shuffle_options: shuffleO.p1 || shuffleO.p2 || shuffleO.p3,
        shuffle_q_p1: shuffleQ.p1, shuffle_q_p2: shuffleQ.p2, shuffle_q_p3: shuffleQ.p3,
        shuffle_o_p1: shuffleO.p1, shuffle_o_p2: shuffleO.p2, shuffle_o_p3: shuffleO.p3,
        scoring: scoring as any,
        allow_review: allowReview,
        display_mode: displayMode,
        instant_feedback: displayMode === "quizizz" ? instantFeedback : false,
        team_config: teamConfig as any,
        lock_mode: lockMode as any,
        open_at: schedule.open_at,
        close_at: schedule.close_at,
        auto_submit_on_close: schedule.auto_submit_on_close,
        original_file_url,
        original_file_name,
        original_file_path,
        created_by: user.id,
      } as any)
      .select("id")
      .single();
    setSaving(false);
    if (error) {
      toast.error("Lỗi tạo đề: " + error.message);
      return;
    }
    navigate(`/exam/${data.id}/share`);
  };


  return (
    <div className="min-h-screen bg-gradient-soft">
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="container flex items-center justify-between py-4">
          <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Trang chủ
          </Link>
          <div className="font-semibold">Tạo bài thi mới</div>
          <Button asChild variant="outline" size="sm">
            <a href="/de-mau.docx" download><Download className="size-4 mr-1" /> Tải mẫu</a>
          </Button>
        </div>
      </header>

      <main className="container max-w-3xl py-10 space-y-6">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-lg flex items-center gap-2"><Upload className="size-5 text-primary" /> Tải đề thi</h2>
            <Button asChild variant="link" size="sm" className="text-primary">
              <a href="/de-mau.docx" download><Download className="size-4 mr-1" /> Tải file mẫu</a>
            </Button>
          </div>

          <Tabs defaultValue="docx">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="docx"><FileText className="size-4 mr-1" /> Word</TabsTrigger>
              <TabsTrigger value="pdf"><FileText className="size-4 mr-1" /> PDF</TabsTrigger>
              <TabsTrigger value="ocr"><ImageIcon className="size-4 mr-1" /> Ảnh (OCR)</TabsTrigger>
              <TabsTrigger value="manual"><Keyboard className="size-4 mr-1" /> Nhập tay</TabsTrigger>
            </TabsList>

            <TabsContent value="docx">
              <label className="block border-2 border-dashed rounded-xl p-8 text-center cursor-pointer hover:bg-muted/50 transition">
                <input ref={docxInputRef} type="file" accept=".docx" className="hidden" onChange={onDocxFile} disabled={parsing} />
                {parsing ? (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground"><Loader2 className="size-8 animate-spin" /> Đang phân tích…</div>
                ) : exam && originalFile?.name.endsWith(".docx") ? (
                  <div className="flex flex-col items-center gap-2"><FileText className="size-8 text-primary" /><div className="font-medium">Đã tải: {title}.docx</div><div className="text-sm text-muted-foreground">I:{exam.partI.length} • II:{exam.partII.length} • III:{exam.partIII.length}</div></div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground"><Upload className="size-8" /><div>Chọn file .docx</div><div className="text-xs">Đáp án đúng: <span className="text-destructive">màu đỏ</span> hoặc <u>gạch chân</u>. Công thức: dùng MathType / Equation hoặc <code>$x^2$</code>.</div></div>
                )}
              </label>
            </TabsContent>

            <TabsContent value="pdf">
              <label className="block border-2 border-dashed rounded-xl p-8 text-center cursor-pointer hover:bg-muted/50 transition">
                <input type="file" accept=".pdf,application/pdf" className="hidden" onChange={onPdfFile} disabled={parsing} />
                {parsing ? (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground"><Loader2 className="size-8 animate-spin" /> Đang đọc PDF…</div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground"><Upload className="size-8" /><div>Chọn file .pdf (chỉ PDF có chữ thật, không phải ảnh scan)</div><div className="text-xs">Đáp án đúng đánh dấu bằng dấu <code>*</code> trước phương án, hoặc dòng "Đáp án: B".</div></div>
                )}
              </label>
            </TabsContent>

            <TabsContent value="ocr">
              <label className="block border-2 border-dashed rounded-xl p-8 text-center cursor-pointer hover:bg-muted/50 transition">
                <input type="file" accept="image/*" multiple className="hidden" onChange={onImageFiles} disabled={ocring} />
                {ocring ? (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground"><Loader2 className="size-8 animate-spin" /> Đang nhận dạng (OCR + LaTeX)… có thể mất 20–60 giây.</div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground"><ImageIcon className="size-8" /><div>Chọn 1 hoặc nhiều ảnh (chụp/scan)</div><div className="text-xs">AI sẽ nhận dạng đề và công thức toán dưới dạng LaTeX (<code>$\frac{"{a}"}{"{b}"}$</code>). Sau OCR có thể chỉnh sửa ở tab "Nhập tay".</div></div>
                )}
              </label>
            </TabsContent>

            <TabsContent value="manual" className="space-y-3">
              <div className="text-xs text-muted-foreground">
                Dùng <code>$...$</code> cho công thức inline, <code>$$...$$</code> cho block. Đánh dấu đáp án đúng phần I/II bằng dấu <code>*</code> trước chữ cái (vd <code>*A. ...</code>); phần III dùng <code>Đáp án: ...</code>.
              </div>
              <Textarea
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                rows={14}
                className="font-mono text-sm"
                placeholder={`PHẦN I\nCâu 1: Tính $\\int_0^1 x^2\\,dx$ bằng?\nA. 0\nB. 1\n*C. $\\frac{1}{3}$\nD. $\\frac{1}{2}$\n\nPHẦN III\nCâu 1: Nghiệm dương của $x^2 - 4 = 0$?\nĐáp án: 2`}
              />
              <Button onClick={onManualParse} variant="outline" size="sm">Phân tích</Button>
            </TabsContent>
          </Tabs>
        </Card>

        {exam && (
          <Card className="p-6 space-y-5">
            <h2 className="font-semibold text-lg">Cài đặt bài thi</h2>

            <div>
              <Label>Tên đề thi</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Thời gian (phút)</Label>
                <Input type="number" min={1} value={duration} onChange={(e) => setDuration(+e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Số lần được làm</Label>
                <Input type="number" min={1} value={maxAttempts} onChange={(e) => setMaxAttempts(+e.target.value)} className="mt-1" />
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium mb-2">Xáo thứ tự câu hỏi theo phần</div>
                <div className="grid grid-cols-3 gap-3">
                  {(["p1","p2","p3"] as const).map((k, i) => (
                    <div key={k} className="flex items-center justify-between rounded-md border p-2">
                      <Label htmlFor={`sq-${k}`} className="text-xs">Phần {["I","II","III"][i]}</Label>
                      <Switch id={`sq-${k}`} checked={shuffleQ[k]} onCheckedChange={(v) => setShuffleQ({ ...shuffleQ, [k]: v })} />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-sm font-medium mb-2">Xáo thứ tự đáp án theo phần</div>
                <div className="grid grid-cols-3 gap-3">
                  {(["p1","p2","p3"] as const).map((k, i) => (
                    <div key={k} className="flex items-center justify-between rounded-md border p-2">
                      <Label htmlFor={`so-${k}`} className="text-xs">Phần {["I","II","III"][i]}</Label>
                      <Switch id={`so-${k}`} checked={shuffleO[k]} onCheckedChange={(v) => setShuffleO({ ...shuffleO, [k]: v })} />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border p-4 bg-muted/30">
              <div className="text-sm font-medium">Cài đặt điểm</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Phần I — điểm / câu</Label>
                  <Input type="number" step="0.05" min={0} value={scoring.p1}
                    onChange={(e) => setScoring({ ...scoring, p1: +e.target.value })} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Phần III — điểm / câu</Label>
                  <Input type="number" step="0.05" min={0} value={scoring.p3}
                    onChange={(e) => setScoring({ ...scoring, p3: +e.target.value })} className="mt-1" />
                </div>
              </div>
              <div>
                <div className="text-xs font-medium mb-1">Phần II — điểm theo số ý đúng (mỗi câu 4 ý)</div>
                <div className="grid grid-cols-4 gap-2">
                  {(["1","2","3","4"] as const).map((k) => (
                    <div key={k}>
                      <Label className="text-xs">Đúng {k} ý</Label>
                      <Input type="number" step="0.05" min={0} value={scoring.p2[k]}
                        onChange={(e) => setScoring({ ...scoring, p2: { ...scoring.p2, [k]: +e.target.value } })}
                        className="mt-1" />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-lg border p-4 space-y-2">
              <Label className="text-sm font-medium">🖥️ Hình thức hiển thị bài kiểm tra</Label>
              <Select value={displayMode} onValueChange={(v) => setDisplayMode(v as "standard" | "quizizz" | "team")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Chế độ tiêu chuẩn (Hiển thị toàn bộ câu hỏi)</SelectItem>
                  <SelectItem value="quizizz">Chế độ từng câu hỏi (Quizizz Mode)</SelectItem>
                  <SelectItem value="team">Chế độ Đội/Nhóm (thi đấu theo nhóm)</SelectItem>
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground">
                Tiêu chuẩn: học sinh thấy toàn bộ câu, được phép quay lại sửa.
                Quizizz: mỗi lần 1 câu, không quay lại, tự lưu tiến độ.
              </div>

              {displayMode === "team" && (
              <div className="mt-3">
                <TeamModeSettings value={teamConfig} onChange={setTeamConfig} examId="new-exam" />
              </div>
            )}

            {displayMode === "quizizz" && (
                <div className="flex items-center justify-between rounded-lg border p-3 mt-3 bg-background">
                  <div className="pr-3">
                    <Label htmlFor="instant-fb" className="text-sm font-medium">💬 Hiển thị đáp án và giải thích ngay sau khi học sinh trả lời</Label>
                    <div className="text-xs text-muted-foreground mt-1">
                      Khi bật, học sinh sẽ được xem kết quả đúng/sai, đáp án đúng và lời giải ngay sau khi trả lời từng câu hỏi.
                    </div>
                  </div>
                  <Switch id="instant-fb" checked={instantFeedback} onCheckedChange={setInstantFeedback} />
                </div>
              )}
            </div>

            <ScheduleSettings value={schedule} onChange={setSchedule} />

            <LockModeSettings value={lockMode} onChange={setLockMode} />


            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <Label htmlFor="allow-review" className="text-sm font-medium">👁️ Cho phép xem lại đáp án sau khi nộp bài</Label>
                <div className="text-xs text-muted-foreground mt-1">
                  Khi bật: học sinh thấy toàn bộ câu hỏi, đáp án đã chọn và đáp án đúng. Khi tắt: chỉ thấy điểm và số câu đúng/sai.
                </div>
              </div>
              <Switch id="allow-review" checked={allowReview} onCheckedChange={setAllowReview} />
            </div>



            <Button onClick={onCreate} disabled={saving || !title} className="w-full bg-gradient-primary">
              {saving ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              Tạo link bài thi
            </Button>
          </Card>
        )}

        {exam && issues.length > 0 && (
          <Card className="p-5 border-destructive/40 bg-destructive/5">
            <div className="flex items-center gap-2 font-semibold text-destructive mb-2">
              <AlertTriangle className="size-5" /> Phát hiện {issues.length} câu sai định dạng
            </div>
            <ul className="text-sm space-y-1 list-disc pl-5">
              {issues.map((iss, k) => (
                <li key={k}>
                  Phần {iss.part} — Câu {iss.idx + 1}: <span className="text-destructive">{iss.reason}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {exam && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Xem trước toàn bộ câu hỏi</h3>
              <div className="text-xs text-muted-foreground">
                I: {exam.partI.length} • II: {exam.partII.length} • III: {exam.partIII.length}
                {imageStats.total > 0 && (
                  <> • Hình ảnh: {imageStats.total} ({imageStats.inQuestions} ở câu hỏi, {imageStats.inOptions} ở phương án)</>
                )}
              </div>

            </div>

            <div className="space-y-6 text-sm">
              {exam.partI.length > 0 && (
                <section>
                  <div className="font-bold text-primary mb-2">PHẦN I — Trắc nghiệm 4 phương án ({exam.partI.length} câu)</div>
                  <div className="space-y-3">
                    {exam.partI.map((q, i) => {
                      const bad = issueSet.has(issueKey("I", i));
                      return (
                        <div key={q.id} className={`border-l-4 pl-3 py-1 ${bad ? "border-destructive bg-destructive/5" : "border-primary"}`}>
                          <div className="font-medium">Câu {i + 1}: <RichText text={q.text} /></div>
                          {q.options.map((o) => (
                            <div key={o.key} className={o.key === q.answer ? "text-success font-medium" : "text-muted-foreground"}>
                              {o.key}. <RichText text={o.text} /> {o.key === q.answer && "✓"}
                            </div>
                          ))}
                          {q.explanation && (
                            <div className="mt-2 rounded-md border-l-2 border-primary/40 bg-primary/5 p-2 text-xs">
                              <div className="font-semibold text-primary mb-1">Lời giải</div>
                              <div className="text-foreground whitespace-pre-wrap"><RichText text={q.explanation} /></div>
                            </div>
                          )}
                          {bad && <div className="text-xs text-destructive mt-1">⚠ Câu này sai định dạng</div>}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {exam.partII.length > 0 && (
                <section>
                  <div className="font-bold text-accent-foreground mb-2">PHẦN II — Đúng/Sai ({exam.partII.length} câu)</div>
                  <div className="space-y-3">
                    {exam.partII.map((q, i) => {
                      const bad = issueSet.has(issueKey("II", i));
                      return (
                        <div key={q.id} className={`border-l-4 pl-3 py-1 ${bad ? "border-destructive bg-destructive/5" : "border-accent"}`}>
                          <div className="font-medium">Câu {i + 1}: <RichText text={q.text} /></div>
                          {q.items.map((it) => (
                            <div key={it.key} className="flex items-start gap-2 py-0.5">
                              <span className="flex gap-1 shrink-0">
                                <span className={`text-xs rounded border px-2 py-0.5 ${it.correct ? "border-success bg-success/10 text-success font-semibold" : "border-border text-muted-foreground"}`}>Đúng</span>
                                <span className={`text-xs rounded border px-2 py-0.5 ${!it.correct ? "border-destructive bg-destructive/10 text-destructive font-semibold" : "border-border text-muted-foreground"}`}>Sai</span>
                              </span>
                              <span className="font-medium min-w-5">{it.key})</span>
                              <span className="flex-1"><RichText text={it.text} /></span>
                            </div>

                          ))}

                          {q.explanation && (
                            <div className="mt-2 rounded-md border-l-2 border-primary/40 bg-primary/5 p-2 text-xs">
                              <div className="font-semibold text-primary mb-1">Lời giải</div>
                              <div className="text-foreground whitespace-pre-wrap"><RichText text={q.explanation} /></div>
                            </div>
                          )}
                          {bad && <div className="text-xs text-destructive mt-1">⚠ Câu này sai định dạng</div>}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {exam.partIII.length > 0 && (
                <section>
                  <div className="font-bold text-warning mb-2">PHẦN III — Trả lời ngắn ({exam.partIII.length} câu)</div>
                  <div className="space-y-3">
                    {exam.partIII.map((q, i) => {
                      const bad = issueSet.has(issueKey("III", i));
                      return (
                        <div key={q.id} className={`border-l-4 pl-3 py-1 ${bad ? "border-destructive bg-destructive/5" : "border-warning"}`}>
                          <div className="font-medium">Câu {i + 1}: <RichText text={q.text} /></div>
                          <div className="text-success">Đáp án: <RichText text={q.answer} /></div>
                          {q.explanation && (
                            <div className="mt-2 rounded-md border-l-2 border-primary/40 bg-primary/5 p-2 text-xs">
                              <div className="font-semibold text-primary mb-1">Lời giải</div>
                              <div className="text-foreground whitespace-pre-wrap"><RichText text={q.explanation} /></div>
                            </div>
                          )}
                          {bad && <div className="text-xs text-destructive mt-1">⚠ Câu này sai định dạng</div>}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
