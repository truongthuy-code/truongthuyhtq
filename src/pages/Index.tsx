import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileText, Users, BarChart3, Upload, Copy, Download, Share2, Trash2, FileDown,
  Settings, Plus, GraduationCap, ClipboardCheck, ShieldAlert, Activity, Star, Search,
  Lock, Unlock, CalendarClock, Trophy, Music, Bot, Folder, FolderPlus, FolderOpen,
  MoreVertical, Edit2, ArrowLeft, ArrowUpDown, CheckSquare, Square, ChevronRight, X,
  Layers, Check,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { publishExamClosed } from "@/lib/studentStorage";
import TeamLeaderboard from "./TeamLeaderboard";
import { syncExamAssignmentCodes, getExamPrimaryCode, getExamShareUrl } from "@/lib/examAssignments";
import { isUuid } from "@/lib/teacherStorage";
import {
  ExamFolder,
  getFolders,
  getExamFolderMapping,
  getFolderIdForExam,
  getFolderColorMeta,
} from "@/lib/folderStorage";
import {
  CreateOrEditFolderModal,
  DeleteFolderModal,
  MoveExamModal,
  renderFolderIcon,
} from "@/components/FolderModals";

type Stats = {
  exams: number; students: number; attempts: number; avgScore: number;
  violations: number; openExams: number;
};

