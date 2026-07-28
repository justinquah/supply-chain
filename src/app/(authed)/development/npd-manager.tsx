"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, formatBytes } from "@/lib/constants";
import {
  createNpdProject,
  updateNpdProject,
  deleteNpdProject,
  setProjectSupplier,
  addVariation,
  updateVariation,
  deleteVariation,
  toggleChecklistStage,
  setStageTargetDate,
  setStageNotApplicable,
  uploadNpdDocument,
  getNpdDocUrl,
  deleteNpdDocument,
  setSpieApplicable,
} from "./actions";
import {
  NPD_STAGES,
  NPD_STATUSES,
  NPD_STATUS_LABELS,
  NPD_STATUS_BADGE,
  NPD_DOC_TYPES,
  NPD_REVISION_KINDS,
  NPD_REVISION_KIND_LABELS,
  dossierProgress,
  checklistProgress,
  supplierDisplayName,
  type NpdStageKey,
  type NpdDocType,
  type NpdProjectType,
} from "./constants";

// ---------------------------------------------------------------------------
// Types passed from the server page
// ---------------------------------------------------------------------------
export type Category = { id: string; name: string };

/** Active supplier profile (role SUPPLIER) for the supplier pickers. */
export type SupplierOption = {
  id: string;
  name: string | null;
  company_name: string | null;
};

export type NpdVariation = {
  id: string;
  name: string;
  usp: string | null;
  key_benefit: string | null;
  rp_price: number | null;
  rsp_price: number | null;
  pack_size: string | null;
  notes: string | null;
  created_at?: string | null;
};

export type NpdChecklistRow = {
  id: string;
  stage: NpdStageKey;
  done: boolean;
  done_at: string | null;
  target_date: string | null;
  not_applicable: boolean;
};

export type NpdDocument = {
  id: string;
  doc_type: NpdDocType;
  file_path: string;
  file_name: string | null;
  uploaded_at: string | null;
};

export type NpdProject = {
  id: string;
  name: string;
  category_id: string | null;
  target_launch_date: string | null;
  status: string;
  notes: string | null;
  spie_applicable: boolean;
  supplier_id: string | null;
  /** NEW_PRODUCT (default) or REVISION. */
  project_type: string;
  /** Revision kind key — set only when project_type = REVISION. */
  revision_kind: string | null;
  supplier: { name: string | null; company_name: string | null } | null;
  product_categories: Category | null;
  npd_variations: NpdVariation[];
  npd_checklist: NpdChecklistRow[];
  npd_documents: NpdDocument[];
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

// Format a bare "YYYY-MM-DD" DATE, e.g. "12 Aug 2026" (UTC avoids TZ shift).
function fmtDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00Z");
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Format a TIMESTAMPTZ (done_at) as a KL calendar date.
function fmtTimestamp(ts: string | null): string {
  if (!ts) return "";
  const dt = new Date(ts);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kuala_Lumpur",
  });
}

