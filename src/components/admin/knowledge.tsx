"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { api, errorMessage, useApi } from "@/lib/client/api";
import { formatDateTime, useDebounced } from "@/lib/client/format";
import { Alert, Badge, Button, Card, CardHeader, DRAWER_CLASS, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, SkeletonRows, Textarea, cn } from "@/components/ui";

interface Doc {
  id: string;
  title: string;
  category: string;
  audience: "public" | "internal";
  body: string;
  tags: string;
  isDemo: boolean;
  version: number;
  updated_at: string;
}

/** Approved company knowledge. The support assistant and the Command Center can only cite these documents. */
export function KnowledgeBase() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get("doc");
  const [q, setQ] = useState("");
  const [audience, setAudience] = useState("");
  const [editing, setEditing] = useState<Doc | "new" | null>(null);
  const dq = useDebounced(q).toLowerCase();
  const { data, error, loading, reload } = useApi<{ items: Doc[]; canManage: boolean }>("/api/knowledge");
  const docs = (data?.items ?? []).filter((d) => (!audience || d.audience === audience) && (!dq || `${d.title} ${d.tags} ${d.body}`.toLowerCase().includes(dq)));
  const current = data?.items.find((d) => d.id === selected);
  const select = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("doc", id);
    else next.delete("doc");
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  return (
    <>
      <PageHeader
        title="Knowledge base"
        description="Approved policies, SOPs and playbooks. AI answers are grounded only in these documents; editing a document invalidates cached answers that cited it."
        actions={
          data?.canManage && (
            <Button onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" aria-hidden /> New document
            </Button>
          )
        }
      />
      <Alert tone="amber" className="mb-4">
        Seeded documents are demonstration content written for this prototype — not official Pickyourtrail policies.
      </Alert>
      <div className={cn("grid gap-6", selected && "2xl:grid-cols-[1fr_560px]")}>
        <Card className="min-w-0">
          <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-[1fr_200px]">
            <Input type="search" aria-label="Search documents" placeholder="Search titles, tags and text" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select aria-label="Audience" value={audience} onChange={(e) => setAudience(e.target.value)}>
              <option value="">All audiences</option>
              <option value="public">Public (customers)</option>
              <option value="internal">Internal (staff only)</option>
            </Select>
          </div>
          {error ? (
            <ErrorState error={error} onRetry={reload} />
          ) : loading && !data ? (
            <SkeletonRows rows={6} />
          ) : !docs.length ? (
            <EmptyState title="No documents match" description="The AI will say it doesn't know rather than guess." />
          ) : (
            <ul className="divide-y divide-border">
              {docs.map((d) => (
                <li key={d.id}>
                  <button onClick={() => select(d.id)} className={cn("block w-full px-5 py-3 text-left hover:bg-surface-muted", selected === d.id && "bg-primary-soft/60")}>
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {d.title}
                      <Badge tone={d.audience === "internal" ? "violet" : "blue"}>{d.audience}</Badge>
                      <Badge>{d.category}</Badge>
                      {d.isDemo && <Badge tone="amber">demo</Badge>}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-sm text-muted">{d.body.replace(/^Demonstration content:[^\n]*\n+/i, "")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {selected && current && (
          <Card className={DRAWER_CLASS}>
            <CardHeader
              title={current.title}
              description={`${current.category} · ${current.audience} · v${current.version} · updated ${formatDateTime(current.updated_at)}`}
              action={
                <div className="flex gap-1">
                  {data?.canManage && (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(current)}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
                    </Button>
                  )}
                  <button onClick={() => select(null)} className="rounded p-1 text-muted hover:bg-surface-muted" aria-label="Close document">
                    <X className="h-5 w-5" />
                  </button>
                </div>
              }
            />
            <div className="whitespace-pre-line p-5 text-sm leading-relaxed text-slate-800">{current.body}</div>
          </Card>
        )}
      </div>
      {editing && (
        <DocEditor
          doc={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null);
            reload();
            select(id);
          }}
        />
      )}
    </>
  );
}

function DocEditor({ doc, onClose, onSaved }: { doc: Doc | null; onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState({ title: doc?.title ?? "", category: doc?.category ?? "Policies", audience: doc?.audience ?? "public", tags: doc?.tags ?? "", body: doc?.body ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={doc ? "Edit document" : "New document"} wide>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            const res = await api<{ document: { id: string } }>(doc ? `/api/knowledge/${doc.id}` : "/api/knowledge", { method: doc ? "PATCH" : "POST", body: f });
            onSaved(res.document.id);
          } catch (e2) {
            setErr(errorMessage(e2));
            setBusy(false);
          }
        }}
      >
        <Field label="Title" htmlFor="kb-title">
          <Input id="kb-title" required minLength={3} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor="kb-cat">
            <Input id="kb-cat" required value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
          </Field>
          <Field label="Audience" htmlFor="kb-aud">
            <Select id="kb-aud" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value as "public" | "internal" })}>
              <option value="public">Public — customers can see it</option>
              <option value="internal">Internal — staff only</option>
            </Select>
          </Field>
        </div>
        <Field label="Search tags" htmlFor="kb-tags" hint="Words customers or staff might use, e.g. refund cancel money back">
          <Input id="kb-tags" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} />
        </Field>
        <Field label="Content" htmlFor="kb-body" hint="Separate paragraphs with a blank line; answers quote the most relevant paragraph.">
          <Textarea id="kb-body" required minLength={20} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} className="min-h-[220px]" />
        </Field>
        {err && <Alert tone="red">{err}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {doc ? "Save new version" : "Publish document"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
