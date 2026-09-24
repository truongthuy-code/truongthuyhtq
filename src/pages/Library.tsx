import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronDown, BookOpen, School, GraduationCap, FileText, Search, Settings, BarChart3, Play, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

type Exam = {
  id: string; title: string; created_at: string; duration_minutes: number;
  subject_name: string | null; school_name: string | null; teacher_name: string | null;
  created_by: string | null;
  original_file_path?: string | null; original_file_url?: string | null;
};

export default function Library() {
  const { user, isAdmin } = useAuth();
  const [exams, setExams] = useState<Exam[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      let q = supabase.from("exams")
        .select("id,title,created_at,duration_minutes,subject_name,school_name,teacher_name,created_by,original_file_path,original_file_url")
        .order("created_at", { ascending: false });
      if (!isAdmin && user) q = q.eq("created_by", user.id);
      const { data } = await q;
      setExams((data as any) || []);
      const { data: subs } = await supabase.from("submissions").select("exam_id");
      const c: Record<string, number> = {};
      (subs || []).forEach((s: any) => { c[s.exam_id] = (c[s.exam_id] || 0) + 1; });
      setCounts(c);
      setLoading(false);
    })();
  }, [isAdmin, user]);

  // build tree: subject -> school -> teacher -> exams
  const tree = useMemo(() => {
    const root: Record<string, Record<string, Record<string, Exam[]>>> = {};
    const ql = query.trim().toLowerCase();
    exams.forEach((e) => {
      if (ql) {
        const hay = `${e.title} ${e.subject_name || ""} ${e.school_name || ""} ${e.teacher_name || ""}`.toLowerCase();
        if (!hay.includes(ql)) return;
      }
      const sub = e.subject_name?.trim() || "Chưa cập nhật môn học";
      const sch = e.school_name?.trim() || "Chưa cập nhật trường học";
      const tch = e.teacher_name?.trim() || "Không xác định";
      root[sub] ||= {};
      root[sub][sch] ||= {};
      root[sub][sch][tch] ||= [];
      root[sub][sch][tch].push(e);
    });
    return root;
  }, [exams, query]);

  const toggle = (k: string) => {
    setOpenKeys((p) => {
      const n = new Set(p);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  };
  const isOpen = (k: string) => openKeys.has(k) || !!query.trim();

  const subjects = Object.keys(tree).sort();

  const downloadExam = async (e: Exam) => {
    if (e.original_file_path) {
      const { data, error } = await supabase.storage.from("exam-files").createSignedUrl(e.original_file_path, 300);
      if (error || !data) return toast.error("Không tạo được link tải");
      window.open(data.signedUrl, "_blank");
      return;
    }
    if (e.original_file_url) { window.open(e.original_file_url, "_blank"); return; }
    // Fallback: export JSON of the full exam (metadata + questions + answers + explanations)
    const { data: full, error } = await supabase.from("exams").select("*").eq("id", e.id).maybeSingle();
    if (error || !full) return toast.error("Không tải được đề");
    const blob = new Blob([JSON.stringify(full, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${(full.title || "de-thi").replace(/[\\/:*?"<>|]+/g, "_")}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast.success("Đã tải đề (JSON)");
  };


  return (
    <div className="p-4 md:p-6 space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Kho Đề Thi</h1>
          <p className="text-sm text-muted-foreground">
            Tổ chức theo Môn học → Trường học → Giáo viên → Đề thi.
            {isAdmin ? " Bạn đang xem ở chế độ quản trị viên." : " Bạn chỉ thấy đề của mình."}
          </p>
        </div>
        <div className="relative w-full md:w-80">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9 rounded-xl" placeholder="Tìm môn / trường / giáo viên / đề..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </header>

      {loading ? (
        <Card className="p-10 text-center text-muted-foreground">Đang tải…</Card>
      ) : subjects.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground rounded-2xl">Chưa có đề thi nào.</Card>
      ) : (
        <Card className="p-4 rounded-2xl shadow-card">
          <div className="space-y-1">
            {subjects.map((subj) => {
              const schoolMap = tree[subj];
              const schools = Object.keys(schoolMap).sort();
              const examCount = schools.reduce((a, sc) => a + Object.values(schoolMap[sc]).reduce((b, arr) => b + arr.length, 0), 0);
              const teacherCount = new Set(schools.flatMap((sc) => Object.keys(schoolMap[sc]))).size;
              const subjKey = `s:${subj}`;
              return (
                <div key={subj} className="rounded-xl">
                  <button onClick={() => toggle(subjKey)} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl hover:bg-muted/50 transition">
                    {isOpen(subjKey) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    <BookOpen className="size-5 text-primary" />
                    <span className="font-semibold">{subj}</span>
                    <Badge variant="secondary" className="ml-2">{schools.length} trường</Badge>
                    <Badge variant="secondary">{teacherCount} GV</Badge>
                    <Badge variant="secondary">{examCount} đề</Badge>
                  </button>
                  {isOpen(subjKey) && (
                    <div className="ml-6 border-l pl-3 space-y-1 mt-1">
                      {schools.map((sch) => {
                        const teacherMap = schoolMap[sch];
                        const teachers = Object.keys(teacherMap).sort();
                        const schKey = `${subjKey}/sc:${sch}`;
                        const schExams = teachers.reduce((a, t) => a + teacherMap[t].length, 0);
                        return (
                          <div key={sch}>
                            <button onClick={() => toggle(schKey)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-muted/40 transition">
                              {isOpen(schKey) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                              <School className="size-4 text-accent" />
                              <span className="font-medium">{sch}</span>
                              <Badge variant="outline" className="ml-2">{teachers.length} GV</Badge>
                              <Badge variant="outline">{schExams} đề</Badge>
                            </button>
                            {isOpen(schKey) && (
                              <div className="ml-6 border-l pl-3 space-y-1 mt-1">
                                {teachers.map((tch) => {
                                  const list = teacherMap[tch];
                                  const tKey = `${schKey}/t:${tch}`;
                                  return (
                                    <div key={tch}>
                                      <button onClick={() => toggle(tKey)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-muted/30 transition">
                                        {isOpen(tKey) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                                        <GraduationCap className="size-4 text-success" />
                                        <span>{tch}</span>
                                        <Badge variant="outline" className="ml-2">{list.length} đề</Badge>
                                      </button>
                                      {isOpen(tKey) && (
                                        <div className="ml-7 mt-1 space-y-1">
                                          {list.map((e) => (
                                            <div key={e.id} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-muted/30 group">
                                              <FileText className="size-4 text-muted-foreground" />
                                              <div className="min-w-0 flex-1">
                                                <div className="text-sm font-medium truncate">{e.title}</div>
                                                <div className="text-[11px] text-muted-foreground">
                                                  {e.duration_minutes}' • {counts[e.id] || 0} lượt thi • {new Date(e.created_at).toLocaleDateString("vi-VN")}
                                                </div>
                                              </div>
                                              <div className="opacity-0 group-hover:opacity-100 transition flex gap-1">
                                                <Button size="sm" variant="ghost" asChild><Link to={`/take/${e.id}`} target="_blank"><Play className="size-3.5" /></Link></Button>
                                                <Button size="sm" variant="ghost" asChild><Link to={`/exam/${e.id}/results`}><BarChart3 className="size-3.5" /></Link></Button>
                                                <Button size="sm" variant="ghost" asChild><Link to={`/exam/${e.id}/edit`}><Settings className="size-3.5" /></Link></Button>
                                                <Button size="sm" variant="ghost" title="Tải đề" onClick={() => downloadExam(e)}><Download className="size-3.5" /></Button>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
