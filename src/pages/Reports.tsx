import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Search, RefreshCw, Share2, Download, Eye, Trophy, ShieldAlert, Users, Award,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
  LineChart, Line, CartesianGrid, Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";

const PIE_COLORS = ["hsl(var(--success))", "hsl(var(--destructive))"];
const BAR_COLOR = "hsl(var(--primary))";

export default function Reports() {
  const [exams, setExams] = useState<any[]>([]);
  const [examId, setExamId] = useState<string>("all");
  const [subs, setSubs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<any | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: ex } = await supabase.from("exams").select("id,title,max_attempts,scoring").order("created_at", { ascending: false });
    setExams(ex || []);
    let q = supabase.from("submissions").select("*").order("score", { ascending: false });
    if (examId !== "all") q = q.eq("exam_id", examId);
    const { data: s } = await q;
    setSubs(s || []);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [examId]);

  const filtered = useMemo(() => {
    if (!query) return subs;
    const q = query.toLowerCase();
    return subs.filter(s => (s.student_name || "").toLowerCase().includes(q) || (s.student_class || "").toLowerCase().includes(q));
  }, [subs, query]);

  const stats = useMemo(() => {
    if (!filtered.length) return { avg: 0, max: 0, min: 0, passRate: 0, count: 0, classCount: 0 };
    const scores = filtered.map(s => Number(s.score) || 0);
    const max = Math.max(...scores);
    const min = Math.min(...scores);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const pass = scores.filter(s => s >= 5).length;
    const classes = new Set(filtered.map(s => s.student_class));
    return { avg: +avg.toFixed(2), max, min, passRate: Math.round((pass / scores.length) * 100), count: filtered.length, classCount: classes.size };
  }, [filtered]);

  const distribution = useMemo(() => {
    const buckets = [
      { range: "0–2", count: 0 }, { range: "2–4", count: 0 },
      { range: "4–6", count: 0 }, { range: "6–8", count: 0 }, { range: "8–10", count: 0 },
    ];
    filtered.forEach(s => {
      const v = Number(s.score) || 0;
      const i = Math.min(4, Math.floor(v / 2));
      buckets[i].count++;
    });
    return buckets;
  }, [filtered]);

  const passData = useMemo(() => [
    { name: "Đạt (≥5)", value: filtered.filter(s => Number(s.score) >= 5).length },
    { name: "Chưa đạt", value: filtered.filter(s => Number(s.score) < 5).length },
  ], [filtered]);

  const timeline = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach(s => {
      const d = new Date(s.submitted_at).toLocaleDateString("vi-VN");
      map.set(d, (map.get(d) || 0) + 1);
    });
    return Array.from(map.entries()).map(([date, count]) => ({ date, count })).slice(-14);
  }, [filtered]);

  const share = () => {
    if (examId === "all") return toast.info("Chọn một đề để chia sẻ trang kết quả");
    navigator.clipboard.writeText(`${window.location.origin}/exam/${examId}/results`);
    toast.success("Đã copy link kết quả");
  };

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
    if (!filtered.length) return toast.info("Không có dữ liệu");
    const rows = filtered.map((s, i) => ({
      TOP: i + 1, "Họ tên": s.student_name, "Lớp": s.student_class,
      "Điểm": s.score, "Đúng": s.correct_count, "Sai": s.wrong_count,
      "Vi phạm": s.violation_count || 0,
      "Tổng thời gian làm bài": fmtDuration(s),
      "Thời gian nộp": new Date(s.submitted_at).toLocaleString("vi-VN"),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Báo cáo");
    XLSX.writeFile(wb, `bao-cao-${Date.now()}.xlsx`);
  };

  const medal = (i: number) => i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`;

  return (
    <div className="p-4 md:p-6 space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Báo cáo kết quả</h1>
          <p className="text-sm text-muted-foreground">Bảng xếp hạng và thống kê chi tiết học sinh.</p>
        </div>
      </header>

      <Card className="p-4 rounded-2xl shadow-card">
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={examId} onValueChange={setExamId}>
            <SelectTrigger className="w-72 rounded-xl"><SelectValue placeholder="Chọn đề thi" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả đề thi</SelectItem>
              {exams.map(e => <SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative flex-1 min-w-[220px]">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Tìm theo tên học sinh hoặc lớp" className="pl-9 rounded-xl"
              value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Button variant="outline" className="rounded-xl" onClick={load}><RefreshCw className="size-4 mr-1" /> Làm mới</Button>
          <Button variant="outline" className="rounded-xl" onClick={share}><Share2 className="size-4 mr-1" /> Chia sẻ</Button>
          <Button className="rounded-xl bg-gradient-primary text-primary-foreground shadow-soft" onClick={exportXlsx}>
            <Download className="size-4 mr-1" /> Xuất Excel
          </Button>
        </div>
      </Card>

      {/* Class report cards */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Điểm trung bình", value: stats.avg, icon: Award, tint: "from-teal-500 to-emerald-500" },
          { label: "Điểm cao nhất", value: stats.max, icon: Trophy, tint: "from-amber-500 to-orange-500" },
          { label: "Điểm thấp nhất", value: stats.min, icon: ShieldAlert, tint: "from-rose-500 to-red-500" },
          { label: "Tỉ lệ đạt", value: `${stats.passRate}%`, icon: Award, tint: "from-sky-500 to-blue-600" },
          { label: "Số HS tham gia", value: stats.count, icon: Users, tint: "from-violet-500 to-fuchsia-500" },
          { label: "Số lớp", value: stats.classCount, icon: Users, tint: "from-cyan-500 to-teal-600" },
        ].map((s, i) => (
          <Card key={i} className="p-4 rounded-2xl card-hover">
            <div className={`size-9 rounded-xl bg-gradient-to-br ${s.tint} text-white grid place-items-center mb-2`}>
              <s.icon className="size-4" />
            </div>
            <div className="text-xl font-bold">{s.value}</div>
            <div className="text-[11px] text-muted-foreground">{s.label}</div>
          </Card>
        ))}
      </section>

      {/* Charts */}
      <section className="grid lg:grid-cols-3 gap-4">
        <Card className="p-4 rounded-2xl lg:col-span-2">
          <h3 className="font-semibold mb-3">Phân bố điểm</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={distribution}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="range" fontSize={12} />
                <YAxis fontSize={12} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill={BAR_COLOR} radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4 rounded-2xl">
          <h3 className="font-semibold mb-3">Tỉ lệ đạt / chưa đạt</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={passData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} label>
                  {passData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4 rounded-2xl lg:col-span-3">
          <h3 className="font-semibold mb-3">Số lượt làm bài theo thời gian</h3>
          <div className="h-56">
            <ResponsiveContainer>
              <LineChart data={timeline}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" fontSize={12} />
                <YAxis fontSize={12} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke={BAR_COLOR} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </section>

      {/* Ranking table */}
      <Card className="rounded-2xl overflow-hidden shadow-card">
        <div className="p-4 border-b">
          <h3 className="font-semibold">Bảng xếp hạng ({filtered.length})</h3>
        </div>
        {loading ? (
          <div className="p-10 text-center text-muted-foreground">Đang tải…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">Chưa có bài nộp.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-16">TOP</TableHead>
                <TableHead>Họ và tên</TableHead>
                <TableHead>Lớp</TableHead>
                <TableHead>Điểm</TableHead>
                <TableHead>Đúng / Sai</TableHead>
                <TableHead>Nộp lúc</TableHead>
                <TableHead>Tổng thời gian</TableHead>
                <TableHead>Vi phạm</TableHead>
                <TableHead className="text-right">Chi tiết</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s, i) => (
                <TableRow key={s.id}>
                  <TableCell className="font-bold">{medal(i)}</TableCell>
                  <TableCell className="font-medium">{s.student_name}</TableCell>
                  <TableCell>{s.student_class}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={Number(s.score) >= 5 ? "bg-success/10 text-success border-success/30" : "bg-destructive/10 text-destructive border-destructive/30"}>
                      {s.score} / {s.max_score}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    <span className="text-success">{s.correct_count}</span> / <span className="text-destructive">{s.wrong_count}</span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(s.submitted_at).toLocaleString("vi-VN")}</TableCell>
                  <TableCell className="text-xs">{fmtDuration(s)}</TableCell>
                  <TableCell>
                    {(s.violation_count || 0) > 0
                      ? <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">{s.violation_count}</Badge>
                      : <span className="text-muted-foreground text-xs">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => setDetail(s)}><Eye className="size-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {examId !== "all" && (
          <div className="p-3 border-t text-right">
            <Button variant="link" asChild><Link to={`/exam/${examId}/results`}>Xem trang chi tiết đề →</Link></Button>
          </div>
        )}
      </Card>

      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Chi tiết bài làm</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-2 text-sm">
              <div><b>Học sinh:</b> {detail.student_name} – {detail.student_class}</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-muted/40 p-3 text-center">
                  <div className="text-xs text-muted-foreground">Điểm</div>
                  <div className="text-2xl font-bold text-primary">{detail.score}</div>
                </div>
                <div className="rounded-xl bg-muted/40 p-3 text-center">
                  <div className="text-xs text-muted-foreground">Trên tối đa</div>
                  <div className="text-2xl font-bold">{detail.max_score}</div>
                </div>
                <div className="rounded-xl bg-success/10 p-3 text-center">
                  <div className="text-xs text-muted-foreground">Đúng</div>
                  <div className="text-xl font-bold text-success">{detail.correct_count}</div>
                </div>
                <div className="rounded-xl bg-destructive/10 p-3 text-center">
                  <div className="text-xs text-muted-foreground">Sai</div>
                  <div className="text-xl font-bold text-destructive">{detail.wrong_count}</div>
                </div>
              </div>
              <div><b>Vi phạm:</b> {detail.violation_count || 0}</div>
              <div><b>Ngày làm:</b> {new Date(detail.submitted_at).toLocaleString("vi-VN")}</div>
              <Button asChild className="w-full mt-2 bg-gradient-primary text-primary-foreground">
                <Link to={`/result/${detail.id}`} target="_blank">Mở trang kết quả đầy đủ</Link>
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
