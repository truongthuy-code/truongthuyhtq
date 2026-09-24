import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FileText, Plus, Search, Copy, Share2, Trash2, Settings, FileDown, BarChart3,
  Play, RotateCcw, CopyPlus, Activity, Lock, Unlock, Trophy,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { publishExamClosed } from "@/lib/studentStorage";
import TeamLeaderboard from "./TeamLeaderboard";

const PAGE_SIZE = 10;

export default function Exams() {
  const [exams, setExams] = useState<any[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [klass, setKlass] = useState("all");
  const [page, setPage] = useState(1);
  const [viewingLeaderboardExamId, setViewingLeaderboardExamId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: ex } = await supabase.from("exams")
      .select("id,title,duration_minutes,created_at,questions,original_file_url,original_file_path,scoring,allow_review,open_at,close_at,manual_closed,display_mode,team_config")
      .order("created_at", { ascending: false });
    setExams(ex || []);
    const { data: subs } = await supabase.from("submissions").select("exam_id,student_class");
    const c: Record<string, number> = {};
    (subs || []).forEach((s: any) => { c[s.exam_id] = (c[s.exam_id] || 0) + 1; });
    setCounts(c);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const classes = useMemo(() => {
    const set = new Set<string>();
    Object.keys(counts).forEach(() => {});
    exams.forEach((e) => {
      const m = (e.title || "").match(/\b(10|11|12)[A-Z]\d+\b/);
      if (m) set.add(m[0]);
    });
    return ["all", ...Array.from(set).sort()];
  }, [exams]);

  const filtered = useMemo(() => {
    return exams.filter((e) => {
      if (query && !(e.title || "").toLowerCase().includes(query.toLowerCase())) return false;
      if (klass !== "all" && !(e.title || "").includes(klass)) return false;
      return true;
    });
  }, [exams, query, klass]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const countQs = (q: any) => (q?.partI?.length || 0) + (q?.partII?.length || 0) + (q?.partIII?.length || 0);

  const getStatus = (e: any): "not_open" | "open" | "closed" => {
    const now = Date.now();
    if (e.manual_closed) return "closed";
    if (e.open_at && new Date(e.open_at).getTime() > now) return "not_open";
    if (e.close_at && new Date(e.close_at).getTime() < now) return "closed";
    return "open";
  };

  const setClosed = async (exam: any, closed: boolean) => {
    const updates: any = { manual_closed: closed };
    if (closed) updates.allow_review = true;
    const { error } = await supabase.from("exams").update(updates).eq("id", exam.id);
    if (error) return toast.error(error.message);
    if (closed) {
      publishExamClosed(exam.id, exam.questions, exam.title);
    }
    toast.success(closed ? "Đã đóng đề thi và tự động công bố đáp án chính thức cho học sinh" : "Đã mở lại đề thi");
    load();
  };

  const confirmClose = (exam: any) => {
    if (confirm(`Bạn có chắc chắn muốn đóng đề "${exam.title}"? Học sinh sẽ không thể nộp bài mới và hệ thống sẽ tự động công bố đáp án chính thức kèm lời giải.`)) {
      setClosed(exam, true);
    }
  };

  const copyLink = (id: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/take/${id}`);
    toast.success("Đã copy link bài thi");
  };
  const deleteExam = async (exam: any) => {
    if (!confirm(`Xóa đề "${exam.title}"?`)) return;
    await supabase.from("submissions").delete().eq("exam_id", exam.id);
    const { error } = await supabase.from("exams").delete().eq("id", exam.id);
    if (error) return toast.error(error.message);
    toast.success("Đã xóa đề"); load();
  };
  const resetResults = async (exam: any) => {
    if (!confirm(`Xóa toàn bộ bài nộp của "${exam.title}"?`)) return;
    const { error } = await supabase.from("submissions").delete().eq("exam_id", exam.id);
    if (error) return toast.error(error.message);
    toast.success("Đã reset kết quả"); load();
  };
  const duplicate = async (exam: any) => {
    const { id, created_at, ...rest } = exam as any;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("exams").insert({
      ...rest, title: `${exam.title} (Bản sao)`, created_by: u.user?.id,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Đã sao chép đề"); load();
  };
  const downloadOriginal = async (exam: any) => {
    if (exam.original_file_path) {
      const { data, error } = await supabase.storage.from("exam-files").createSignedUrl(exam.original_file_path, 300);
      if (error || !data) return toast.error("Không tạo được link tải");
      window.open(data.signedUrl, "_blank");
    } else if (exam.original_file_url) window.open(exam.original_file_url, "_blank");
    else toast.info("Đề này không có file gốc");
  };

  return (
    <div className="p-4 md:p-6 space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Kho Đề Thi</h1>
          <p className="text-sm text-muted-foreground">Quản lý, chỉnh sửa và tổ chức các kỳ kiểm tra.</p>
        </div>
      </header>

      <Card className="p-4 rounded-2xl shadow-card">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Tìm kiếm đề thi..."
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              className="pl-9 rounded-xl"
            />
          </div>
          <Select value={klass} onValueChange={(v) => { setKlass(v); setPage(1); }}>
            <SelectTrigger className="w-44 rounded-xl"><SelectValue placeholder="Lớp" /></SelectTrigger>
            <SelectContent>
              {classes.map((c) => <SelectItem key={c} value={c}>{c === "all" ? "Tất cả lớp" : c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button asChild className="rounded-xl bg-gradient-primary text-primary-foreground shadow-soft">
            <Link to="/teacher"><Plus className="size-4 mr-1" /> Tạo đề mới</Link>
          </Button>
        </div>
      </Card>

      {loading ? (
        <div className="text-center text-muted-foreground py-10">Đang tải…</div>
      ) : pageItems.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground rounded-2xl">Không tìm thấy đề phù hợp.</Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {pageItems.map((e, idx) => {
            const subject = (e.title || "").match(/(Toán|Lý|Hóa|Sinh|Văn|Anh|Sử|Địa|GDCD|Tin)/i)?.[0] || "Tổng hợp";
            const cls = (e.title || "").match(/\b(10|11|12)[A-Z]\d+\b/)?.[0] || "—";
            const attempts = counts[e.id] || 0;
            return (
              <Card key={e.id} className="p-5 rounded-2xl border-border/70 card-hover animate-slide-up flex flex-col" style={{ animationDelay: `${idx * 30}ms` }}>
                <div className="flex items-start gap-3">
                  <div className="size-11 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0 mt-0.5">
                    <FileText className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <h3 className="font-semibold text-base leading-snug break-words flex-1 text-foreground" title={e.title}>
                        {e.title}
                      </h3>
                      <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                        {(() => {
                          const st = getStatus(e);
                          if (st === "closed") {
                            return (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium inline-flex items-center gap-1">
                                <Lock className="size-3" /> Đã đóng
                              </span>
                            );
                          }
                          if (st === "not_open") {
                            return (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium inline-flex items-center gap-1">
                                <Activity className="size-3" /> Chưa mở
                              </span>
                            );
                          }
                          return (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-success/10 text-success font-medium inline-flex items-center gap-1">
                              <Activity className="size-3" /> Đang mở
                            </span>
                          );
                        })()}
                        {e.display_mode === "team" && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 font-bold border border-amber-500/30 inline-flex items-center gap-1">
                            <Trophy className="size-3 text-amber-500" /> Đội/Nhóm
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                      <span>Môn: <b>{subject}</b></span>
                      <span>•</span>
                      <span>Lớp: <b>{cls}</b></span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                  <div className="rounded-xl bg-muted/40 py-2">
                    <div className="text-base font-bold">{countQs(e.questions)}</div>
                    <div className="text-[10px] text-muted-foreground">Câu hỏi</div>
                  </div>
                  <div className="rounded-xl bg-muted/40 py-2">
                    <div className="text-base font-bold">{e.duration_minutes}'</div>
                    <div className="text-[10px] text-muted-foreground">Thời gian</div>
                  </div>
                  <div className="rounded-xl bg-muted/40 py-2">
                    <div className="text-base font-bold">{attempts}</div>
                    <div className="text-[10px] text-muted-foreground">Lượt thi</div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  {e.display_mode === "team" && (
                    <Button
                      size="sm"
                      className="rounded-xl col-span-2 bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 hover:from-amber-600 hover:to-yellow-500 text-indigo-950 font-black shadow-md border-2 border-amber-300 py-2.5 h-11 text-sm flex items-center justify-center gap-2 active:translate-y-0.5 transition-all"
                      onClick={() => setViewingLeaderboardExamId(e.id)}
                    >
                      <Trophy className="size-5 fill-indigo-950 text-indigo-950" />
                      <span>MỞ BẢNG XẾP HẠNG 🏆</span>
                    </Button>
                  )}
                  <Button size="sm" className="rounded-lg bg-gradient-primary text-primary-foreground" asChild>
                    <Link to={`/take/${e.id}`} target="_blank"><Play className="size-3.5 mr-1" /> Thi</Link>
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-lg" asChild>
                    <Link to={`/exam/${e.id}/edit`}><Settings className="size-3.5 mr-1" /> Sửa</Link>
                  </Button>
                  {getStatus(e) === "closed" ? (
                    <Button size="sm" variant="outline" className="rounded-lg text-success border-success/40" onClick={() => setClosed(e, false)}>
                      <Unlock className="size-3.5 mr-1" /> Mở lại đề
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="rounded-lg text-destructive border-destructive/40" onClick={() => confirmClose(e)}>
                      <Lock className="size-3.5 mr-1" /> Đóng đề
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="rounded-lg" onClick={() => copyLink(e.id)}>
                    <Copy className="size-3.5 mr-1" /> Copy link
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-lg" asChild>
                    <Link to={`/exam/${e.id}/share`}><Share2 className="size-3.5 mr-1" /> Chia sẻ</Link>
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-lg" asChild>
                    <Link to={`/exam/${e.id}/results`}><BarChart3 className="size-3.5 mr-1" /> Thống kê</Link>
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-lg" onClick={() => downloadOriginal(e)}>
                    <FileDown className="size-3.5 mr-1" /> Đề gốc
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-lg" onClick={() => duplicate(e)}>
                    <CopyPlus className="size-3.5 mr-1" /> Sao chép
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-lg text-warning border-warning/40" onClick={() => resetResults(e)}>
                    <RotateCcw className="size-3.5 mr-1" /> Reset KQ
                  </Button>
                  <Button size="sm" variant="destructive" className="rounded-lg col-span-2" onClick={() => deleteExam(e)}>
                    <Trash2 className="size-3.5 mr-1" /> Xóa đề
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Trước</Button>
          <span className="text-sm text-muted-foreground">Trang {page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(page + 1)}>Sau</Button>
        </div>
      )}

      {/* MODAL BẢNG XẾP HẠNG ĐỘI/NHÓM */}
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
