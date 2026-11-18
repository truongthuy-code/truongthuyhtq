import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Eye, ShieldCheck, RefreshCw } from "lucide-react";
import { AdminActivityLogRecord } from "@/lib/adminService";

interface AdminAuditLogsTabProps {
  logs: AdminActivityLogRecord[];
  onRefresh: () => Promise<void>;
}

const ACTION_LABELS: Record<string, string> = {
  APPROVE_TEACHER: "Phê duyệt giáo viên",
  REJECT_TEACHER: "Từ chối giáo viên",
  LOCK_TEACHER: "Khóa giáo viên",
  UNLOCK_TEACHER: "Mở khóa giáo viên",
  UPDATE_TEACHER: "Cập nhật giáo viên",
  ARCHIVE_TEACHER: "Lưu trữ giáo viên",
  DELETE_TEACHER: "Xóa vĩnh viễn giáo viên",
  UPDATE_EXAM: "Cập nhật đề thi",
  DELETE_EXAM: "Xóa / lưu trữ đề thi",
  CREATE_FOLDER: "Tạo thư mục",
  UPDATE_FOLDER: "Cập nhật thư mục",
  DELETE_FOLDER: "Xóa thư mục",
  CHANGE_SUPER_ADMIN_PASSWORD: "Đổi mật khẩu Super Admin",
};

export function AdminAuditLogsTab({ logs, onRefresh }: AdminAuditLogsTabProps) {
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("ALL");
  const [detailLog, setDetailLog] = useState<AdminActivityLogRecord | null>(null);

  const uniqueActions = useMemo(() => {
    const set = new Set<string>(Object.keys(ACTION_LABELS));
    for (const l of logs) {
      if (l.action) set.add(l.action);
    }
    return Array.from(set);
  }, [logs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((l) => {
      if (actionFilter !== "ALL" && l.action !== actionFilter) return false;
      if (!q) return true;
      return (
        String(l.actor_email || "").toLowerCase().includes(q) ||
        String(l.action || "").toLowerCase().includes(q) ||
        String(l.target_label || "").toLowerCase().includes(q) ||
        String(l.summary || "").toLowerCase().includes(q)
      );
    });
  }, [logs, actionFilter, query]);

  return (
    <div className="space-y-4">
      <Card className="p-4 border shadow-none flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-2">
            <ShieldCheck className="size-4 text-emerald-600" />
            <span>Nhật ký bất biến (Chỉ đọc)</span>
          </div>

          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-60">
              <SelectValue placeholder="Lọc theo hành động" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tất cả hành động</SelectItem>
              {uniqueActions.map((act) => (
                <SelectItem key={act} value={act}>
                  {ACTION_LABELS[act] || act}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button size="sm" variant="outline" onClick={onRefresh}>
            <RefreshCw className="size-3.5 mr-1.5" /> Tải mới
          </Button>
        </div>

        <div className="relative w-full md:w-72">
          <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm đối tượng, tóm tắt, email..."
            className="pl-9"
          />
        </div>
      </Card>

      <Card className="border shadow-none overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Thời gian</TableHead>
                <TableHead>Người thực hiện</TableHead>
                <TableHead>Hành động</TableHead>
                <TableHead>Đối tượng</TableHead>
                <TableHead>Tóm tắt thay đổi</TableHead>
                <TableHead className="text-right">Chi tiết</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-sm">
                    Chưa có bản ghi nhật ký hoạt động nào trong cơ sở dữ liệu.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                      {new Date(l.created_at).toLocaleString("vi-VN")}
                    </TableCell>
                    <TableCell className="text-sm">{l.actor_email}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{ACTION_LABELS[l.action] || l.action}</Badge>
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {l.target_label || l.target_id || l.target_type}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate">
                      {l.summary || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setDetailLog(l)} title="Xem dữ liệu trước/sau">
                        <Eye className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={!!detailLog} onOpenChange={(o) => !o && setDetailLog(null)}>
        <DialogContent className="font-times-new-roman max-w-2xl">
          <DialogHeader>
            <DialogTitle>Chi tiết nhật ký hoạt động</DialogTitle>
            <DialogDescription>
              {detailLog && (ACTION_LABELS[detailLog.action] || detailLog.action)} —{" "}
              {detailLog && new Date(detailLog.created_at).toLocaleString("vi-VN")}
            </DialogDescription>
          </DialogHeader>
          {detailLog && (
            <ScrollArea className="max-h-[60vh] pr-2">
              <div className="space-y-3 text-sm">
                <div className="p-3 rounded-lg border bg-muted/20 space-y-1">
                  <div>
                    <strong>Người thực hiện:</strong> {detailLog.actor_email}
                  </div>
                  <div>
                    <strong>Đối tượng:</strong> {detailLog.target_type} ({detailLog.target_label || detailLog.target_id || "—"})
                  </div>
                  <div>
                    <strong>Tóm tắt:</strong> {detailLog.summary || "—"}
                  </div>
                </div>

                {detailLog.before_data && (
                  <div className="space-y-1">
                    <div className="text-xs font-bold uppercase text-muted-foreground">Dữ liệu trước thay đổi</div>
                    <pre className="p-3 rounded-lg border bg-muted/30 text-xs overflow-x-auto">
                      {JSON.stringify(detailLog.before_data, null, 2)}
                    </pre>
                  </div>
                )}

                {detailLog.after_data && (
                  <div className="space-y-1">
                    <div className="text-xs font-bold uppercase text-muted-foreground">Dữ liệu sau thay đổi</div>
                    <pre className="p-3 rounded-lg border bg-muted/30 text-xs overflow-x-auto">
                      {JSON.stringify(detailLog.after_data, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailLog(null)}>
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
