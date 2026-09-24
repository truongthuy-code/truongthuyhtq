import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { User, KeyRound, LogOut, ShieldCheck, ChevronDown } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { TeacherProfileDialog } from "./TeacherProfileDialog";
import { ChangePasswordDialog } from "./ChangePasswordDialog";

interface UserAvatarMenuProps {
  collapsed?: boolean;
}

export function UserAvatarMenu({ collapsed = false }: UserAvatarMenuProps) {
  const { user, profile, isAdmin, signOut } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);

  const displayName = profile?.full_name || user?.email || "Người dùng";
  const avatarLetter = (displayName[0] || "U").toUpperCase();
  const avatarUrl = profile?.avatar;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-muted/80 transition-colors text-left w-full outline-none focus-visible:ring-2 focus-visible:ring-primary"
            title="Tùy chọn tài khoản"
          >
            <div className="size-9 rounded-full bg-gradient-primary grid place-items-center text-primary-foreground text-sm font-semibold shrink-0 overflow-hidden shadow-sm">
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} className="size-full object-cover" />
              ) : (
                avatarLetter
              )}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold truncate flex items-center gap-1">
                  <span>{displayName}</span>
                  {isAdmin && <ShieldCheck className="size-3 text-amber-500 shrink-0" />}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {isAdmin ? "Quản trị viên (Admin)" : (profile?.subject_name ? `${profile.subject_name}` : "Giáo viên")}
                </div>
              </div>
            )}
            {!collapsed && <ChevronDown className="size-3.5 text-muted-foreground opacity-60" />}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-56 p-1">
          <DropdownMenuLabel className="font-normal px-2 py-1.5">
            <div className="text-xs font-semibold truncate">{displayName}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {profile?.email || (profile?.username ? `@${profile.username}` : user?.email)}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => setProfileOpen(true)} className="cursor-pointer gap-2 py-2">
            <User className="size-4 text-primary" />
            <span>Thông tin tài khoản</span>
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => setPwdOpen(true)} className="cursor-pointer gap-2 py-2">
            <KeyRound className="size-4 text-amber-600" />
            <span>Đổi mật khẩu</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => signOut()}
            className="cursor-pointer gap-2 py-2 text-destructive focus:text-destructive focus:bg-destructive/10"
          >
            <LogOut className="size-4" />
            <span>Đăng xuất</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <TeacherProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
      <ChangePasswordDialog open={pwdOpen} onOpenChange={setPwdOpen} />
    </>
  );
}
