import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  FileText, Users, BarChart3, Upload, Copy, Download, Share2, Trash2, FileDown,
  Settings, Plus, GraduationCap, ClipboardCheck, ShieldAlert, Activity, Star, Search,
  Lock, Unlock, CalendarClock, Trophy, Music,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { publishExamClosed } from "@/lib/studentStorage";
import TeamLeaderboard from "./TeamLeaderboard";

type Stats = {
  exams: number; students: number; attempts: number; avgScore: number;
  violations: number; openExams: number;
};

export default function Index() {
  const { user, isAdmin } = useAuth();
  const [exams, setExams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>({ exams: 0, students: 0, attempts: 0, avgScore: 0, violations: 0, openExams: 0 });
  const [query, setQuery] = useState("");
  const [viewingLeaderboardExamId, setViewingLeaderboardExamId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: ex } = await supabase.from("exams")
        .select("id,title,duration_minutes,created_at,questions,original_file_url,original_file_name,original_file_path,created_by,open_at,close_at,manual_closed,auto_submit_on_close,display_mode,team_config")
        .order("created_at", { ascending: false }).limit(200);
      setExams(ex || []);
      const { data: subs } = await supabase.from("submissions").select("student_name,student_class,score,violation_count");
      const s = subs || [];
      const uniqStudents = new Set(s.map((x: any) => `${x.student_name}__${x.student_class}`)).size;
      const avg = s.length ? s.reduce((a: number, b: any) => a + Number(b.score || 0), 0) / s.length : 0;
      const violations = s.reduce((a: number, b: any) => a + (b.violation_count || 0), 0);
      const now = Date.now();
      const openCount = (ex || []).filter((e: any) => {
        if (e.manual_closed) return false;
        if (e.open_at && new Date(e.open_at).getTime() > now) return false;
        if (e.close_at && new Date(e.close_at).getTime() < now) return false;
        return true;
      }).length;
      setStats({
        exams: ex?.length || 0,
        students: uniqStudents,
        attempts: s.length,
        avgScore: Math.round(avg * 100) / 100,
        violations,
        openExams: openCount,
      });
      setLoading(false);
    })();
  }, []);

  const copyLink = (id: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/take/${id}`);
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


  const filtered = useMemo(
    () => exams.filter((e) => !query || (e.title || "").toLowerCase().includes(query.toLowerCase())),
    [exams, query],
  );

  const statCards = [
    { label: "Tổng số đề thi", value: stats.exams, icon: FileText, tint: "from-teal-500 to-emerald-500" },
    { label: "Tổng số học sinh", value: stats.students, icon: Users, tint: "from-sky-500 to-blue-600" },
    { label: "Lượt làm bài", value: stats.attempts, icon: ClipboardCheck, tint: "from-violet-500 to-fuchsia-500" },
    { label: "Điểm trung bình", value: stats.avgScore, icon: Star, tint: "from-amber-500 to-orange-500" },
    { label: "Lượt vi phạm", value: stats.violations, icon: ShieldAlert, tint: "from-rose-500 to-red-600" },
    { label: "Đề thi đang mở", value: stats.openExams, icon: Activity, tint: "from-cyan-500 to-teal-600" },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Banner */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-primary text-primary-foreground shadow-soft animate-slide-up">
        <div className="absolute -right-10 -top-10 size-48 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -left-10 -bottom-10 size-48 rounded-full bg-white/10 blur-2xl" />
        <div className="relative px-6 py-7 md:py-8 flex items-center gap-4 justify-center text-center flex-col">
          <div className="flex items-center gap-3">
            <div className="size-12 rounded-2xl bg-white/15 grid place-items-center backdrop-blur">
              <GraduationCap className="size-7" />
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight uppercase">
              Hệ thống tạo đề trắc nghiệm Online
            </h1>
          </div>
          <p className="text-sm md:text-base text-white/90">Trương Thị Bích Thủy – THPT Lê Quý Đôn</p>
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

      {/* Exam list */}
      <section>
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h2 className="text-xl font-bold">{isAdmin ? "Tất cả đề thi (Admin)" : "Đề thi của bạn"}</h2>
            <p className="text-xs text-muted-foreground">{filtered.length} đề</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Tìm đề thi…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9 w-56 rounded-xl"
              />
            </div>
            <Button asChild variant="outline" className="rounded-xl">
              <a href="/de-mau.docx" download><FileDown className="size-4 mr-1" /> Đề mẫu</a>
            </Button>
            <Button
              asChild
              className="rounded-xl text-white shadow-soft"
              style={{ background: "linear-gradient(135deg, #0EA5E9, #2563EB)" }}
            >
              <Link to="/teacher"><Plus className="size-4 mr-1" /> Tạo đề mới</Link>
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-center text-muted-foreground py-8">Đang tải…</div>
        ) : filtered.length === 0 ? (
          <Card className="p-10 text-center text-muted-foreground rounded-2xl">
            <Upload className="size-8 mx-auto mb-3 text-muted-foreground/60" />
            Chưa có đề nào. Hãy tạo đề đầu tiên!
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((e, idx) => {
              const status = getStatus(e);
              const statusInfo = status === "open"
                ? { label: "🟢 Đang mở", cls: "bg-success/10 text-success border-success/30" }
                : status === "not_open"
                  ? { label: "🟡 Chưa mở", cls: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400" }
                  : { label: "🔴 Đã đóng", cls: "bg-destructive/10 text-destructive border-destructive/30" };
              return (
              <Card
                key={e.id}
                className="p-5 flex flex-col card-hover animate-slide-up rounded-2xl border-border/70"
                style={{ animationDelay: `${idx * 30}ms` }}
              >
                <div className="flex items-start gap-3">
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
                    <div className="text-xs text-muted-foreground mt-1">
                      {countQs(e.questions)} câu • {e.duration_minutes} phút
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
                <div className="mt-4 grid grid-cols-2 gap-2">
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
            })}
          </div>
        )}
      </section>

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
