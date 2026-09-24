import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { BookOpen, FileText, School, GraduationCap, Activity, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export default function Subjects() {
  const { isAdmin, user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [subs, setSubs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      let q = supabase.from("exams").select("id,subject_name,school_name,teacher_name,created_by");
      if (!isAdmin && user) q = q.eq("created_by", user.id);
      const [{ data: ex }, { data: s }] = await Promise.all([
        q,
        supabase.from("submissions").select("exam_id,score,student_name,student_class"),
      ]);
      setRows((ex as any) || []);
      setSubs((s as any) || []);
      setLoading(false);
    })();
  }, [isAdmin, user]);

  const stats = useMemo(() => {
    const examBySubject: Record<string, any[]> = {};
    rows.forEach((e) => {
      const k = e.subject_name?.trim() || "Chưa cập nhật môn học";
      (examBySubject[k] ||= []).push(e);
    });
    const examIdToSubject = new Map<string, string>();
    rows.forEach((e) => examIdToSubject.set(e.id, e.subject_name?.trim() || "Chưa cập nhật môn học"));
    const subAgg: Record<string, { count: number; sum: number; students: Set<string> }> = {};
    subs.forEach((s) => {
      const k = examIdToSubject.get(s.exam_id);
      if (!k) return;
      const a = (subAgg[k] ||= { count: 0, sum: 0, students: new Set() });
      a.count++; a.sum += Number(s.score || 0);
      a.students.add(`${s.student_name}__${s.student_class}`);
    });
    return Object.keys(examBySubject).sort().map((name) => {
      const exs = examBySubject[name];
      const schools = new Set(exs.map((e) => e.school_name?.trim() || "Chưa cập nhật trường học")).size;
      const teachers = new Set(exs.map((e) => e.teacher_name?.trim() || e.created_by || "?")).size;
      const a = subAgg[name] || { count: 0, sum: 0, students: new Set() };
      return {
        name, schools, teachers, exams: exs.length,
        attempts: a.count,
        avg: a.count ? Math.round((a.sum / a.count) * 100) / 100 : 0,
        students: a.students.size,
      };
    });
  }, [rows, subs]);

  return (
    <div className="p-4 md:p-6 space-y-5">
      <header>
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Quản lý môn học</h1>
        <p className="text-sm text-muted-foreground">Thống kê hoạt động theo từng môn học.</p>
      </header>

      {loading ? (
        <Card className="p-10 text-center text-muted-foreground">Đang tải…</Card>
      ) : stats.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground rounded-2xl">Chưa có dữ liệu.</Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {stats.map((s, i) => (
            <Card key={s.name} className="p-5 rounded-2xl card-hover animate-slide-up" style={{ animationDelay: `${i * 30}ms` }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="size-11 rounded-xl bg-primary/10 text-primary grid place-items-center">
                  <BookOpen className="size-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold truncate">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{s.exams} đề • {s.attempts} lượt thi</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Stat icon={<School className="size-4" />} label="Trường" value={s.schools} />
                <Stat icon={<GraduationCap className="size-4" />} label="Giáo viên" value={s.teachers} />
                <Stat icon={<FileText className="size-4" />} label="Đề thi" value={s.exams} />
                <Stat icon={<Activity className="size-4" />} label="Lượt thi" value={s.attempts} />
                <Stat icon={<Star className="size-4" />} label="Điểm TB" value={s.avg} />
                <Stat icon={<GraduationCap className="size-4" />} label="Học sinh" value={s.students} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-muted/40 p-2 text-center">
      <div className="flex items-center justify-center text-muted-foreground mb-1">{icon}</div>
      <div className="text-base font-bold">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
