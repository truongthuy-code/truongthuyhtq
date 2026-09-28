import { useCallback, useEffect, useMemo, useState } from "react";
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
  Plus,
  RefreshCw,
  School,
  BookOpen,
  GraduationCap,
  Crown,
  UserCheck,
  Building,
  Layers,
  Award,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  getAllTeachers,
  TeacherUser,
  hashPassword,
  upsertTeacher,
  deleteTeacher,
  AdminUser,
  getAllAdmins,
  saveAllAdmins,
  upsertAdmin,
  deleteAdmin,
  changeAdminPassword,
  ROOT_SUPER_ADMIN_ID,
  getRootAdmin,
} from "@/lib/teacherStorage";
import { SUBJECT_LIST } from "@/lib/subjects";
import { toast } from "sonner";
import MandatoryPasswordChange from "@/components/MandatoryPasswordChange";

const DEFAULT_SCHOOLS = [
  "THPT Phan Bội Châu - TP Đà Nẵng",
  "THPT Lê Quý Đôn",
  "THPT Chuyên Hà Nội - Amsterdam",
  "THPT Bùi Thị Xuân",
  "THPT Marie Curie",
  "THPT Trần Phú",
];

const LS_SCHOOLS_KEY = "qc_schools_registry_v1";
const LS_SUBJECTS_KEY = "qc_custom_subjects_v1";

