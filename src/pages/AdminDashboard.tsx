import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Users,
  FileText,
  BarChart3,
  Search,
  UserPlus,
  Lock,
  Unlock,
  KeyRound,
  Trash2,
  Edit,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Eye,
  ExternalLink,
  Plus,
  RefreshCw,
  School,
  BookOpen,
  GraduationCap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  getAllTeachers,
  saveAllTeachers,
  TeacherUser,
  hashPassword,
  upsertTeacher,
  deleteTeacher,
} from "@/lib/teacherStorage";
import { SUBJECT_LIST } from "@/lib/subjects";
import { toast } from "sonner";

export default function AdminDashboard() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<"dashboard" | "teachers" | "exams" | "results">("dashboard");

  // Teachers State
  const [teachers, setTeachers] = useState<TeacherUser[]>([]);
  const [teacherQuery, setTeacherQuery] = useState("");
  const [addTeacherOpen, setAddTeacherOpen] = useState(false);
  const [editTeacher, setEditTeacher] = useState<TeacherUser | null>(null);
  const [resetPwdTeacher, setResetPwdTeacher] = useState<TeacherUser | null>(null);
  const [newPasswordVal, setNewPasswordVal] = useState("");

  // Teacher Form State
  const [tfUsername, setTfUsername] = useState("");
  const [tfName, setTfName] = useState("");
  const [tfEmail, setTfEmail] = useState("");
  const [tfPhone, setTfPhone] = useState("");
  const [tfSchool, setTfSchool] = useState("");
  const [tfSubject, setTfSubject] = useState("");
  const [tfPassword, setTfPassword] = useState("");

  // Exams State
  const [exams, setExams] = useState<any[]>([]);
  const [examQuery, setExamQuery] = useState("");
  const [selectedTeacherFilter, setSelectedTeacherFilter] = useState<string>("all");
  const [examSubCounts, setExamSubCounts] = useState<Record<string, number>>({});

  // Submissions / Results State
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [resultExamFilter, setResultExamFilter] = useState<string>("all");
  const [resultQuery, setResultQuery] = useState("");
  const [selectedSubDetail, setSelectedSubDetail] = useState<any | null>(null);

  const [loading, setLoading] = useState(true);

  // Load All Data
  const loadData = async () => {
    setLoading(true);
    // 1. Teachers
    const tchs = getAllTeachers();
    setTeachers(tchs);

    // 2. Exams
    const { data: ex } = await supabase
      .from("exams")
      .select("id,title,created_by,created_at,duration_minutes,display_mode,school_name,teacher_name,subject_name,questions,manual_closed")
      .order("created_at", { ascending: false });
    const allExams = ex || [];
    setExams(allExams);

    // 3. Submissions
    const { data: subs } = await supabase
      .from("submissions")
      .select("id,exam_id,student_name,student_class,score,max_score,correct_count,wrong_count,violation_count,submitted_at,duration_seconds,answers")
      .order("submitted_at", { ascending: false });
    const allSubs = subs || [];
    setSubmissions(allSubs);

    // Counts per exam
    const c: Record<string, number> = {};
    allSubs.forEach((s) => {
      c[s.exam_id] = (c[s.exam_id] || 0) + 1;
    });
    setExamSubCounts(c);

    setLoading(false);
  };

  useEffect(() => {
    loadData();
    const handleSync = () => setTeachers(getAllTeachers());
    window.addEventListener("teacher_registry_changed", handleSync);
    return () => window.removeEventListener("teacher_registry_changed", handleSync);
  }, []);

  // Filtered Teachers
  const filteredTeachers = useMemo(() => {
    const q = teacherQuery.toLowerCase().trim();
    if (!q) return teachers;
    return teachers.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.username.toLowerCase().includes(q) ||
        t.email.toLowerCase().includes(q) ||
        (t.school || "").toLowerCase().includes(q) ||
        (t.subject || "").toLowerCase().includes(q)
    );
  }, [teachers, teacherQuery]);

  // Map of teacher id / username to teacher
  const teacherMap = useMemo(() => {
    const map = new Map<string, TeacherUser>();
    teachers.forEach((t) => {
      map.set(t.id, t);
      map.set(t.username.toLowerCase(), t);
      if (t.email) map.set(t.email.toLowerCase(), t);
    });
    return map;
  }, [teachers]);

  // Helper to get teacher name for an exam
  const getExamTeacherName = (exam: any) => {
    if (exam.created_by && teacherMap.has(exam.created_by)) {
      return teacherMap.get(exam.created_by)!.name;
    }
    if (exam.teacher_name) return exam.teacher_name;
    // Default teacher if created_by is default
    return "Giáo viên Hệ thống";
  };

  // Filtered Exams
  const filteredExams = useMemo(() => {
    return exams.filter((e) => {
      if (selectedTeacherFilter !== "all" && e.created_by !== selectedTeacherFilter) {
        return false;
      }
      if (examQuery) {
        const q = examQuery.toLowerCase().trim();
        const titleMatch = (e.title || "").toLowerCase().includes(q);
        const teacherMatch = getExamTeacherName(e).toLowerCase().includes(q);
        if (!titleMatch && !teacherMatch) return false;
      }
      return true;
    });
  }, [exams, selectedTeacherFilter, examQuery, teacherMap]);

  // Filtered Results
  const filteredResults = useMemo(() => {
    return submissions.filter((s) => {
      if (resultExamFilter !== "all" && s.exam_id !== resultExamFilter) return false;
      if (resultQuery) {
        const q = resultQuery.toLowerCase().trim();
        const nameMatch = (s.student_name || "").toLowerCase().includes(q);
        const classMatch = (s.student_class || "").toLowerCase().includes(q);
        if (!nameMatch && !classMatch) return false;
      }
      return true;
    });
  }, [submissions, resultExamFilter, resultQuery]);

  // Statistics
  const stats = useMemo(() => {
    const totalTeachers = teachers.length;
    const activeTeachers = teachers.filter((t) => t.status === "active").length;
    const totalExams = exams.length;
    const totalSubs = submissions.length;
    const uniqStudents = new Set(submissions.map((s) => `${s.student_name}_${s.student_class}`)).size;
    const avgScore = totalSubs
      ? Math.round((submissions.reduce((a, b) => a + Number(b.score || 0), 0) / totalSubs) * 10) / 10
      : 0;

    return { totalTeachers, activeTeachers, totalExams, totalSubs, uniqStudents, avgScore };
  }, [teachers, exams, submissions]);

  // Teacher CRUD Handlers
  const handleCreateTeacher = (e: React.FormEvent) => {
    e.preventDefault();
    const uname = tfUsername.trim().toLowerCase();
    if (!uname || !tfName.trim() || !tfPassword) {
      toast.error("Vui lòng điền tên đăng nhập, họ tên và mật khẩu");
      return;
    }
    if (teachers.some((t) => t.username.toLowerCase() === uname)) {
      toast.error("Tên đăng nhập này đã tồn tại");
      return;
    }

    const newTeacher: TeacherUser = {
      id: `teacher-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      username: uname,
      name: tfName.trim(),
      email: tfEmail.trim() || `${uname}@school.edu.vn`,
      phone: tfPhone.trim(),
      school: tfSchool.trim() || "Trường THPT",
      subject: tfSubject || "Toán học",
      status: "active",
      passwordHash: hashPassword(tfPassword),
      createdAt: new Date().toISOString(),
    };

    upsertTeacher(newTeacher);
    setTeachers(getAllTeachers());
    toast.success(`Đã tạo tài khoản giáo viên: ${newTeacher.name}`);
    setAddTeacherOpen(false);

    // Reset Form
    setTfUsername("");
    setTfName("");
    setTfEmail("");
    setTfPhone("");
    setTfSchool("");
    setTfSubject("");
    setTfPassword("");
  };

  const handleUpdateTeacher = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTeacher) return;
    upsertTeacher(editTeacher);
    setTeachers(getAllTeachers());
    toast.success("Cập nhật thông tin giáo viên thành công");
    setEditTeacher(null);
  };

  const toggleTeacherStatus = (t: TeacherUser) => {
    const nextStatus = t.status === "active" ? "locked" : "active";
    const updated: TeacherUser = { ...t, status: nextStatus };
    upsertTeacher(updated);
    setTeachers(getAllTeachers());
    toast.success(nextStatus === "locked" ? `Đã khóa tài khoản ${t.name}` : `Đã mở khóa tài khoản ${t.name}`);
  };

  const handleResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPwdTeacher) return;
    if (newPasswordVal.length < 6) {
      toast.error("Mật khẩu mới tối thiểu 6 ký tự");
      return;
    }
    const updated: TeacherUser = {
      ...resetPwdTeacher,
      passwordHash: hashPassword(newPasswordVal),
    };
    upsertTeacher(updated);
    setTeachers(getAllTeachers());
    toast.success(`Đã đổi mật khẩu cho giáo viên ${resetPwdTeacher.name}`);
    setResetPwdTeacher(null);
    setNewPasswordVal("");
  };

  const handleDeleteTeacher = (t: TeacherUser) => {
    if (!confirm(`Bạn có chắc muốn xóa tài khoản giáo viên "${t.name}"? Thao tác này không thể hoàn tác.`)) {
      return;
    }
    deleteTeacher(t.id);
    setTeachers(getAllTeachers());
    toast.success(`Đã xóa tài khoản giáo viên: ${t.name}`);
  };

  // Exam Actions
  const handleDeleteExam = async (exam: any) => {
    if (!confirm(`Xóa đề thi "${exam.title}"? Toàn bộ bài làm của học sinh cho đề này cũng sẽ bị xóa vĩnh viễn.`)) {
      return;
    }
    await supabase.from("submissions").delete().eq("exam_id", exam.id);
    const { error } = await supabase.from("exams").delete().eq("id", exam.id);
    if (error) {
      toast.error("Lỗi xóa đề: " + error.message);
      return;
    }
    setExams((prev) => prev.filter((e) => e.id !== exam.id));
    toast.success("Đã xóa đề thi thành công");
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card border rounded-2xl p-6 shadow-soft">
        <div className="flex items-center gap-3">
          <div className="size-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 grid place-items-center text-white shadow-soft shrink-0">
            <ShieldCheck className="size-7" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
              Hệ thống Quản trị Toàn quyền (Admin)
              <Badge className="bg-amber-500 hover:bg-amber-600 text-white font-semibold">Tối cao</Badge>
            </h1>
            <p className="text-sm text-muted-foreground">
              Toàn quyền quản lý tài khoản giáo viên, tất cả đề thi và kết quả kiểm tra trong toàn bộ hệ thống
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`size-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Làm mới
          </Button>
          <Button asChild size="sm" className="bg-gradient-primary">
            <Link to="/teacher">
              <Plus className="size-4 mr-1" /> Tạo đề thi mới
            </Link>
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="space-y-6">
        <TabsList className="grid grid-cols-4 w-full md:w-auto md:inline-flex bg-muted/60 p-1 rounded-xl">
          <TabsTrigger value="dashboard" className="rounded-lg gap-2 text-xs sm:text-sm">
            <BarChart3 className="size-4" /> Tổng quan
          </TabsTrigger>
          <TabsTrigger value="teachers" className="rounded-lg gap-2 text-xs sm:text-sm">
            <Users className="size-4" /> Quản lý Giáo viên ({teachers.length})
          </TabsTrigger>
          <TabsTrigger value="exams" className="rounded-lg gap-2 text-xs sm:text-sm">
            <FileText className="size-4" /> Tất cả Bài thi ({exams.length})
          </TabsTrigger>
          <TabsTrigger value="results" className="rounded-lg gap-2 text-xs sm:text-sm">
            <GraduationCap className="size-4" /> Kết quả làm bài ({submissions.length})
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: DASHBOARD OVERVIEW */}
        <TabsContent value="dashboard" className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Card className="p-4 flex flex-col items-center justify-center text-center border-l-4 border-l-blue-500">
              <Users className="size-5 text-blue-500 mb-1" />
              <div className="text-2xl font-black">{stats.totalTeachers}</div>
              <div className="text-xs text-muted-foreground">Giáo viên</div>
            </Card>

            <Card className="p-4 flex flex-col items-center justify-center text-center border-l-4 border-l-emerald-500">
              <CheckCircle2 className="size-5 text-emerald-500 mb-1" />
              <div className="text-2xl font-black">{stats.activeTeachers}</div>
              <div className="text-xs text-muted-foreground">GV Đang hoạt động</div>
            </Card>

            <Card className="p-4 flex flex-col items-center justify-center text-center border-l-4 border-l-purple-500">
              <FileText className="size-5 text-purple-500 mb-1" />
              <div className="text-2xl font-black">{stats.totalExams}</div>
              <div className="text-xs text-muted-foreground">Tổng số đề thi</div>
            </Card>

            <Card className="p-4 flex flex-col items-center justify-center text-center border-l-4 border-l-cyan-500">
              <GraduationCap className="size-5 text-cyan-500 mb-1" />
              <div className="text-2xl font-black">{stats.uniqStudents}</div>
              <div className="text-xs text-muted-foreground">Học sinh tham gia</div>
            </Card>

            <Card className="p-4 flex flex-col items-center justify-center text-center border-l-4 border-l-amber-500">
              <BarChart3 className="size-5 text-amber-500 mb-1" />
              <div className="text-2xl font-black">{stats.totalSubs}</div>
              <div className="text-xs text-muted-foreground">Lượt nộp bài</div>
            </Card>

            <Card className="p-4 flex flex-col items-center justify-center text-center border-l-4 border-l-rose-500">
              <ShieldAlert className="size-5 text-rose-500 mb-1" />
              <div className="text-2xl font-black">{stats.avgScore}/10</div>
              <div className="text-xs text-muted-foreground">Điểm trung bình</div>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Quick Teachers card */}
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-base flex items-center gap-2">
                  <Users className="size-4 text-primary" /> Giáo viên gần đây
                </h3>
                <Button variant="ghost" size="sm" onClick={() => setActiveTab("teachers")}>
                  Xem tất cả ({teachers.length})
                </Button>
              </div>
              <div className="divide-y">
                {teachers.slice(0, 5).map((t) => (
                  <div key={t.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="size-8 rounded-full bg-primary/10 text-primary font-bold text-xs grid place-items-center shrink-0">
                        {t.name[0]?.toUpperCase() || "G"}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{t.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          @{t.username} • {t.subject} • {t.school}
                        </div>
                      </div>
                    </div>
                    <Badge variant={t.status === "active" ? "default" : "destructive"} className="shrink-0 text-[10px]">
                      {t.status === "active" ? "Hoạt động" : "Đã khóa"}
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>

            {/* Quick Exams card */}
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-base flex items-center gap-2">
                  <FileText className="size-4 text-primary" /> Bài thi mới nhất
                </h3>
                <Button variant="ghost" size="sm" onClick={() => setActiveTab("exams")}>
                  Xem tất cả ({exams.length})
                </Button>
              </div>
              <div className="divide-y">
                {exams.slice(0, 5).map((e) => (
                  <div key={e.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{e.title}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        GV: {getExamTeacherName(e)} • {examSubCounts[e.id] || 0} bài nộp
                      </div>
                    </div>
                    <Button asChild size="sm" variant="outline" className="shrink-0 h-8 text-xs">
                      <Link to={`/exam/${e.id}/results`}>
                        <BarChart3 className="size-3.5 mr-1" /> Kết quả
                      </Link>
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </TabsContent>

        {/* TAB 2: QUẢN LÝ GIÁO VIÊN */}
        <TabsContent value="teachers" className="space-y-4">
          <Card className="p-4 md:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative w-full sm:w-72">
                <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Tìm giáo viên (tên, tài khoản, trường)..."
                  value={teacherQuery}
                  onChange={(e) => setTeacherQuery(e.target.value)}
                  className="pl-9 rounded-xl"
                />
              </div>
              <Button onClick={() => setAddTeacherOpen(true)} className="w-full sm:w-auto bg-gradient-primary rounded-xl">
                <UserPlus className="size-4 mr-2" /> Thêm giáo viên mới
              </Button>
            </div>

            <div className="border rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Giáo viên</TableHead>
                    <TableHead>Tên đăng nhập</TableHead>
                    <TableHead>Môn học & Trường</TableHead>
                    <TableHead>Liên hệ</TableHead>
                    <TableHead className="text-center">Trạng thái</TableHead>
                    <TableHead className="text-right">Hành động</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTeachers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        Không tìm thấy giáo viên nào phù hợp.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredTeachers.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="size-9 rounded-full bg-gradient-primary grid place-items-center text-primary-foreground font-bold text-sm shrink-0 overflow-hidden">
                              {t.avatar ? (
                                <img src={t.avatar} alt={t.name} className="size-full object-cover" />
                              ) : (
                                t.name[0]?.toUpperCase() || "G"
                              )}
                            </div>
                            <div>
                              <div className="font-semibold text-sm leading-tight">{t.name}</div>
                              <div className="text-[11px] text-muted-foreground">{t.email}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs font-semibold text-primary">
                          @{t.username}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="font-medium">{t.subject || "Chưa phân môn"}</div>
                          <div className="text-muted-foreground">{t.school || "Chưa cập nhật"}</div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {t.phone || "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={t.status === "active" ? "default" : "destructive"}
                            className="text-[11px]"
                          >
                            {t.status === "active" ? "Hoạt động" : "Bị khóa"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              title={t.status === "active" ? "Khóa tài khoản" : "Mở khóa tài khoản"}
                              onClick={() => toggleTeacherStatus(t)}
                            >
                              {t.status === "active" ? (
                                <Lock className="size-4 text-amber-600" />
                              ) : (
                                <Unlock className="size-4 text-emerald-600" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              title="Chỉnh sửa thông tin"
                              onClick={() => setEditTeacher({ ...t })}
                            >
                              <Edit className="size-4 text-blue-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              title="Đặt lại mật khẩu"
                              onClick={() => {
                                setResetPwdTeacher(t);
                                setNewPasswordVal("");
                              }}
                            >
                              <KeyRound className="size-4 text-purple-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-destructive hover:bg-destructive/10"
                              title="Xóa giáo viên"
                              onClick={() => handleDeleteTeacher(t)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* TAB 3: TẤT CẢ BÀI THI */}
        <TabsContent value="exams" className="space-y-4">
          <Card className="p-4 md:p-6 space-y-4">
            <div className="flex flex-col md:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 w-full md:w-auto">
                <div className="relative flex-1 md:w-72">
                  <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Tìm tên bài thi hoặc giáo viên..."
                    value={examQuery}
                    onChange={(e) => setExamQuery(e.target.value)}
                    className="pl-9 rounded-xl"
                  />
                </div>
                <Select value={selectedTeacherFilter} onValueChange={setSelectedTeacherFilter}>
                  <SelectTrigger className="w-56 rounded-xl">
                    <SelectValue placeholder="Lọc theo giáo viên" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả giáo viên</SelectItem>
                    {teachers.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} (@{t.username})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="text-xs text-muted-foreground">
                Hiển thị <b>{filteredExams.length}</b> / {exams.length} bài thi
              </div>
            </div>

            <div className="border rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Tên bài thi</TableHead>
                    <TableHead>Giáo viên tạo</TableHead>
                    <TableHead>Thời gian</TableHead>
                    <TableHead className="text-center">Số bài nộp</TableHead>
                    <TableHead className="text-center">Trạng thái</TableHead>
                    <TableHead className="text-right">Hành động</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredExams.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        Không có đề thi nào phù hợp.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredExams.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell>
                          <div className="font-semibold text-sm line-clamp-1">{e.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {e.subject_name || "Môn học"} • {e.duration_minutes} phút • Chế độ: {e.display_mode || "chuẩn"}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="font-semibold text-primary">{getExamTeacherName(e)}</div>
                          <div className="text-muted-foreground">{e.school_name || "THPT"}</div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(e.created_at).toLocaleDateString("vi-VN")}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary" className="font-bold">
                            {examSubCounts[e.id] || 0}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={e.manual_closed ? "outline" : "default"} className="text-[10px]">
                            {e.manual_closed ? "Đã đóng" : "Đang mở"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button asChild variant="ghost" size="icon" className="size-8" title="Xem kết quả">
                              <Link to={`/exam/${e.id}/results`}>
                                <BarChart3 className="size-4 text-blue-600" />
                              </Link>
                            </Button>
                            <Button asChild variant="ghost" size="icon" className="size-8" title="Chỉnh sửa đề">
                              <Link to={`/exam/${e.id}/edit`}>
                                <Edit className="size-4 text-amber-600" />
                              </Link>
                            </Button>
                            <Button asChild variant="ghost" size="icon" className="size-8" title="Link bài thi">
                              <Link to={`/take/${e.id}`} target="_blank">
                                <ExternalLink className="size-4 text-emerald-600" />
                              </Link>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-destructive hover:bg-destructive/10"
                              title="Xóa đề thi"
                              onClick={() => handleDeleteExam(e)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* TAB 4: QUẢN LÝ KẾT QUẢ BÀI LÀM */}
        <TabsContent value="results" className="space-y-4">
          <Card className="p-4 md:p-6 space-y-4">
            <div className="flex flex-col md:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 w-full md:w-auto">
                <div className="relative flex-1 md:w-72">
                  <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Tìm theo tên học sinh hoặc lớp..."
                    value={resultQuery}
                    onChange={(e) => setResultQuery(e.target.value)}
                    className="pl-9 rounded-xl"
                  />
                </div>
                <Select value={resultExamFilter} onValueChange={setResultExamFilter}>
                  <SelectTrigger className="w-64 rounded-xl">
                    <SelectValue placeholder="Lọc theo bài thi" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả bài thi</SelectItem>
                    {exams.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="text-xs text-muted-foreground">
                Tổng cộng <b>{filteredResults.length}</b> lượt nộp bài
              </div>
            </div>

            <div className="border rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Học sinh</TableHead>
                    <TableHead>Lớp</TableHead>
                    <TableHead>Bài thi</TableHead>
                    <TableHead className="text-center">Số câu đúng / sai</TableHead>
                    <TableHead className="text-center">Điểm số</TableHead>
                    <TableHead className="text-center">Vi phạm</TableHead>
                    <TableHead className="text-right">Thời gian nộp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredResults.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        Không có dữ liệu bài nộp nào.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredResults.slice(0, 100).map((s) => {
                      const exam = exams.find((e) => e.id === s.exam_id);
                      return (
                        <TableRow key={s.id}>
                          <TableCell className="font-semibold text-sm">
                            {s.student_name}
                          </TableCell>
                          <TableCell className="text-xs">
                            <Badge variant="outline">{s.student_class}</Badge>
                          </TableCell>
                          <TableCell className="text-xs max-w-xs truncate">
                            {exam?.title || s.exam_id}
                          </TableCell>
                          <TableCell className="text-center text-xs">
                            <span className="text-emerald-600 font-semibold">{s.correct_count}</span>
                            {" / "}
                            <span className="text-rose-500">{s.wrong_count}</span>
                          </TableCell>
                          <TableCell className="text-center font-bold text-sm">
                            <span
                              className={
                                s.score >= 8
                                  ? "text-emerald-600"
                                  : s.score >= 5
                                  ? "text-blue-600"
                                  : "text-rose-500"
                              }
                            >
                              {s.score}
                            </span>
                            <span className="text-xs text-muted-foreground">/{s.max_score || 10}</span>
                          </TableCell>
                          <TableCell className="text-center">
                            {s.violation_count > 0 ? (
                              <Badge variant="destructive" className="text-[10px]">
                                {s.violation_count} lần
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">0</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {new Date(s.submitted_at).toLocaleString("vi-VN")}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* DIALOG 1: THÊM GIÁO VIÊN MỚI */}
      <Dialog open={addTeacherOpen} onOpenChange={setAddTeacherOpen}>
        <DialogContent className="max-w-md sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="size-5 text-primary" /> Thêm tài khoản Giáo viên mới
            </DialogTitle>
            <DialogDescription>
              Tạo tài khoản giáo viên mới. Giáo viên có thể dùng tên đăng nhập và mật khẩu này để đăng nhập ngay.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateTeacher} className="space-y-3.5 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="tf-user">Tên đăng nhập *</Label>
                <Input
                  id="tf-user"
                  required
                  placeholder="giaovien_toan"
                  value={tfUsername}
                  onChange={(e) => setTfUsername(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tf-pass">Mật khẩu ban đầu *</Label>
                <Input
                  id="tf-pass"
                  required
                  type="password"
                  placeholder="Tối thiểu 6 ký tự"
                  value={tfPassword}
                  onChange={(e) => setTfPassword(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="tf-name">Họ và tên giáo viên *</Label>
              <Input
                id="tf-name"
                required
                placeholder="Thầy Nguyễn Văn An"
                value={tfName}
                onChange={(e) => setTfName(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="tf-email">Email</Label>
                <Input
                  id="tf-email"
                  type="email"
                  placeholder="an.nv@school.edu.vn"
                  value={tfEmail}
                  onChange={(e) => setTfEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tf-phone">Số điện thoại</Label>
                <Input
                  id="tf-phone"
                  placeholder="0912 345 678"
                  value={tfPhone}
                  onChange={(e) => setTfPhone(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="tf-school">Trường học</Label>
                <Input
                  id="tf-school"
                  placeholder="THPT Lê Quý Đôn"
                  value={tfSchool}
                  onChange={(e) => setTfSchool(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tf-subject">Môn học</Label>
                <Select value={tfSubject} onValueChange={setTfSubject}>
                  <SelectTrigger id="tf-subject">
                    <SelectValue placeholder="Chọn môn học" />
                  </SelectTrigger>
                  <SelectContent>
                    {SUBJECT_LIST.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                    <SelectItem value="Khác">Môn khác</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setAddTeacherOpen(false)}>
                Hủy
              </Button>
              <Button type="submit" className="bg-gradient-primary">
                Tạo tài khoản
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG 2: CHỈNH SỬA GIÁO VIÊN */}
      <Dialog open={!!editTeacher} onOpenChange={(val) => !val && setEditTeacher(null)}>
        <DialogContent className="max-w-md sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="size-5 text-blue-600" /> Chỉnh sửa thông tin Giáo viên
            </DialogTitle>
            <DialogDescription>
              Cập nhật thông tin hồ sơ cho giáo viên @{editTeacher?.username}
            </DialogDescription>
          </DialogHeader>

          {editTeacher && (
            <form onSubmit={handleUpdateTeacher} className="space-y-3.5 py-2">
              <div className="space-y-1">
                <Label>Họ và tên *</Label>
                <Input
                  required
                  value={editTeacher.name}
                  onChange={(e) => setEditTeacher({ ...editTeacher, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={editTeacher.email}
                    onChange={(e) => setEditTeacher({ ...editTeacher, email: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Số điện thoại</Label>
                  <Input
                    value={editTeacher.phone || ""}
                    onChange={(e) => setEditTeacher({ ...editTeacher, phone: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Trường học</Label>
                  <Input
                    value={editTeacher.school}
                    onChange={(e) => setEditTeacher({ ...editTeacher, school: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Môn học</Label>
                  <Select
                    value={editTeacher.subject}
                    onValueChange={(val) => setEditTeacher({ ...editTeacher, subject: val })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn môn" />
                    </SelectTrigger>
                    <SelectContent>
                      {SUBJECT_LIST.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => setEditTeacher(null)}>
                  Hủy
                </Button>
                <Button type="submit" className="bg-gradient-primary">
                  Lưu thay đổi
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* DIALOG 3: ĐẶT LẠI MẬT KHẨU GIÁO VIÊN */}
      <Dialog open={!!resetPwdTeacher} onOpenChange={(val) => !val && setResetPwdTeacher(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-5 text-purple-600" /> Đặt lại mật khẩu giáo viên
            </DialogTitle>
            <DialogDescription>
              Tài khoản: <b>{resetPwdTeacher?.name}</b> (@{resetPwdTeacher?.username})
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleResetPassword} className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="admin-new-pwd">Mật khẩu mới *</Label>
              <Input
                id="admin-new-pwd"
                required
                minLength={6}
                placeholder="Nhập mật khẩu mới (tối thiểu 6 ký tự)"
                value={newPasswordVal}
                onChange={(e) => setNewPasswordVal(e.target.value)}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setResetPwdTeacher(null)}>
                Hủy
              </Button>
              <Button type="submit" className="bg-gradient-primary">
                Cập nhật mật khẩu
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
