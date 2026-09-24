import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import AppSidebar from "./AppSidebar";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-[hsl(210,25%,97%)]">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center border-b bg-background/80 backdrop-blur sticky top-0 z-20 px-3">
            <SidebarTrigger />
            <div className="ml-3 text-sm text-muted-foreground">Hệ thống quản trị</div>
          </header>
          <main className="flex-1 min-w-0 animate-fade-in">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