export default function AdminDashboard() {
  const { user, isSuperAdmin, isAdmin, mustChangePassword, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<
    "dashboard" | "admins" | "teachers" | "students" | "schools" | "subjects" | "exams" | "results"
  >("dashboard");

  // Admins State (Super Admin tab)
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [adminQuery, setAdminQuery] = useState("");
  const [addAdminOpen, setAddAdminOpen] = useState(false);
  const [resetPwdAdmin, setResetPwdAdmin] = useState<AdminUser | null>(null);
  const [newAdminPwd, setNewAdminPwd] = useState("");
  const [deleteAdminTarget, setDeleteAdminTarget] = useState<AdminUser | null>(null);

  // Admin form state
  const [afUsername, setAfUsername] = useState("");
  const [afName, setAfName] = useState("");
  const [afEmail, setAfEmail] = useState("");
  const [afPassword, setAfPassword] = useState("");
  const [afStatus, setAfStatus] = useState<"active" | "locked">("active");

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

  // Schools State
  const [customSchools, setCustomSchools] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(LS_SCHOOLS_KEY);
      return raw ? JSON.parse(raw) : DEFAULT_SCHOOLS;
    } catch {
      return DEFAULT_SCHOOLS;
    }
  });
  const [schoolQuery, setSchoolQuery] = useState("");
  const [addSchoolOpen, setAddSchoolOpen] = useState(false);
  const [newSchoolName, setNewSchoolName] = useState("");

  // Subjects State
  const [customSubjects, setCustomSubjects] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(LS_SUBJECTS_KEY);
      return raw ? JSON.parse(raw) : SUBJECT_LIST;
    } catch {
      return SUBJECT_LIST;
    }
  });
  const [subjectQuery, setSubjectQuery] = useState("");
  const [addSubjectOpen, setAddSubjectOpen] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState("");

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

  // Students filter state
  const [studentQuery, setStudentQuery] = useState("");
  const [studentClassFilter, setStudentClassFilter] = useState("all");

  const [loading, setLoading] = useState(true);

  // Load All Data
  const loadData = async () => {
    setLoading(true);
    // 1. Admins
    setAdmins(getAllAdmins());

    // 2. Teachers
    const tchs = getAllTeachers();
    setTeachers(tchs);

    // 3. Exams
    const { data: ex } = await supabase
      .from("exams")
      .select("id,title,created_by,created_at,duration_minutes,display_mode,school_name,teacher_name,subject_name,questions,manual_closed")
      .order("created_at", { ascending: false });
    const allExams = ex || [];
    setExams(allExams);

    // 4. Submissions
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
    const handleSync = () => {
      setTeachers(getAllTeachers());
      setAdmins(getAllAdmins());
    };
    window.addEventListener("teacher_registry_changed", handleSync);
    window.addEventListener("admin_registry_changed", handleSync);
    return () => {
      window.removeEventListener("teacher_registry_changed", handleSync);
      window.removeEventListener("admin_registry_changed", handleSync);
    };
  }, []);

  // Filtered Admins
  const filteredAdmins = useMemo(() => {
    const q = adminQuery.toLowerCase().trim();
    if (!q) return admins;
    return admins.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.username.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q)
    );
  }, [admins, adminQuery]);

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
  const getExamTeacherName = useCallback((exam: any) => {
    if (exam.created_by && teacherMap.has(exam.created_by)) {
      return teacherMap.get(exam.created_by)!.name;
    }
    if (exam.teacher_name) return exam.teacher_name;
    return "Giáo viên Hệ thống";
  }, [teacherMap]);

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
  }, [exams, selectedTeacherFilter, examQuery, getExamTeacherName]);

  // Aggregated Students
  const studentList = useMemo(() => {
    const map = new Map<string, { name: string; klass: string; attempts: number; totalScore: number; lastActive: string }>();
    submissions.forEach((s) => {
      const name = (s.student_name || "Ẩn danh").trim();
      const klass = (s.student_class || "Chưa rõ").trim();
      const key = `${name}___${klass}`.toLowerCase();

      const existing = map.get(key);
      const score = Number(s.score || 0);
      if (!existing) {
        map.set(key, {
          name,
          klass,
          attempts: 1,
          totalScore: score,
          lastActive: s.submitted_at || new Date().toISOString(),
        });
      } else {
        existing.attempts += 1;
        existing.totalScore += score;
        if (s.submitted_at && s.submitted_at > existing.lastActive) {
          existing.lastActive = s.submitted_at;
        }
      }
    });

    const list = Array.from(map.values()).map((st) => ({
      ...st,
      avgScore: st.attempts ? Math.round((st.totalScore / st.attempts) * 10) / 10 : 0,
    }));

    return list;
  }, [submissions]);

  const uniqueClasses = useMemo(() => {
    const set = new Set<string>();
    studentList.forEach((s) => set.add(s.klass));
    return Array.from(set).sort();
  }, [studentList]);

  const filteredStudents = useMemo(() => {
    return studentList.filter((s) => {
      if (studentClassFilter !== "all" && s.klass !== studentClassFilter) return false;
      if (studentQuery) {
        const q = studentQuery.toLowerCase().trim();
        return s.name.toLowerCase().includes(q) || s.klass.toLowerCase().includes(q);
      }
      return true;
    });
  }, [studentList, studentClassFilter, studentQuery]);

  // All Schools (custom + from teachers/exams)
  const allSchools = useMemo(() => {
    const set = new Set<string>(customSchools);
    teachers.forEach((t) => {
      if (t.school) set.add(t.school.trim());
    });
    exams.forEach((e) => {
      if (e.school_name) set.add(e.school_name.trim());
    });
    return Array.from(set).filter(Boolean).sort();
  }, [customSchools, teachers, exams]);

  const filteredSchools = useMemo(() => {
    const q = schoolQuery.toLowerCase().trim();
    if (!q) return allSchools;
    return allSchools.filter((s) => s.toLowerCase().includes(q));
  }, [allSchools, schoolQuery]);

  // All Subjects
  const allSubjects = useMemo(() => {
    const set = new Set<string>(customSubjects);
    SUBJECT_LIST.forEach((s) => set.add(s));
    teachers.forEach((t) => {
      if (t.subject) set.add(t.subject.trim());
    });
    exams.forEach((e) => {
      if (e.subject_name) set.add(e.subject_name.trim());
    });
    return Array.from(set).filter(Boolean).sort();
  }, [customSubjects, teachers, exams]);

  const filteredSubjects = useMemo(() => {
    const q = subjectQuery.toLowerCase().trim();
    if (!q) return allSubjects;
    return allSubjects.filter((s) => s.toLowerCase().includes(q));
  }, [allSubjects, subjectQuery]);

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
    const totalStudents = studentList.length;
    const totalSchools = allSchools.length;
    const totalSubjects = allSubjects.length;
    const avgScore = totalSubs
      ? Math.round((submissions.reduce((a, b) => a + Number(b.score || 0), 0) / totalSubs) * 10) / 10
      : 0;

    return { totalTeachers, activeTeachers, totalExams, totalSubs, totalStudents, totalSchools, totalSubjects, avgScore };
  }, [teachers, exams, submissions, studentList, allSchools, allSubjects]);

  // ADMIN MANAGEMENT HANDLERS (Super Admin only)
  const handleCreateAdmin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) {
      toast.error("Chỉ Super Admin gốc mới có quyền tạo Quản trị viên mới!");
      return;
    }

    const uname = afUsername.trim().toLowerCase();
    const email = afEmail.trim().toLowerCase();

    if (!uname || !afName.trim() || !afPassword) {
      toast.error("Vui lòng điền đầy đủ họ tên, tên đăng nhập và mật khẩu");
      return;
    }

    if (uname === "admin" || email === "admin@admin.com") {
      toast.error("Tên đăng nhập hoặc Email này là của Super Admin gốc!");
      return;
    }

    if (afPassword.length < 6) {
      toast.error("Mật khẩu ban đầu phải có ít nhất 6 ký tự");
      return;
    }

    const newAdm: AdminUser = {
      id: `admin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      username: uname,
      name: afName.trim(),
      email: email || `${uname}@admin.edu.vn`,
      role: "admin", // strictly secondary admin
      passwordHash: hashPassword(afPassword),
      status: afStatus,
      mustChangePassword: false,
      createdAt: new Date().toISOString(),
      createdBy: user?.id || "super_admin",
    };

    const res = upsertAdmin(newAdm);
    if (!res.ok) {
      toast.error(res.message || "Không thể tạo tài khoản Admin");
      return;
    }

    setAdmins(getAllAdmins());
    toast.success(`Đã tạo Quản trị viên mới: ${newAdm.name} (@${newAdm.username})`);
    setAddAdminOpen(false);

    // Reset Form
    setAfUsername("");
    setAfName("");
    setAfEmail("");
    setAfPassword("");
    setAfStatus("active");
  };

  const handleToggleAdminStatus = (adm: AdminUser) => {
    if (!isSuperAdmin) {
      toast.error("Chỉ Super Admin gốc mới có quyền thay đổi trạng thái!");
      return;
    }
    if (adm.role === "super_admin" || adm.id === ROOT_SUPER_ADMIN_ID) {
      toast.error("Không thể khóa tài khoản Super Admin gốc!");
      return;
    }

    const nextStatus = adm.status === "active" ? "locked" : "active";
    upsertAdmin({ ...adm, status: nextStatus });
    setAdmins(getAllAdmins());
    toast.success(
      nextStatus === "active"
        ? `Đã mở khóa tài khoản Admin: @${adm.username}`
        : `Đã khóa tài khoản Admin: @${adm.username}`
    );
  };

  const handleResetAdminPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin || !resetPwdAdmin) return;
    if (newAdminPwd.length < 6) {
      toast.error("Mật khẩu mới phải có tối thiểu 6 ký tự");
      return;
    }

    changeAdminPassword(resetPwdAdmin.id, newAdminPwd);
    setAdmins(getAllAdmins());
    toast.success(`Đã cập nhật mật khẩu cho Quản trị viên @${resetPwdAdmin.username}`);
    setResetPwdAdmin(null);
    setNewAdminPwd("");
  };

  const handleDeleteAdmin = () => {
    if (!isSuperAdmin || !deleteAdminTarget) return;
    if (deleteAdminTarget.role === "super_admin" || deleteAdminTarget.id === ROOT_SUPER_ADMIN_ID) {
      toast.error("Tuyệt đối không thể xóa tài khoản Super Admin gốc!");
      return;
    }

    const res = deleteAdmin(deleteAdminTarget.id);
    if (!res.ok) {
      toast.error(res.message || "Lỗi xóa Quản trị viên");
      return;
    }

    setAdmins(getAllAdmins());
    toast.success(`Đã xóa tài khoản Quản trị viên: @${deleteAdminTarget.username}`);
    setDeleteAdminTarget(null);
  };

  // Teacher CRUD Handlers
  const handleCreateTeacher = (e: React.FormEvent) => {
    e.preventDefault();
    const uname = tfUsername.trim().toLowerCase();
    if (!uname || !tfName.trim() || !tfPassword) {
      toast.error("Vui lòng điền tên đăng nhập, họ tên và mật khẩu");
      return;
    }
    if (uname === "admin" || uname === "super_admin") {
      toast.error("Tên đăng nhập này không hợp lệ");
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
    toast.success("Cập nhật thông tin giáo viên thành công!");
    setEditTeacher(null);
  };

  const handleToggleTeacherStatus = (t: TeacherUser) => {
    const nextStatus = t.status === "active" ? "locked" : "active";
    upsertTeacher({ ...t, status: nextStatus });
    setTeachers(getAllTeachers());
    toast.success(
      nextStatus === "active"
        ? `Đã mở khóa tài khoản giáo viên: ${t.name}`
        : `Đã khóa tài khoản giáo viên: ${t.name}`
    );
  };

  const handleResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPwdTeacher) return;
    if (newPasswordVal.length < 6) {
      toast.error("Mật khẩu mới phải có tối thiểu 6 ký tự");
      return;
    }
    upsertTeacher({ ...resetPwdTeacher, passwordHash: hashPassword(newPasswordVal) });
    setTeachers(getAllTeachers());
    toast.success(`Đã đặt lại mật khẩu cho giáo viên ${resetPwdTeacher.name}`);
    setResetPwdTeacher(null);
    setNewPasswordVal("");
  };

  const handleDeleteTeacher = (id: string, name: string) => {
    if (confirm(`Bạn có chắc chắn muốn xóa giáo viên "${name}" khỏi hệ thống?`)) {
      deleteTeacher(id);
      setTeachers(getAllTeachers());
      toast.success(`Đã xóa giáo viên: ${name}`);
    }
  };

  // Exam Management Handlers
  const handleToggleCloseExam = async (exam: any) => {
    const nextState = !exam.manual_closed;
    const { error } = await supabase
      .from("exams")
      .update({ manual_closed: nextState })
      .eq("id", exam.id);

    if (error) {
      toast.error("Không thể thay đổi trạng thái đề thi");
    } else {
      toast.success(nextState ? "Đã khóa đề thi" : "Đã mở lại đề thi cho học sinh làm bài");
      loadData();
    }
  };

  const handleDeleteExam = async (examId: string, title: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa đề thi "${title}"? Toàn bộ kết quả bài nộp của đề này cũng sẽ bị gỡ bỏ.`)) {
      return;
    }
    try {
      await supabase.from("submissions").delete().eq("exam_id", examId);
      const { error } = await supabase.from("exams").delete().eq("id", examId);
      if (error) throw error;
      toast.success(`Đã xóa đề thi: ${title}`);
      loadData();
    } catch (err: any) {
      toast.error("Không thể xóa đề thi: " + err.message);
    }
  };

  // School handlers
  const handleAddSchool = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newSchoolName.trim();
    if (!name) return;
    if (allSchools.includes(name)) {
      toast.error("Trường học này đã có trong hệ thống");
      return;
    }
    const updated = [...customSchools, name];
    setCustomSchools(updated);
    localStorage.setItem(LS_SCHOOLS_KEY, JSON.stringify(updated));
    toast.success(`Đã thêm trường học mới: ${name}`);
    setNewSchoolName("");
    setAddSchoolOpen(false);
  };

  // Subject handlers
  const handleAddSubject = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newSubjectName.trim();
    if (!name) return;
    if (allSubjects.includes(name)) {
      toast.error("Môn học này đã có trong hệ thống");
      return;
    }
    const updated = [...customSubjects, name];
    setCustomSubjects(updated);
    localStorage.setItem(LS_SUBJECTS_KEY, JSON.stringify(updated));
    toast.success(`Đã thêm môn học mới: ${name}`);
    setNewSubjectName("");
    setAddSubjectOpen(false);
  };

  // If mandatory change password flag is active, block everything and show the change screen
  if (mustChangePassword) {
    return (
      <MandatoryPasswordChange
        onSuccess={() => {
          refreshProfile();
        }}
      />
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* HEADER WITH ROLE BADGE */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tight text-foreground flex items-center gap-2">
              <ShieldCheck className="size-7 text-primary" /> Dashboard Quản trị Hệ thống
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Quản trị toàn diện: Quản trị viên, Giáo viên, Học sinh, Trường học, Môn học & Đề thi
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {isSuperAdmin ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500/15 via-rose-500/15 to-purple-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-300 font-bold text-xs shadow-sm">
              <Crown className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>SUPER ADMIN (GỐC)</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 font-bold text-xs">
              <ShieldCheck className="size-4 shrink-0" />
              <span>QUẢN TRỊ VIÊN (ADMIN)</span>
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="rounded-xl h-9"
          >
            <RefreshCw className={`size-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Làm mới
          </Button>
        </div>
      </div>

      {/* TABS NAVIGATION */}
      <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="space-y-6">
        <div className="overflow-x-auto pb-1">
          <TabsList className="bg-muted/60 p-1 rounded-xl h-auto gap-1">
            <TabsTrigger value="dashboard" className="rounded-lg text-xs py-2 px-3 font-semibold">
              <BarChart3 className="size-3.5 mr-1.5" /> Tổng quan
            </TabsTrigger>

            {/* ONLY VISIBLE TO SUPER ADMIN */}
            {isSuperAdmin && (
              <TabsTrigger
                value="admins"
                className="rounded-lg text-xs py-2 px-3 font-semibold data-[state=active]:bg-gradient-to-r data-[state=active]:from-amber-600 data-[state=active]:to-purple-600 data-[state=active]:text-white"
              >
                <Crown className="size-3.5 mr-1.5 text-amber-400" /> Quản lý Quản trị viên
              </TabsTrigger>
            )}

            <TabsTrigger value="teachers" className="rounded-lg text-xs py-2 px-3 font-semibold">
              <Users className="size-3.5 mr-1.5" /> Giáo viên ({teachers.length})
            </TabsTrigger>

            <TabsTrigger value="students" className="rounded-lg text-xs py-2 px-3 font-semibold">
              <GraduationCap className="size-3.5 mr-1.5" /> Học sinh ({studentList.length})
            </TabsTrigger>

            <TabsTrigger value="schools" className="rounded-lg text-xs py-2 px-3 font-semibold">
              <School className="size-3.5 mr-1.5" /> Trường học ({allSchools.length})
            </TabsTrigger>

            <TabsTrigger value="subjects" className="rounded-lg text-xs py-2 px-3 font-semibold">
              <BookOpen className="size-3.5 mr-1.5" /> Môn học ({allSubjects.length})
            </TabsTrigger>

            <TabsTrigger value="exams" className="rounded-lg text-xs py-2 px-3 font-semibold">
              <FileText className="size-3.5 mr-1.5" /> Đề thi ({exams.length})
            </TabsTrigger>

            <TabsTrigger value="results" className="rounded-lg text-xs py-2 px-3 font-semibold">
              <Award className="size-3.5 mr-1.5" /> Kết quả & Báo cáo ({submissions.length})
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ============================================================ */}
        {/* TAB 1: TỔNG QUAN (DASHBOARD) */}
        {/* ============================================================ */}
        <TabsContent value="dashboard" className="space-y-6">
          {/* Quick Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <Card className="p-3.5 flex flex-col items-center justify-center text-center border-l-4 border-l-primary shadow-xs">
              <Users className="size-4 text-primary mb-1" />
              <div className="text-xl font-black">{stats.totalTeachers}</div>
              <div className="text-[11px] text-muted-foreground">Giáo viên</div>
            </Card>

            <Card className="p-3.5 flex flex-col items-center justify-center text-center border-l-4 border-l-emerald-500 shadow-xs">
              <GraduationCap className="size-4 text-emerald-500 mb-1" />
              <div className="text-xl font-black">{stats.totalStudents}</div>
              <div className="text-[11px] text-muted-foreground">Học sinh</div>
            </Card>

            <Card className="p-3.5 flex flex-col items-center justify-center text-center border-l-4 border-l-blue-500 shadow-xs">
              <FileText className="size-4 text-blue-500 mb-1" />
              <div className="text-xl font-black">{stats.totalExams}</div>
              <div className="text-[11px] text-muted-foreground">Đề thi</div>
            </Card>

            <Card className="p-3.5 flex flex-col items-center justify-center text-center border-l-4 border-l-amber-500 shadow-xs">
              <BarChart3 className="size-4 text-amber-500 mb-1" />
              <div className="text-xl font-black">{stats.totalSubs}</div>
              <div className="text-[11px] text-muted-foreground">Bài nộp</div>
            </Card>

            <Card className="p-3.5 flex flex-col items-center justify-center text-center border-l-4 border-l-purple-500 shadow-xs">
              <School className="size-4 text-purple-500 mb-1" />
              <div className="text-xl font-black">{stats.totalSchools}</div>
              <div className="text-[11px] text-muted-foreground">Trường học</div>
            </Card>

            <Card className="p-3.5 flex flex-col items-center justify-center text-center border-l-4 border-l-cyan-500 shadow-xs">
              <BookOpen className="size-4 text-cyan-500 mb-1" />
              <div className="text-xl font-black">{stats.totalSubjects}</div>
              <div className="text-[11px] text-muted-foreground">Môn học</div>
            </Card>

            <Card className="p-3.5 flex flex-col items-center justify-center text-center border-l-4 border-l-rose-500 shadow-xs">
              <Award className="size-4 text-rose-500 mb-1" />
              <div className="text-xl font-black">{stats.avgScore}/10</div>
              <div className="text-[11px] text-muted-foreground">Điểm TB</div>
            </Card>
          </div>

          {/* Quick Sections Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Quick Teachers card */}
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-base flex items-center gap-2">
                  <Users className="size-4 text-primary" /> Giáo viên gần đây
                </h3>
                <Button variant="ghost" size="sm" onClick={() => setActiveTab("teachers")} className="text-xs">
                  Xem tất cả ({teachers.length})
                </Button>
              </div>
              <div className="divide-y text-sm">
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
                  <FileText className="size-4 text-primary" /> Đề thi mới nhất
                </h3>
                <Button variant="ghost" size="sm" onClick={() => setActiveTab("exams")} className="text-xs">
                  Xem tất cả ({exams.length})
                </Button>
              </div>
              <div className="divide-y text-sm">
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

        {/* ============================================================ */}
        {/* TAB 2: QUẢN LÝ QUẢN TRỊ VIÊN (SUPER ADMIN ONLY) */}
        {/* ============================================================ */}
        {isSuperAdmin && (
          <TabsContent value="admins" className="space-y-4">
            <Card className="p-4 md:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pb-2 border-b">
                <div>
                  <h2 className="text-lg font-bold flex items-center gap-2">
                    <Crown className="size-5 text-amber-500" /> Danh sách Quản trị viên Hệ thống
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Super Admin gốc có quyền tạo, quản lý và phân quyền cho các tài khoản Quản trị viên (Admin).
                  </p>
                </div>
                <Button
                  onClick={() => setAddAdminOpen(true)}
                  className="w-full sm:w-auto bg-gradient-to-r from-amber-600 to-primary text-white rounded-xl shadow-xs"
                >
                  <UserPlus className="size-4 mr-2" /> + Tạo Admin mới
                </Button>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="relative w-full sm:w-80">
                  <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Tìm admin theo tên, tài khoản, email..."
                    value={adminQuery}
                    onChange={(e) => setAdminQuery(e.target.value)}
                    className="pl-9 rounded-xl"
                  />
                </div>
                <div className="text-xs text-muted-foreground">
                  Tổng số: <span className="font-bold text-foreground">{filteredAdmins.length}</span> Quản trị viên
                </div>
              </div>

              <div className="border rounded-xl overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead>Quản trị viên</TableHead>
                      <TableHead>Tên đăng nhập</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead className="text-center">Vai trò</TableHead>
                      <TableHead className="text-center">Trạng thái</TableHead>
                      <TableHead className="text-right">Hành động</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAdmins.map((adm) => {
                      const isRoot = adm.role === "super_admin" || adm.id === ROOT_SUPER_ADMIN_ID;
                      return (
                        <TableRow key={adm.id} className={isRoot ? "bg-amber-500/5 hover:bg-amber-500/10" : ""}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div
                                className={`size-9 rounded-full grid place-items-center font-bold text-sm shrink-0 ${
                                  isRoot
                                    ? "bg-gradient-to-br from-amber-500 to-rose-600 text-white shadow-xs"
                                    : "bg-primary/10 text-primary"
                                }`}
                              >
                                {isRoot ? <Crown className="size-4" /> : adm.name[0]?.toUpperCase() || "A"}
                              </div>
                              <div>
                                <div className="font-bold text-sm flex items-center gap-1.5">
                                  {adm.name}
                                  {isRoot && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 font-black uppercase">
                                      Gốc
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground font-mono">ID: {adm.id}</div>
                              </div>
                            </div>
                          </TableCell>

                          <TableCell className="font-mono text-xs font-semibold">@{adm.username}</TableCell>
                          <TableCell className="text-xs">{adm.email}</TableCell>

                          <TableCell className="text-center">
                            {isRoot ? (
                              <Badge className="bg-gradient-to-r from-amber-500 to-rose-600 text-white font-bold text-[10px]">
                                SUPER ADMIN
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="font-semibold text-[10px]">
                                ADMIN
                              </Badge>
                            )}
                          </TableCell>

                          <TableCell className="text-center">
                            <Badge
                              variant={adm.status === "active" ? "default" : "destructive"}
                              className="text-[10px]"
                            >
                              {adm.status === "active" ? "Hoạt động" : "Đã khóa"}
                            </Badge>
                          </TableCell>

                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {isRoot ? (
                                <Badge variant="outline" className="text-[11px] text-amber-600 border-amber-500/30">
                                  <ShieldCheck className="size-3 mr-1" /> Tài khoản gốc bảo vệ
                                </Badge>
                              ) : (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 px-2 text-xs"
                                    onClick={() => handleToggleAdminStatus(adm)}
                                    title={adm.status === "active" ? "Khóa tài khoản" : "Mở khóa"}
                                  >
                                    {adm.status === "active" ? (
                                      <Lock className="size-3.5 text-amber-600" />
                                    ) : (
                                      <Unlock className="size-3.5 text-emerald-600" />
                                    )}
                                  </Button>

                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 px-2 text-xs"
                                    onClick={() => {
                                      setResetPwdAdmin(adm);
                                      setNewAdminPwd("");
                                    }}
                                    title="Đặt lại mật khẩu"
                                  >
                                    <KeyRound className="size-3.5 text-purple-600" />
                                  </Button>

                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 px-2 text-xs text-rose-600 hover:bg-rose-50"
                                    onClick={() => setDeleteAdminTarget(adm)}
                                    title="Xóa tài khoản"
                                  >
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </TabsContent>
        )}

        {/* ============================================================ */}
        {/* TAB 3: QUẢN LÝ GIÁO VIÊN */}
        {/* ============================================================ */}
        <TabsContent value="teachers" className="space-y-4">
          <Card className="p-4 md:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pb-2 border-b">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Users className="size-5 text-primary" /> Quản lý Danh sách Giáo viên
                </h2>
                <p className="text-xs text-muted-foreground">
                  Toàn bộ tài khoản giáo viên tham gia tạo đề, chấm thi và quản lý học sinh trên hệ thống.
                </p>
              </div>
              <Button
                onClick={() => setAddTeacherOpen(true)}
                className="w-full sm:w-auto bg-gradient-primary rounded-xl"
              >
                <UserPlus className="size-4 mr-2" /> Thêm giáo viên mới
              </Button>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative w-full sm:w-80">
                <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Tìm giáo viên (tên, tài khoản, trường)..."
                  value={teacherQuery}
                  onChange={(e) => setTeacherQuery(e.target.value)}
                  className="pl-9 rounded-xl"
                />
              </div>
              <div className="text-xs text-muted-foreground">
                Tổng số: <span className="font-bold text-foreground">{filteredTeachers.length}</span> giáo viên
              </div>
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
                              <div className="font-bold text-sm">{t.name}</div>
                              <div className="text-xs text-muted-foreground font-mono">ID: {t.id}</div>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell className="font-mono text-xs font-semibold">@{t.username}</TableCell>

                        <TableCell>
                          <div className="text-xs font-medium text-primary">{t.subject}</div>
                          <div className="text-xs text-muted-foreground">{t.school}</div>
                        </TableCell>

                        <TableCell>
                          <div className="text-xs">{t.email || "Chưa có"}</div>
                          <div className="text-xs text-muted-foreground">{t.phone || "Chưa có"}</div>
                        </TableCell>

                        <TableCell className="text-center">
                          <Badge
                            variant={t.status === "active" ? "default" : "destructive"}
                            className="text-[10px]"
                          >
                            {t.status === "active" ? "Hoạt động" : "Đã khóa"}
                          </Badge>
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-2 text-xs"
                              onClick={() => setEditTeacher(t)}
                              title="Chỉnh sửa thông tin"
                            >
                              <Edit className="size-3.5 text-blue-600" />
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-2 text-xs"
                              onClick={() => handleToggleTeacherStatus(t)}
                              title={t.status === "active" ? "Khóa tài khoản" : "Mở khóa"}
                            >
                              {t.status === "active" ? (
                                <Lock className="size-3.5 text-amber-600" />
                              ) : (
                                <Unlock className="size-3.5 text-emerald-600" />
                              )}
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-2 text-xs"
                              onClick={() => {
                                setResetPwdTeacher(t);
                                setNewPasswordVal("");
                              }}
                              title="Đặt lại mật khẩu"
                            >
                              <KeyRound className="size-3.5 text-purple-600" />
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-2 text-xs text-rose-600 hover:bg-rose-50"
                              onClick={() => handleDeleteTeacher(t.id, t.name)}
                              title="Xóa giáo viên"
                            >
                              <Trash2 className="size-3.5" />
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

        {/* ============================================================ */}
        {/* TAB 4: QUẢN LÝ HỌC SINH */}
        {/* ============================================================ */}
        <TabsContent value="students" className="space-y-4">
          <Card className="p-4 md:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pb-2 border-b">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <GraduationCap className="size-5 text-emerald-600" /> Quản lý Học sinh & Tiến độ làm bài
                </h2>
                <p className="text-xs text-muted-foreground">
                  Tổng hợp danh sách học sinh tham gia làm bài, số lượt nộp và điểm trung bình tích lũy.
                </p>
              </div>
              <Button asChild variant="outline" className="rounded-xl">
                <Link to="/students">
                  <Users className="size-4 mr-2" /> Xem Sổ danh sách học sinh
                </Link>
              </Button>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative w-full sm:w-72">
                  <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Tìm học sinh theo tên..."
                    value={studentQuery}
                    onChange={(e) => setStudentQuery(e.target.value)}
                    className="pl-9 rounded-xl"
                  />
                </div>

                <Select value={studentClassFilter} onValueChange={setStudentClassFilter}>
                  <SelectTrigger className="w-36 rounded-xl">
                    <SelectValue placeholder="Lọc theo lớp" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả các lớp</SelectItem>
                    {uniqueClasses.map((c) => (
                      <SelectItem key={c} value={c}>
                        Lớp {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="text-xs text-muted-foreground">
                Hiển thị: <span className="font-bold text-foreground">{filteredStudents.length}</span> học sinh
              </div>
            </div>

            <div className="border rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Học sinh</TableHead>
                    <TableHead>Lớp</TableHead>
                    <TableHead className="text-center">Số bài đã thi</TableHead>
                    <TableHead className="text-center">Điểm trung bình</TableHead>
                    <TableHead>Lần làm bài gần nhất</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStudents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        Chưa có dữ liệu học sinh nào.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredStudents.map((st, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <div className="size-8 rounded-full bg-emerald-500/10 text-emerald-600 font-bold text-xs grid place-items-center">
                              {st.name[0]?.toUpperCase() || "H"}
                            </div>
                            <span className="font-semibold text-sm">{st.name}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-bold">
                            {st.klass}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center font-bold">{st.attempts}</TableCell>
                        <TableCell className="text-center font-bold">
                          <span
                            className={
                              st.avgScore >= 8
                                ? "text-emerald-600 font-black"
                                : st.avgScore >= 5
                                ? "text-blue-600 font-semibold"
                                : "text-rose-600 font-semibold"
                            }
                          >
                            {st.avgScore}/10
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(st.lastActive).toLocaleString("vi-VN")}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 5: QUẢN LÝ TRƯỜNG HỌC */}
        {/* ============================================================ */}
        <TabsContent value="schools" className="space-y-4">
          <Card className="p-4 md:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pb-2 border-b">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <School className="size-5 text-purple-600" /> Danh mục Trường học
                </h2>
                <p className="text-xs text-muted-foreground">
                  Quản lý danh sách các trường THPT / THCS trong hệ thống tạo đề thi.
                </p>
              </div>
              <Button onClick={() => setAddSchoolOpen(true)} className="rounded-xl bg-purple-600 hover:bg-purple-700 text-white">
                <Plus className="size-4 mr-1.5" /> Thêm trường học
              </Button>
            </div>

            <div className="relative w-full sm:w-80">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Tìm tên trường học..."
                value={schoolQuery}
                onChange={(e) => setSchoolQuery(e.target.value)}
                className="pl-9 rounded-xl"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {filteredSchools.map((sch) => {
                const countTeachers = teachers.filter((t) => t.school === sch).length;
                const countExams = exams.filter((e) => e.school_name === sch).length;
                return (
                  <Card key={sch} className="p-4 flex flex-col justify-between border hover:border-purple-500/50 transition-all">
                    <div>
                      <div className="size-8 rounded-lg bg-purple-500/10 text-purple-600 grid place-items-center mb-2">
                        <Building className="size-4" />
                      </div>
                      <h4 className="font-bold text-sm leading-snug line-clamp-2">{sch}</h4>
                    </div>
                    <div className="mt-3 pt-3 border-t text-xs text-muted-foreground flex items-center justify-between">
                      <span>{countTeachers} Giáo viên</span>
                      <span>{countExams} Đề thi</span>
                    </div>
                  </Card>
                );
              })}
            </div>
          </Card>
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 6: QUẢN LÝ MÔN HỌC */}
        {/* ============================================================ */}
        <TabsContent value="subjects" className="space-y-4">
          <Card className="p-4 md:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pb-2 border-b">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <BookOpen className="size-5 text-cyan-600" /> Danh mục Môn học
                </h2>
                <p className="text-xs text-muted-foreground">
                  Quản lý danh sách các môn thi giảng dạy trên hệ thống.
                </p>
              </div>
              <Button onClick={() => setAddSubjectOpen(true)} className="rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white">
                <Plus className="size-4 mr-1.5" /> Thêm môn học
              </Button>
            </div>

            <div className="relative w-full sm:w-80">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Tìm tên môn học..."
                value={subjectQuery}
                onChange={(e) => setSubjectQuery(e.target.value)}
                className="pl-9 rounded-xl"
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {filteredSubjects.map((sub) => {
                const countExams = exams.filter((e) => e.subject_name === sub).length;
                const countTeachers = teachers.filter((t) => t.subject === sub).length;
                return (
                  <Card key={sub} className="p-4 flex flex-col justify-between border hover:border-cyan-500/50 transition-all">
                    <div>
                      <div className="size-8 rounded-lg bg-cyan-500/10 text-cyan-600 grid place-items-center mb-2">
                        <BookOpen className="size-4" />
                      </div>
                      <h4 className="font-bold text-sm truncate">{sub}</h4>
                    </div>
                    <div className="mt-3 pt-3 border-t text-xs text-muted-foreground flex items-center justify-between">
                      <span>{countTeachers} GV</span>
                      <span>{countExams} Đề thi</span>
                    </div>
                  </Card>
                );
              })}
            </div>
          </Card>
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 7: QUẢN LÝ ĐỀ THI */}
        {/* ============================================================ */}
        <TabsContent value="exams" className="space-y-4">
          <Card className="p-4 md:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pb-2 border-b">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <FileText className="size-5 text-blue-600" /> Quản lý Đề thi Hệ thống
                </h2>
                <p className="text-xs text-muted-foreground">
                  Theo dõi trạng thái đóng/mở, bài nộp và quản trị toàn bộ đề thi trực tuyến.
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative w-full sm:w-72">
                  <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Tìm tên đề thi, giáo viên..."
                    value={examQuery}
                    onChange={(e) => setExamQuery(e.target.value)}
                    className="pl-9 rounded-xl"
                  />
                </div>

                <Select value={selectedTeacherFilter} onValueChange={setSelectedTeacherFilter}>
                  <SelectTrigger className="w-48 rounded-xl">
                    <SelectValue placeholder="Lọc theo giáo viên" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả giáo viên</SelectItem>
                    {teachers.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="text-xs text-muted-foreground">
                Tổng số: <span className="font-bold text-foreground">{filteredExams.length}</span> đề thi
              </div>
            </div>

            <div className="border rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Tên đề thi</TableHead>
                    <TableHead>Giáo viên tạo</TableHead>
                    <TableHead>Môn học & Trường</TableHead>
                    <TableHead className="text-center">Số bài nộp</TableHead>
                    <TableHead className="text-center">Trạng thái</TableHead>
                    <TableHead className="text-right">Hành động</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredExams.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        Không tìm thấy đề thi nào.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredExams.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell>
                          <div className="font-bold text-sm text-foreground">{e.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {e.duration_minutes} phút • {Array.isArray(e.questions) ? e.questions.length : 0} câu hỏi
                          </div>
                        </TableCell>

                        <TableCell>
                          <div className="font-semibold text-xs">{getExamTeacherName(e)}</div>
                        </TableCell>

                        <TableCell>
                          <div className="text-xs text-primary font-medium">{e.subject_name || "Chưa chọn môn"}</div>
                          <div className="text-xs text-muted-foreground">{e.school_name || "Chưa chọn trường"}</div>
                        </TableCell>

                        <TableCell className="text-center font-bold text-sm">
                          {examSubCounts[e.id] || 0}
                        </TableCell>

                        <TableCell className="text-center">
                          <Badge variant={e.manual_closed ? "destructive" : "default"} className="text-[10px]">
                            {e.manual_closed ? "Đã khóa" : "Đang mở"}
                          </Badge>
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button asChild size="sm" variant="outline" className="h-8 px-2 text-xs">
                              <Link to={`/exam/${e.id}/results`}>
                                <BarChart3 className="size-3.5 mr-1" /> Kết quả
                              </Link>
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-2 text-xs"
                              onClick={() => handleToggleCloseExam(e)}
                              title={e.manual_closed ? "Mở lại đề thi" : "Khóa đề thi"}
                            >
                              {e.manual_closed ? <Unlock className="size-3.5 text-emerald-600" /> : <Lock className="size-3.5 text-amber-600" />}
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-2 text-xs text-rose-600 hover:bg-rose-50"
                              onClick={() => handleDeleteExam(e.id, e.title)}
                              title="Xóa đề thi"
                            >
                              <Trash2 className="size-3.5" />
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

        {/* ============================================================ */}
        {/* TAB 8: KẾT QUẢ & BÁO CÁO (RESULTS) */}
        {/* ============================================================ */}
        <TabsContent value="results" className="space-y-4">
          <Card className="p-4 md:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pb-2 border-b">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Award className="size-5 text-amber-600" /> Dữ liệu & Kết quả bài làm trên hệ thống
                </h2>
                <p className="text-xs text-muted-foreground">
                  Xem chi tiết kết quả từng bài thi của học sinh trên toàn hệ thống.
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative w-full sm:w-72">
                  <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Tìm tên học sinh hoặc lớp..."
                    value={resultQuery}
                    onChange={(e) => setResultQuery(e.target.value)}
                    className="pl-9 rounded-xl"
                  />
                </div>

                <Select value={resultExamFilter} onValueChange={setResultExamFilter}>
                  <SelectTrigger className="w-56 rounded-xl">
                    <SelectValue placeholder="Lọc theo bài thi" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả đề thi</SelectItem>
                    {exams.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="text-xs text-muted-foreground">
                Hiển thị: <span className="font-bold text-foreground">{filteredResults.length}</span> bài nộp
              </div>
            </div>

            <div className="border rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Học sinh</TableHead>
                    <TableHead>Lớp</TableHead>
                    <TableHead>Đề thi</TableHead>
                    <TableHead className="text-center">Điểm số</TableHead>
                    <TableHead className="text-center">Đúng/Sai</TableHead>
                    <TableHead>Thời gian nộp</TableHead>
                    <TableHead className="text-right">Hành động</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredResults.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        Chưa có bài thi nào được nộp.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredResults.slice(0, 100).map((s) => {
                      const ex = exams.find((e) => e.id === s.exam_id);
                      return (
                        <TableRow key={s.id}>
                          <TableCell className="font-semibold">{s.student_name || "Ẩn danh"}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{s.student_class || "—"}</Badge>
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate text-xs">
                            {ex?.title || s.exam_id}
                          </TableCell>
                          <TableCell className="text-center font-bold">
                            <span
                              className={
                                Number(s.score) >= 8
                                  ? "text-emerald-600 font-black"
                                  : Number(s.score) >= 5
                                  ? "text-blue-600 font-semibold"
                                  : "text-rose-600 font-semibold"
                              }
                            >
                              {s.score}/{s.max_score || 10}
                            </span>
                          </TableCell>
                          <TableCell className="text-center text-xs">
                            <span className="text-emerald-600 font-bold">{s.correct_count ?? "—"}</span> /{" "}
                            <span className="text-rose-600 font-bold">{s.wrong_count ?? "—"}</span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {s.submitted_at ? new Date(s.submitted_at).toLocaleString("vi-VN") : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs"
                              onClick={() => setSelectedSubDetail(s)}
                            >
                              <Eye className="size-3.5 mr-1" /> Chi tiết
                            </Button>
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

      {/* ============================================================ */}
      {/* DIALOG: TẠO ADMIN MỚI (CHỈ SUPER ADMIN) */}
      {/* ============================================================ */}
      <Dialog open={addAdminOpen} onOpenChange={setAddAdminOpen}>
        <DialogContent className="max-w-md sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Crown className="size-5 text-amber-500" /> Tạo tài khoản Quản trị viên (Admin)
            </DialogTitle>
            <DialogDescription>
              Tài khoản được tạo sẽ có quyền quản trị (Admin). Hệ thống chỉ cho phép tạo tài khoản vai trò <b>Admin</b>, không tạo thêm Super Admin gốc.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateAdmin} className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="af-name">Họ và tên Quản trị viên *</Label>
              <Input
                id="af-name"
                required
                placeholder="Nguyễn Văn Quản Trị"
                value={afName}
                onChange={(e) => setAfName(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="af-user">Tên đăng nhập *</Label>
                <Input
                  id="af-user"
                  required
                  placeholder="admin_phu"
                  value={afUsername}
                  onChange={(e) => setAfUsername(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="af-email">Email đăng nhập *</Label>
                <Input
                  id="af-email"
                  type="email"
                  required
                  placeholder="admin_phu@school.edu.vn"
                  value={afEmail}
                  onChange={(e) => setAfEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="af-pass">Mật khẩu ban đầu *</Label>
                <Input
                  id="af-pass"
                  type="password"
                  required
                  minLength={6}
                  placeholder="Tối thiểu 6 ký tự"
                  value={afPassword}
                  onChange={(e) => setAfPassword(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="af-status">Trạng thái tài khoản</Label>
                <Select value={afStatus} onValueChange={(v: any) => setAfStatus(v)}>
                  <SelectTrigger id="af-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Hoạt động</SelectItem>
                    <SelectItem value="locked">Khóa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="p-3 bg-amber-500/10 rounded-xl text-xs text-amber-900 dark:text-amber-200 border border-amber-500/20">
              <span className="font-bold">Quyền hạn của tài khoản:</span> Quản trị viên này có quyền quản lý giáo viên, học sinh, đề thi, trường học và môn học; nhưng <b>không có quyền</b> quản lý danh sách Quản trị viên.
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setAddAdminOpen(false)}>
                Hủy
              </Button>
              <Button type="submit" className="bg-gradient-to-r from-amber-600 to-primary text-white font-bold">
                Xác nhận tạo Admin
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG: ĐẶT LẠI MẬT KHẨU ADMIN */}
      <Dialog open={!!resetPwdAdmin} onOpenChange={(val) => !val && setResetPwdAdmin(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-5 text-purple-600" /> Đặt lại mật khẩu Quản trị viên
            </DialogTitle>
            <DialogDescription>
              Tài khoản: <b>{resetPwdAdmin?.name}</b> (@{resetPwdAdmin?.username})
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleResetAdminPassword} className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="admin-new-pwd-val">Mật khẩu mới *</Label>
              <Input
                id="admin-new-pwd-val"
                type="password"
                required
                minLength={6}
                placeholder="Nhập mật khẩu mới (tối thiểu 6 ký tự)"
                value={newAdminPwd}
                onChange={(e) => setNewAdminPwd(e.target.value)}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setResetPwdAdmin(null)}>
                Hủy
              </Button>
              <Button type="submit" className="bg-gradient-primary">
                Cập nhật mật khẩu
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG: XÁC NHẬN XÓA ADMIN */}
      <Dialog open={!!deleteAdminTarget} onOpenChange={(val) => !val && setDeleteAdminTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600">
              <AlertTriangle className="size-5" /> Xác nhận xóa Quản trị viên
            </DialogTitle>
            <DialogDescription>
              Bạn có chắc chắn muốn xóa tài khoản Quản trị viên <b>{deleteAdminTarget?.name}</b> (@{deleteAdminTarget?.username}) khỏi hệ thống? Hành động này không thể hoàn tác.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => setDeleteAdminTarget(null)}>
              Hủy
            </Button>
            <Button type="button" variant="destructive" onClick={handleDeleteAdmin}>
              Xác nhận xóa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG: THÊM GIÁO VIÊN */}
      <Dialog open={addTeacherOpen} onOpenChange={setAddTeacherOpen}>
        <DialogContent className="max-w-md sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="size-5 text-primary" /> Thêm Giáo viên mới
            </DialogTitle>
            <DialogDescription>
              Tạo tài khoản giáo viên trực tiếp vào hệ thống cơ sở dữ liệu nội bộ.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateTeacher} className="space-y-3.5 py-2">
            <div className="space-y-1">
              <Label htmlFor="tf-name">Họ và tên giáo viên *</Label>
              <Input
                id="tf-name"
                required
                placeholder="Thầy/Cô Nguyễn Văn A"
                value={tfName}
                onChange={(e) => setTfName(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="tf-username">Tên đăng nhập *</Label>
                <Input
                  id="tf-username"
                  required
                  placeholder="giaovien123"
                  value={tfUsername}
                  onChange={(e) => setTfUsername(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tf-password">Mật khẩu ban đầu *</Label>
                <Input
                  id="tf-password"
                  type="password"
                  required
                  minLength={6}
                  placeholder="Ít nhất 6 ký tự"
                  value={tfPassword}
                  onChange={(e) => setTfPassword(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="tf-email">Email</Label>
                <Input
                  id="tf-email"
                  type="email"
                  placeholder="gv@school.edu.vn"
                  value={tfEmail}
                  onChange={(e) => setTfEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tf-phone">Số điện thoại</Label>
                <Input
                  id="tf-phone"
                  placeholder="0912..."
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
                    {allSubjects.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setAddTeacherOpen(false)}>
                Hủy
              </Button>
              <Button type="submit" className="bg-gradient-primary">
                Tạo tài khoản giáo viên
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG: CHỈNH SỬA GIÁO VIÊN */}
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
                      {allSubjects.map((s) => (
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

      {/* DIALOG: ĐẶT LẠI MẬT KHẨU GIÁO VIÊN */}
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

      {/* DIALOG: THÊM TRƯỜNG HỌC */}
      <Dialog open={addSchoolOpen} onOpenChange={setAddSchoolOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <School className="size-5 text-purple-600" /> Thêm Trường học mới
            </DialogTitle>
            <DialogDescription>
              Nhập tên trường học để bổ sung vào danh mục trường trong toàn hệ thống.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddSchool} className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="school-name">Tên trường học *</Label>
              <Input
                id="school-name"
                required
                placeholder="VD: THPT Phan Châu Trinh"
                value={newSchoolName}
                onChange={(e) => setNewSchoolName(e.target.value)}
              />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setAddSchoolOpen(false)}>
                Hủy
              </Button>
              <Button type="submit" className="bg-purple-600 hover:bg-purple-700 text-white">
                Thêm trường
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG: THÊM MÔN HỌC */}
      <Dialog open={addSubjectOpen} onOpenChange={setAddSubjectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="size-5 text-cyan-600" /> Thêm Môn học mới
            </DialogTitle>
            <DialogDescription>
              Nhập tên môn học mới để giáo viên có thể chọn khi tạo đề thi.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddSubject} className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="sub-name">Tên môn học *</Label>
              <Input
                id="sub-name"
                required
                placeholder="VD: Khoa học tự nhiên"
                value={newSubjectName}
                onChange={(e) => setNewSubjectName(e.target.value)}
              />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setAddSubjectOpen(false)}>
                Hủy
              </Button>
              <Button type="submit" className="bg-cyan-600 hover:bg-cyan-700 text-white">
                Thêm môn
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG: CHI TIẾT BÀI NỘP */}
      <Dialog open={!!selectedSubDetail} onOpenChange={(val) => !val && setSelectedSubDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Award className="size-5 text-amber-500" /> Chi tiết bài nộp học sinh
            </DialogTitle>
            <DialogDescription>
              Thông tin chi tiết kết quả làm bài của học sinh
            </DialogDescription>
          </DialogHeader>
          {selectedSubDetail && (
            <div className="space-y-3 py-2 text-sm">
              <div className="grid grid-cols-2 gap-2 p-3 bg-muted/40 rounded-xl">
                <div>
                  <span className="text-muted-foreground text-xs">Học sinh:</span>
                  <div className="font-bold">{selectedSubDetail.student_name || "Ẩn danh"}</div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Lớp:</span>
                  <div className="font-bold">{selectedSubDetail.student_class || "—"}</div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Điểm số:</span>
                  <div className="font-black text-primary text-base">
                    {selectedSubDetail.score}/{selectedSubDetail.max_score || 10}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Thời gian làm:</span>
                  <div className="font-semibold">
                    {Math.round((selectedSubDetail.duration_seconds || 0) / 60)} phút
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Số câu đúng / sai:</span>
                  <div className="font-semibold text-xs">
                    <span className="text-emerald-600 font-bold">{selectedSubDetail.correct_count ?? 0} đúng</span>,{" "}
                    <span className="text-rose-600 font-bold">{selectedSubDetail.wrong_count ?? 0} sai</span>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Vi phạm tab:</span>
                  <div className="font-semibold text-xs text-rose-500">
                    {selectedSubDetail.violation_count || 0} lần
                  </div>
                </div>
              </div>
              <DialogFooter className="pt-2">
                <Button variant="outline" onClick={() => setSelectedSubDetail(null)}>
                  Đóng
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
