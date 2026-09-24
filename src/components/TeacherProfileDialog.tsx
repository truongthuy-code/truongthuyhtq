import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { User, School, BookOpen, Phone, Mail, Camera, Loader2 } from "lucide-react";
import { SUBJECT_LIST } from "@/lib/subjects";

interface TeacherProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TeacherProfileDialog({ open, onOpenChange }: TeacherProfileDialogProps) {
  const { profile, updateTeacherProfile } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [school, setSchool] = useState("");
  const [subject, setSubject] = useState("");
  const [avatar, setAvatar] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && profile) {
      setName(profile.full_name || "");
      setEmail(profile.email || "");
      setPhone(profile.phone || "");
      setSchool(profile.school_name || "");
      setSubject(profile.subject_name || "");
      setAvatar(profile.avatar || "");
    }
  }, [open, profile]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Vui lòng nhập họ và tên");
      return;
    }
    setBusy(true);
    const ok = await updateTeacherProfile({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      school: school.trim(),
      subject: subject.trim(),
      avatar: avatar.trim(),
    });
    setBusy(false);
    if (ok) {
      toast.success("Đã cập nhật thông tin cá nhân thành công");
      onOpenChange(false);
    } else {
      toast.error("Không thể lưu thay đổi");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <User className="size-5 text-primary" /> Thông tin tài khoản giáo viên
          </DialogTitle>
          <DialogDescription>
            Chỉnh sửa thông tin cá nhân. Sau khi lưu, thông tin sẽ được cập nhật ngay lập tức.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4 py-2">
          {/* Avatar Preview */}
          <div className="flex items-center gap-4 p-3 bg-muted/40 rounded-xl">
            <div className="size-16 rounded-full bg-gradient-primary grid place-items-center text-primary-foreground text-2xl font-bold overflow-hidden shadow-inner shrink-0">
              {avatar ? (
                <img src={avatar} alt={name} className="size-full object-cover" />
              ) : (
                (name[0] || "G").toUpperCase()
              )}
            </div>
            <div className="flex-1">
              <Label htmlFor="avatar-url" className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                <Camera className="size-3.5" /> URL Ảnh đại diện (tùy chọn)
              </Label>
              <Input
                id="avatar-url"
                placeholder="https://example.com/avatar.png"
                value={avatar}
                onChange={(e) => setAvatar(e.target.value)}
                className="text-xs h-9"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="t-name">Họ và tên *</Label>
              <Input
                id="t-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Cô Trương Thị Bích Thủy"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="t-user">Tên đăng nhập</Label>
              <Input
                id="t-user"
                disabled
                value={profile?.username || profile?.email || ""}
                className="bg-muted text-muted-foreground cursor-not-allowed"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="t-email" className="flex items-center gap-1">
                <Mail className="size-3.5 text-muted-foreground" /> Email
              </Label>
              <Input
                id="t-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="giaovien@school.edu.vn"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="t-phone" className="flex items-center gap-1">
                <Phone className="size-3.5 text-muted-foreground" /> Số điện thoại
              </Label>
              <Input
                id="t-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0912 345 678"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="t-school" className="flex items-center gap-1">
                <School className="size-3.5 text-muted-foreground" /> Trường học
              </Label>
              <Input
                id="t-school"
                value={school}
                onChange={(e) => setSchool(e.target.value)}
                placeholder="THPT Lê Quý Đôn"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="t-subject" className="flex items-center gap-1">
                <BookOpen className="size-3.5 text-muted-foreground" /> Môn giảng dạy
              </Label>
              <Select value={subject} onValueChange={setSubject}>
                <SelectTrigger id="t-subject">
                  <SelectValue placeholder="Chọn môn học" />
                </SelectTrigger>
                <SelectContent>
                  {SUBJECT_LIST.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                  <SelectItem value="Khác">Môn khác</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="pt-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Hủy bỏ
            </Button>
            <Button type="submit" disabled={busy} className="bg-gradient-primary">
              {busy && <Loader2 className="size-4 mr-2 animate-spin" />} Lưu thay đổi
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
