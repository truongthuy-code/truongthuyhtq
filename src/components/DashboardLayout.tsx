import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import AppSidebar from "./AppSidebar";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-[hsl(210,25%,97%)]">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center justify-between border-b bg-background/80 backdrop-blur sticky top-0 z-20 px-3">
            <div className="flex items-center">
              <SidebarTrigger />
              <div className="ml-3 text-xs md:text-sm text-muted-foreground font-medium truncate">
                Tác giả: <span className="font-semibold text-foreground">Trương Thị Bích Thủy – THPT Phan Bội Châu - TP Đà Nẵng</span>
              </div>
            </div>
            <div className="hidden sm:block text-[11px] text-muted-foreground bg-muted/60 px-2.5 py-1 rounded-full">
              Hệ thống Tạo đề trắc nghiệm Online
            </div>
          </header>
          <main className="flex-1 min-w-0 animate-fade-in">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
