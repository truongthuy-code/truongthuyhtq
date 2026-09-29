import { useState, useEffect, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sparkles,
  Bot,
  Upload,
  FileText,
  FileCode,
  FileSpreadsheet,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  Eye,
  Edit,
  Trash2,
  RefreshCw,
  Search,
  Filter,
  GraduationCap,
  BookOpen,
  ArrowRight,
  Layers,
  HelpCircle,
  Check,
  X,
  FileCheck2,
  ListOrdered,
  Lightbulb,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import {
  LearningMaterial,
  getAllMaterials,
  upsertMaterial,
  deleteMaterial,
  toggleMaterialActive,
  KnowledgeBase,
} from "@/lib/learningMaterials";
import { parseUploadedMaterial } from "@/lib/materialFileParser";
import { analyzeDocumentWithAI } from "@/lib/aiAssistantClient";
import { useAuth } from "@/hooks/useAuth";
import { SUBJECT_LIST } from "@/lib/subjects";

export default function AiLearningAssistantTeacher() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceFileInputRef = useRef<HTMLInputElement>(null);

  const [materials, setMaterials] = useState<LearningMaterial[]>([]);
  const [search, setSearch] = useState("");
  const [filterSubject, setFilterSubject] = useState<string>("all");
  const [filterGrade, setFilterGrade] = useState<string>("all");

  // Upload Form State
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadSubject, setUploadSubject] = useState("Tin học");
  const [customSubject, setCustomSubject] = useState("");
  const [uploadGrade, setUploadGrade] = useState("12");
  const [uploadTopic, setUploadTopic] = useState("");
  const [uploadDocTitle, setUploadDocTitle] = useState("");
  const [uploadScope, setUploadScope] = useState<"all" | "class" | "group">("all");
  const [uploadScopeTarget, setUploadScopeTarget] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzingStep, setAnalyzingStep] = useState("");

  // Modals
  const [viewMaterial, setViewMaterial] = useState<LearningMaterial | null>(null);
  const [editMaterial, setEditMaterial] = useState<LearningMaterial | null>(null);
  const [replacingMaterial, setReplacingMaterial] = useState<LearningMaterial | null>(null);

  // Load materials
  const loadData = () => {
    const list = getAllMaterials();
    setMaterials(list);
  };

  useEffect(() => {
    loadData();
  }, []);

  // Handle file select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadFile(file);
    if (!uploadDocTitle) {
      const cleanName = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
      setUploadDocTitle(cleanName);
    }
  };

  // Submit upload and run AI Analysis
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      toast.error("Vui lòng chọn file tài liệu cần tải lên!");
      return;
    }
    const finalSubject = uploadSubject === "other" ? customSubject.trim() : uploadSubject;
    if (!finalSubject) {
      toast.error("Vui lòng nhập tên môn học!");
      return;
    }
    if (!uploadTopic.trim()) {
      toast.error("Vui lòng nhập tên bài / chủ đề học tập!");
      return;
    }

    setIsAnalyzing(true);
    setAnalyzingStep("1. Đang trích xuất nội dung văn bản từ tệp...");

    try {
      // 1. Parse File
      const extracted = await parseUploadedMaterial(uploadFile);
      setAnalyzingStep("2. AI đang phân tích cấu trúc, khái niệm, quy tắc và ví dụ...");

      // 2. Analyze with Gemini AI
      let kb: KnowledgeBase | undefined;
      try {
        kb = await analyzeDocumentWithAI({
          text: extracted.text,
          subject: finalSubject,
          grade: uploadGrade,
          topic: uploadTopic.trim(),
          title: uploadDocTitle.trim() || uploadFile.name,
          imageBase64: extracted.imageBase64,
        });
      } catch (aiErr: any) {
        console.warn("AI Knowledge analysis warning:", aiErr);
        toast.info("Đã trích xuất tài liệu. AI sẽ tiếp tục học tài liệu này trong quá trình trợ giúp học sinh.");
        kb = {
          summary: `Tài liệu môn ${finalSubject} lớp ${uploadGrade}: ${uploadTopic.trim()}`,
          mainTopics: [uploadTopic.trim()],
          concepts: [],
          rules: [],
          procedures: [],
          examples: [],
          keyTakeaways: ["Kiến thức trọng tâm theo tài liệu của giáo viên."],
        };
      }

      setAnalyzingStep("3. Đang lưu vào Kho kiến thức Trợ lý học tập AI...");

      const newMat: LearningMaterial = {
        id: "mat-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
        teacherId: user?.id || "teacher-current",
        teacherName: profile?.full_name || "Giáo viên",
        subject: finalSubject,
        grade: uploadGrade,
        topic: uploadTopic.trim(),
        title: uploadDocTitle.trim() || uploadFile.name,
        fileName: uploadFile.name,
        fileType: extracted.fileType,
        scope: uploadScope,
        scopeTarget: uploadScopeTarget.trim(),
        rawContent: extracted.text,
        knowledgeBase: kb,
        isActiveForAI: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      upsertMaterial(newMat);
      loadData();
      toast.success("Tải tài liệu và xây dựng Kho kiến thức AI thành công!");

      // Reset form
      setUploadFile(null);
      setUploadTopic("");
      setUploadDocTitle("");
      setUploadScopeTarget("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: any) {
      console.error(err);
      toast.error("Lỗi xử lý tài liệu: " + err.message);
    } finally {
      setIsAnalyzing(false);
      setAnalyzingStep("");
    }
  };

  // Replace file handler
  const handleReplaceFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !replacingMaterial) return;

    try {
      toast.info("Đang đọc và phân tích tệp mới thay thế...");
      const extracted = await parseUploadedMaterial(file);
      const kb = await analyzeDocumentWithAI({
        text: extracted.text,
        subject: replacingMaterial.subject,
        grade: replacingMaterial.grade,
        topic: replacingMaterial.topic,
        title: replacingMaterial.title,
        imageBase64: extracted.imageBase64,
      }).catch(() => undefined);

      const updated: LearningMaterial = {
        ...replacingMaterial,
        fileName: file.name,
        fileType: extracted.fileType,
        rawContent: extracted.text,
        knowledgeBase: kb || replacingMaterial.knowledgeBase,
        updatedAt: new Date().toISOString(),
      };

      upsertMaterial(updated);
      loadData();
      setReplacingMaterial(null);
      toast.success("Thay thế tài liệu thành công!");
    } catch (err: any) {
      toast.error("Lỗi thay thế file: " + err.message);
    }
  };

  // Save Edit info
  const handleSaveEdit = () => {
    if (!editMaterial) return;
    upsertMaterial(editMaterial);
    loadData();
    setEditMaterial(null);
    toast.success("Cập nhật thông tin tài liệu thành công!");
  };

  // Delete
  const handleDelete = (id: string, title: string) => {
    if (confirm(`Bạn có chắc chắn muốn xóa tài liệu "${title}"? AI sẽ không được tiếp tục sử dụng nội dung của tài liệu này.`)) {
      deleteMaterial(id);
      loadData();
      toast.success("Đã xóa tài liệu khỏi Kho kiến thức AI.");
    }
  };

  // Toggle active
  const handleToggleActive = (id: string, current: boolean) => {
    toggleMaterialActive(id, !current);
    loadData();
    toast.success(!current ? "Đã BẬT sử dụng tài liệu cho Trợ lý AI" : "Đã TẮT sử dụng tài liệu cho Trợ lý AI");
  };

  // Filtered materials
  const filteredMaterials = useMemo(() => {
    return materials.filter((m) => {
      const matchSearch =
        !search ||
        m.title.toLowerCase().includes(search.toLowerCase()) ||
        m.topic.toLowerCase().includes(search.toLowerCase()) ||
        m.fileName.toLowerCase().includes(search.toLowerCase());

      const matchSub = filterSubject === "all" || m.subject === filterSubject;
      const matchGrade = filterGrade === "all" || m.grade === filterGrade;
      return matchSearch && matchSub && matchGrade;
    });
  }, [materials, search, filterSubject, filterGrade]);

  const availableSubjects = useMemo(() => {
    const set = new Set(materials.map((m) => m.subject));
    return Array.from(set);
  }, [materials]);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* HEADER BANNER */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 via-indigo-600 to-sky-600 text-white p-6 md:p-8 shadow-soft">
        <div className="absolute -right-8 -top-8 size-48 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-2 max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 backdrop-blur text-xs font-semibold">
              <Bot className="size-4 animate-bounce" /> PHÂN HỆ GIÁO VIÊN
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
              🤖 TRỢ LÝ HỌC TẬP AI – KHO TRI THỨC BÀI HỌC
            </h1>
            <p className="text-sm md:text-base text-white/90 leading-relaxed">
              Cung cấp tài liệu học tập theo từng môn, lớp, bài và chủ đề. AI đóng vai trò <strong>Gia sư học tập</strong> dựa
              chính xác trên nguồn tài liệu do giáo viên cung cấp: tóm tắt lý thuyết, kiểm tra nhanh, tạo bài tập ôn luyện 10/20 câu
              và kèm cặp học sinh từng bước.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <Button
              asChild
              variant="secondary"
              className="bg-white text-indigo-700 hover:bg-white/90 font-bold shadow-md rounded-xl"
            >
              <Link to="/student/assistant">
                <GraduationCap className="size-4 mr-2" /> Trải nghiệm vai trò Học sinh
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* SECTION 1: TẢI & PHÂN TÍCH TÀI LIỆU HỌC TẬP */}
      <Card className="p-5 md:p-6 shadow-sm border border-indigo-100 bg-white space-y-5">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2 text-indigo-700 font-bold text-lg">
            <Upload className="size-5" /> 1. QUẢN LÝ VÀ TẢI TÀI LIỆU HỌC TẬP CHO AI
          </div>
          <Badge variant="outline" className="text-xs bg-indigo-50 border-indigo-200 text-indigo-800">
            Hỗ trợ: .docx, .pdf, .pptx, .txt, hình ảnh
          </Badge>
        </div>

        <form onSubmit={handleUploadSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Môn học */}
            <div>
              <Label className="text-xs font-semibold text-slate-700">Môn học *</Label>
              <Select value={uploadSubject} onValueChange={setUploadSubject}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Chọn môn học" />
                </SelectTrigger>
                <SelectContent>
                  {SUBJECT_LIST.map((s) => (
                    <SelectItem key={s.name} value={s.name}>
                      {s.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="other">+ Nhập môn học khác...</SelectItem>
                </SelectContent>
              </Select>
              {uploadSubject === "other" && (
                <Input
                  placeholder="Nhập tên môn học..."
                  value={customSubject}
                  onChange={(e) => setCustomSubject(e.target.value)}
                  className="mt-2 text-sm"
                  required
                />
              )}
            </div>

            {/* Khối lớp */}
            <div>
              <Label className="text-xs font-semibold text-slate-700">Khối / Lớp *</Label>
              <Select value={uploadGrade} onValueChange={setUploadGrade}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Chọn khối lớp" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">Lớp 10</SelectItem>
                  <SelectItem value="11">Lớp 11</SelectItem>
                  <SelectItem value="12">Lớp 12</SelectItem>
                  <SelectItem value="9">Lớp 9</SelectItem>
                  <SelectItem value="8">Lớp 8</SelectItem>
                  <SelectItem value="7">Lớp 7</SelectItem>
                  <SelectItem value="6">Lớp 6</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Bài / Chủ đề */}
            <div>
              <Label className="text-xs font-semibold text-slate-700">Bài / Chủ đề *</Label>
              <Input
                placeholder="Ví dụ: Bài 9. Tạo danh sách, bảng"
                value={uploadTopic}
                onChange={(e) => setUploadTopic(e.target.value)}
                className="mt-1 text-sm"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Tên tài liệu */}
            <div className="md:col-span-2">
              <Label className="text-xs font-semibold text-slate-700">
                Tên tài liệu hiển thị (Tự lấy từ file nhưng có thể chỉnh sửa)
              </Label>
              <Input
                placeholder="Ví dụ: Giáo trình Bài 9 - Tạo danh sách và bảng trong HTML"
                value={uploadDocTitle}
                onChange={(e) => setUploadDocTitle(e.target.value)}
                className="mt-1 text-sm"
              />
            </div>

            {/* Phạm vi sử dụng */}
            <div>
              <Label className="text-xs font-semibold text-slate-700">Phạm vi sử dụng cho học sinh</Label>
              <Select value={uploadScope} onValueChange={(val: any) => setUploadScope(val)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toàn bộ học sinh khối/môn</SelectItem>
                  <SelectItem value="class">Một lớp cụ thể</SelectItem>
                  <SelectItem value="group">Một nhóm học sinh</SelectItem>
                </SelectContent>
              </Select>
              {uploadScope !== "all" && (
                <Input
                  placeholder={uploadScope === "class" ? "Nhập lớp (VD: 12A1)..." : "Nhập tên nhóm học sinh..."}
                  value={uploadScopeTarget}
                  onChange={(e) => setUploadScopeTarget(e.target.value)}
                  className="mt-2 text-sm"
                />
              )}
            </div>
          </div>

          {/* Chọn File Upload */}
          <div className="border-2 border-dashed border-indigo-200 rounded-xl p-5 bg-indigo-50/40 hover:bg-indigo-50/80 transition-all text-center">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".docx,.pdf,.pptx,.txt,image/*"
              className="hidden"
              id="material-file-upload"
            />
            <label htmlFor="material-file-upload" className="cursor-pointer block space-y-2">
              <div className="size-12 rounded-full bg-indigo-100 text-indigo-600 grid place-items-center mx-auto shadow-inner">
                <Upload className="size-6" />
              </div>
              <div className="font-semibold text-sm text-indigo-900">
                {uploadFile ? (
                  <span className="text-emerald-700 font-bold">📄 Đã chọn: {uploadFile.name} ({(uploadFile.size / 1024).toFixed(1)} KB)</span>
                ) : (
                  <span>Kéo thả hoặc bấm để chọn tệp tài liệu học tập</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Định dạng: Word (.docx), PDF, PowerPoint (.pptx), TXT, Hình ảnh bài học (.png, .jpg)
              </p>
            </label>
          </div>

          {/* Loading status */}
          {isAnalyzing && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm space-y-2 animate-pulse">
              <div className="flex items-center gap-2 font-bold text-amber-800">
                <RefreshCw className="size-4 animate-spin" /> AI đang đọc và trích xuất Kho tri thức...
              </div>
              <p className="text-xs text-amber-700">{analyzingStep}</p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="submit"
              disabled={isAnalyzing || !uploadFile}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-6 rounded-xl shadow-soft"
            >
              {isAnalyzing ? "Đang phân tích..." : "🚀 Tải lên & Phân tích kho kiến thức AI"}
            </Button>
          </div>
        </form>
      </Card>

      {/* SECTION 2: KHO TÀI LIỆU CỦA GIÁO VIÊN */}
      <Card className="p-5 md:p-6 shadow-sm border border-slate-200 bg-white space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b pb-3">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <BookOpen className="size-5 text-indigo-600" /> 2. KHO TÀI LIỆU HỌC TẬP CỦA GIÁO VIÊN ({filteredMaterials.length})
            </h2>
            <p className="text-xs text-muted-foreground">
              Các tài liệu đang cung cấp nguồn tri thức cho Trợ lý học tập AI. Khi xóa hoặc tắt, AI không được sử dụng tài liệu đó.
            </p>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative w-44">
              <Search className="size-3.5 absolute left-2.5 top-3 text-muted-foreground" />
              <Input
                placeholder="Tìm tài liệu, bài..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 text-xs"
              />
            </div>

            <Select value={filterSubject} onValueChange={setFilterSubject}>
              <SelectTrigger className="w-36 h-9 text-xs">
                <SelectValue placeholder="Môn học" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả môn</SelectItem>
                {availableSubjects.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterGrade} onValueChange={setFilterGrade}>
              <SelectTrigger className="w-28 h-9 text-xs">
                <SelectValue placeholder="Lớp" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả lớp</SelectItem>
                <SelectItem value="10">Lớp 10</SelectItem>
                <SelectItem value="11">Lớp 11</SelectItem>
                <SelectItem value="12">Lớp 12</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Table of Materials */}
        {filteredMaterials.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground space-y-2">
            <BookOpen className="size-12 mx-auto text-slate-300" />
            <div className="text-sm font-semibold">Chưa có tài liệu học tập nào phù hợp.</div>
            <p className="text-xs">Hãy tải lên tài liệu đầu tiên ở biểu mẫu phía trên để kích hoạt Trợ lý AI.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-700 text-xs font-bold uppercase tracking-wider border-b">
                <tr>
                  <th className="py-3 px-3">Môn</th>
                  <th className="py-3 px-3">Lớp</th>
                  <th className="py-3 px-4">Bài / Chủ đề</th>
                  <th className="py-3 px-4">Tài liệu</th>
                  <th className="py-3 px-3">Ngày cập nhật</th>
                  <th className="py-3 px-3 text-center">Trạng thái AI</th>
                  <th className="py-3 px-4 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMaterials.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-3 font-semibold text-indigo-700">
                      <Badge variant="outline" className="border-indigo-200 bg-indigo-50/50">
                        {m.subject}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 font-medium text-slate-600">Lớp {m.grade}</td>
                    <td className="py-3 px-4 font-bold text-slate-900">{m.topic}</td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-800">{m.title}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                        <span className="uppercase font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">
                          {m.fileType}
                        </span>
                        <span className="truncate max-w-[200px]">{m.fileName}</span>
                        {m.scope !== "all" && (
                          <Badge variant="secondary" className="text-[10px] py-0 px-1">
                            {m.scope === "class" ? `Lớp ${m.scopeTarget}` : `Nhóm ${m.scopeTarget}`}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(m.updatedAt || m.createdAt).toLocaleDateString("vi-VN")}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="flex flex-col items-center justify-center gap-1">
                        <Switch
                          checked={m.isActiveForAI}
                          onCheckedChange={() => handleToggleActive(m.id, m.isActiveForAI)}
                          className="data-[state=checked]:bg-emerald-600"
                        />
                        <span
                          className={`text-[10px] font-semibold ${
                            m.isActiveForAI ? "text-emerald-600" : "text-slate-400"
                          }`}
                        >
                          {m.isActiveForAI ? "Đang bật cho AI" : "Đã tắt"}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setViewMaterial(m)}
                          className="h-8 px-2 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50"
                          title="Xem kho kiến thức đã trích xuất"
                        >
                          <Eye className="size-4 mr-1" /> Xem
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditMaterial({ ...m })}
                          className="h-8 px-2 text-slate-600 hover:text-slate-900"
                          title="Cập nhật thông tin"
                        >
                          <Edit className="size-4 mr-1" /> Sửa
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setReplacingMaterial(m);
                            replaceFileInputRef.current?.click();
                          }}
                          className="h-8 px-2 text-amber-600 hover:text-amber-800 hover:bg-amber-50"
                          title="Thay thế tệp tài liệu"
                        >
                          <RefreshCw className="size-4 mr-1" /> Thay thế
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(m.id, m.title)}
                          className="h-8 px-2 text-rose-600 hover:text-rose-800 hover:bg-rose-50"
                          title="Xóa tài liệu"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Hidden input for replacing file */}
      <input
        type="file"
        ref={replaceFileInputRef}
        onChange={handleReplaceFileChange}
        accept=".docx,.pdf,.pptx,.txt,image/*"
        className="hidden"
      />

      {/* MODAL 1: XEM CHI TIẾT KHO KIẾN THỨC DO AI TRÍCH XUẤT */}
      <Dialog open={!!viewMaterial} onOpenChange={(open) => !open && setViewMaterial(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-2 text-indigo-700 font-bold text-xs uppercase tracking-wider">
              <Bot className="size-4" /> Kho tri thức AI trích xuất từ tài liệu
            </div>
            <DialogTitle className="text-xl font-extrabold text-slate-900">
              {viewMaterial?.title}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Môn: <strong>{viewMaterial?.subject}</strong> • Khối: <strong>{viewMaterial?.grade}</strong> • Bài/Chủ đề:{" "}
              <strong>{viewMaterial?.topic}</strong>
            </DialogDescription>
          </DialogHeader>

          {viewMaterial && (
            <Tabs defaultValue="knowledge" className="w-full mt-2">
              <TabsList className="grid grid-cols-2">
                <TabsTrigger value="knowledge">💡 Cấu trúc kiến thức AI</TabsTrigger>
                <TabsTrigger value="raw">📄 Văn bản tài liệu gốc</TabsTrigger>
              </TabsList>

              <TabsContent value="knowledge" className="space-y-4 pt-3 text-sm">
                {/* Tóm tắt */}
                {viewMaterial.knowledgeBase?.summary && (
                  <div className="p-3.5 rounded-xl bg-indigo-50 border border-indigo-100">
                    <h4 className="font-bold text-indigo-900 text-xs uppercase mb-1">📖 Tóm tắt tổng quan</h4>
                    <p className="text-slate-800 text-xs md:text-sm leading-relaxed">{viewMaterial.knowledgeBase.summary}</p>
                  </div>
                )}

                {/* Khái niệm */}
                {viewMaterial.knowledgeBase?.concepts && viewMaterial.knowledgeBase.concepts.length > 0 && (
                  <div>
                    <h4 className="font-bold text-slate-800 mb-2 flex items-center gap-1.5">
                      <Lightbulb className="size-4 text-amber-500" /> Khái niệm & Định nghĩa
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {viewMaterial.knowledgeBase.concepts.map((c, i) => (
                        <div key={i} className="p-2.5 rounded-lg border bg-slate-50/60">
                          <div className="font-bold text-indigo-700 text-xs">{c.name}</div>
                          <div className="text-xs text-slate-700 mt-0.5">{c.definition}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Quy tắc */}
                {viewMaterial.knowledgeBase?.rules && viewMaterial.knowledgeBase.rules.length > 0 && (
                  <div>
                    <h4 className="font-bold text-slate-800 mb-2 flex items-center gap-1.5">
                      <ListOrdered className="size-4 text-sky-600" /> Quy tắc & Lưu ý bắt buộc
                    </h4>
                    <ul className="list-disc pl-5 text-xs text-slate-700 space-y-1">
                      {viewMaterial.knowledgeBase.rules.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Ví dụ */}
                {viewMaterial.knowledgeBase?.examples && viewMaterial.knowledgeBase.examples.length > 0 && (
                  <div>
                    <h4 className="font-bold text-slate-800 mb-2 flex items-center gap-1.5">
                      <CheckCircle2 className="size-4 text-emerald-600" /> Ví dụ minh họa
                    </h4>
                    <div className="space-y-1.5">
                      {viewMaterial.knowledgeBase.examples.map((ex, i) => (
                        <div key={i} className="p-2 rounded bg-slate-100 font-mono text-xs text-slate-800">
                          {ex}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="raw" className="pt-3">
                <div className="p-3 bg-slate-900 text-slate-100 rounded-xl font-mono text-xs max-h-96 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                  {viewMaterial.rawContent}
                </div>
              </TabsContent>
            </Tabs>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setViewMaterial(null)}>
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL 2: CHỈNH SỬA THÔNG TIN TÀI LIỆU */}
      <Dialog open={!!editMaterial} onOpenChange={(open) => !open && setEditMaterial(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cập nhật thông tin tài liệu</DialogTitle>
          </DialogHeader>

          {editMaterial && (
            <div className="space-y-3 py-2 text-sm">
              <div>
                <Label className="text-xs">Tên tài liệu</Label>
                <Input
                  value={editMaterial.title}
                  onChange={(e) => setEditMaterial({ ...editMaterial, title: e.target.value })}
                  className="mt-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Môn học</Label>
                  <Input
                    value={editMaterial.subject}
                    onChange={(e) => setEditMaterial({ ...editMaterial, subject: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Khối lớp</Label>
                  <Input
                    value={editMaterial.grade}
                    onChange={(e) => setEditMaterial({ ...editMaterial, grade: e.target.value })}
                    className="mt-1"
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs">Bài / Chủ đề</Label>
                <Input
                  value={editMaterial.topic}
                  onChange={(e) => setEditMaterial({ ...editMaterial, topic: e.target.value })}
                  className="mt-1"
                />
              </div>

              <div>
                <Label className="text-xs">Phạm vi sử dụng</Label>
                <Select
                  value={editMaterial.scope}
                  onValueChange={(val: any) => setEditMaterial({ ...editMaterial, scope: val })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toàn bộ khối/môn</SelectItem>
                    <SelectItem value="class">Lớp cụ thể</SelectItem>
                    <SelectItem value="group">Nhóm học sinh</SelectItem>
                  </SelectContent>
                </Select>
                {editMaterial.scope !== "all" && (
                  <Input
                    placeholder="Tên lớp hoặc nhóm..."
                    value={editMaterial.scopeTarget || ""}
                    onChange={(e) => setEditMaterial({ ...editMaterial, scopeTarget: e.target.value })}
                    className="mt-2"
                  />
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditMaterial(null)}>
              Hủy
            </Button>
            <Button onClick={handleSaveEdit} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold">
              Lưu thay đổi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
