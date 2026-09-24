import { NavLink, useLocation } from "react-router-dom";
import { GraduationCap, LayoutDashboard, FileText, Users, BarChart3, BookOpen, FolderTree, Shuffle, ShieldCheck } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";
import { UserAvatarMenu } from "./UserAvatarMenu";

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
  const { user, profile, isAdmin } = useAuth();
  const collapsed = state === "collapsed";

  const allMenuItems = isAdmin
    ? [{ title: "Quản trị Admin", url: "/admin", icon: ShieldCheck }, ...items]
    : items;

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
              {allMenuItems.map((it) => {
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

      <SidebarFooter className="border-t p-2">
        <UserAvatarMenu collapsed={collapsed} />
      </SidebarFooter>
    </Sidebar>
  );
}
