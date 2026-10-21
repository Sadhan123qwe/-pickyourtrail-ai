"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BookOpen, Bot, Briefcase, ChevronsLeft, ChevronsRight, LayoutDashboard, LifeBuoy, Map, PlaneTakeoff, Settings, Sparkles, Users } from "lucide-react";
import { cn } from "@/components/ui";
import { BrandMark } from "@/components/customer/shell";

export const NAV = [
  { href: "/admin", label: "Business Overview", icon: LayoutDashboard, permission: "dashboard:read" },
  { href: "/admin/command-center", label: "AI Command Center", icon: Sparkles, permission: "copilot:use", ai: true },
  { href: "/admin/leads", label: "Leads & Sales", icon: Briefcase, permission: "leads:read" },
  { href: "/admin/customers", label: "Customers", icon: Users, permission: ["leads:read", "tickets:read"] },
  { href: "/admin/trips", label: "Trips & Itineraries", icon: Map, permission: "trips:read_all" },
  { href: "/admin/bookings", label: "Booking Operations", icon: PlaneTakeoff, permission: "trips:read_all" },
  { href: "/admin/support", label: "Support Operations", icon: LifeBuoy, permission: "tickets:read" },
  { href: "/admin/copilot", label: "Employee AI Copilot", icon: Bot, permission: "copilot:use", ai: true },
  { href: "/admin/knowledge", label: "Knowledge Base", icon: BookOpen, permission: "copilot:use" },
  { href: "/admin/analytics", label: "Analytics & Reports", icon: BarChart3, permission: "analytics:read" },
  { href: "/admin/settings", label: "Settings", icon: Settings, permission: "dashboard:read" },
] as const;

export function allowed(permissions: string[], need: string | readonly string[]) {
  return typeof need === "string" ? permissions.includes(need) : need.some((n) => permissions.includes(n));
}

/** Tooltip shown beside an icon when the rail is collapsed (also exposed via aria-label). */
function RailTip({ label, show }: { label: string; show: boolean }) {
  if (!show) return null;
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-nav-deep px-2.5 py-1 text-xs font-medium text-white shadow-lg ring-1 ring-lavender/20 group-hover:block group-focus-visible:block"
    >
      {label}
    </span>
  );
}

export function Sidebar({
  permissions,
  aiMode,
  onNavigate,
  collapsed = false,
  onToggle,
}: {
  permissions: string[];
  aiMode: "live" | "mock";
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const path = usePathname();
  return (
    <div className="relative flex h-full flex-col bg-gradient-to-b from-nav to-[#221d42] text-nav-text">
      <Link href="/admin" onClick={onNavigate} className={cn("flex items-center gap-2.5 py-5 text-white", collapsed ? "justify-center px-0" : "px-5")} aria-label="Pickyourtrail operations home">
        <BrandMark />
        {!collapsed && (
          <span className="leading-tight">
            <span className="block text-sm font-semibold">Pickyourtrail</span>
            <span className="block text-[11px] text-nav-muted">Operations platform</span>
          </span>
        )}
      </Link>
      <nav aria-label="Workspace" className={cn("flex-1 space-y-0.5 pb-4", collapsed ? "px-2" : "overflow-y-auto px-3")}>
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = item.href === "/admin" ? path === "/admin" : path.startsWith(item.href);
          const base = cn("group relative flex items-center gap-3 rounded-xl py-2 text-[13px] transition-colors", collapsed ? "justify-center px-0" : "px-3");
          if (!allowed(permissions, item.permission)) {
            return (
              <span key={item.href} className={cn(base, "cursor-not-allowed text-nav-muted/50")} title={`${item.label} — not available for your role`} aria-disabled="true">
                <Icon className="h-4 w-4" aria-hidden /> {!collapsed && item.label}
                {collapsed && <span className="sr-only">{item.label} (not available for your role)</span>}
              </span>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              aria-label={collapsed ? item.label : undefined}
              className={cn(base, active ? "bg-nav-active font-medium text-white shadow-[inset_3px_0_0_var(--lavender)]" : "hover:bg-nav-hover hover:text-white")}
            >
              <Icon className={cn("h-4 w-4 shrink-0", active ? "text-lavender" : "text-nav-muted group-hover:text-nav-text")} aria-hidden />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {"ai" in item && item.ai && <span className={cn("h-1.5 w-1.5 rounded-full bg-ai", collapsed ? "absolute right-1.5 top-1.5" : "ml-auto")} aria-hidden />}
              <RailTip label={item.label} show={collapsed} />
            </Link>
          );
        })}
      </nav>
      <div className={cn("border-t border-white/10 text-xs text-nav-muted", collapsed ? "px-2 py-3" : "px-5 py-4")}>
        <p className={cn("flex items-center gap-2", collapsed && "justify-center")} title={aiMode === "live" ? "AI: live (OpenAI)" : "AI: demo mode (rules)"}>
          <span className={cn("h-2 w-2 shrink-0 rounded-full", aiMode === "live" ? "bg-ai" : "bg-[#f5b94a]")} aria-hidden />
          {collapsed ? <span className="sr-only">AI: {aiMode === "live" ? "live" : "demo mode"}</span> : <>AI: {aiMode === "live" ? "live (OpenAI)" : "demo mode (rules)"}</>}
        </p>
        {!collapsed && (
          <Link href="/" className="mt-2 block hover:text-white">
            Open customer site ↗
          </Link>
        )}
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            className={cn("group relative mt-3 flex items-center gap-2 rounded-lg py-1.5 text-nav-muted hover:bg-nav-hover hover:text-white", collapsed ? "w-full justify-center" : "-ml-2 px-2")}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" aria-hidden /> : <ChevronsLeft className="h-4 w-4" aria-hidden />}
            {!collapsed && "Collapse"}
            <RailTip label="Expand sidebar" show={collapsed} />
          </button>
        )}
      </div>
    </div>
  );
}
