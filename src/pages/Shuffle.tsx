import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Shuffle as ShuffleIcon, FileDown, Eye, Loader2 } from "lucide-react";
import { parseDocx, stripRich, type ParsedExam } from "@/lib/docxParser";
import { generateVariants, estimateMaxVariants } from "@/lib/shuffleEngine";
import { generateExamCodes } from "@/lib/examCodeGenerator";
import { exportExams, exportAnswerKey, exportExamsAndKey, type ExamMeta, type ExportOptions } from "@/lib/examExporter";

export default function Shuffle() {
  const [exams, setExams] = useState<any[]>([]);
  const [sourceMode, setSourceMode] = useState<"exam" | "file">("exam");
  const [selectedExamId, setSelectedExamId] = useState<string>("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [baseExam, setBaseExam] = useState<ParsedExam | null>(null);
  const [baseTitle, setBaseTitle] = useState<string>("De_kiem_tra");
  const [loadingBase, setLoadingBase] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileReadSeq = useRef(0);

  const [meta, setMeta] = useState<ExamMeta>({
    agency: "SỞ GIÁO DỤC & ĐÀO TẠO",
    unit: "TRƯỜNG THPT",
    session: "KỲ THI KIỂM TRA",
    subject: "",
    duration: "45",
    questionPrefix: "Câu",
  });

  const [numVariants, setNumVariants] = useState(4);
  const [codesInput, setCodesInput] = useState("");
  const [codePrefix, setCodePrefix] = useState("7");
  const [codeLen, setCodeLen] = useState(3);

  const [opts, setOpts] = useState({
    renumberPerPart: true,
    singleFile: true,
    answersAsTable: true,
    keepSaOrder: false,
    keepPartOrder: true,
    shuffleQuestions: true,
    shuffleAnswers: true,
  });

  const [variants, setVariants] = useState<ParsedExam[]>([]);
  const [codes, setCodes] = useState<string[]>([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("exams").select("id,title,questions,subject_name,duration_minutes").order("created_at", { ascending: false });
      setExams(data || []);
    })();
  }, []);

  const loadFromExam = async (id: string) => {
    setSelectedExamId(id);
    setUploadedFile(null);
    const ex = exams.find((e) => e.id === id);
    if (!ex) return;
    const q = ex.questions || {};
    setBaseExam({ partI: q.partI || [], partII: q.partII || [], partIII: q.partIII || [] });
    setBaseTitle((ex.title || "de").replace(/[^\w\-]+/g, "_").slice(0, 40));
    setMeta((m) => ({ ...m, subject: ex.subject_name || m.subject, duration: String(ex.duration_minutes || m.duration) }));
  };

  const clearGeneratedState = () => {
    setVariants([]);
    setCodes([]);
    setPreviewIdx(0);
  };

  const loadFromFile = async (f: File) => {
    const readId = ++fileReadSeq.current;
    setUploadedFile(null);
    setSelectedExamId("");
    setBaseExam(null);
    clearGeneratedState();
    setLoadingBase(true);
    try {
      const parsed = await parseDocx(f);
      if (readId !== fileReadSeq.current) return;
      setUploadedFile(f);
      setBaseExam(parsed);
      setBaseTitle(f.name.replace(/\.docx$/i, "").replace(/[^\w\-]+/g, "_").slice(0, 40));
    } catch (e: any) {
      if (readId !== fileReadSeq.current) return;
      toast.error("Không đọc được file: " + e.message);
    } finally {
      if (readId === fileReadSeq.current) setLoadingBase(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onSourceFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const f = input.files?.[0];
    if (!f) {
      input.value = "";
      return;
    }
    if (!f.name.toLowerCase().endsWith(".docx")) {
      setUploadedFile(null);
      setBaseExam(null);
      clearGeneratedState();
      toast.error("Vui lòng chọn file .docx");
      input.value = "";
      return;
    }
    await loadFromFile(f);
    input.value = "";
  };

  const stats = useMemo(() => {
    if (!baseExam) return null;
    return { p1: baseExam.partI.length, p2: baseExam.partII.length, p3: baseExam.partIII.length };
  }, [baseExam]);

  const maxVariants = useMemo(() => (baseExam ? estimateMaxVariants(baseExam, {
    shuffleQuestions: opts.shuffleQuestions, shuffleAnswers: opts.shuffleAnswers, keepSaOrder: opts.keepSaOrder,
  }) : 0), [baseExam, opts]);

  const computedCodes = useMemo(() => {
    const r = generateExamCodes({ prefix: codePrefix, codeLength: codeLen, quantity: numVariants, manualCodes: codesInput });
    return r.ok ? r.codes : [];
  }, [codePrefix, codeLen, numVariants, codesInput]);

  const validate = (): string | null => {
    if (!baseExam) return "Chưa chọn đề gốc";
    if (numVariants < 1) return "Số lượng mã đề phải ≥ 1";
    if (!stats || (stats.p1 + stats.p2 + stats.p3) === 0) return "Đề không có câu hỏi";
    const r = generateExamCodes({ prefix: codePrefix, codeLength: codeLen, quantity: numVariants, manualCodes: codesInput });
    if (r.ok === false) return r.error;
    if (numVariants > maxVariants) return `Chỉ có thể tạo tối đa ${maxVariants} mã đề khác nhau`;
    return null;
  };

  const generate = () => {
    const err = validate();
    if (err) return toast.error(err);
    setBusy(true);
    try {
      const vs = generateVariants(baseExam!, numVariants, {
        shuffleQuestions: opts.shuffleQuestions, shuffleAnswers: opts.shuffleAnswers, keepSaOrder: opts.keepSaOrder,
      });
      setVariants(vs);
      setCodes(computedCodes);
      setPreviewIdx(0);
      toast.success(`Đã tạo ${vs.length} mã đề`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const doExportAll = async () => {
    if (!variants.length) return toast.error("Chưa sinh đề");
    setBusy(true);
    try {
      await exportExamsAndKey(
        variants,
        codes,
        meta,
        {
          renumberPerPart: opts.renumberPerPart,
          singleFile: opts.singleFile,
          answersAsTable: opts.answersAsTable,
        },
        baseTitle
      );
      toast.success("Đã xuất trọn bộ đề và đáp án");
    } catch (e: any) {
      toast.error("Lỗi xuất file: " + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const doExportExams = async () => {
    if (!variants.length) return toast.error("Chưa sinh đề");
    setBusy(true);
    try {
      await exportExams(variants, codes, meta, { renumberPerPart: opts.renumberPerPart, singleFile: opts.singleFile, answersAsTable: opts.answersAsTable }, baseTitle);
      toast.success("Đã xuất file đề");
    } finally { setBusy(false); }
  };
  const doExportKey = async () => {
    if (!variants.length) return toast.error("Chưa sinh đề");
    setBusy(true);
    try {
      await exportAnswerKey(variants, codes, baseTitle);
      toast.success("Đã xuất đáp án");
    } finally { setBusy(false); }
  };

  const preview = variants[previewIdx];

  return (
    <div className="p-4 md:p-6 space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight flex items-center gap-2">
            <ShuffleIcon className="size-7 text-primary" /> Xáo đề kiểm tra
          </h1>
          <p className="text-sm text-muted-foreground">Sinh nhiều mã đề từ một đề gốc, kèm bảng đáp án.</p>
        </div>
      </header>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* LEFT */}
        <div className="space-y-4">
          <Card className="p-4 rounded-2xl space-y-3">
            <h3 className="font-semibold">1. Chọn đề gốc</h3>
            <div className="flex gap-2">
              <Button size="sm" variant={sourceMode === "exam" ? "default" : "outline"} onClick={() => setSourceMode("exam")}>Từ hệ thống</Button>
              <Button size="sm" variant={sourceMode === "file" ? "default" : "outline"} onClick={() => setSourceMode("file")}>Tải file Word</Button>
            </div>
            {sourceMode === "exam" ? (
              <Select value={selectedExamId} onValueChange={loadFromExam}>
                <SelectTrigger><SelectValue placeholder="— Chọn đề —" /></SelectTrigger>
                <SelectContent>
                  {exams.map((e) => <SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center gap-2">
                <Input ref={fileInputRef} type="file" accept=".docx" onChange={onSourceFileChange} />
                {loadingBase && <Loader2 className="size-4 animate-spin" />}
              </div>
            )}
            {stats && (
              <div className="text-xs text-muted-foreground">
                Phần I: <b>{stats.p1}</b> · Phần II: <b>{stats.p2}</b> · Phần III: <b>{stats.p3}</b>
                {baseExam && <> · Tối đa <b>{Number.isFinite(maxVariants) ? maxVariants.toLocaleString() : "∞"}</b> hoán vị</>}
              </div>
            )}
          </Card>

          <Card className="p-4 rounded-2xl space-y-3">
            <h3 className="font-semibold">2. Thông tin đề</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Cơ quan quản lý</Label><Input value={meta.agency} onChange={(e) => setMeta({ ...meta, agency: e.target.value })} /></div>
              <div><Label className="text-xs">Đơn vị</Label><Input value={meta.unit} onChange={(e) => setMeta({ ...meta, unit: e.target.value })} /></div>
              <div className="col-span-2"><Label className="text-xs">Kỳ thi</Label><Input value={meta.session} onChange={(e) => setMeta({ ...meta, session: e.target.value })} /></div>
              <div><Label className="text-xs">Môn học</Label><Input value={meta.subject} onChange={(e) => setMeta({ ...meta, subject: e.target.value })} /></div>
              <div><Label className="text-xs">Thời gian (phút)</Label><Input value={meta.duration} onChange={(e) => setMeta({ ...meta, duration: e.target.value })} /></div>
              <div><Label className="text-xs">Tiêu đề câu</Label><Input value={meta.questionPrefix} onChange={(e) => setMeta({ ...meta, questionPrefix: e.target.value })} /></div>
              <div><Label className="text-xs">Tiền tố mã đề</Label><Input value={codePrefix} onChange={(e) => setCodePrefix(e.target.value)} /></div>
              <div><Label className="text-xs">Độ dài mã đề</Label><Input type="number" min={2} max={6} value={codeLen} onChange={(e) => setCodeLen(+e.target.value)} /></div>
            </div>
          </Card>

          <Card className="p-4 rounded-2xl space-y-3">
            <h3 className="font-semibold">3. Tùy chọn</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                ["renumberPerPart", "Đánh lại số câu từ 1 mỗi phần"],
                ["singleFile", "Tất cả đề trong 1 file Word"],
                ["answersAsTable", "Xuất đáp án dạng bảng"],
                ["keepSaOrder", "Giữ nguyên thứ tự câu tự luận"],
                ["keepPartOrder", "Giữ nguyên thứ tự phần"],
                ["shuffleQuestions", "Xáo thứ tự câu"],
                ["shuffleAnswers", "Xáo đáp án"],
              ].map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={(opts as any)[k]} onCheckedChange={(v) => setOpts({ ...opts, [k]: !!v })} />
                  <span>{l}</span>
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div>
                <Label className="text-xs">Số lượng mã đề</Label>
                <Input
                  type="number"
                  min={1}
                  max={200}
                  value={numVariants}
                  onChange={(e) => setNumVariants(Math.max(1, parseInt(e.target.value) || 1))}
                />
              </div>
              <div><Label className="text-xs">Mã đề (nhập tay, cách nhau bằng , )</Label><Input value={codesInput} onChange={(e) => setCodesInput(e.target.value)} placeholder="Vd: 701,702,703,704" /></div>
            </div>
          </Card>

          <div className="flex gap-2 flex-wrap items-center">
            <Button onClick={generate} disabled={busy || !baseExam} className="rounded-xl bg-gradient-primary font-semibold">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ShuffleIcon className="size-4 mr-1.5" />} Sinh đề
            </Button>
            <Button
              onClick={doExportAll}
              disabled={busy || !variants.length}
              className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm"
            >
              {busy ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <FileDown className="size-4 mr-1.5" />}
              Xuất đề và đáp án (.zip)
            </Button>
            {variants.length > 0 && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
                <span>Tải riêng:</span>
                <Button variant="ghost" size="sm" onClick={doExportExams} disabled={busy} className="h-7 px-2 text-xs">
                  Chỉ đề
                </Button>
                <span>·</span>
                <Button variant="ghost" size="sm" onClick={doExportKey} disabled={busy} className="h-7 px-2 text-xs">
                  Chỉ đáp án
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Preview */}
        <Card className="p-4 rounded-2xl">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2"><Eye className="size-4" /> Xem trước</h3>
            {variants.length > 0 && (
              <Select value={String(previewIdx)} onValueChange={(v) => setPreviewIdx(+v)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{codes.map((c, i) => <SelectItem key={c} value={String(i)}>Mã {c}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
          <div className="border rounded-lg p-4 max-h-[700px] overflow-auto bg-white text-sm text-black" style={{ fontFamily: "Times New Roman, serif" }}>
            {!preview ? (
              <p className="text-muted-foreground text-center py-16">Chưa có đề nào. Bấm "Sinh đề" để bắt đầu.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-center font-bold">{meta.agency}</p>
                <p className="text-center">{meta.unit}</p>
                <p className="text-center font-semibold">{meta.session}</p>
                <p className="text-center font-bold text-base mt-2">Môn: {meta.subject}</p>
                <p className="text-center">Thời gian: {meta.duration} phút</p>
                <p className="text-right font-bold">Mã đề: {codes[previewIdx]}</p>

                {(() => {
                  const num = (partIdx: number, i: number) => {
                    if (opts.renumberPerPart) return i + 1;
                    const before = partIdx === 0 ? 0 : partIdx === 1 ? preview.partI.length : preview.partI.length + preview.partII.length;
                    return before + i + 1;
                  };
                  return (
                    <>
                      {preview.partI.length > 0 && <>
                        <p className="font-bold mt-3">PHẦN I. Trắc nghiệm nhiều lựa chọn</p>
                        {preview.partI.map((q, i) => (
                          <div key={q.id} className="mt-2">
                            <p><b>{meta.questionPrefix} {num(0, i)}.</b> {stripRich(q.text)}</p>
                            {q.options.map((o) => <p key={o.key} className="pl-4">{o.key}. {stripRich(o.text)}</p>)}
                          </div>
                        ))}
                      </>}
                      {preview.partII.length > 0 && <>
                        <p className="font-bold mt-3">PHẦN II. Đúng/Sai</p>
                        {preview.partII.map((q, i) => (
                          <div key={q.id} className="mt-2">
                            <p><b>{meta.questionPrefix} {num(1, i)}.</b> {stripRich(q.text)}</p>
                            {q.items.map((it) => <p key={it.key} className="pl-4">{it.key}) {stripRich(it.text)}</p>)}
                          </div>
                        ))}
                      </>}
                      {preview.partIII.length > 0 && <>
                        <p className="font-bold mt-3">PHẦN III. Trả lời ngắn</p>
                        {preview.partIII.map((q, i) => (
                          <div key={q.id} className="mt-2">
                            <p><b>{meta.questionPrefix} {num(2, i)}.</b> {stripRich(q.text)}</p>
                          </div>
                        ))}
                      </>}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
