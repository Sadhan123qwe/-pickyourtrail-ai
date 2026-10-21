import { ShieldAlert } from "lucide-react";

export function ForbiddenPanel({ area }: { area: string }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-border bg-surface p-8 text-center">
      <ShieldAlert className="mx-auto h-8 w-8 text-warning" aria-hidden />
      <h1 className="mt-3 text-lg font-semibold">No access to {area}</h1>
      <p className="mt-1 text-sm text-muted">Your role doesn&apos;t include this area. Ask an administrator if you need access.</p>
    </div>
  );
}
