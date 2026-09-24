import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Copy, ArrowLeft, BarChart3, Trophy, StopCircle } from "lucide-react";

export default function Share() {
  const { id } = useParams();
  const [exam, setExam] = useState<any>(null);
  // Khi đang ở môi trường preview (id-preview--*.lovable.app) hoặc sandbox,
  // link sẽ yêu cầu đăng nhập workspace. Luôn dùng domain đã publish để học sinh
  // truy cập công khai (kể cả trên điện thoại) mà không cần đăng nhập.
  const PUBLISHED_ORIGIN = "https://thuy-tracnghiem.lovable.app";
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const isPreview =
    host.includes("id-preview--") ||
    host.endsWith(".lovable.dev") ||
    host.endsWith(".sandbox.lovable.dev") ||
    host === "localhost" ||
    host === "127.0.0.1";
  const origin = isPreview ? PUBLISHED_ORIGIN : window.location.origin;
  const url = `${origin}/take/${id}`;
  const lbUrl = `${origin}/leaderboard/${id}`;
  const isTeam = exam?.display_mode === "team";

  const endActivity = async () => {
    const { error } = await supabase.from("exams").update({ team_activity_ended: true } as any).eq("id", id!);
    if (error) { toast.error("Lỗi: " + error.message); return; }
    setExam({ ...exam, team_activity_ended: true });
    toast.success("Đã kết thúc hoạt động");
  };

  useEffect(() => {
    supabase.from("exams").select("*").eq("id", id!).maybeSingle().then(({ data }) => setExam(data));
  }, [id]);

  const copy = () => {
    navigator.clipboard.writeText(url);
    toast.success("Đã copy link");
  };

  if (!exam) return <div className="container py-20 text-center text-muted-foreground">Đang tải…</div>;

  return (
    <div className="min-h-screen bg-gradient-soft">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="container flex items-center justify-between py-4">
          <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Trang chủ
          </Link>
        </div>
      </header>

      <main className="container max-w-2xl py-10 space-y-6">
        <Card className="p-8 text-center">
          <div className="size-14 rounded-full bg-success/10 text-success grid place-items-center mx-auto mb-4 text-2xl">✓</div>
          <h1 className="text-2xl font-bold">Đã tạo bài thi</h1>
          <p className="text-muted-foreground mt-1">{exam.title}</p>

          <div className="mt-6 flex gap-2">
            <Input readOnly value={url} className="font-mono text-sm" />
            <Button onClick={copy}><Copy className="size-4" /></Button>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div className="bg-muted rounded-lg p-3">
              <div className="text-muted-foreground">Thời gian</div>
              <div className="font-semibold">{exam.duration_minutes} phút</div>
            </div>
            <div className="bg-muted rounded-lg p-3">
              <div className="text-muted-foreground">Số câu</div>
              <div className="font-semibold">
                {(exam.questions.partI?.length || 0) + (exam.questions.partII?.length || 0) + (exam.questions.partIII?.length || 0)}
              </div>
            </div>
            <div className="bg-muted rounded-lg p-3">
              <div className="text-muted-foreground">Số lần làm</div>
              <div className="font-semibold">{exam.max_attempts}</div>
            </div>
          </div>

          <div className="mt-6 flex gap-2 justify-center">
            <Button asChild variant="outline"><Link to={`/exam/${id}/results`}><BarChart3 className="size-4 mr-2" /> Xem kết quả</Link></Button>
            <Button asChild><Link to={`/take/${id}`}>Xem trước</Link></Button>
          </div>

          {isTeam && (
            <div className="mt-6 rounded-xl border-2 border-primary/40 bg-primary/5 p-4 text-left space-y-3">
              <div className="font-semibold flex items-center gap-2"><Trophy className="size-4 text-primary" /> Chế độ Đội/Nhóm</div>
              <div className="flex gap-2">
                <Input readOnly value={lbUrl} className="font-mono text-xs" />
                <Button variant="outline" onClick={() => { navigator.clipboard.writeText(lbUrl); toast.success("Đã copy link bảng xếp hạng"); }}>
                  <Copy className="size-4" />
                </Button>
              </div>
              <div className="flex gap-2">
                <Button asChild variant="outline" className="flex-1"><Link to={`/leaderboard/${id}`}>Mở bảng xếp hạng</Link></Button>
                <Button onClick={endActivity} disabled={!!exam.team_activity_ended} variant="destructive" className="flex-1">
                  <StopCircle className="size-4 mr-2" /> {exam.team_activity_ended ? "Đã kết thúc" : "Kết thúc hoạt động"}
                </Button>
              </div>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
