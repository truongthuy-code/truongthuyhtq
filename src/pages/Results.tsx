import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Download, RefreshCw } from "lucide-react";
import * as XLSX from "xlsx";

export default function Results() {
  const { id } = useParams();
  const [exam, setExam] = useState<any>(null);
  const [subs, setSubs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [{ data: e }, { data: s }] = await Promise.all([
      supabase.from("exams").select("*").eq("id", id!).maybeSingle(),
      supabase.from("submissions").select("*").eq("exam_id", id!).order("submitted_at", { ascending: false }),
    ]);
    setExam(e); setSubs(s || []); setLoading(false);
  };
  useEffect(() => { load(); }, [id]);

  const fmtDuration = (s: any) => {
    let total: number;
    if (s.duration_seconds != null && isFinite(Number(s.duration_seconds))) {
      total = Math.max(0, Math.floor(Number(s.duration_seconds)));
    } else {
      if (!s.started_at || !s.submitted_at) return "—";
      const ms = new Date(s.submitted_at).getTime() - new Date(s.started_at).getTime();
      if (!isFinite(ms) || ms < 0) return "—";
      total = Math.floor(ms / 1000);
    }
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    if (h > 0) return `${h}h ${m}p ${sec}s`;
    return `${m} phút ${sec} giây`;
  };

  const exportXlsx = () => {
    const rows = subs.map((s, i) => ({
      STT: i + 1,
      "Họ tên": s.student_name,
      "Lớp": s.student_class,
      "Số câu đúng": s.correct_count,
      "Số câu sai": s.wrong_count,
      "Điểm": s.score,
      "Vi phạm": s.violation_count ?? 0,
      "Trạng thái": (s.violation_count ?? 0) === 0 ? "Tốt" : (s.violation_count ?? 0) < 3 ? "Cảnh báo" : "Nghi ngờ gian lận",
      "Tổng thời gian làm bài": fmtDuration(s),
      "Thời gian nộp": new Date(s.submitted_at).toLocaleString("vi-VN"),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Kết quả");
    XLSX.writeFile(wb, `${exam?.title || "ket-qua"}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-gradient-soft">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="container flex items-center justify-between py-4">
          <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Trang chủ
          </Link>
          <div className="font-semibold truncate">{exam?.title}</div>
          <div />
        </div>
      </header>

      <main className="container max-w-5xl py-8 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Kết quả lớp</h1>
            <p className="text-sm text-muted-foreground">{subs.length} bài đã nộp</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={load}><RefreshCw className="size-4 mr-2" />Làm mới</Button>
            <Button onClick={exportXlsx} disabled={!subs.length} className="bg-gradient-primary">
              <Download className="size-4 mr-2" /> Tải Excel
            </Button>
          </div>
        </div>

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Họ tên</TableHead>
                <TableHead>Lớp</TableHead>
                <TableHead className="text-center">Đúng</TableHead>
                <TableHead className="text-center">Sai</TableHead>
                <TableHead className="text-center">Điểm</TableHead>
                <TableHead className="text-center">Vi phạm</TableHead>
                <TableHead>Tổng thời gian</TableHead>
                <TableHead>Nộp lúc</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Đang tải…</TableCell></TableRow>}
              {!loading && subs.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Chưa có bài nộp</TableCell></TableRow>}
              {subs.map((s, i) => {
                const vc = s.violation_count ?? 0;
                const vList: any[] = Array.isArray(s.violations) ? s.violations : [];
                const cls = vc === 0 ? "text-success" : vc < 3 ? "text-warning" : "text-destructive";
                const label = vc === 0 ? "Tốt" : vc < 3 ? "Cảnh báo" : "Nghi ngờ gian lận";
                return (
                  <TableRow key={s.id}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell className="font-medium">{s.student_name}</TableCell>
                    <TableCell>{s.student_class}</TableCell>
                    <TableCell className="text-center text-success">{s.correct_count}</TableCell>
                    <TableCell className="text-center text-destructive">{s.wrong_count}</TableCell>
                    <TableCell className="text-center font-bold">{s.score}</TableCell>
                    <TableCell className="text-center">
                      {vc > 0 ? (
                        <details className="inline-block text-left">
                          <summary className={`cursor-pointer font-semibold ${cls}`}>{vc} • {label}</summary>
                          <div className="mt-2 text-xs space-y-1 text-muted-foreground max-w-xs">
                            {vList.map((v, k) => (
                              <div key={k}>
                                {new Date(v.at).toLocaleTimeString("vi-VN")} — {v.type}
                                {v.duration_ms ? ` (${Math.round(v.duration_ms / 1000)}s)` : ""}
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : <span className={`text-xs ${cls}`}>Tốt</span>}
                    </TableCell>
                    <TableCell className="text-sm">{fmtDuration(s)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(s.submitted_at).toLocaleString("vi-VN")}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      </main>
    </div>
  );
}
