import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Plus, Trash2, Save, Eye, FileText, Settings2, CheckCircle2 } from "lucide-react";
import { SystemExam, getParsedQuestions, ParsedQuestionSet } from "@/lib/allExamsStorage";
import { ExamFolder, buildFolderTreeOptions } from "@/lib/folderStorage";
import { SUBJECT_LIST } from "@/lib/subjects";
import RichText from "@/components/RichText";
import { toast } from "sonner";

interface AdminExamEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exam: SystemExam | null;
  folders?: ExamFolder[];
  initialTab?: "settings" | "questions" | "preview";
  onSave: (updatedExam: Partial<SystemExam>) => Promise<{ ok: boolean; error?: string }>;
}

export function AdminExamEditorModal({
  open,
  onOpenChange,
  exam,
  folders = [],
  initialTab = "settings",
  onSave,
}: AdminExamEditorModalProps) {
  const [activeTab, setActiveTab] = useState<"settings" | "questions" | "preview">(initialTab);
  const [title, setTitle] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(45);
  const [subjectName, setSubjectName] = useState("Tin học");
  const [schoolName, setSchoolName] = useState("");
  const [folderId, setFolderId] = useState<string>("__none__");
  const [displayMode, setDisplayMode] = useState<"standard" | "quizizz" | "team">("standard");
  const [manualClosed, setManualClosed] = useState(false);
  const [allowReview, setAllowReview] = useState(true);
  const [instantFeedback, setInstantFeedback] = useState(false);
  const [questions, setQuestions] = useState<ParsedQuestionSet>({ partI: [], partII: [], partIII: [] });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!exam) return;
    setActiveTab(initialTab);
    setTitle(exam.title || "");
    setDurationMinutes(exam.duration_minutes || 45);
    setSubjectName(exam.subject_name || "Tin học");
    setSchoolName(exam.school_name || "");
    setFolderId(exam.folder_id || "__none__");
    setDisplayMode((exam.display_mode as any) || "standard");
    setManualClosed(!!exam.manual_closed);
    setAllowReview(exam.allow_review !== false);
    setInstantFeedback(!!exam.instant_feedback);
    setQuestions(JSON.parse(JSON.stringify(getParsedQuestions(exam.questions))));
  }, [exam, initialTab, open]);

  const folderOptions = useMemo(() => buildFolderTreeOptions(folders), [folders]);

  const handleSave = async () => {
    if (!exam) return;
    if (!title.trim()) {
      toast.error("Tiêu đề đề thi không được để trống");
      return;
    }
    setSaving(true);
    const res = await onSave({
      ...exam,
      title: title.trim(),
      duration_minutes: Math.max(1, Number(durationMinutes) || 45),
      subject_name: subjectName.trim() || "Chưa phân loại",
      school_name: schoolName.trim(),
      folder_id: folderId === "__none__" ? null : folderId,
      display_mode: displayMode,
      manual_closed: manualClosed,
      allow_review: allowReview,
      instant_feedback: instantFeedback,
      questions,
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Đã lưu thay đổi đề thi thành công");
      onOpenChange(false);
    } else {
      toast.error(res.error || "Không thể lưu đề thi");
    }
  };

  const addPartIQuestion = () => {
    setQuestions((prev) => ({
      ...prev,
      partI: [
        ...prev.partI,
        {
          id: `p1_${Date.now()}_${prev.partI.length + 1}`,
          text: "Nội dung câu hỏi mới...",
          options: [
            { key: "A", text: "Phương án A" },
            { key: "B", text: "Phương án B" },
            { key: "C", text: "Phương án C" },
            { key: "D", text: "Phương án D" },
          ],
          answer: "A",
          explanation: "",
        },
      ],
    }));
  };

  const addPartIIQuestion = () => {
    setQuestions((prev) => ({
      ...prev,
      partII: [
        ...prev.partII,
        {
          id: `p2_${Date.now()}_${prev.partII.length + 1}`,
          text: "Tình huống câu hỏi đúng/sai...",
          items: [
            { key: "a", text: "Mệnh đề a", correct: true },
            { key: "b", text: "Mệnh đề b", correct: false },
            { key: "c", text: "Mệnh đề c", correct: true },
            { key: "d", text: "Mệnh đề d", correct: false },
          ],
          explanation: "",
        },
      ],
    }));
  };

  const addPartIIIQuestion = () => {
    setQuestions((prev) => ({
      ...prev,
      partIII: [
        ...prev.partIII,
        {
          id: `p3_${Date.now()}_${prev.partIII.length + 1}`,
          text: "Câu hỏi trả lời ngắn...",
          answer: "",
          explanation: "",
        },
      ],
    }));
  };

  const totalQuestions = questions.partI.length + questions.partII.length + questions.partIII.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] flex flex-col font-times-new-roman p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3 border-b bg-muted/20">
          <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
            <div>
              <DialogTitle className="text-xl font-bold text-foreground">
                {exam?.title || "Chi tiết & Chỉnh sửa đề thi"}
              </DialogTitle>
              <DialogDescription className="text-xs mt-1">
                Giáo viên: <strong>{exam?.teacher_name || "Chưa rõ"}</strong> • Tổng số câu:{" "}
                <strong className="tabular-nums">{totalQuestions}</strong>
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={manualClosed ? "destructive" : "default"}>
                {manualClosed ? "Đang khóa / đóng" : "Đang mở"}
              </Badge>
            </div>
          </div>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as any)}
          className="flex-1 flex flex-col min-h-0"
        >
          <div className="px-6 pt-3 border-b">
            <TabsList className="grid grid-cols-3 w-full max-w-md">
              <TabsTrigger value="settings" className="gap-1.5 text-xs">
                <Settings2 className="size-3.5" /> Thông tin & Cài đặt
              </TabsTrigger>
              <TabsTrigger value="questions" className="gap-1.5 text-xs">
                <FileText className="size-3.5" /> Câu hỏi ({totalQuestions})
              </TabsTrigger>
              <TabsTrigger value="preview" className="gap-1.5 text-xs">
                <Eye className="size-3.5" /> Xem trước
              </TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="flex-1 px-6 py-4 max-h-[62vh]">
            <TabsContent value="settings" className="mt-0 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Tiêu đề bài thi *</Label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>

                <div className="space-y-1.5">
                  <Label>Thời gian làm bài (phút)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={300}
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value) || 45)}
                    className="tabular-nums"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Môn học</Label>
                  <Select value={subjectName} onValueChange={setSubjectName}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SUBJECT_LIST.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                      {!SUBJECT_LIST.includes(subjectName) && subjectName && (
                        <SelectItem value={subjectName}>{subjectName}</SelectItem>
                      )}
                      <SelectItem value="Khác">Khác</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Trường học</Label>
                  <Input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} />
                </div>

                <div className="space-y-1.5">
                  <Label>Thư mục lưu trữ</Label>
                  <Select value={folderId} onValueChange={setFolderId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Chưa phân loại" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Đề thi chưa phân loại</SelectItem>
                      {folderOptions.map((opt) => (
                        <SelectItem key={opt.folder.id} value={opt.folder.id}>
                          {"— ".repeat(opt.depth) + opt.folder.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Chế độ hiển thị</Label>
                  <Select value={displayMode} onValueChange={(v) => setDisplayMode(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Tiêu chuẩn (Danh sách)</SelectItem>
                      <SelectItem value="quizizz">Từng câu hỏi (Trình chiếu / Quiz)</SelectItem>
                      <SelectItem value="team">Đội nhóm (Team Battle)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div className="p-3 rounded-lg border flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">Khóa / Đóng đề thi</div>
                    <div className="text-xs text-muted-foreground">Ngăn học sinh làm bài</div>
                  </div>
                  <Switch checked={manualClosed} onCheckedChange={setManualClosed} />
                </div>

                <div className="p-3 rounded-lg border flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">Xem lại bài</div>
                    <div className="text-xs text-muted-foreground">Sau khi nộp bài</div>
                  </div>
                  <Switch checked={allowReview} onCheckedChange={setAllowReview} />
                </div>

                <div className="p-3 rounded-lg border flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">Chấm tức thì</div>
                    <div className="text-xs text-muted-foreground">Hiện đáp án từng câu</div>
                  </div>
                  <Switch checked={instantFeedback} onCheckedChange={setInstantFeedback} />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="questions" className="mt-0 space-y-6">
              {/* Part I */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold">Phần I: Trắc nghiệm nhiều lựa chọn ({questions.partI.length})</h3>
                  <Button type="button" size="sm" variant="outline" onClick={addPartIQuestion}>
                    <Plus className="size-3.5 mr-1" /> Thêm câu Phần I
                  </Button>
                </div>

                {questions.partI.map((q, qIdx) => (
                  <div key={q.id || qIdx} className="p-4 rounded-xl border bg-card space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline">Câu {qIdx + 1}</Badge>
                      <div className="flex items-center gap-2">
                        <Label className="text-xs">Đáp án đúng:</Label>
                        <Select
                          value={q.answer || "A"}
                          onValueChange={(val) => {
                            const next = [...questions.partI];
                            next[qIdx] = { ...next[qIdx], answer: val };
                            setQuestions({ ...questions, partI: next });
                          }}
                        >
                          <SelectTrigger className="h-8 w-20">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {["A", "B", "C", "D"].map((k) => (
                              <SelectItem key={k} value={k}>
                                {k}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => {
                            setQuestions({
                              ...questions,
                              partI: questions.partI.filter((_, idx) => idx !== qIdx),
                            });
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Nội dung câu hỏi</Label>
                      <Textarea
                        rows={2}
                        value={q.text}
                        onChange={(e) => {
                          const next = [...questions.partI];
                          next[qIdx] = { ...next[qIdx], text: e.target.value };
                          setQuestions({ ...questions, partI: next });
                        }}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {(q.options || []).map((opt, oIdx) => (
                        <div key={opt.key || oIdx} className="flex items-center gap-2">
                          <Badge
                            variant={q.answer === opt.key ? "default" : "outline"}
                            className="shrink-0 w-7 justify-center"
                          >
                            {opt.key}
                          </Badge>
                          <Input
                            value={opt.text}
                            onChange={(e) => {
                              const next = [...questions.partI];
                              const nextOpts = [...(next[qIdx].options || [])];
                              nextOpts[oIdx] = { ...nextOpts[oIdx], text: e.target.value };
                              next[qIdx] = { ...next[qIdx], options: nextOpts };
                              setQuestions({ ...questions, partI: next });
                            }}
                          />
                        </div>
                      ))}
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Giải thích đáp án (tùy chọn)</Label>
                      <Input
                        value={q.explanation || ""}
                        placeholder="Nhập lời giải thích..."
                        onChange={(e) => {
                          const next = [...questions.partI];
                          next[qIdx] = { ...next[qIdx], explanation: e.target.value };
                          setQuestions({ ...questions, partI: next });
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Part II */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold">Phần II: Trắc nghiệm Đúng / Sai ({questions.partII.length})</h3>
                  <Button type="button" size="sm" variant="outline" onClick={addPartIIQuestion}>
                    <Plus className="size-3.5 mr-1" /> Thêm câu Phần II
                  </Button>
                </div>

                {questions.partII.map((q, qIdx) => (
                  <div key={q.id || qIdx} className="p-4 rounded-xl border bg-card space-y-3">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline">Câu Đúng/Sai {qIdx + 1}</Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => {
                          setQuestions({
                            ...questions,
                            partII: questions.partII.filter((_, idx) => idx !== qIdx),
                          });
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    <Textarea
                      rows={2}
                      value={q.text}
                      onChange={(e) => {
                        const next = [...questions.partII];
                        next[qIdx] = { ...next[qIdx], text: e.target.value };
                        setQuestions({ ...questions, partII: next });
                      }}
                    />
                    <div className="space-y-2">
                      {(q.items || []).map((it, iIdx) => (
                        <div key={it.key || iIdx} className="flex items-center gap-2">
                          <Badge variant="secondary" className="w-7 justify-center shrink-0">
                            {it.key})
                          </Badge>
                          <Input
                            value={it.text}
                            onChange={(e) => {
                              const next = [...questions.partII];
                              const nextItems = [...(next[qIdx].items || [])];
                              nextItems[iIdx] = { ...nextItems[iIdx], text: e.target.value };
                              next[qIdx] = { ...next[qIdx], items: nextItems };
                              setQuestions({ ...questions, partII: next });
                            }}
                          />
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Switch
                              checked={!!it.correct}
                              onCheckedChange={(checked) => {
                                const next = [...questions.partII];
                                const nextItems = [...(next[qIdx].items || [])];
                                nextItems[iIdx] = { ...nextItems[iIdx], correct: checked };
                                next[qIdx] = { ...next[qIdx], items: nextItems };
                                setQuestions({ ...questions, partII: next });
                              }}
                            />
                            <span className="text-xs font-semibold w-10">{it.correct ? "Đúng" : "Sai"}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Part III */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold">Phần III: Trả lời ngắn ({questions.partIII.length})</h3>
                  <Button type="button" size="sm" variant="outline" onClick={addPartIIIQuestion}>
                    <Plus className="size-3.5 mr-1" /> Thêm câu Phần III
                  </Button>
                </div>

                {questions.partIII.map((q, qIdx) => (
                  <div key={q.id || qIdx} className="p-4 rounded-xl border bg-card space-y-2.5">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline">Câu Trả lời ngắn {qIdx + 1}</Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => {
                          setQuestions({
                            ...questions,
                            partIII: questions.partIII.filter((_, idx) => idx !== qIdx),
                          });
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    <Textarea
                      rows={2}
                      value={q.text}
                      onChange={(e) => {
                        const next = [...questions.partIII];
                        next[qIdx] = { ...next[qIdx], text: e.target.value };
                        setQuestions({ ...questions, partIII: next });
                      }}
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Đáp án đúng</Label>
                        <Input
                          value={q.answer || ""}
                          onChange={(e) => {
                            const next = [...questions.partIII];
                            next[qIdx] = { ...next[qIdx], answer: e.target.value };
                            setQuestions({ ...questions, partIII: next });
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Giải thích</Label>
                        <Input
                          value={q.explanation || ""}
                          onChange={(e) => {
                            const next = [...questions.partIII];
                            next[qIdx] = { ...next[qIdx], explanation: e.target.value };
                            setQuestions({ ...questions, partIII: next });
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="preview" className="mt-0 space-y-5">
              {totalQuestions === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  Đề thi chưa có nội dung câu hỏi để xem trước.
                </div>
              ) : (
                <>
                  {questions.partI.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="font-bold text-base border-b pb-1">PHẦN I. Trắc nghiệm nhiều lựa chọn</h4>
                      {questions.partI.map((q, idx) => (
                        <div key={q.id || idx} className="p-3.5 rounded-lg border bg-muted/15 space-y-2">
                          <div className="font-bold text-sm flex gap-1.5">
                            <span>Câu {idx + 1}:</span>
                            <div className="flex-1">
                              <RichText content={q.text} />
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-4">
                            {(q.options || []).map((opt) => {
                              const isCorrect = opt.key === q.answer;
                              return (
                                <div
                                  key={opt.key}
                                  className={`p-2 rounded border text-sm flex items-start gap-2 ${
                                    isCorrect ? "bg-emerald-500/10 border-emerald-500/40 font-semibold" : "bg-background"
                                  }`}
                                >
                                  <span className="font-bold">{opt.key}.</span>
                                  <div className="flex-1">
                                    <RichText content={opt.text} />
                                  </div>
                                  {isCorrect && <CheckCircle2 className="size-4 text-emerald-600 shrink-0 mt-0.5" />}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {questions.partII.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="font-bold text-base border-b pb-1">PHẦN II. Trắc nghiệm Đúng/Sai</h4>
                      {questions.partII.map((q, idx) => (
                        <div key={q.id || idx} className="p-3.5 rounded-lg border bg-muted/15 space-y-2">
                          <div className="font-bold text-sm flex gap-1.5">
                            <span>Câu {idx + 1}:</span>
                            <div className="flex-1">
                              <RichText content={q.text} />
                            </div>
                          </div>
                          <div className="space-y-1 pl-4">
                            {(q.items || []).map((it) => (
                              <div key={it.key} className="p-2 rounded border bg-background text-sm flex justify-between gap-2">
                                <span>
                                  <strong>{it.key})</strong> <RichText content={it.text} />
                                </span>
                                <Badge variant={it.correct ? "default" : "secondary"}>
                                  {it.correct ? "Đúng" : "Sai"}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {questions.partIII.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="font-bold text-base border-b pb-1">PHẦN III. Trả lời ngắn</h4>
                      {questions.partIII.map((q, idx) => (
                        <div key={q.id || idx} className="p-3.5 rounded-lg border bg-muted/15 space-y-1.5">
                          <div className="font-bold text-sm flex gap-1.5">
                            <span>Câu {idx + 1}:</span>
                            <div className="flex-1">
                              <RichText content={q.text} />
                            </div>
                          </div>
                          <div className="text-xs text-emerald-700 font-semibold pl-4">
                            Đáp án: {q.answer || "(Chưa thiết lập)"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter className="px-6 py-3.5 border-t bg-muted/20">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Đóng
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving} className="bg-gradient-primary">
            {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Save className="size-4 mr-2" />}
            Lưu thay đổi đề thi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
