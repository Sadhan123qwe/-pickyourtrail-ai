"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell, LogOut, Menu, Search, Sparkles, X } from "lucide-react";
import { api, useApi } from "@/lib/client/api";
import { useDebounced } from "@/lib/client/format";
import { cn } from "@/components/ui";

interface Notifications {
  items: { id: string; severity: "high" | "medium" | "info"; title: string; href: string }[];
  ai: { mode: "live" | "mock"; requestsLastHour: number; liveRequestsLastHour: number; toolCallsLastHour: number; failuresToday: number; pendingApprovals: number };
}
interface SearchResult {
  groups: { type: string; label: string; items: { id: string; title: string; subtitle: string; href: string }[] }[];
}

function useOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onOutside();
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ref, onOutside]);
}

function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const dq = useDebounced(q.trim(), 250);
  const { data, loading } = useApi<SearchResult>(dq.length >= 2 ? `/api/search?q=${encodeURIComponent(dq)}` : null);
  useOutside(box, () => setOpen(false));
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target as HTMLElement).closest("input, textarea, select")) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);
  const flat = data?.groups.flatMap((g) => g.items) ?? [];
  return (
    <div ref={box} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        ref={input}
        type="search"
        aria-label="Search leads, customers, trips, tickets and documents"
        placeholder="Search leads, customers, trips, tickets…  ( / )"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && flat[0]) {
            router.push(flat[0].href);
            setOpen(false);
          }
        }}
        className="h-9 w-full rounded-lg border border-border bg-surface-muted/80 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-primary focus:bg-surface focus:outline-none focus:ring-2 focus:ring-ring/40"
      />
      {open && dq.length >= 2 && (
        <div className="absolute left-0 right-0 top-11 z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-surface shadow-xl" role="listbox">
          {loading && !data && <p className="px-4 py-3 text-sm text-muted">Searching…</p>}
          {data && data.groups.length === 0 && <p className="px-4 py-3 text-sm text-muted">No matches you have access to.</p>}
          {data?.groups.map((g) => (
            <div key={g.type} className="py-1">
              <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{g.label}</p>
              {g.items.map((i) => (
                <Link key={i.id} href={i.href} onClick={() => setOpen(false)} className="block px-4 py-2 hover:bg-surface-muted" role="option" aria-selected={false}>
                  <span className="block text-sm text-foreground">{i.title}</span>
                  <span className="block text-xs capitalize text-muted">{i.subtitle}</span>
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Topbar({ user, roleLabel, onMenu }: { user: { name: string; email: string }; roleLabel: string; onMenu: () => void }) {
  const router = useRouter();
  const [bellOpen, setBellOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const bell = useRef<HTMLDivElement>(null);
  useOutside(bell, () => setBellOpen(false));
  // Notifications are database counts only (no AI call); refresh every 30s.
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const { data } = useApi<Notifications>(`/api/notifications?t=${tick}`);
  const ai = data?.ai;
  const urgent = data?.items.filter((i) => i.severity === "high").length ?? 0;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/80 bg-surface/85 px-4 backdrop-blur-md lg:px-6">
      <button onClick={onMenu} className="rounded-md p-1.5 text-muted hover:bg-surface-muted lg:hidden" aria-label="Open navigation">
        <Menu className="h-5 w-5" />
      </button>
      <div className="hidden shrink-0 items-center gap-2 border-r border-border pr-4 xl:flex">
        <span className="rounded-full bg-lavender-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">Enterprise</span>
        <span className="whitespace-nowrap text-sm font-medium text-foreground">Operations workspace</span>
      </div>
      <GlobalSearch />
      <div className="ml-auto flex items-center gap-1 sm:gap-3">
        <Link
          href="/admin/command-center"
          className="hidden shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-border bg-surface px-2.5 py-1.5 text-xs hover:bg-lavender-surface sm:flex"
          title={ai ? `AI mode: ${ai.mode}. ${ai.requestsLastHour} AI requests and ${ai.toolCallsLastHour} tool calls in the last hour; ${ai.failuresToday} fallbacks today.` : "AI activity"}
        >
          <span className={cn("h-2 w-2 rounded-full", ai?.mode === "live" ? "bg-ai ring-1 ring-nav-deep/20" : "bg-[#f5b94a]", (ai?.toolCallsLastHour ?? 0) > 0 && "pulse-dot")} aria-hidden />
          <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden />
          <span className="text-muted">{ai ? `${ai.mode === "live" ? "Live AI" : "Demo AI"} · ${ai.toolCallsLastHour} actions/h` : "AI"}</span>
          {ai && ai.pendingApprovals > 0 && <span className="rounded-full bg-warning-soft px-1.5 font-medium text-warning">{ai.pendingApprovals} to approve</span>}
        </Link>
        <div ref={bell} className="relative">
          <button onClick={() => setBellOpen((o) => !o)} className="relative rounded-md p-2 text-muted hover:bg-surface-muted" aria-label={`Notifications (${data?.items.length ?? 0})`} aria-expanded={bellOpen}>
            <Bell className="h-5 w-5" />
            {(data?.items.length ?? 0) > 0 && (
              <span className={cn("absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white", urgent ? "bg-tomato" : "bg-nav-deep")}>{data!.items.length}</span>
            )}
          </button>
          {bellOpen && (
            <div className="absolute right-0 top-11 z-50 w-80 rounded-xl border border-border bg-surface shadow-xl">
              <p className="border-b border-border px-4 py-2.5 text-sm font-semibold">Notifications</p>
              {!data?.items.length ? (
                <p className="px-4 py-6 text-center text-sm text-muted">You&apos;re all caught up.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.items.map((n) => (
                    <li key={n.id}>
                      <Link href={n.href} onClick={() => setBellOpen(false)} className="flex items-start gap-2 px-4 py-3 text-sm hover:bg-surface-muted">
                        <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.severity === "high" ? "bg-danger" : n.severity === "medium" ? "bg-warning" : "bg-primary")} aria-hidden />
                        {n.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 border-l border-border pl-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-lavender text-xs font-semibold text-nav-deep" aria-hidden>
            {user.name
              .split(" ")
              .map((p) => p[0])
              .slice(0, 2)
              .join("")}
          </span>
          <span className="hidden max-w-[140px] whitespace-nowrap leading-tight xl:block">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            <span className="block text-[11px] text-muted">{roleLabel}</span>
          </span>
          <button
            onClick={async () => {
              await api("/api/auth/logout", { method: "POST" }).catch(() => null);
              router.push("/login");
              router.refresh();
            }}
            className="rounded-md p-2 text-muted hover:bg-surface-muted"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}

export function MobileNavDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
      <div className="absolute inset-0 bg-nav-deep/50" onClick={onClose} />
      <div className="absolute inset-y-0 left-0 w-72 shadow-2xl">
        <button onClick={onClose} className="absolute right-3 top-4 z-10 rounded p-1 text-nav-text hover:text-white" aria-label="Close navigation">
          <X className="h-5 w-5" />
        </button>
        {children}
      </div>
    </div>
  );
}