export default function Index() {
  const { user, profile, isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeFolderId = searchParams.get("folder");

  const [exams, setExams] = useState<any[]>([]);
  const [folders, setFolders] = useState<ExamFolder[]>([]);
  const [folderMappings, setFolderMappings] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>({ exams: 0, students: 0, attempts: 0, avgScore: 0, violations: 0, openExams: 0 });

  // Search & Sort states
  const [query, setQuery] = useState("");
  const [folderQuery, setFolderQuery] = useState("");
  const [folderSort, setFolderSort] = useState<"name-asc" | "name-desc" | "created-desc" | "created-asc">("name-asc");
  const [examSort, setExamSort] = useState<"created-desc" | "created-asc" | "title-asc">("created-desc");

  // Selection state for bulk operations
  const [selectedExamIds, setSelectedExamIds] = useState<string[]>([]);

  // Modals state
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<ExamFolder | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<{ folder: ExamFolder; count: number } | null>(null);
  const [moveExamTarget, setMoveExamTarget] = useState<{ examIds: string[]; titles: string[]; currentFolderId: string | null } | null>(null);

  // Leaderboard modal
  const [viewingLeaderboardExamId, setViewingLeaderboardExamId] = useState<string | null>(null);

  // Load Folders & Exam Folder Mappings
  const reloadFolders = async () => {
    try {
      const fList = await getFolders(user?.id, isAdmin);
      setFolders(fList);
      setFolderMappings(getExamFolderMapping());
    } catch (err) {
      console.warn("Error loading folders:", err);
    }
  };

  useEffect(() => {
    reloadFolders();
  }, [user, isAdmin]);

  // Load Exams & Stats
  const loadExams = async () => {
    let q = supabase.from("exams")
      .select("id,title,duration_minutes,created_at,questions,original_file_url,original_file_name,original_file_path,created_by,open_at,close_at,manual_closed,auto_submit_on_close,display_mode,team_config,folder_id")
      .order("created_at", { ascending: false }).limit(200);

    // Teacher data isolation: If not admin and user exists, isolate exams to teacher
    if (!isAdmin && user) {
      if (isUuid(user.id)) {
        q = q.eq("created_by", user.id);
      }
    }

    let loadedExams: any[] = [];
    const { data: ex, error: exErr } = await q;

    if (exErr && (exErr.code === "42703" || exErr.message?.includes("folder_id"))) {
      // Fallback if folder_id column not yet migrated in remote Supabase
      const { data: fallbackEx } = await supabase.from("exams")
        .select("id,title,duration_minutes,created_at,questions,original_file_url,original_file_name,original_file_path,created_by,open_at,close_at,manual_closed,auto_submit_on_close,display_mode,team_config")
        .order("created_at", { ascending: false }).limit(200);
      loadedExams = fallbackEx || [];
    } else {
      loadedExams = ex || [];
    }

    setExams(loadedExams);
    loadedExams.forEach((e: any) => syncExamAssignmentCodes(e).catch(() => {}));

    const examIds = loadedExams.map((e: any) => e.id);

    let subQ = supabase.from("submissions").select("exam_id,student_name,student_class,score,violation_count");
    if (!isAdmin && user) {
      if (examIds.length > 0) {
        subQ = subQ.in("exam_id", examIds);
      } else {
        setStats({ exams: 0, students: 0, attempts: 0, avgScore: 0, violations: 0, openExams: 0 });
        setLoading(false);
        return;
      }
    }

    const { data: subs } = await subQ;
    const s = subs || [];
    const uniqStudents = new Set(s.map((x: any) => `${x.student_name}__${x.student_class}`)).size;
    const avg = s.length ? s.reduce((a: number, b: any) => a + Number(b.score || 0), 0) / s.length : 0;
    const violations = s.reduce((a: number, b: any) => a + (b.violation_count || 0), 0);
    const now = Date.now();
    const openCount = loadedExams.filter((e: any) => {
      if (e.manual_closed) return false;
      if (e.open_at && new Date(e.open_at).getTime() > now) return false;
      if (e.close_at && new Date(e.close_at).getTime() < now) return false;
      return true;
    }).length;

    setStats({
      exams: loadedExams.length,
      students: uniqStudents,
      attempts: s.length,
      avgScore: Math.round(avg * 100) / 100,
      violations,
      openExams: openCount,
    });
    setLoading(false);
  };

  useEffect(() => {
    loadExams();
  }, [isAdmin, user]);

  // Derived Active Folder
  const activeFolder = useMemo(() => {
    if (!activeFolderId) return null;
    return folders.find((f) => f.id === activeFolderId) || null;
  }, [folders, activeFolderId]);

  // Folder Exam Counts calculation
  const folderExamCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    folders.forEach((f) => { counts[f.id] = 0; });
    exams.forEach((e) => {
      const fId = getFolderIdForExam(e, folderMappings);
      if (fId && counts[fId] !== undefined) {
        counts[fId] = (counts[fId] || 0) + 1;
      }
    });
    return counts;
  }, [folders, exams, folderMappings]);

  // Filtered and Sorted Folders
  const filteredFolders = useMemo(() => {
    const list = folders.filter((f) => {
      if (!folderQuery) return true;
      const q = folderQuery.toLowerCase();
      return (f.name || "").toLowerCase().includes(q) || (f.description || "").toLowerCase().includes(q);
    });

    return list.sort((a, b) => {
      if (folderSort === "name-asc") return a.name.localeCompare(b.name, "vi");
      if (folderSort === "name-desc") return b.name.localeCompare(a.name, "vi");
      if (folderSort === "created-desc") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (folderSort === "created-asc") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return 0;
    });
  }, [folders, folderQuery, folderSort]);

  // Exams belonging to the active folder
  const currentFolderExams = useMemo(() => {
    if (!activeFolderId) return [];
    return exams.filter((e) => getFolderIdForExam(e, folderMappings) === activeFolderId);
  }, [exams, activeFolderId, folderMappings]);

  // Exams that are unclassified (folder_id is null/undefined)
  const unclassifiedExams = useMemo(() => {
    return exams.filter((e) => getFolderIdForExam(e, folderMappings) === null);
  }, [exams, folderMappings]);

  // Generic Exam Filter & Sorter
  const sortAndFilterExamList = (rawList: any[]) => {
    const filtered = rawList.filter((e) => {
      if (!query) return true;
      return (e.title || "").toLowerCase().includes(query.toLowerCase());
    });

    return filtered.sort((a, b) => {
      if (examSort === "created-desc") return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      if (examSort === "created-asc") return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
      if (examSort === "title-asc") return (a.title || "").localeCompare(b.title || "", "vi");
      return 0;
    });
  };

  const displayedFolderExams = useMemo(
    () => sortAndFilterExamList(currentFolderExams),
    [currentFolderExams, query, examSort]
  );

  const displayedUnclassifiedExams = useMemo(
    () => sortAndFilterExamList(unclassifiedExams),
    [unclassifiedExams, query, examSort]
  );

  // Bulk selection helpers
  const toggleSelectExam = (id: string) => {
    setSelectedExamIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = (targetList: any[]) => {
    const targetIds = targetList.map((e) => e.id);
    const allSelected = targetIds.length > 0 && targetIds.every((id) => selectedExamIds.includes(id));
    if (allSelected) {
      setSelectedExamIds((prev) => prev.filter((id) => !targetIds.includes(id)));
    } else {
      setSelectedExamIds((prev) => Array.from(new Set([...prev, ...targetIds])));
    }
  };

  // Exam actions
  const copyLink = (id: string, code?: string) => {
    navigator.clipboard.writeText(getExamShareUrl(id, code));
    toast.success("Đã copy link bài thi");
  };

  const exportXlsx = async (exam: any) => {
    const { data: subs, error } = await supabase.from("submissions").select("*").eq("exam_id", exam.id).order("submitted_at", { ascending: false });
    if (error) { toast.error(error.message); return; }
    if (!subs || subs.length === 0) { toast.info("Chưa có bài nộp nào"); return; }
    const rows = subs.map((s, i) => ({
      STT: i + 1, "Họ tên": s.student_name, "Lớp": s.student_class,
      "Số câu đúng": s.correct_count, "Số câu sai": s.wrong_count, "Điểm": s.score,
      "Thời gian nộp": new Date(s.submitted_at).toLocaleString("vi-VN"),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Kết quả");
    XLSX.writeFile(wb, `${exam.title || "ket-qua"}.xlsx`);
    toast.success(`Đã xuất ${subs.length} bài nộp`);
  };

  const deleteExam = async (exam: any) => {
    if (!confirm(`Xóa đề "${exam.title}"? Tất cả bài nộp của đề này cũng sẽ bị xóa.`)) return;
    await supabase.from("submissions").delete().eq("exam_id", exam.id);
    const { error } = await supabase.from("exams").delete().eq("id", exam.id);
    if (error) { toast.error(error.message); return; }
    setExams((prev) => prev.filter((e) => e.id !== exam.id));
    setSelectedExamIds((prev) => prev.filter((id) => id !== exam.id));
    toast.success("Đã xóa đề");
  };

  const downloadOriginal = async (exam: any) => {
    if (exam.original_file_path) {
      const { data, error } = await supabase.storage.from("exam-files").createSignedUrl(exam.original_file_path, 300);
      if (error || !data) { toast.error("Không tạo được link tải"); return; }
      window.open(data.signedUrl, "_blank");
    } else if (exam.original_file_url) {
      window.open(exam.original_file_url, "_blank");
    }
  };

  const countQs = (q: any) => (q?.partI?.length || 0) + (q?.partII?.length || 0) + (q?.partIII?.length || 0);

  const getStatus = (e: any): "not_open" | "open" | "closed" => {
    const now = Date.now();
    if (e.manual_closed) return "closed";
    if (e.open_at && new Date(e.open_at).getTime() > now) return "not_open";
    if (e.close_at && new Date(e.close_at).getTime() < now) return "closed";
    return "open";
  };
  const fmtDt = (s: string | null | undefined) => s ? new Date(s).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }) : "";

  const setClosed = async (exam: any, closed: boolean) => {
    const updates: any = { manual_closed: closed };
    if (closed) {
      updates.allow_review = true;
    }
    const { error } = await supabase.from("exams").update(updates).eq("id", exam.id);
    if (error) { toast.error(error.message); return; }
    if (closed) {
      publishExamClosed(exam.id, exam.questions, exam.title);
    }
    setExams((prev) => prev.map((x) => x.id === exam.id ? { ...x, manual_closed: closed, allow_review: closed ? true : x.allow_review } : x));
    toast.success(closed ? "Đã đóng đề thi và tự động công bố đáp án chính thức cho học sinh" : "Đã mở lại đề thi");
  };
  const confirmClose = (exam: any) => {
    if (confirm(`Bạn có chắc chắn muốn đóng đề thi "${exam.title}"? Học sinh sẽ không thể làm bài mới, đồng thời hệ thống sẽ tự động công bố đáp án chính thức và lời giải cho học sinh.`)) {
      setClosed(exam, true);
    }
  };

  // Open folder handler
  const handleOpenFolder = (folderId: string) => {
    setSearchParams({ folder: folderId });
    setQuery("");
    setSelectedExamIds([]);
  };

  // Back to home handler
  const handleBackToHome = () => {
    searchParams.delete("folder");
    setSearchParams(searchParams);
    setQuery("");
    setSelectedExamIds([]);
  };

  // Re-fetch after moving exams
  const handleAfterMoveExams = () => {
    setFolderMappings(getExamFolderMapping());
    setSelectedExamIds([]);
    loadExams();
  };

  const statCards = [
    { label: "Tổng số đề thi", value: stats.exams, icon: FileText, tint: "from-teal-500 to-emerald-500" },
    { label: "Tổng số học sinh", value: stats.students, icon: Users, tint: "from-sky-500 to-blue-600" },
    { label: "Lượt làm bài", value: stats.attempts, icon: ClipboardCheck, tint: "from-violet-500 to-fuchsia-500" },
    { label: "Điểm trung bình", value: stats.avgScore, icon: Star, tint: "from-amber-500 to-orange-500" },
    { label: "Lượt vi phạm", value: stats.violations, icon: ShieldAlert, tint: "from-rose-500 to-red-600" },
    { label: "Đề thi đang mở", value: stats.openExams, icon: Activity, tint: "from-cyan-500 to-teal-600" },
  ];

  // Render individual Exam Card
  const renderExamCard = (e: any, idx: number, insideFolder = false) => {
    const status = getStatus(e);
    const statusInfo = status === "open"
      ? { label: "🟢 Đang mở", cls: "bg-success/10 text-success border-success/30" }
      : status === "not_open"
        ? { label: "🟡 Chưa mở", cls: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400" }
        : { label: "🔴 Đã đóng", cls: "bg-destructive/10 text-destructive border-destructive/30" };

    const isSelected = selectedExamIds.includes(e.id);
    const currentFolderId = getFolderIdForExam(e, folderMappings);
    const examFolderObj = currentFolderId ? folders.find((f) => f.id === currentFolderId) : null;
    const folderColorMeta = examFolderObj ? getFolderColorMeta(examFolderObj.color) : null;

    return (
      <Card
        key={e.id}
        className={`p-5 flex flex-col card-hover animate-slide-up rounded-2xl border transition-all ${
          isSelected ? "border-primary ring-2 ring-primary/40 bg-primary/5" : "border-border/70"
        }`}
        style={{ animationDelay: `${idx * 25}ms` }}
      >
        <div className="flex items-start gap-3">
          {/* Checkbox select */}
          <button
            type="button"
            onClick={() => toggleSelectExam(e.id)}
            className="mt-1 text-muted-foreground hover:text-primary transition-colors shrink-0"
            title={isSelected ? "Bỏ chọn" : "Chọn đề thi này để thao tác"}
          >
            {isSelected ? (
              <CheckSquare className="size-5 text-primary fill-primary/10" />
            ) : (
              <Square className="size-5" />
            )}
          </button>

          <div className="size-10 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0 mt-0.5">
            <FileText className="size-5" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <h3 className="font-semibold text-base leading-snug break-words flex-1 text-foreground" title={e.title}>
                {e.title}
              </h3>
              <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${statusInfo.cls}`}>
                  {statusInfo.label}
                </span>
                {e.display_mode === "team" && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 font-bold whitespace-nowrap flex items-center gap-1">
                    <Trophy className="size-3 text-amber-500" /> Đội/Nhóm
                  </span>
                )}
                {e.display_mode === "team" && e.team_config?.music?.enabled && (
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full bg-pink-500/15 text-pink-700 dark:text-pink-300 border border-pink-500/30 font-bold whitespace-nowrap flex items-center gap-1"
                    title={e.team_config?.music?.customName ? `Nhạc: ${e.team_config.music.customName}` : "Có nhạc nền"}
                  >
                    <Music className="size-3 text-pink-500" />
                    {e.team_config?.music?.customName ? (
                      <span className="max-w-[80px] sm:max-w-[120px] truncate">{e.team_config.music.customName}</span>
                    ) : (
                      "Nhạc nền"
                    )}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <div className="text-xs text-muted-foreground">
                {countQs(e.questions)} câu • {e.duration_minutes} phút
              </div>
              {/* Badge hiển thị thư mục nếu đang xem ở ngoài hoặc xem admin */}
              {examFolderObj && folderColorMeta && !insideFolder && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${folderColorMeta.bg} ${folderColorMeta.border} ${folderColorMeta.text} flex items-center gap-1`}>
                  {renderFolderIcon(examFolderObj.icon, "size-3")}
                  <span className="truncate max-w-[120px]">{examFolderObj.name}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-lg bg-muted/40 p-2.5 text-xs space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <CalendarClock className="size-3.5" />
            <span className="font-medium text-foreground">Mở đề:</span>
            <span>{e.open_at ? fmtDt(e.open_at) : fmtDt(e.created_at)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground pl-5">
            <span className="font-medium text-foreground">Đóng đề:</span>
            <span>{e.manual_closed ? "Đã đóng thủ công" : (e.close_at ? fmtDt(e.close_at) : "Thủ công")}</span>
          </div>
        </div>

        {isAdmin && e.created_by && e.created_by !== user?.id && (
          <div className="text-[10px] mt-2 px-1.5 py-0.5 rounded bg-muted inline-block w-fit">GV khác</div>
        )}

        {/* Mã bài thi & Nút Sao chép mã */}
        <div className="mt-3 flex items-center justify-between p-2.5 rounded-xl bg-primary/5 border border-primary/20">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-bold text-muted-foreground uppercase">Mã bài thi:</span>
            <span className="font-mono text-base font-black text-primary tracking-widest">{getExamPrimaryCode(e)}</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2.5 text-xs font-bold text-primary hover:bg-primary/10 gap-1 shrink-0"
            onClick={() => {
              const c = getExamPrimaryCode(e);
              navigator.clipboard.writeText(c);
              toast.success(`Đã sao chép mã bài thi: ${c}`);
            }}
          >
            <Copy className="size-3.5" /> Sao chép mã
          </Button>
        </div>

        {/* Nút hành động nhanh: Chuyển thư mục */}
        <div className="mt-3 pt-2 border-t border-border/50 flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant="outline"
            className="w-full rounded-xl text-xs font-semibold text-primary border-primary/30 hover:bg-primary/10 gap-1.5 h-8"
            onClick={() => {
              setMoveExamTarget({
                examIds: [e.id],
                titles: [e.title],
                currentFolderId,
              });
            }}
          >
            <FolderPlus className="size-3.5 text-primary" />
            <span>{currentFolderId ? "Đổi thư mục" : "Chuyển vào thư mục"}</span>
          </Button>
        </div>

        {/* Action Buttons Grid */}
        <div className="mt-2 grid grid-cols-2 gap-2">
          {e.display_mode === "team" && (
            <Button
              size="sm"
              className="rounded-xl col-span-2 bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 hover:from-amber-600 hover:to-yellow-500 text-indigo-950 font-black shadow-md border-2 border-amber-300 py-2.5 h-11 text-sm sm:text-base flex items-center justify-center gap-2 active:translate-y-0.5 transition-all"
              onClick={() => setViewingLeaderboardExamId(e.id)}
            >
              <Trophy className="size-5 fill-indigo-950 text-indigo-950" />
              <span>MỞ BẢNG XẾP HẠNG 🏆</span>
            </Button>
          )}
          <Button size="sm" variant="outline" className="rounded-lg" onClick={() => copyLink(e.id)}>
            <Copy className="size-3.5 mr-1" /> Copy link
          </Button>
          <Button size="sm" variant="outline" className="rounded-lg" asChild>
            <Link to={`/exam/${e.id}/share`}><Share2 className="size-3.5 mr-1" /> Chia sẻ</Link>
          </Button>
          <Button size="sm" variant="outline" className="rounded-lg" asChild>
            <Link to={`/exam/${e.id}/results`}><BarChart3 className="size-3.5 mr-1" /> Kết quả</Link>
          </Button>
          <Button size="sm" className="rounded-lg bg-gradient-primary shadow-soft" onClick={() => exportXlsx(e)}>
            <Download className="size-3.5 mr-1" /> Excel
          </Button>
          <Button size="sm" variant="outline" className="rounded-lg" asChild>
            <Link to={`/exam/${e.id}/edit`}><Settings className="size-3.5 mr-1" /> Sửa cài đặt</Link>
          </Button>
          {(e.original_file_path || e.original_file_url) ? (
            <Button size="sm" variant="outline" className="rounded-lg" onClick={() => downloadOriginal(e)}>
              <FileDown className="size-3.5 mr-1" /> Tải đề gốc
            </Button>
          ) : <span />}
          {status === "closed" ? (
            <Button size="sm" variant="outline" className="rounded-lg col-span-2 border-success/40 text-success hover:bg-success/10" onClick={() => setClosed(e, false)}>
              <Unlock className="size-3.5 mr-1" /> 🔓 Mở lại đề thi
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="rounded-lg col-span-2 border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10" onClick={() => confirmClose(e)}>
              <Lock className="size-3.5 mr-1" /> 🔒 Đóng đề
            </Button>
          )}
          <Button size="sm" variant="destructive" className="rounded-lg col-span-2" onClick={() => deleteExam(e)}>
            <Trash2 className="size-3.5 mr-1" /> Xóa đề
          </Button>
        </div>
      </Card>
    );
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Banner thương hiệu */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-primary text-primary-foreground shadow-soft animate-slide-up">
        <div className="absolute -right-10 -top-10 size-48 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -left-10 -bottom-10 size-48 rounded-full bg-white/10 blur-2xl" />
        <div className="relative px-6 py-7 md:py-8 flex items-center gap-4 justify-center text-center flex-col">
          <div className="flex items-center gap-3">
            <div className="size-12 rounded-2xl bg-white/15 grid place-items-center backdrop-blur">
              <GraduationCap className="size-7" />
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight uppercase">
              HỆ THỐNG TẠO ĐỀ TRẮC NGHIỆM ONLINE
            </h1>
          </div>
          <p className="text-sm md:text-base text-white/95 font-semibold tracking-wide uppercase">
            TRƯƠNG THỊ BÍCH THỦY – THPT PHAN BỘI CHÂU - TP ĐÀ NẴNG
          </p>
        </div>
      </section>

      {/* Stat cards */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map((s, i) => (
          <Card key={i} className="p-4 card-hover animate-slide-up rounded-2xl" style={{ animationDelay: `${i * 40}ms` }}>
            <div className={`size-10 rounded-xl bg-gradient-to-br ${s.tint} text-white grid place-items-center mb-3`}>
              <s.icon className="size-5" />
            </div>
            <div className="text-2xl font-bold leading-none">{s.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
          </Card>
        ))}
      </section>

      {/* Floating Toolbar khi chọn nhiều đề thi để chuyển hàng loạt */}
      {selectedExamIds.length > 0 && (
        <div className="sticky top-4 z-30 p-3.5 rounded-2xl bg-card border-2 border-primary shadow-xl flex items-center justify-between gap-3 flex-wrap animate-slide-up">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-xl bg-primary text-white grid place-items-center font-bold text-xs">
              {selectedExamIds.length}
            </div>
            <span className="text-sm font-bold text-foreground">
              Đã chọn {selectedExamIds.length} đề thi
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="rounded-xl text-white shadow-soft bg-gradient-primary gap-1.5"
              onClick={() => {
                const targetTitles = exams
                  .filter((e) => selectedExamIds.includes(e.id))
                  .map((e) => e.title);
                setMoveExamTarget({
                  examIds: selectedExamIds,
                  titles: targetTitles,
                  currentFolderId: activeFolderId,
                });
              }}
            >
              <FolderPlus className="size-4" />
              <span>Chuyển vào thư mục</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="rounded-xl"
              onClick={() => setSelectedExamIds([])}
            >
              <X className="size-4 mr-1" /> Bỏ chọn
            </Button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TRƯỜNG HỢP 1: GIÁO VIÊN ĐANG MỞ MỘT THƯ MỤC CỤ THỂ                        */}
      {/* ========================================================================= */}
      {activeFolder ? (
        <section className="space-y-6 animate-fade-in">
          {/* Breadcrumb điều hướng */}
          <nav className="flex items-center gap-2 text-sm text-muted-foreground font-medium flex-wrap">
            <button
              type="button"
              onClick={handleBackToHome}
              className="hover:text-primary transition-colors flex items-center gap-1.5"
            >
              <span>Trang chủ</span>
            </button>
            <ChevronRight className="size-4 text-muted-foreground/50 shrink-0" />
            <button
              type="button"
              onClick={handleBackToHome}
              className="hover:text-primary transition-colors"
            >
              Thư mục đề thi
            </button>
            <ChevronRight className="size-4 text-muted-foreground/50 shrink-0" />
            <span className="font-bold text-foreground flex items-center gap-1.5">
              {activeFolder.name}
            </span>
          </nav>

          {/* Banner thông tin Thư mục đang mở */}
          {(() => {
            const colorMeta = getFolderColorMeta(activeFolder.color);
            return (
              <div className={`p-6 rounded-2xl border ${colorMeta.bg} ${colorMeta.border} shadow-sm space-y-4`}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-start gap-4">
                    <div className={`size-14 rounded-2xl bg-gradient-to-br ${colorMeta.iconGradient} text-white grid place-items-center shadow-md shrink-0`}>
                      {renderFolderIcon(activeFolder.icon, "size-7")}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${colorMeta.badgeBg} ${colorMeta.border} ${colorMeta.text}`}>
                          THƯ MỤC ĐANG MỞ
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Tạo ngày: {fmtDt(activeFolder.created_at)}
                        </span>
                      </div>
                      <h2 className="text-2xl font-black text-foreground mt-1 tracking-tight">
                        {activeFolder.name}
                      </h2>
                      {activeFolder.description && (
                        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                          {activeFolder.description}
                        </p>
                      )}
                      <div className="text-xs font-semibold text-foreground/80 mt-2 flex items-center gap-2">
                        <span className={`size-2 rounded-full ${colorMeta.dot}`} />
                        <span>Tổng số: <strong className="font-bold text-foreground">{currentFolderExams.length}</strong> đề thi trong thư mục</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      className="rounded-xl border-border/80 bg-background/80 hover:bg-background"
                      onClick={() => setEditingFolder(activeFolder)}
                    >
                      <Edit2 className="size-4 mr-1.5" /> Sửa thư mục
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-xl border-border/80 bg-background/80 hover:bg-background"
                      onClick={handleBackToHome}
                    >
                      <ArrowLeft className="size-4 mr-1.5" /> Quay lại trang chủ
                    </Button>
                    {/* NÚT TẠO ĐỀ TRỰC TIẾP TRONG THƯ MỤC NÀY */}
                    <Button
                      asChild
                      className="rounded-xl text-white shadow-soft bg-gradient-primary"
                    >
                      <Link
                        to={`/teacher?folder=${activeFolder.id}`}
                        state={{ folderId: activeFolder.id, folderName: activeFolder.name }}
                      >
                        <Plus className="size-4 mr-1.5" /> Tạo đề mới vào thư mục này
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Toolbar Tìm kiếm & Sắp xếp trong thư mục */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl text-xs gap-1.5"
                onClick={() => toggleSelectAll(displayedFolderExams)}
              >
                {displayedFolderExams.length > 0 &&
                displayedFolderExams.every((e) => selectedExamIds.includes(e.id)) ? (
                  <>
                    <CheckSquare className="size-4 text-primary" /> Bỏ chọn tất cả
                  </>
                ) : (
                  <>
                    <Square className="size-4" /> Chọn tất cả ({displayedFolderExams.length})
                  </>
                )}
              </Button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Tìm đề trong thư mục này…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9 w-60 rounded-xl"
                />
              </div>

              {/* Sắp xếp đề thi */}
              <div className="flex items-center gap-1 bg-card border rounded-xl px-2.5 py-1 text-xs">
                <ArrowUpDown className="size-3.5 text-muted-foreground" />
                <select
                  value={examSort}
                  onChange={(e) => setExamSort(e.target.value as any)}
                  className="bg-transparent border-none text-xs font-semibold focus:outline-hidden cursor-pointer"
                >
                  <option value="created-desc">Mới nhất</option>
                  <option value="created-asc">Cũ nhất</option>
                  <option value="title-asc">Tên đề (A-Z)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Danh sách đề thi thuộc Thư mục đang mở */}
          {displayedFolderExams.length === 0 ? (
            <Card className="p-12 text-center text-muted-foreground rounded-2xl border-dashed">
              <FolderOpen className="size-12 mx-auto mb-3 text-muted-foreground/50" />
              <h3 className="text-base font-bold text-foreground">
                Thư mục "{activeFolder.name}" chưa có đề thi nào
              </h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                Bạn có thể tạo đề thi trực tiếp ngay bây giờ để đề thi tự động được lưu vào thư mục này, hoặc chuyển các đề thi có sẵn từ trang chủ vào đây.
              </p>
              <div className="mt-5 flex justify-center gap-2">
                <Button
                  asChild
                  className="rounded-xl text-white shadow-soft bg-gradient-primary"
                >
                  <Link
                    to={`/teacher?folder=${activeFolder.id}`}
                    state={{ folderId: activeFolder.id, folderName: activeFolder.name }}
                  >
                    <Plus className="size-4 mr-1.5" /> + Tạo đề mới trong thư mục này
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl"
                  onClick={handleBackToHome}
                >
                  Xem danh sách đề ở trang chủ
                </Button>
              </div>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {displayedFolderExams.map((e, idx) => renderExamCard(e, idx, true))}
            </div>
          )}
        </section>
      ) : (
        /* ========================================================================= */
        /* TRƯỜNG HỢP 2: TRANG CHỦ CHÍNH (KHÔNG MỞ THƯ MỤC CỤ THỂ)                   */
        /* ========================================================================= */
        <div className="space-y-8">
          {/* 1. KHU VỰC QUẢN LÝ THƯ MỤC TRÊN TRANG CHỦ */}
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2">
                  <div className="size-7 rounded-lg bg-teal-500/15 text-teal-600 dark:text-teal-400 grid place-items-center">
                    <Folder className="size-4" />
                  </div>
                  <h2 className="text-xl font-extrabold uppercase tracking-tight text-foreground">
                    THƯ MỤC ĐỀ THI
                  </h2>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Phân loại đề thi theo lớp, môn học, học kỳ hoặc loại bài kiểm tra ({folders.length} thư mục)
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Tìm kiếm thư mục */}
                <div className="relative">
                  <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Tìm thư mục…"
                    value={folderQuery}
                    onChange={(e) => setFolderQuery(e.target.value)}
                    className="pl-9 w-48 rounded-xl h-9 text-xs"
                  />
                </div>

                {/* Sắp xếp thư mục */}
                <div className="flex items-center gap-1 bg-card border rounded-xl px-2.5 py-1 text-xs h-9">
                  <ArrowUpDown className="size-3.5 text-muted-foreground" />
                  <select
                    value={folderSort}
                    onChange={(e) => setFolderSort(e.target.value as any)}
                    className="bg-transparent border-none text-xs font-semibold focus:outline-hidden cursor-pointer"
                  >
                    <option value="name-asc">Tên A-Z</option>
                    <option value="name-desc">Tên Z-A</option>
                    <option value="created-desc">Mới nhất</option>
                    <option value="created-asc">Cũ nhất</option>
                  </select>
                </div>

                {/* Nút Tạo thư mục */}
                <Button
                  onClick={() => {
                    setEditingFolder(null);
                    setCreateFolderOpen(true);
                  }}
                  className="rounded-xl text-white shadow-soft bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 gap-1.5 h-9"
                >
                  <FolderPlus className="size-4" />
                  <span>+ Tạo thư mục</span>
                </Button>
              </div>
            </div>

            {/* Danh sách Thư mục Card Grid */}
            {filteredFolders.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground rounded-2xl border-dashed">
                <Folder className="size-10 mx-auto mb-2 text-muted-foreground/50" />
                <p className="font-semibold text-sm text-foreground">
                  {folderQuery ? `Không tìm thấy thư mục nào phù hợp với "${folderQuery}"` : "Chưa có thư mục nào"}
                </p>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                  {folderQuery ? "Thử tìm kiếm với từ khóa khác hoặc tạo thư mục mới." : "Tạo các thư mục như LỚP 10, LỚP 11, LỚP 12, KIỂM TRA GIỮA KỲ để quản lý đề thi khoa học."}
                </p>
                <Button
                  onClick={() => {
                    setEditingFolder(null);
                    setCreateFolderOpen(true);
                  }}
                  className="mt-4 rounded-xl text-white shadow-soft bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-xs"
                >
                  <FolderPlus className="size-3.5 mr-1" /> Tạo thư mục đầu tiên
                </Button>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredFolders.map((f, idx) => {
                  const colorMeta = getFolderColorMeta(f.color);
                  const count = folderExamCounts[f.id] || 0;

                  return (
                    <Card
                      key={f.id}
                      className={`p-4 rounded-2xl border transition-all duration-200 flex flex-col justify-between group hover:shadow-md cursor-pointer ${colorMeta.border} ${colorMeta.hoverBorder} bg-card`}
                      style={{ animationDelay: `${idx * 20}ms` }}
                      onClick={() => handleOpenFolder(f.id)}
                    >
                      <div>
                        {/* Header của Folder card: Icon + Menu 3 chấm */}
                        <div className="flex items-start justify-between gap-2">
                          <div className={`size-11 rounded-xl bg-gradient-to-br ${colorMeta.iconGradient} text-white grid place-items-center shadow-xs shrink-0 group-hover:scale-105 transition-transform`}>
                            {renderFolderIcon(f.icon, "size-5")}
                          </div>

                          <div onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
                                >
                                  <MoreVertical className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48 rounded-xl">
                                <DropdownMenuItem onClick={() => handleOpenFolder(f.id)} className="gap-2 cursor-pointer">
                                  <FolderOpen className="size-4 text-primary" />
                                  <span>Mở thư mục</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setEditingFolder(f)} className="gap-2 cursor-pointer">
                                  <Edit2 className="size-4 text-muted-foreground" />
                                  <span>Đổi tên & chỉnh sửa</span>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => setDeleteFolderTarget({ folder: f, count })}
                                  className="gap-2 text-destructive focus:text-destructive cursor-pointer"
                                >
                                  <Trash2 className="size-4" />
                                  <span>Xóa thư mục</span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>

                        {/* Tên thư mục & Mô tả */}
                        <div className="mt-3">
                          <h3 className="font-bold text-base text-foreground leading-snug group-hover:text-primary transition-colors line-clamp-1" title={f.name}>
                            {f.name}
                          </h3>
                          {f.description ? (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2" title={f.description}>
                              {f.description}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground/60 italic mt-1">Không có mô tả</p>
                          )}
                        </div>
                      </div>

                      {/* Footer của Folder card: Số lượng đề thi & Ngày tạo */}
                      <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between text-xs">
                        <span className={`font-bold px-2 py-0.5 rounded-full border ${colorMeta.bg} ${colorMeta.border} ${colorMeta.text} flex items-center gap-1`}>
                          <span className={`size-1.5 rounded-full ${colorMeta.dot}`} />
                          <span>{count} đề thi</span>
                        </span>

                        <span className="text-[11px] text-muted-foreground">
                          {fmtDt(f.created_at).split(" ")[1] || fmtDt(f.created_at)}
                        </span>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          {/* 2. KHU VỰC ĐỀ THI CHƯA PHÂN LOẠI */}
          <section className="space-y-4 pt-4 border-t border-border/70">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2">
                  <div className="size-7 rounded-lg bg-primary/10 text-primary grid place-items-center">
                    <FileText className="size-4" />
                  </div>
                  <h2 className="text-xl font-bold uppercase tracking-tight text-foreground">
                    ĐỀ THI CHƯA PHÂN LOẠI
                  </h2>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Các đề thi chưa được đưa vào thư mục ({displayedUnclassifiedExams.length} đề thi)
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl text-xs gap-1.5"
                  onClick={() => toggleSelectAll(displayedUnclassifiedExams)}
                >
                  {displayedUnclassifiedExams.length > 0 &&
                  displayedUnclassifiedExams.every((e) => selectedExamIds.includes(e.id)) ? (
                    <>
                      <CheckSquare className="size-4 text-primary" /> Bỏ chọn tất cả
                    </>
                  ) : (
                    <>
                      <Square className="size-4" /> Chọn tất cả ({displayedUnclassifiedExams.length})
                    </>
                  )}
                </Button>

                {/* Tìm kiếm đề thi chưa phân loại */}
                <div className="relative">
                  <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Tìm đề thi…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="pl-9 w-52 rounded-xl h-9 text-xs"
                  />
                </div>

                {/* Sắp xếp đề thi */}
                <div className="flex items-center gap-1 bg-card border rounded-xl px-2.5 py-1 text-xs h-9">
                  <ArrowUpDown className="size-3.5 text-muted-foreground" />
                  <select
                    value={examSort}
                    onChange={(e) => setExamSort(e.target.value as any)}
                    className="bg-transparent border-none text-xs font-semibold focus:outline-hidden cursor-pointer"
                  >
                    <option value="created-desc">Mới nhất</option>
                    <option value="created-asc">Cũ nhất</option>
                    <option value="title-asc">Tên đề (A-Z)</option>
                  </select>
                </div>

                <Button asChild variant="outline" className="rounded-xl h-9 text-xs">
                  <a href="/de-mau.docx" download><FileDown className="size-3.5 mr-1" /> Đề mẫu</a>
                </Button>
                <Button
                  asChild
                  className="rounded-xl text-white shadow-soft bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 h-9 text-xs"
                >
                  <Link to="/ai-assistant"><Bot className="size-3.5 mr-1.5" /> Trợ lý AI</Link>
                </Button>
                <Button
                  asChild
                  className="rounded-xl text-white shadow-soft h-9 text-xs"
                  style={{ background: "linear-gradient(135deg, #0EA5E9, #2563EB)" }}
                >
                  <Link to="/teacher"><Plus className="size-3.5 mr-1" /> Tạo đề mới</Link>
                </Button>
              </div>
            </div>

            {loading ? (
              <div className="text-center text-muted-foreground py-8">Đang tải đề thi…</div>
            ) : displayedUnclassifiedExams.length === 0 ? (
              <Card className="p-10 text-center text-muted-foreground rounded-2xl border-dashed">
                <Check className="size-8 mx-auto mb-2 text-emerald-500" />
                <p className="font-semibold text-sm text-foreground">
                  {query
                    ? `Không tìm thấy đề thi nào phù hợp với từ khóa "${query}"`
                    : "Không có đề thi nào ở mục chưa phân loại!"}
                </p>
                <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                  {query
                    ? "Hãy thử tìm kiếm với từ khóa khác."
                    : "Tất cả đề thi của bạn đã được phân loại vào các thư mục hoặc chưa tạo đề thi nào mới."}
                </p>
                <Button
                  asChild
                  className="mt-4 rounded-xl text-white shadow-soft text-xs"
                  style={{ background: "linear-gradient(135deg, #0EA5E9, #2563EB)" }}
                >
                  <Link to="/teacher"><Plus className="size-3.5 mr-1" /> Tạo đề thi mới</Link>
                </Button>
              </Card>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {displayedUnclassifiedExams.map((e, idx) => renderExamCard(e, idx, false))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ========================================================================= */}
      {/* CÁC MODAL THAO TÁC THƯ MỤC & CHUYỂN ĐỀ                                    */}
      {/* ========================================================================= */}

      {/* 1. Modal Tạo / Sửa thư mục */}
      <CreateOrEditFolderModal
        open={createFolderOpen || !!editingFolder}
        onOpenChange={(open) => {
          if (!open) {
            setCreateFolderOpen(false);
            setEditingFolder(null);
          }
        }}
        folder={editingFolder}
        teacherId={user?.id}
        onSuccess={() => {
          reloadFolders();
        }}
      />

      {/* 2. Modal Xác nhận xóa thư mục */}
      <DeleteFolderModal
        open={!!deleteFolderTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteFolderTarget(null);
        }}
        folder={deleteFolderTarget?.folder || null}
        examCount={deleteFolderTarget?.count || 0}
        onSuccess={(deletedId) => {
          if (activeFolderId === deletedId) {
            handleBackToHome();
          }
          reloadFolders();
          loadExams();
        }}
      />

      {/* 3. Modal Chuyển đề thi vào thư mục (Đơn lẻ & Hàng loạt) */}
      <MoveExamModal
        open={!!moveExamTarget}
        onOpenChange={(open) => {
          if (!open) setMoveExamTarget(null);
        }}
        examIds={moveExamTarget?.examIds || []}
        examTitles={moveExamTarget?.titles || []}
        folders={folders}
        currentFolderId={moveExamTarget?.currentFolderId}
        onSuccess={handleAfterMoveExams}
      />

      {/* MODAL BẢNG XẾP HẠNG ĐỘI/NHÓM KHI GIÁO VIÊN BẤM XEM */}
      {viewingLeaderboardExamId && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-[#0a1538] animate-fade-in"
          role="dialog"
          aria-modal="true"
        >
          <TeamLeaderboard
            examId={viewingLeaderboardExamId}
            onClose={() => setViewingLeaderboardExamId(null)}
          />
        </div>
      )}
    </div>
  );
}