// RM with 2dp; empty shows an em-dash.
function fmtRm(n: number | null): string {
  if (n == null) return "—";
  return `RM ${Number(n).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Indigo "Revision · {kind}" badge — NEW_PRODUCT projects render nothing. */
function RevisionBadge({
  projectType,
  revisionKind,
}: {
  projectType: string;
  revisionKind: string | null;
}) {
  if (projectType !== "REVISION") return null;
  const kind = revisionKind
    ? NPD_REVISION_KIND_LABELS[revisionKind] ?? revisionKind
    : null;
  return (
    <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 whitespace-nowrap">
      Revision{kind ? ` · ${kind}` : ""}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-block text-xs font-medium px-2 py-0.5 rounded-full",
        NPD_STATUS_BADGE[status] ??
          "bg-gray-100 text-gray-500 border border-gray-200"
      )}
    >
      {NPD_STATUS_LABELS[status] ?? status}
    </span>
  );
}

const inputCls =
  "border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";

type Msg = { ok: boolean; text: string } | null;

function MsgText({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <span className={cn("text-xs", msg.ok ? "text-emerald-600" : "text-red-600")}>
      {msg.text}
    </span>
  );
}

// "Dossier n/m" pill — amber while incomplete, emerald when complete.
function DossierChip({ done, total }: { done: number; total: number }) {
  const complete = done >= total;
  return (
    <span
      className={cn(
        "inline-block text-xs font-medium px-2 py-0.5 rounded-full tabular-nums",
        complete
          ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
          : "bg-amber-100 text-amber-700 border border-amber-200"
      )}
    >
      Dossier {done}/{total}
    </span>
  );
}

// ---------------------------------------------------------------------------
// New project form
// ---------------------------------------------------------------------------
function NewProjectForm({
  categories,
  suppliers,
}: {
  categories: Category[];
  suppliers: SupplierOption[];
}) {
  const [open, setOpen] = useState(false);
  const [projectType, setProjectType] = useState<NpdProjectType>("NEW_PRODUCT");
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    startTransition(async () => {
      const res = await createNpdProject({
        name: String(fd.get("name") ?? ""),
        categoryId: String(fd.get("category_id") ?? ""),
        targetLaunchDate: String(fd.get("target_launch_date") ?? ""),
        variationNames: String(fd.get("variation_names") ?? ""),
        supplierId: String(fd.get("supplier_id") ?? ""),
        projectType,
        revisionKind:
          projectType === "REVISION"
            ? String(fd.get("revision_kind") ?? "")
            : null,
      });
      if (res.ok) {
        setMsg({ ok: true, text: "Project created" });
        form.reset();
        setProjectType("NEW_PRODUCT");
        setOpen(false);
      } else {
        setMsg({ ok: false, text: res.error ?? "Failed to create project" });
      }
    });
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={() => setOpen(true)}>
          + New NPD project
        </Button>
        <MsgText msg={msg} />
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            New NPD project
          </div>
          {/* Type toggle — revision projects also pick a revision kind. */}
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="radio"
                name="project_type"
                value="NEW_PRODUCT"
                checked={projectType === "NEW_PRODUCT"}
                onChange={() => setProjectType("NEW_PRODUCT")}
                className="h-3.5 w-3.5"
              />
              <span className="text-gray-800">New product</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="radio"
                name="project_type"
                value="REVISION"
                checked={projectType === "REVISION"}
                onChange={() => setProjectType("REVISION")}
                className="h-3.5 w-3.5"
              />
              <span className="text-gray-800">Revision of existing product</span>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex flex-col">
              <label className="text-[10px] text-gray-500 mb-1">
                Product name *
              </label>
              <input
                name="name"
                required
                placeholder="e.g. Cassava Sakura litter"
                className={inputCls}
              />
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] text-gray-500 mb-1">Category</label>
              <select name="category_id" defaultValue="" className={inputCls}>
                <option value="">— none —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] text-gray-500 mb-1">
                Target launch date
              </label>
              <input type="date" name="target_launch_date" className={inputCls} />
            </div>
            {projectType === "REVISION" && (
              <div className="flex flex-col">
                <label className="text-[10px] text-gray-500 mb-1">
                  Revision kind *
                </label>
                <select
                  name="revision_kind"
                  required
                  defaultValue=""
                  className={inputCls}
                >
                  <option value="" disabled>
                    — select kind —
                  </option>
                  {NPD_REVISION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {NPD_REVISION_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex flex-col">
              <label className="text-[10px] text-gray-500 mb-1">Supplier</label>
              <select name="supplier_id" defaultValue="" className={inputCls}>
                <option value="">— not decided yet —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {supplierDisplayName(s) ?? s.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col sm:col-span-3">
              <label className="text-[10px] text-gray-500 mb-1">
                Variations (one per line)
              </label>
              <textarea
                name="variation_names"
                rows={3}
                placeholder={"Salmon\nTuna\nChicken"}
                className={inputCls}
              />
              <span className="text-[10px] text-gray-400 mt-1">
                Each line becomes a variation row — fill in USP, prices and pack
                size later on the project card.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Creating…" : "Create project"}
            </Button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-gray-500 hover:underline"
            >
              Cancel
            </button>
            <MsgText msg={msg} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------
function Checklist({
  project,
  dossier,
}: {
  project: NpdProject;
  dossier: { done: number; total: number };
}) {
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);

  const byStage = new Map<string, NpdChecklistRow>();
  for (const row of project.npd_checklist) byStage.set(row.stage, row);

  // done / applicable — N/A stages drop out of both sides of the count.
  const { done: doneCount, total: applicableTotal } = checklistProgress(
    project.npd_checklist
  );

  function toggle(stage: NpdStageKey, done: boolean) {
    setMsg(null);
    startTransition(async () => {
      const res = await toggleChecklistStage(project.id, stage, done);
      if (!res.ok) setMsg({ ok: false, text: res.error ?? "Failed to update" });
    });
  }

  function saveTargetDate(stage: NpdStageKey, date: string) {
    setMsg(null);
    startTransition(async () => {
      const res = await setStageTargetDate(project.id, stage, date || null);
      if (!res.ok) setMsg({ ok: false, text: res.error ?? "Failed to save date" });
    });
  }

  function toggleNa(stage: NpdStageKey, notApplicable: boolean) {
    setMsg(null);
    startTransition(async () => {
      const res = await setStageNotApplicable(project.id, stage, notApplicable);
      if (!res.ok) setMsg({ ok: false, text: res.error ?? "Failed to update" });
    });
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          Launch checklist
        </span>
        <div className="flex-1 max-w-[160px] h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full bg-brand rounded-full transition-all"
            style={{
              width: `${
                applicableTotal > 0 ? (doneCount / applicableTotal) * 100 : 0
              }%`,
            }}
          />
        </div>
        <span className="text-xs text-gray-600 tabular-nums font-medium">
          {doneCount}/{applicableTotal}
        </span>
        <MsgText msg={msg} />
      </div>
      <ul className="space-y-1">
        {NPD_STAGES.map((stage) => {
          const row = byStage.get(stage.key);
          const na = row?.not_applicable ?? false;
          const done = row?.done ?? false;
          return (
            <li key={stage.key} className="flex flex-wrap items-center gap-2 text-sm">
              <label
                className={cn(
                  "flex items-center gap-2 select-none",
                  na ? "cursor-not-allowed" : "cursor-pointer"
                )}
              >
                <input
                  type="checkbox"
                  checked={done}
                  disabled={isPending || na}
                  onChange={(e) => toggle(stage.key, e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 accent-current disabled:opacity-40"
                />
                <span
                  className={
                    na
                      ? "text-gray-300 line-through"
                      : done
                        ? "text-gray-400 line-through"
                        : "text-gray-800"
                  }
                >
                  {stage.label}
                </span>
              </label>
              {na && (
                <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400 border border-gray-200">
                  n/a
                </span>
              )}
              <button
                type="button"
                onClick={() => toggleNa(stage.key, !na)}
                disabled={isPending}
                title={
                  na
                    ? "Mark this stage applicable again"
                    : "Mark this stage not applicable (drops out of the count)"
                }
                className="text-[10px] text-gray-400 hover:text-gray-600 hover:underline disabled:opacity-50"
              >
                {na ? "mark applicable" : "N/A"}
              </button>
              {stage.href && (
                <Link
                  href={stage.href}
                  className="text-xs text-blue-600 hover:underline"
                >
                  {stage.linkLabel}
                </Link>
              )}
              {/* DVS permit stage: surface dossier completeness inline so the
                  stage can't look done while documents are missing (checkbox
                  stays free — no auto-tick, no blocking). */}
              {stage.key === "DVS_PERMIT" && (
                <DossierChip done={dossier.done} total={dossier.total} />
              )}
              {stage.hasTargetDate && (
                <span className="flex items-center gap-1.5 text-xs text-gray-500">
                  {stage.targetLabel}:
                  <input
                    type="date"
                    defaultValue={row?.target_date ?? ""}
                    disabled={isPending}
                    onChange={(e) => saveTargetDate(stage.key, e.target.value)}
                    className="border border-gray-200 rounded-md px-1.5 py-0.5 text-xs text-gray-700"
                  />
                </span>
              )}
              {!stage.hasTargetDate && row?.target_date && (
                <span className="text-xs text-gray-400">
                  target {fmtDate(row.target_date)}
                </span>
              )}
              {done && row?.done_at && (
                <span className="text-xs text-gray-400 ml-auto">
                  done {fmtTimestamp(row.done_at)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DVS dossier — documents required for the DVS permit application
// ---------------------------------------------------------------------------
function DvsDossier({
  project,
  dossier,
}: {
  project: NpdProject;
  dossier: { done: number; total: number };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pendingType = useRef<NpdDocType | null>(null);

  const byType = new Map<NpdDocType, NpdDocument[]>();
  for (const d of project.npd_documents) {
    const arr = byType.get(d.doc_type) ?? [];
    arr.push(d);
    byType.set(d.doc_type, arr);
  }

  function pickFile(docType: NpdDocType) {
    setErr(null);
    pendingType.current = docType;
    inputRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const docType = pendingType.current;
    e.target.value = ""; // allow re-picking the same file
    if (!file || !docType) return;

    // Pre-flight the Server Action body limit — over it, Next.js rejects the
    // POST with a 413 and the action never runs, so check here (same as
    // purchase-orders doc-badge.tsx).
    if (file.size > MAX_UPLOAD_BYTES) {
      setErr(
        `File is ${formatBytes(file.size)} — over the ${MAX_UPLOAD_LABEL} limit. Compress it and retry.`
      );
      return;
    }

    setBusy("up:" + docType);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await uploadNpdDocument(project.id, docType, fd);
      if (res.ok) router.refresh();
      else setErr(res.error ?? "Upload failed");
    } catch (ex) {
      setErr(
        `Upload failed: ${ex instanceof Error ? ex.message : "the server rejected the request"}`
      );
    } finally {
      setBusy(null);
    }
  }

  async function openDoc(doc: NpdDocument) {
    setBusy(doc.id);
    setErr(null);
    try {
      const url = await getNpdDocUrl(doc.file_path);
      if (url) window.open(url, "_blank");
      else setErr("Could not open that document.");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Could not open that document.");
    } finally {
      setBusy(null);
    }
  }

  function handleDeleteDoc(doc: NpdDocument) {
    if (!confirm(`Remove "${doc.file_name ?? "this file"}" from the dossier?`)) {
      return;
    }
    setErr(null);
    startTransition(async () => {
      const res = await deleteNpdDocument(doc.id);
      if (!res.ok) setErr(res.error ?? "Failed to remove document");
    });
  }

  function toggleSpie() {
    setErr(null);
    startTransition(async () => {
      const res = await setSpieApplicable(project.id, !project.spie_applicable);
      if (!res.ok) setErr(res.error ?? "Failed to update SPIE flag");
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          DVS dossier
        </span>
        <DossierChip done={dossier.done} total={dossier.total} />
        {err && (
          <span className="w-full text-[10px] leading-tight text-red-600" title={err}>
            {err}
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        className="hidden"
        onChange={onFile}
      />
      <ul className="divide-y divide-gray-50 rounded-lg border border-gray-100">
        {NPD_DOC_TYPES.map((t) => {
          const files = byType.get(t.key) ?? [];
          const uploading = busy === "up:" + t.key;
          const spieOff = t.key === "SPIE_LETTER" && !project.spie_applicable;
          const latest = files.reduce<string | null>(
            (max, f) =>
              f.uploaded_at && (!max || f.uploaded_at > max) ? f.uploaded_at : max,
            null
          );

          return (
            <li
              key={t.key}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
            >
              <span className="min-w-0">
                <span
                  className={
                    spieOff ? "text-gray-400 line-through" : "text-gray-800"
                  }
                >
                  {t.label}
                </span>
                {t.caption && (
                  <span className="block text-[10px] text-gray-400">
                    {t.caption}
                  </span>
                )}
              </span>

              {spieOff ? (
                <>
                  <span className="text-xs text-gray-400">
                    not applicable (fish-based product)
                  </span>
                  <button
                    onClick={toggleSpie}
                    disabled={isPending}
                    className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                  >
                    mark applicable
                  </button>
                </>
              ) : (
                <>
                  {files.length > 0 ? (
                    <span className="text-xs text-emerald-700 whitespace-nowrap">
                      ✓ uploaded {files.length} file{files.length === 1 ? "" : "s"}
                      {latest && `, latest ${fmtTimestamp(latest)}`}
                    </span>
                  ) : (
                    <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                      missing
                    </span>
                  )}

                  {files.map((f) => (
                    <span key={f.id} className="flex items-center gap-0.5">
                      <button
                        onClick={() => openDoc(f)}
                        disabled={busy === f.id}
                        title={`Open ${f.file_name ?? "file"}`}
                        className="text-xs text-blue-600 hover:underline disabled:opacity-50 max-w-[180px] truncate"
                      >
                        {busy === f.id ? "…" : f.file_name ?? "file"}
                      </button>
                      <button
                        onClick={() => handleDeleteDoc(f)}
                        disabled={isPending}
                        title="Remove from dossier"
                        className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50 px-0.5"
                      >
                        ×
                      </button>
                    </span>
                  ))}

                  <span className="ml-auto flex items-center gap-2 whitespace-nowrap">
                    {t.key === "SPIE_LETTER" && (
                      <button
                        onClick={toggleSpie}
                        disabled={isPending}
                        className="text-[10px] text-gray-400 hover:text-gray-600 hover:underline disabled:opacity-50"
                      >
                        mark not applicable
                      </button>
                    )}
                    <button
                      onClick={() => pickFile(t.key)}
                      disabled={uploading}
                      title={`Upload ${t.label} (max ${MAX_UPLOAD_LABEL})`}
                      className="text-xs px-2 py-0.5 rounded-md border border-gray-200 text-gray-600 hover:bg-brand/10 hover:text-brand disabled:opacity-50"
                    >
                      {uploading ? "Uploading…" : "Upload"}
                    </button>
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variations
// ---------------------------------------------------------------------------
function VariationRow({ variation }: { variation: NpdVariation }) {
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    const parsePrice = (key: string): number | null => {
      const s = String(fd.get(key) ?? "").trim();
      if (s === "") return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };
    startTransition(async () => {
      const res = await updateVariation(variation.id, {
        name: String(fd.get("name") ?? ""),
        pack_size: String(fd.get("pack_size") ?? ""),
        usp: String(fd.get("usp") ?? ""),
        key_benefit: String(fd.get("key_benefit") ?? ""),
        rp_price: parsePrice("rp_price"),
        rsp_price: parsePrice("rsp_price"),
      });
      if (res.ok) setEditing(false);
      else setMsg({ ok: false, text: res.error ?? "Failed to save" });
    });
  }

  function handleDelete() {
    if (!confirm(`Delete variation "${variation.name}"?`)) return;
    startTransition(async () => {
      const res = await deleteVariation(variation.id);
      if (!res.ok) setMsg({ ok: false, text: res.error ?? "Failed to delete" });
    });
  }

  if (editing) {
    return (
      <tr className="border-b border-gray-100 bg-gray-50/60">
        <td colSpan={7} className="p-2">
          <form onSubmit={handleSave} className="space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <div className="flex flex-col">
                <label className="text-[10px] text-gray-500 mb-1">Name *</label>
                <input
                  name="name"
                  required
                  defaultValue={variation.name}
                  className={inputCls}
                />
              </div>
              <div className="flex flex-col">
                <label className="text-[10px] text-gray-500 mb-1">Pack size</label>
                <input
                  name="pack_size"
                  defaultValue={variation.pack_size ?? ""}
                  placeholder="e.g. 70g × 6"
                  className={inputCls}
                />
              </div>
              <div className="flex flex-col">
                <label className="text-[10px] text-gray-500 mb-1">USP</label>
                <input
                  name="usp"
                  defaultValue={variation.usp ?? ""}
                  className={inputCls}
                />
              </div>
              <div className="flex flex-col">
                <label className="text-[10px] text-gray-500 mb-1">
                  Key benefit
                </label>
                <input
                  name="key_benefit"
                  defaultValue={variation.key_benefit ?? ""}
                  className={inputCls}
                />
              </div>
              <div className="flex flex-col">
                <label className="text-[10px] text-gray-500 mb-1">
                  RP price (RM)
                </label>
                <input
                  name="rp_price"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={variation.rp_price ?? ""}
                  className={inputCls}
                />
              </div>
              <div className="flex flex-col">
                <label className="text-[10px] text-gray-500 mb-1">
                  RSP price (RM)
                </label>
                <input
                  name="rsp_price"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={variation.rsp_price ?? ""}
                  className={inputCls}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? "Saving…" : "Save"}
              </Button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-xs text-gray-500 hover:underline"
              >
                Cancel
              </button>
              <MsgText msg={msg} />
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-gray-50 last:border-0 align-top">
      <td className="py-1.5 pl-3 pr-2 font-medium text-gray-900">
        {variation.name}
      </td>
      <td className="py-1.5 px-2 text-gray-600">{variation.pack_size || "—"}</td>
      <td className="py-1.5 px-2 text-gray-600">{variation.usp || "—"}</td>
      <td className="py-1.5 px-2 text-gray-600">
        {variation.key_benefit || "—"}
      </td>
      <td className="py-1.5 px-2 text-gray-600 tabular-nums whitespace-nowrap">
        {fmtRm(variation.rp_price)}
      </td>
      <td className="py-1.5 px-2 text-gray-600 tabular-nums whitespace-nowrap">
        {fmtRm(variation.rsp_price)}
      </td>
      <td className="py-1.5 pr-3 pl-2 text-right whitespace-nowrap">
        <button
          onClick={() => setEditing(true)}
          disabled={isPending}
          className="text-xs text-blue-600 hover:underline disabled:opacity-50 mr-3"
        >
          Edit
        </button>
        <button
          onClick={handleDelete}
          disabled={isPending}
          className="text-xs text-red-600 hover:underline disabled:opacity-50"
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

function Variations({ project }: { project: NpdProject }) {
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const form = e.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    if (!name) return;
    startTransition(async () => {
      const res = await addVariation(project.id, name);
      if (res.ok) form.reset();
      else setMsg({ ok: false, text: res.error ?? "Failed to add" });
    });
  }

  return (
    <div>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
        Variations ({project.npd_variations.length})
      </div>
      {project.npd_variations.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-100 mb-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50/60 text-xs">
                <th className="py-1.5 pl-3 pr-2 font-medium">Name</th>
                <th className="py-1.5 px-2 font-medium">Pack size</th>
                <th className="py-1.5 px-2 font-medium">USP</th>
                <th className="py-1.5 px-2 font-medium">Key benefit</th>
                <th className="py-1.5 px-2 font-medium">RP price</th>
                <th className="py-1.5 px-2 font-medium">RSP price</th>
                <th className="py-1.5 pr-3 pl-2 font-medium text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {project.npd_variations.map((v) => (
                <VariationRow key={v.id} variation={v} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form onSubmit={handleAdd} className="flex items-center gap-2">
        <input
          name="name"
          placeholder="Add variation (e.g. Salmon)"
          className={cn(inputCls, "w-56")}
        />
        <Button type="submit" size="sm" variant="outline" disabled={isPending}>
          {isPending ? "Adding…" : "+ Add"}
        </Button>
        <MsgText msg={msg} />
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Supplier inline editor — name + a small select that saves on pick
// ---------------------------------------------------------------------------
function SupplierInline({
  project,
  suppliers,
}: {
  project: NpdProject;
  suppliers: SupplierOption[];
}) {
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);

  const currentName = supplierDisplayName(project.supplier);
  // Current supplier may be missing from the active list (e.g. deactivated) —
  // keep it selectable so the select doesn't silently show the wrong value.
  const hasCurrent =
    !project.supplier_id || suppliers.some((s) => s.id === project.supplier_id);

  function save(value: string) {
    setMsg(null);
    startTransition(async () => {
      const res = await setProjectSupplier(project.id, value || null);
      if (res.ok) setEditing(false);
      else setMsg({ ok: false, text: res.error ?? "Failed to save supplier" });
    });
  }

  if (!editing) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-gray-500">
        Supplier:{" "}
        <span className={currentName ? "text-gray-700" : "text-gray-400"}>
          {currentName ?? "not decided yet"}
        </span>
        <button
          onClick={() => setEditing(true)}
          disabled={isPending}
          className="text-blue-600 hover:underline disabled:opacity-50"
        >
          edit
        </button>
        <MsgText msg={msg} />
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-xs">
      <select
        defaultValue={project.supplier_id ?? ""}
        disabled={isPending}
        onChange={(e) => save(e.target.value)}
        className="border border-gray-200 rounded-md px-1.5 py-0.5 text-xs text-gray-700"
      >
        <option value="">— not decided yet —</option>
        {!hasCurrent && project.supplier_id && (
          <option value={project.supplier_id}>
            {currentName ?? "(current supplier)"}
          </option>
        )}
        {suppliers.map((s) => (
          <option key={s.id} value={s.id}>
            {supplierDisplayName(s) ?? s.id}
          </option>
        ))}
      </select>
      <button
        onClick={() => setEditing(false)}
        disabled={isPending}
        className="text-gray-500 hover:underline disabled:opacity-50"
      >
        cancel
      </button>
      <MsgText msg={msg} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Project card
// ---------------------------------------------------------------------------
function ProjectCard({
  project,
  categories,
  suppliers,
}: {
  project: NpdProject;
  categories: Category[];
  suppliers: SupplierOption[];
}) {
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);

  const dossier = dossierProgress(project.npd_documents, project.spie_applicable);

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateNpdProject(project.id, {
        name: String(fd.get("name") ?? ""),
        categoryId: String(fd.get("category_id") ?? ""),
        targetLaunchDate: String(fd.get("target_launch_date") ?? ""),
        status: String(fd.get("status") ?? project.status),
        notes: String(fd.get("notes") ?? ""),
      });
      if (res.ok) setEditing(false);
      else setMsg({ ok: false, text: res.error ?? "Failed to save" });
    });
  }

  function handleDelete() {
    if (
      !confirm(
        `Delete NPD project "${project.name}"? This removes its variations and checklist too.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await deleteNpdProject(project.id);
      if (!res.ok) setMsg({ ok: false, text: res.error ?? "Failed to delete" });
    });
  }

  return (
    <Card>
      <CardContent className="pt-4 space-y-4">
        {/* Header */}
        {editing ? (
          <form onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="flex flex-col">
                <label className="text-[10px] text-gray-500 mb-1">
                  Product name *
                </label>
                <input
                  name="name"
                  required
                  defaultValue={project.name}
                  className={inputCls}
                />
              </div>
              <div className="flex flex-col">
                <label className="text-[10px] text-gray-500 mb-1">Category</label>
                <select
                  name="category_id"
                  defaultValue={project.category_id ?? ""}
                  className={inputCls}
                >
                  <option value="">— none —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col">
                <label className="text-[10px] text-gray-500 mb-1">
                  Target launch date
                </label>
                <input
                  type="date"
                  name="target_launch_date"
                  defaultValue={project.target_launch_date ?? ""}
                  className={inputCls}
                />
              </div>
              <div className="flex flex-col">
                <label className="text-[10px] text-gray-500 mb-1">Status</label>
                <select
                  name="status"
                  defaultValue={project.status}
                  className={inputCls}
                >
                  {NPD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {NPD_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col sm:col-span-2 lg:col-span-4">
                <label className="text-[10px] text-gray-500 mb-1">Notes</label>
                <textarea
                  name="notes"
                  rows={2}
                  defaultValue={project.notes ?? ""}
                  className={inputCls}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? "Saving…" : "Save"}
              </Button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-xs text-gray-500 hover:underline"
              >
                Cancel
              </button>
              <MsgText msg={msg} />
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold text-gray-900">{project.name}</span>
            <RevisionBadge
              projectType={project.project_type}
              revisionKind={project.revision_kind}
            />
            {project.product_categories && (
              <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                {project.product_categories.name}
              </span>
            )}
            <SupplierInline project={project} suppliers={suppliers} />
            <StatusBadge status={project.status} />
            <span className="text-xs text-gray-500">
              Launch: {fmtDate(project.target_launch_date)}
            </span>
            <span className="ml-auto whitespace-nowrap">
              <button
                onClick={() => setEditing(true)}
                disabled={isPending}
                className="text-xs text-blue-600 hover:underline disabled:opacity-50 mr-3"
              >
                Edit
              </button>
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="text-xs text-red-600 hover:underline disabled:opacity-50"
              >
                Delete
              </button>
            </span>
            {msg && <MsgText msg={msg} />}
          </div>
        )}

        {!editing && project.notes && (
          <p className="text-sm text-gray-500 whitespace-pre-wrap">
            {project.notes}
          </p>
        )}

        <Checklist project={project} dossier={dossier} />
        <DvsDossier project={project} dossier={dossier} />
        <Variations project={project} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Top-level manager
// ---------------------------------------------------------------------------
const STATUS_GROUP_ORDER: Record<string, number> = {
  ON_HOLD: 0,
  LAUNCHED: 1,
  CANCELLED: 2,
};

export function NpdManager({
  projects,
  categories,
  suppliers,
}: {
  projects: NpdProject[];
  categories: Category[];
  suppliers: SupplierOption[];
}) {
  const [showOthers, setShowOthers] = useState(false);

  const active = projects.filter((p) => p.status === "ACTIVE");
  const others = projects
    .filter((p) => p.status !== "ACTIVE")
    .sort(
      (a, b) =>
        (STATUS_GROUP_ORDER[a.status] ?? 9) - (STATUS_GROUP_ORDER[b.status] ?? 9)
    );

  return (
    <div className="space-y-4">
      <NewProjectForm categories={categories} suppliers={suppliers} />

      {projects.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-gray-400">
            No NPD projects yet. Create the first new-product project above.
          </CardContent>
        </Card>
      ) : (
        <>
          {active.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              categories={categories}
              suppliers={suppliers}
            />
          ))}

          {others.length > 0 && (
            <div className="space-y-4">
              <button
                onClick={() => setShowOthers((v) => !v)}
                className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
              >
                {showOthers ? "Hide" : "Show"} on-hold / launched / cancelled
                projects ({others.length})
              </button>
              {showOthers &&
                others.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    categories={categories}
                    suppliers={suppliers}
                  />
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
