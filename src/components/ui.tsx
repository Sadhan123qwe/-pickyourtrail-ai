"use client";

import Link from "next/link";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Check, ChevronRight, Inbox, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

/* ==========================================================================
 * Pickyourtrail design system — shared primitives.
 * Sizes follow a 4px scale: controls 32/36/44px, radii 8/12px, compact type.
 * ========================================================================== */

export function cn(...inputs: (string | false | null | undefined)[]) {
  return twMerge(clsx(inputs));
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "ai";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-nav-deep text-white hover:bg-[#2b2752] shadow-[0_1px_2px_rgba(23,21,47,0.25)]",
  ai: "bg-ai text-nav-deep font-semibold border border-nav-deep/10 hover:bg-ai-hover shadow-[0_1px_2px_rgba(74,100,0,0.25)]",
  secondary: "bg-surface text-foreground border border-border hover:bg-surface-muted",
  ghost: "text-foreground hover:bg-surface-muted",
  danger: "bg-surface text-danger border border-danger/30 hover:bg-danger-soft",
};
const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "h-11 px-5 text-[15px] gap-2",
};

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-xl font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={cn("inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-muted hover:text-foreground disabled:opacity-40", className)} {...props}>
      {children}
    </button>
  );
}

/** Primary reading surface: nearly opaque glass. */
export function Card({ className, children, ...props }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("surface rounded-2xl", className)} {...props}>
      {children}
    </div>
  );
}

/** Secondary panel: lighter translucent glass. Never use for dense tables or forms. */
export function GlassPanel({ className, children, ...props }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("glass rounded-2xl", className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

type Tone = "neutral" | "blue" | "green" | "amber" | "red" | "violet" | "teal";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-muted text-slate-600 border-border",
  blue: "bg-primary-soft text-primary border-primary/15",
  green: "bg-success-soft text-success border-success/15",
  amber: "bg-warning-soft text-warning border-warning/20",
  red: "bg-danger-soft text-danger border-tomato/40",
  violet: "bg-lavender-surface text-primary border-lavender/60",
  teal: "bg-accent-soft text-accent border-accent/20",
};

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function AiBadge({ children = "AI" }: { children?: ReactNode }) {
  return (
    <Badge className="border-nav-deep/10 bg-ai text-nav-deep">
      <Sparkles className="h-3 w-3" aria-hidden /> {children}
    </Badge>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

const inputBase =
  "w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:bg-surface-muted";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputBase, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputBase, "min-h-[80px] py-2", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(inputBase, "h-9 pr-8", className)} {...props}>
      {children}
    </select>
  );
}

/** Detail panel: slide-over drawer below 2xl, sticky side column on very wide screens. */
export const DRAWER_CLASS =
  "fixed inset-y-0 right-0 z-40 w-full max-w-lg overflow-y-auto rounded-none !bg-surface shadow-2xl 2xl:sticky 2xl:top-20 2xl:z-auto 2xl:h-fit 2xl:max-h-[calc(100vh-6rem)] 2xl:max-w-none 2xl:rounded-2xl 2xl:shadow-none";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}
    </span>
  );
}

export function TypingIndicator({ label = "AI is thinking" }: { label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span key={i} className="typing-dot h-1.5 w-1.5 rounded-full bg-primary" />
      ))}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} aria-hidden />;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={i % 2 ? "w-2/3" : "w-full"} />
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-3 rounded-full bg-surface-muted p-3 text-muted">{icon ?? <Inbox className="h-5 w-5" />}</div>
      <p className="font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const message = error instanceof Error ? error.message : "Something went wrong";
  const status = (error as { status?: number })?.status;
  return (
    <div role="alert" className={cn("flex flex-col items-center text-center", compact ? "p-4" : "px-6 py-10")}>
      <AlertTriangle className="mb-2 h-5 w-5 text-danger" aria-hidden />
      <p className="font-medium text-foreground">{status === 403 ? "Access denied" : status === 401 ? "Please sign in" : "Couldn't load this"}</p>
      <p className="mt-1 max-w-md text-[13px] text-muted">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </Button>
      )}
    </div>
  );
}

