"use client";

import { useState, useSyncExternalStore } from "react";
import { cn } from "@/components/ui";
import { Sidebar } from "./sidebar";
import { MobileNavDrawer, Topbar } from "./topbar";

const KEY = "pyt.sidebar.collapsed";
const listeners = new Set<() => void>();
function readCollapsed() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
function setCollapsed(v: boolean) {
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {
    /* storage unavailable: state just won't persist */
  }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

export function WorkspaceShell({
  user,
  roleLabel,
  permissions,
  aiMode,
  children,
}: {
  user: { name: string; email: string };
  roleLabel: string;
  permissions: string[];
  aiMode: "live" | "mock";
  children: React.ReactNode;
}) {
  const [menu, setMenu] = useState(false);
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);
  return (
    <div className="min-h-screen">
      <aside className={cn("fixed inset-y-0 left-0 z-40 hidden transition-[width] duration-200 lg:block", collapsed ? "w-[72px]" : "w-60")}>
        <Sidebar permissions={permissions} aiMode={aiMode} collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      </aside>
      <MobileNavDrawer open={menu} onClose={() => setMenu(false)}>
        <Sidebar permissions={permissions} aiMode={aiMode} onNavigate={() => setMenu(false)} />
      </MobileNavDrawer>
      <div className={cn("flex min-h-screen flex-col transition-[padding] duration-200", collapsed ? "lg:pl-[72px]" : "lg:pl-60")}>
        <Topbar user={user} roleLabel={roleLabel} onMenu={() => setMenu(true)} />
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
