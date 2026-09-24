import { NavLink, useLocation } from "react-router-dom";
import { GraduationCap, LayoutDashboard, FileText, Users, BarChart3, BookOpen, FolderTree, Shuffle, LogOut } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

const items = [
  { title: "Trang chủ", url: "/", icon: LayoutDashboard },
  { title: "Kho đề thi (Tree)", url: "/library", icon: FolderTree },
  { title: "Quản lý môn học", url: "/subjects", icon: BookOpen },
  { title: "Danh sách đề thi", url: "/exams", icon: FileText },
  { title: "Xáo đề kiểm tra", url: "/shuffle", icon: Shuffle },
  { title: "Quản lý học sinh", url: "/students", icon: Users },
  { title: "Kết quả & Báo cáo", url: "/reports", icon: BarChart3 },
  { title: "Cổng học sinh", url: "/student", icon: GraduationCap },
];

export default function AppSidebar() {
  const { state } = useSidebar();
  const { pathname } = useLocation();
  const { user, profile, isAdmin, signOut } = useAuth();
  const collapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="border-b">
        <div className="flex items-center gap-3 px-2 py-3">
          <div className="size-10 rounded-xl bg-gradient-primary grid place-items-center text-primary-foreground shadow-soft shrink-0">
            <GraduationCap className="size-5" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="font-bold text-sm leading-tight text-primary uppercase truncate">Tạo đề trắc nghiệm</div>
              <div className="text-[11px] text-muted-foreground truncate">
                {profile?.full_name || user?.email} {profile?.school_name ? `– ${profile.school_name}` : ""}
              </div>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel>Menu</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((it) => {
                const active = pathname === it.url || (it.url !== "/" && pathname.startsWith(it.url));
                return (
                  <SidebarMenuItem key={it.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={it.title}
                      className={`rounded-xl h-11 transition-all duration-200 ${
                        active
                          ? "bg-gradient-primary text-primary-foreground shadow-soft hover:opacity-95 data-[active=true]:bg-gradient-primary data-[active=true]:text-primary-foreground"
                          : "hover:bg-sidebar-accent hover:translate-x-0.5"
                      }`}
                    >
                      <NavLink to={it.url} className="flex items-center gap-3">
                        <it.icon className="size-5 shrink-0" />
                        {!collapsed && <span className="truncate font-medium">{it.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="size-9 rounded-full bg-gradient-primary grid place-items-center text-primary-foreground text-sm font-semibold shrink-0">
            {(profile?.full_name?.[0] || user?.email?.[0] || "U").toUpperCase()}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium truncate">{profile?.full_name || user?.email}</div>
              <div className="text-[10px] text-muted-foreground">{isAdmin ? "Quản trị viên" : (profile?.subject_name || "Giáo viên")}</div>
            </div>
          )}
          {!collapsed && (
            <Button variant="ghost" size="icon" onClick={signOut} title="Đăng xuất">
              <LogOut className="size-4" />
            </Button>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