export function Alert({ tone = "blue", title, children, className }: { tone?: "blue" | "green" | "amber" | "red" | "teal"; title?: string; children?: ReactNode; className?: string }) {
  const styles = {
    blue: "border-primary/20 bg-primary-soft/80 text-slate-800",
    green: "border-success/20 bg-success-soft text-slate-800",
    amber: "border-warning/30 bg-warning-soft text-slate-800",
    red: "border-danger/25 bg-danger-soft text-slate-800",
    teal: "border-accent/25 bg-accent-soft text-slate-800",
  }[tone];
  return (
    <div role={tone === "red" ? "alert" : "status"} className={cn("rounded-lg border px-3.5 py-2.5 text-[13px]", styles, className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not([aria-label='Close'])")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-nav-deep/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cn("max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-surface shadow-2xl sm:rounded-2xl", wide ? "sm:max-w-2xl" : "sm:max-w-md")}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-5 py-3.5">
          <h2 id={titleId} className="text-[15px] font-semibold">
            {title}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface-muted" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cn("flex gap-1 overflow-x-auto border-b border-border", className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
            value === t.value ? "border-nav-deep text-foreground" : "border-transparent text-muted hover:text-foreground",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className={cn("ml-1.5 rounded-full px-1.5 text-[11px]", value === t.value ? "bg-lavender-surface text-primary" : "bg-surface-muted text-muted")}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Segmented control for compact filters (status views, date ranges). */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-0.5 rounded-xl border border-border bg-lavender-surface/70 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("rounded-lg px-2.5 py-1 text-[13px] font-medium transition-colors", value === o.value ? "bg-nav-deep text-white shadow-sm" : "text-muted hover:text-foreground")}
        >
          {o.label}
          {o.count !== undefined && <span className="ml-1 text-[11px] text-muted">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-1.5">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
        {items.map((c, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3" aria-hidden />}
            {c.href ? (
              <Link href={c.href} className="hover:text-foreground">
                {c.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-slate-600">
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageHeader({ title, description, actions, eyebrow, breadcrumbs }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; breadcrumbs?: Crumb[] }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
        {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Metric card. `delta` compares with the previous period; `invert` when lower is better. */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "blue",
  delta,
  invert,
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "blue" | "green" | "amber" | "red" | "teal";
  delta?: number | null;
  invert?: boolean;
  href?: string;
}) {
  const iconTone = { blue: "bg-primary-soft text-primary", green: "bg-success-soft text-success", amber: "bg-warning-soft text-warning", red: "bg-danger-soft text-tomato", teal: "bg-ai text-nav-deep" }[tone];
  const good = delta !== undefined && delta !== null && (invert ? delta < 0 : delta > 0);
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] text-muted">{label}</p>
        {icon && <span className={cn("rounded-lg p-1.5", iconTone)}>{icon}</span>}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <p className="text-2xl font-semibold tabular-nums text-foreground">{value}</p>
        {delta !== undefined && delta !== null && delta !== 0 && (
          <span className={cn("inline-flex items-center text-xs font-medium", good ? "text-success" : "text-danger")}>
            {delta > 0 ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />}
            {Math.abs(delta)}
            {typeof value === "string" && value.endsWith("%") ? " pts" : ""}
          </span>
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="surface block rounded-2xl p-4 transition-colors hover:border-lavender">
      {body}
    </Link>
  ) : (
    <Card className="p-4">{body}</Card>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[13px] text-muted">
      <span>{total === 0 ? "No results" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}</span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

export function DemoBadge({ label = "Demo data" }: { label?: string }) {
  return (
    <Badge tone="amber" title="Sample data for demonstration — not live">
      {label}
    </Badge>
  );
}

export function SearchInput({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder?: string; label: string }) {
  return <Input type="search" aria-label={label} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

/** Lifecycle stepper — used to separate estimate / request / pending / provider-confirmed. */
export function StatusSteps({ steps, current, failed }: { steps: { key: string; label: string; hint?: string }[]; current: string; failed?: boolean }) {
  const index = Math.max(0, steps.findIndex((s) => s.key === current));
  return (
    <ol className="flex flex-wrap items-start gap-y-2" aria-label="Status">
      {steps.map((s, i) => {
        const done = i < index;
        const active = i === index;
        return (
          <li key={s.key} className="flex min-w-0 flex-1 items-start gap-2">
            <span
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                done ? "border-nav-deep bg-ai text-nav-deep" : active ? (failed ? "border-tomato bg-danger-soft text-danger" : "border-primary bg-lavender-surface text-primary") : "border-border bg-surface text-muted",
              )}
              aria-hidden
            >
              {done ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className="min-w-0 pr-2">
              <span className={cn("block text-xs font-medium", active ? "text-foreground" : "text-muted")}>
                {s.label}
                {active && <span className="sr-only"> (current)</span>}
              </span>
              {s.hint && <span className="block text-[11px] text-muted">{s.hint}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Vertical activity timeline. */
export function Timeline({ items }: { items: { id: string; title: ReactNode; meta?: ReactNode; tone?: "blue" | "teal" | "green" | "amber" | "red" | "neutral" }[] }) {
  const dot = { blue: "bg-primary", teal: "bg-accent", green: "bg-success", amber: "bg-warning", red: "bg-danger", neutral: "bg-slate-300" };
  return (
    <ol className="space-y-3 border-l border-border pl-4">
      {items.map((i) => (
        <li key={i.id} className="relative">
          <span className={cn("absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ring-4 ring-surface", dot[i.tone ?? "blue"])} aria-hidden />
          <div className="text-[13px] text-slate-700">{i.title}</div>
          {i.meta && <p className="text-xs text-muted">{i.meta}</p>}
        </li>
      ))}
    </ol>
  );
}
