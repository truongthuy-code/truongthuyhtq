import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { FileText, Loader2 } from "lucide-react";
import { SUBJECT_LIST } from "@/lib/subjects";

export default function AuthPage() {
  const navigate = useNavigate();
  const loc = useLocation() as any;
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [busy, setBusy] = useState(false);
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);
  const redirectTo = loc.state?.from || "/";

  useEffect(() => {
    if (!loading && user) navigate(redirectTo, { replace: true });
  }, [user, loading, navigate, redirectTo]);

  useEffect(() => {
    supabase.from("subjects").select("id,name").order("sort_order").then(({ data }) => {
      setSubjects((data as any) || SUBJECT_LIST.map((n, i) => ({ id: String(i), name: n })));
    });
  }, []);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Đăng nhập thành công");
    navigate(redirectTo, { replace: true });
  };

  const signup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) { toast.error("Mật khẩu xác nhận không khớp"); return; }
    if (!fullName.trim() || !subjectName) {
      toast.error("Vui lòng điền họ tên và môn học"); return;
    }
    setBusy(true);
    const { data: sign, error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { full_name: fullName, subject_name: subjectName },
      },
    });
    if (error) { setBusy(false); toast.error(error.message); return; }

    // After signup, sign in (in case email confirmation is disabled) and persist profile
    let uid = sign.user?.id;
    if (!sign.session) {
      const { data: signIn, error: e2 } = await supabase.auth.signInWithPassword({ email, password });
      if (e2) { setBusy(false); toast.error(e2.message); return; }
      uid = signIn.user?.id;
    }
    if (uid) {
      const subj = subjects.find((s) => s.name === subjectName);
      await supabase.from("profiles").update({
        full_name: fullName.trim(),
        subject_id: subj?.id || null,
        subject_name: subjectName,
        profile_completed: false,
      }).eq("id", uid);
    }
    setBusy(false);
    toast.success("Tạo tài khoản thành công");
    navigate(redirectTo, { replace: true });
  };

  return (
    <div className="min-h-screen bg-gradient-soft grid place-items-center p-4">
      <Card className="p-8 w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 font-bold text-lg justify-center mb-6">
          <div className="size-9 rounded-lg bg-gradient-primary grid place-items-center text-primary-foreground">
            <FileText className="size-5" />
          </div>
          <span>QuizCheck — Giáo viên</span>
        </Link>

        <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="login">Đăng nhập</TabsTrigger>
            <TabsTrigger value="signup">Đăng ký</TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <form onSubmit={login} className="space-y-3 mt-4">
              <div><Label>Email</Label><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" /></div>
              <div><Label>Mật khẩu</Label><Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1" /></div>
              <Button type="submit" className="w-full bg-gradient-primary" disabled={busy}>
                {busy && <Loader2 className="size-4 mr-2 animate-spin" />} Đăng nhập
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={signup} className="space-y-3 mt-4">
              <div><Label>Họ và tên *</Label><Input required value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
              <div>
                <Label>Môn học giảng dạy *</Label>
                <Select value={subjectName} onValueChange={setSubjectName}>
                  <SelectTrigger><SelectValue placeholder="Chọn môn học" /></SelectTrigger>
                  <SelectContent>
                    {subjects.map((s) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Email *</Label><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div><Label>Mật khẩu *</Label><Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
              <div><Label>Xác nhận mật khẩu *</Label><Input type="password" required minLength={6} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></div>
              <Button type="submit" className="w-full bg-gradient-primary" disabled={busy}>
                {busy && <Loader2 className="size-4 mr-2 animate-spin" />} Đăng ký
              </Button>
            </form>
          </TabsContent>
        </Tabs>

        <div className="mt-6 pt-4 border-t text-center text-xs text-muted-foreground">
          Bạn là Học sinh?{" "}
          <Link to="/student/auth" className="text-primary font-semibold hover:underline">
            Đăng nhập / Đăng ký cổng học sinh tại đây
          </Link>
        </div>
      </Card>
    </div>
  );
}
