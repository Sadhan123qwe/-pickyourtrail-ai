"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LifeBuoy, LogOut, Luggage, ShieldCheck, UserRound } from "lucide-react";
import { api, useApi } from "@/lib/client/api";
import { Button, Card, CardHeader, GlassPanel, PageHeader, Skeleton } from "@/components/ui";
import { useToast } from "@/components/feedback";

interface Profile {
  user: { name: string; email: string; phone: string | null; role: string } | null;
}

export function Account() {
  const router = useRouter();
  const toast = useToast();
  const me = useApi<Profile>("/api/profile");
  const trips = useApi<{ items: { status: string }[] }>("/api/trips");
  const tickets = useApi<{ items: { status: string }[] }>("/api/support/tickets");
  const user = me.data?.user;
  const activeTrips = (trips.data?.items ?? []).filter((t) => t.status !== "cancelled").length;
  const openTickets = (tickets.data?.items ?? []).filter((t) => !["resolved", "closed"].includes(t.status)).length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6">
      <PageHeader title="Profile" description="Your account, saved trips and support requests." />
      {me.loading && !me.data ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_280px]">
          <Card>
            <CardHeader title={user ? "Your account" : "Planning as a guest"} />
            <div className="p-4 text-[13px]">
              {user ? (
                <div className="flex items-start gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-soft text-base font-semibold text-primary">
                    {user.name
                      .split(" ")
                      .map((p) => p[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <dl className="grid flex-1 gap-3 sm:grid-cols-2">
                    <div>
                      <dt className="text-[11px] text-muted">Name</dt>
                      <dd className="font-medium">{user.name}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted">Email</dt>
                      <dd className="font-medium">{user.email}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted">Phone</dt>
                      <dd className="font-medium">{user.phone ?? "Not added"}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted">Account type</dt>
                      <dd className="font-medium capitalize">{user.role === "customer" ? "Traveller" : `Staff (${user.role})`}</dd>
                    </div>
                  </dl>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-slate-700">Your trips and support requests are kept in this browser. Create an account (or sign in) to keep them on every device — anything you&apos;ve planned here moves to your account automatically.</p>
                  <div className="flex flex-wrap gap-2">
                    <Link href="/signup" className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-sm font-medium text-white hover:bg-primary-hover">
                      Create account
                    </Link>
                    <Link href="/login" className="inline-flex h-9 items-center rounded-lg border border-border bg-surface px-3.5 text-sm font-medium hover:bg-surface-muted">
                      Sign in
                    </Link>
                  </div>
                </div>
              )}
            </div>
            {user && (
              <div className="flex justify-end border-t border-border/70 px-4 py-3">
                <Button
                  variant="secondary"
                  onClick={async () => {
                    await api("/api/auth/logout", { method: "POST" }).catch(() => null);
                    toast({ tone: "success", title: "Signed out" });
                    router.push("/");
                    router.refresh();
                  }}
                >
                  <LogOut className="h-4 w-4" aria-hidden /> Sign out
                </Button>
              </div>
            )}
          </Card>
          <div className="space-y-3">
            <GlassPanel className="p-4">
              <Link href="/trips" className="flex items-center justify-between gap-3 text-[13px] hover:text-primary">
                <span className="inline-flex items-center gap-2 font-medium">
                  <Luggage className="h-4 w-4 text-primary" aria-hidden /> My trips
                </span>
                <span className="tabular-nums text-muted">{trips.data ? activeTrips : "…"}</span>
              </Link>
              <Link href="/support" className="mt-3 flex items-center justify-between gap-3 text-[13px] hover:text-primary">
                <span className="inline-flex items-center gap-2 font-medium">
                  <LifeBuoy className="h-4 w-4 text-primary" aria-hidden /> Open support requests
                </span>
                <span className="tabular-nums text-muted">{tickets.data ? openTickets : "…"}</span>
              </Link>
            </GlassPanel>
            <GlassPanel className="p-4 text-xs text-muted">
              <p className="flex items-center gap-1.5 font-medium text-foreground">
                <ShieldCheck className="h-4 w-4 text-success" aria-hidden /> How your data is used
              </p>
              <p className="mt-1.5">
                Your trip preferences and conversations are shared with Pickyourtrail travel experts so they can prepare quotes and help with support. Payment details are never collected in this prototype.
              </p>
              {!user && (
                <p className="mt-2 inline-flex items-center gap-1">
                  <UserRound className="h-3.5 w-3.5" aria-hidden /> Guest session
                </p>
              )}
            </GlassPanel>
          </div>
        </div>
      )}
    </div>
  );
}
