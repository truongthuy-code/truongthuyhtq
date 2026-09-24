import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, GraduationCap } from "lucide-react";

type Subject = { id: string; name: string };

export default function ProfileCompletionGate({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, refreshProfile } = useAuth();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [busy, setBusy] = useState(false);

  const open = !!user && !loading && profile !== null && !profile.profile_completed;

  useEffect(() => {
    if (!open) return;
    supabase.from("subjects").select("id,name").order("sort_order").then(({ data }) => {
      setSubjects((data as any) || []);
    });
    setFullName(profile?.full_name || "");
    setPhone(profile?.phone || "");
    setSubjectId(profile?.subject_id || "");
    setSchoolName(profile?.school_name || "");
  }, [open, profile]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !subjectId || !schoolName.trim() || !fullName.trim()) {
      toast.error("Vui lòng điền đầy đủ họ tên, môn học và trường");
      return;
    }
    setBusy(true);
    try {
      const { data: schoolId, error: schErr } = await supabase.rpc("upsert_school", { p_name: schoolName.trim() });
      if (schErr) throw schErr;
      const subj = subjects.find((s) => s.id === subjectId);
      const { error } = await supabase.from("profiles").update({
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        subject_id: subjectId,
        subject_name: subj?.name || null,
        school_id: schoolId as any,
        school_name: schoolName.trim(),
        profile_completed: true,
      }).eq("id", user.id);
      if (error) throw error;
      toast.success("Đã cập nhật thông tin giáo viên");
      await refreshProfile();
    } catch (err: any) {
      toast.error(err.message || "Cập nhật thất bại");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {children}
      <Dialog open={open}>
        <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
          <DialogHeader>
            <div className="size-12 rounded-xl bg-gradient-primary text-primary-foreground grid place-items-center mb-2">
              <GraduationCap className="size-6" />
            </div>
            <DialogTitle>Hoàn tất hồ sơ giáo viên</DialogTitle>
            <DialogDescription>
              Vui lòng cung cấp thông tin môn học và trường công tác để hệ thống tổ chức đề thi theo cấu trúc.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <div><Label>Họ và tên *</Label><Input required value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
            <div>
              <Label>Môn học giảng dạy *</Label>
              <Select value={subjectId} onValueChange={setSubjectId}>
                <SelectTrigger><SelectValue placeholder="Chọn môn học" /></SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Tên trường công tác *</Label><Input required placeholder="VD: THPT Lê Quý Đôn" value={schoolName} onChange={(e) => setSchoolName(e.target.value)} /></div>
            <div><Label>Số điện thoại</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <Button type="submit" className="w-full bg-gradient-primary" disabled={busy}>
              {busy && <Loader2 className="size-4 mr-2 animate-spin" />} Lưu thông tin
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
