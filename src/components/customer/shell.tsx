"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Compass, Home, LifeBuoy, LogIn, LogOut, Luggage, MapPinned, Menu, Plane, Plus, Search, Sparkles, UserRound, X } from "lucide-react";
import { api, useApi } from "@/lib/client/api";
import { cn } from "@/components/ui";

interface User {
  name: string;
  email: string;
  role: string;
}

const NAV = [
  { href: "/", label: "Home", icon: Home, exact: true },
  { href: "/plan", label: "AI Trip Planner", icon: Sparkles },
  { href: "/trips", label: "My Trips", icon: Luggage },
  { href: "/destinations", label: "Destinations", icon: MapPinned },
  { href: "/support", label: "Support", icon: LifeBuoy },
  { href: "/account", label: "Profile & settings", icon: UserRound },
];

const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("flex h-8 w-8 items-center justify-center rounded-xl bg-lavender text-nav-deep shadow-[inset_0_-2px_0_rgba(23,21,47,0.12)]", className)}>
      <Compass className="h-[18px] w-[18px]" aria-hidden />
    </span>
  );
}

function CustomerSidebar({ user, onNavigate }: { user: User | null; onNavigate?: () => void }) {
  const path = usePathname();
  const router = useRouter();
  const trips = useApi<{ items: { id: string; title: string; status: string; itinerary_id: string | null }[] }>("/api/trips");
  const recent = (trips.data?.items ?? []).filter((t) => t.status !== "cancelled").slice(0, 3);
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-gradient-to-b from-nav to-[#221d42] text-nav-text">
      <div className="pointer-events-none absolute -right-16 top-24 h-48 w-48 rounded-full bg-lavender/10 blur-3xl" aria-hidden />
      <Link href="/" onClick={onNavigate} className="relative flex items-center gap-2.5 px-5 pb-4 pt-5 text-white" aria-label="Pickyourtrail home">
        <BrandMark />
        <span className="leading-tight">
          <span className="block text-[15px] font-semibold">Pickyourtrail</span>
          <span className="block text-[11px] text-nav-muted">AI travel planner</span>
        </span>
      </Link>
      <div className="relative px-3">
        <Link
          href="/plan?new=1"
          onClick={onNavigate}
          className="flex h-10 items-center justify-center gap-2 rounded-xl bg-ai text-sm font-semibold text-nav-deep shadow-[0_6px_18px_-8px_rgba(212,255,63,0.7)] hover:bg-ai-hover"
        >
          <Plus className="h-4 w-4" aria-hidden /> Plan a new trip
        </Link>
      </div>
      <nav aria-label="Main" className="relative mt-4 space-y-0.5 px-3">
        {NAV.map((item) => {
          const active = item.exact ? path === item.href : path.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                active ? "bg-nav-active font-medium text-white shadow-[inset_3px_0_0_var(--lavender)]" : "hover:bg-nav-hover hover:text-white",
              )}
            >
              <Icon className={cn("h-4 w-4", active ? "text-ai" : "text-nav-muted")} aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
      {recent.length > 0 && (
        <div className="relative mt-5 px-3">
          <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-nav-muted">Recent trips</p>
          <ul className="mt-1.5 space-y-0.5">
            {recent.map((t) => (
              <li key={t.id}>
                <Link
                  href={t.itinerary_id ? `/trips/${t.id}/itinerary` : `/plan?trip=${t.id}`}
                  onClick={onNavigate}
                  className="flex items-center gap-2 truncate rounded-lg px-3 py-1.5 text-[13px] hover:bg-nav-hover hover:text-white"
                  title={t.title}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-lavender" aria-hidden />
                  <span className="truncate">{t.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="relative mt-auto space-y-3 p-4">
        <div className="glass-dark relative overflow-hidden rounded-2xl p-3 text-[12px]">
          <Plane className="absolute -right-1 -top-1 h-12 w-12 rotate-12 text-lavender/15" aria-hidden />
          <p className="font-medium text-white">Real experts, real bookings</p>
          <p className="mt-0.5 text-nav-muted">A travel expert confirms every booking — nothing is booked without you.</p>
        </div>
        {user ? (
          <div className="glass-dark flex items-center gap-2.5 rounded-xl p-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-lavender text-xs font-semibold text-nav-deep">{initials(user.name)}</span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13px] font-medium text-white">{user.name}</span>
              <span className="block truncate text-[11px] text-nav-muted">{user.email}</span>
            </span>
            <button
              onClick={async () => {
                await api("/api/auth/logout", { method: "POST" }).catch(() => null);
                router.push("/");
                router.refresh();
              }}
              className="rounded-md p-1.5 text-nav-muted hover:bg-nav-hover hover:text-white"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="glass-dark rounded-xl p-3 text-[13px]">
            <p className="text-white">Planning as a guest</p>
            <p className="mt-0.5 text-[11px] text-nav-muted">Trips are saved in this browser. Sign in to keep them everywhere.</p>
            <Link href="/login" onClick={onNavigate} className="mt-2 inline-flex items-center gap-1.5 font-medium text-lavender hover:text-white">
              <LogIn className="h-3.5 w-3.5" aria-hidden /> Sign in or create account
            </Link>
          </div>
        )}
        {user && user.role !== "customer" ? (
          <Link href="/admin" className="block text-[11px] text-nav-muted hover:text-white">
            Open operations workspace ↗
          </Link>
        ) : (
          <Link href="/login?next=/admin" className="block text-[11px] text-nav-muted hover:text-white">
            Staff sign-in
          </Link>
        )}
      </div>
    </div>
  );
}

/** Compact desktop top bar: destination search, quick actions and the traveller. */
function CustomerTopbar({ user }: { user: User | null }) {
  const router = useRouter();
  const path = usePathname();
  const [q, setQ] = useState("");
  return (
    <header className="sticky top-0 z-20 hidden h-14 items-center gap-3 border-b border-border/80 bg-surface/80 px-6 backdrop-blur-md lg:flex">
      <span className="whitespace-nowrap rounded-full bg-lavender-surface px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary">Traveller workspace</span>
      <form
        role="search"
        className="relative w-full max-w-sm"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/destinations${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search destinations, beaches, culture…"
          aria-label="Search destinations"
          className="h-9 w-full rounded-xl border border-border bg-surface-muted/80 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-primary focus:bg-surface focus:outline-none focus:ring-2 focus:ring-ring/40"
        />
      </form>
      <div className="ml-auto flex items-center gap-2">
        {path !== "/plan" && (
          <Link href="/plan?new=1" className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl bg-ai px-3 text-[13px] font-semibold text-nav-deep hover:bg-ai-hover">
            <Sparkles className="h-4 w-4" aria-hidden /> Plan with AI
          </Link>
        )}
        <Link href="/support" className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:bg-surface-muted hover:text-foreground" aria-label="Support" title="Support">
          <LifeBuoy className="h-[18px] w-[18px]" />
        </Link>
        {user ? (
          <Link href="/account" className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 hover:bg-surface-muted" title="Profile & settings">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-lavender text-xs font-semibold text-nav-deep">{initials(user.name)}</span>
            <span className="hidden whitespace-nowrap text-[13px] font-medium xl:block">{user.name.split(" ")[0]}</span>
          </Link>
        ) : (
          <Link href="/login" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-[13px] font-medium hover:bg-surface-muted">
            <LogIn className="h-4 w-4" aria-hidden /> Sign in
          </Link>
        )}
      </div>
    </header>
  );
}

function CustomerFooter() {
  return (
    <footer className="mt-6 border-t border-border/80 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <BrandMark className="h-7 w-7" />
          <div className="leading-tight">
            <p className="text-[13px] font-semibold">Pickyourtrail AI</p>
            <p className="text-[11px] text-muted">Plan with AI · book with experts</p>
          </div>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
          <Link href="/plan" className="hover:text-foreground">AI Trip Planner</Link>
          <Link href="/destinations" className="hover:text-foreground">Destinations</Link>
          <Link href="/trips" className="hover:text-foreground">My Trips</Link>
          <Link href="/support" className="hover:text-foreground">Help &amp; support</Link>
          <Link href="/login?next=/admin" className="hover:text-foreground">Staff sign-in</Link>
        </nav>
      </div>
      <p className="mt-4 text-[11px] text-muted">
        Interview prototype · Prices are estimates from demo data · Policies are sample content, not official Pickyourtrail terms · Nothing is booked or charged. Destination photos: Unsplash.
      </p>
    </footer>
  );
}

export function CustomerShell({ user, children }: { user: User | null; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 lg:block">
        <CustomerSidebar user={user} />
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-nav-deep/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 shadow-2xl">
            <button onClick={() => setOpen(false)} className="absolute right-3 top-4 z-10 rounded p-1 text-nav-text hover:text-white" aria-label="Close navigation">
              <X className="h-5 w-5" />
            </button>
            <CustomerSidebar user={user} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
      <div className="flex min-h-screen flex-col lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-white/10 bg-nav px-4 text-white lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded-md p-1.5 hover:bg-white/10" aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </button>
          <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold">
            <BrandMark className="h-7 w-7" /> Pickyourtrail
          </Link>
          {path !== "/plan" && (
            <Link href="/plan?new=1" className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-xl bg-ai px-3 text-[13px] font-semibold text-nav-deep">
              <Sparkles className="h-3.5 w-3.5" aria-hidden /> Plan
            </Link>
          )}
        </header>
        <CustomerTopbar user={user} />
        <main className="flex-1">{children}</main>
        {path !== "/plan" && <CustomerFooter />}
      </div>
    </div>
  );
}
