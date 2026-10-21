"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { Alert, Button, Card, Field, Input } from "@/components/ui";

const DEMO_ACCOUNTS = [
  { label: "Customer", email: "customer@pyt-demo.test" },
  { label: "Sales", email: "sales@pyt-demo.test" },
  { label: "Support", email: "support@pyt-demo.test" },
  { label: "Operations", email: "ops@pyt-demo.test" },
  { label: "Admin", email: "admin@pyt-demo.test" },
];

function safeNext(next: string | null, fallback: string) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reason = params.get("reason");

  async function submit(email = form.email, password = form.password) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ user: { role: string } }>(mode === "login" ? "/api/auth/login" : "/api/auth/signup", {
        body: mode === "login" ? { email, password } : { ...form, phone: form.phone || undefined },
      });
      const fallback = res.user.role === "customer" ? "/trips" : "/admin";
      router.push(safeNext(params.get("next"), fallback));
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <Card className="p-6">
        <h1 className="text-xl font-semibold">{mode === "login" ? "Sign in" : "Create your account"}</h1>
        <p className="mt-1 text-sm text-muted">
          {mode === "login" ? "Trips you planned in this browser are added to your account." : "Save trips across devices and track support requests."}
        </p>
        {reason === "employee" && (
          <Alert tone="amber" className="mt-4">
            The employee portal needs an employee account. Use one of the demo staff accounts below.
          </Alert>
        )}
        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {mode === "signup" && (
            <Field label="Full name" htmlFor="name">
              <Input id="name" autoComplete="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
          )}
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Password" htmlFor="password" hint={mode === "signup" ? "At least 8 characters" : undefined}>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={mode === "signup" ? 8 : 1}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
          {mode === "signup" && (
            <Field label="Phone (optional)" htmlFor="phone">
              <Input id="phone" type="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
          )}
          {error && <Alert tone="red">{error}</Alert>}
          <Button type="submit" className="w-full" loading={busy}>
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted">
          {mode === "login" ? (
            <>
              New here?{" "}
              <Link href="/signup" className="font-medium text-primary hover:underline">
                Create an account
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-primary hover:underline">
                Sign in
              </Link>
            </>
          )}
        </p>
      </Card>
      {mode === "login" && (
        <Card className="mt-4 p-5">
          <h2 className="text-sm font-semibold">Demo accounts</h2>
          <p className="mt-1 text-xs text-muted">
            Seeded for this prototype only. Password for all: <code className="rounded bg-surface-muted px-1">demo1234</code>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {DEMO_ACCOUNTS.map((a) => (
              <Button key={a.email} variant="secondary" size="sm" disabled={busy} onClick={() => submit(a.email, "demo1234")}>
                {a.label}
              </Button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
