import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Search, Upload, UserPlus, Eye, Pencil, KeyRound, Lock, Trash2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";

type Student = {
  id: string;
  name: string;
  klass: string;
  email: string;
  username: string;
  password?: string;
  status: "approved" | "pending" | "locked";
  createdAt: string;
  source: "submission" | "manual";
};

const LS_KEY = "students_manual_v1";
const loadManual = (): Student[] => {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; }
};
const saveManual = (list: Student[]) => localStorage.setItem(LS_KEY, JSON.stringify(list));

const SAMPLE: Student[] = [
  { id: "s1", name: "Nguyễn Văn An", klass: "10A1", email: "an.nv@lqd.edu.vn", username: "an.nv", status: "approved", createdAt: new Date().toISOString(), source: "manual" },
  { id: "s2", name: "Trần Thị Bình", klass: "10A2", email: "binh.tt@lqd.edu.vn", username: "binh.tt", status: "pending", createdAt: new Date().toISOString(), source: "manual" },
  { id: "s3", name: "Lê Minh Châu", klass: "11A1", email: "chau.lm@lqd.edu.vn", username: "chau.lm", status: "locked", createdAt: new Date().toISOString(), source: "manual" },
];

export default function Students() {
  const [manual, setManual] = useState<Student[]>([]);
  const [fromSubs, setFromSubs] = useState<Student[]>([]);
  const [query, setQuery] = useState("");
  const [openAdd, setOpenAdd] = useState(false);
  const [openView, setOpenView] = useState<Student | null>(null);
  const [editing, setEditing] = useState<Student | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<Partial<Student>>({});

  useEffect(() => {
    const m = loadManual();
    setManual(m.length ? m : SAMPLE);
    if (!m.length) saveManual(SAMPLE);
    (async () => {
      const { data } = await supabase.from("submissions").select("student_name,student_class,submitted_at");
      const seen = new Map<string, Student>();
      (data || []).forEach((s: any) => {
        const key = `${s.student_name}__${s.student_class}`;
        if (!seen.has(key)) {
          seen.set(key, {
            id: `sub:${key}`, name: s.student_name, klass: s.student_class,
            email: "", username: "", status: "approved",
            createdAt: s.submitted_at, source: "submission",
          });
        }
      });
      setFromSubs(Array.from(seen.values()));
    })();
  }, []);

  const all = useMemo(() => {
    const merged = [...manual, ...fromSubs.filter(s => !manual.some(m => m.name === s.name && m.klass === s.klass))];
    if (!query) return merged;
    const q = query.toLowerCase();
    return merged.filter(s => s.name.toLowerCase().includes(q) || s.klass.toLowerCase().includes(q) || s.email.toLowerCase().includes(q));
  }, [manual, fromSubs, query]);

  const persistManual = (next: Student[]) => { setManual(next); saveManual(next); };

  const submit = () => {
    if (!form.name || !form.klass) return toast.error("Nhập đủ Họ tên và Lớp");
    if (editing) {
      persistManual(manual.map(s => s.id === editing.id ? { ...s, ...form } as Student : s));
      toast.success("Đã cập nhật");
    } else {
      const s: Student = {
        id: `m_${Date.now()}`, name: form.name!, klass: form.klass!,
        email: form.email || "", username: form.username || "", password: form.password,
        status: "approved", createdAt: new Date().toISOString(), source: "manual",
      };
      persistManual([s, ...manual]);
      toast.success("Đã thêm học sinh");
    }
    setOpenAdd(false); setEditing(null); setForm({});
  };

  const remove = (s: Student) => {
    if (s.source !== "manual") return toast.error("Học sinh này phát sinh từ bài thi, không thể xóa.");
    if (!confirm(`Xóa ${s.name}?`)) return;
    persistManual(manual.filter(x => x.id !== s.id));
  };
  const toggleLock = (s: Student) => {
    if (s.source !== "manual") return toast.error("Không thể khóa học sinh từ bài thi.");
    persistManual(manual.map(x => x.id === s.id ? { ...x, status: x.status === "locked" ? "approved" : "locked" } : x));
  };
  const resetPwd = (s: Student) => {
    const pw = Math.random().toString(36).slice(-8);
    if (s.source === "manual") persistManual(manual.map(x => x.id === s.id ? { ...x, password: pw } : x));
    toast.success(`Mật khẩu mới: ${pw}`);
  };

  const onImport = async (file: File) => {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const next: Student[] = rows.map((r, i) => ({
      id: `m_${Date.now()}_${i}`,
      name: r["Họ tên"] || r.name || r.Name || "",
      klass: r["Lớp"] || r.class || r.klass || "",
      email: r["Email"] || r.email || "",
      username: r["Tài khoản"] || r.username || "",
      password: r["Mật khẩu"] || r.password,
      status: "approved" as const, createdAt: new Date().toISOString(), source: "manual" as const,
    })).filter(s => s.name);
    if (!next.length) return toast.error("File không có dữ liệu hợp lệ");
    persistManual([...next, ...manual]);
    toast.success(`Đã import ${next.length} học sinh`);
  };

  const statusBadge = (s: Student["status"]) => {
    const map = {
      approved: { label: "Đã duyệt", cls: "bg-success/10 text-success border-success/30" },
      pending: { label: "Chờ duyệt", cls: "bg-warning/10 text-warning border-warning/30" },
      locked: { label: "Bị khóa", cls: "bg-destructive/10 text-destructive border-destructive/30" },
    }[s];
    return <Badge variant="outline" className={map.cls}>{map.label}</Badge>;
  };

  return (
    <div className="p-4 md:p-6 space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Quản lý học sinh</h1>
          <p className="text-sm text-muted-foreground">Danh sách tài khoản học sinh trong hệ thống.</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          <Button variant="outline" className="rounded-xl" onClick={() => fileRef.current?.click()}>
            <Upload className="size-4 mr-1" /> Import Excel
          </Button>
          <Dialog open={openAdd} onOpenChange={(v) => { setOpenAdd(v); if (!v) { setEditing(null); setForm({}); } }}>
            <DialogTrigger asChild>
              <Button className="rounded-xl bg-gradient-primary text-primary-foreground shadow-soft">
                <UserPlus className="size-4 mr-1" /> Thêm học sinh
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing ? "Sửa học sinh" : "Thêm học sinh"}</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div><Label>Họ tên</Label><Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label>Lớp</Label><Input value={form.klass || ""} onChange={(e) => setForm({ ...form, klass: e.target.value })} /></div>
                <div><Label>Tài khoản</Label><Input value={form.username || ""} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
                <div><Label>Mật khẩu</Label><Input value={form.password || ""} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
                <div><Label>Email</Label><Input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenAdd(false)}>Hủy</Button>
                <Button onClick={submit} className="bg-gradient-primary text-primary-foreground">Lưu</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <Card className="p-4 rounded-2xl shadow-card">
        <div className="relative max-w-md">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Tìm kiếm học sinh..." className="pl-9 rounded-xl"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </Card>

      <Card className="rounded-2xl overflow-hidden shadow-card">
        {all.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">
            <Users className="size-8 mx-auto mb-2 opacity-60" />
            Chưa có học sinh nào.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-12">STT</TableHead>
                <TableHead>Họ và tên</TableHead>
                <TableHead>Lớp</TableHead>
                <TableHead>Email / Tài khoản</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>Ngày tạo</TableHead>
                <TableHead className="text-right">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {all.map((s, i) => (
                <TableRow key={s.id}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.klass}</TableCell>
                  <TableCell className="text-xs">
                    <div>{s.email || <span className="text-muted-foreground">—</span>}</div>
                    <div className="text-muted-foreground">{s.username}</div>
                  </TableCell>
                  <TableCell>{statusBadge(s.status)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(s.createdAt).toLocaleDateString("vi-VN")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      <Button size="icon" variant="ghost" title="Xem" onClick={() => setOpenView(s)}><Eye className="size-4" /></Button>
                      <Button size="icon" variant="ghost" title="Sửa" onClick={() => { setEditing(s); setForm(s); setOpenAdd(true); }}><Pencil className="size-4" /></Button>
                      <Button size="icon" variant="ghost" title="Đặt lại mật khẩu" onClick={() => resetPwd(s)}><KeyRound className="size-4" /></Button>
                      <Button size="icon" variant="ghost" title="Khóa/Mở khóa" onClick={() => toggleLock(s)}><Lock className="size-4" /></Button>
                      <Button size="icon" variant="ghost" className="text-destructive" title="Xóa" onClick={() => remove(s)}><Trash2 className="size-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={!!openView} onOpenChange={(v) => !v && setOpenView(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Thông tin học sinh</DialogTitle></DialogHeader>
          {openView && (
            <div className="space-y-2 text-sm">
              <div><b>Họ tên:</b> {openView.name}</div>
              <div><b>Lớp:</b> {openView.klass}</div>
              <div><b>Email:</b> {openView.email || "—"}</div>
              <div><b>Tài khoản:</b> {openView.username || "—"}</div>
              <div><b>Trạng thái:</b> {statusBadge(openView.status)}</div>
              <div><b>Ngày tạo:</b> {new Date(openView.createdAt).toLocaleString("vi-VN")}</div>
              <div className="text-xs text-muted-foreground">Nguồn: {openView.source === "manual" ? "Thêm thủ công" : "Phát sinh từ bài thi"}</div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
