"use server";

import { revalidatePath } from "next/cache";
import { requireRole, createClient } from "@/lib/supabase/server";
import {
  NPD_STAGE_KEYS,
  NPD_STATUSES,
  NPD_DOC_TYPE_KEYS,
  type NpdStageKey,
  type NpdStatus,
  type NpdDocType,
} from "./constants";

type ActionResult = { ok: boolean; error?: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isStage(v: string): v is NpdStageKey {
  return (NPD_STAGE_KEYS as string[]).includes(v);
}

function isDocType(v: string): v is NpdDocType {
  return (NPD_DOC_TYPE_KEYS as string[]).includes(v);
}

// Storage-safe file-name slug (same as purchase-orders/actions.ts).
function slug(s: string) {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

function isFile(v: FormDataEntryValue | null): v is File {
  return !!v && typeof v !== "string" && (v as File).size > 0;
}

function isStatus(v: string): v is NpdStatus {
  return (NPD_STATUSES as readonly string[]).includes(v);
}

function textOrNull(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
}

/** Validate an optional DATE string. Returns undefined when invalid. */
function dateOrNull(v: string | null | undefined): string | null | undefined {
  const s = (v ?? "").trim();
  if (s === "") return null;
  return DATE_RE.test(s) ? s : undefined;
}

/** Validate an optional price. Returns undefined when invalid. */
function priceOrNull(v: number | null | undefined): number | null | undefined {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

/**
 * Split the multi-variation textarea input (one per line, or comma-separated)
 * into trimmed, de-duplicated (case-insensitive) variation names.
 */
function parseVariationNames(input: string | null | undefined): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of (input ?? "").split(/[\r\n,]+/)) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/**
 * Create an NPD project with its variations (one per line in the input) and
 * seed the 7 checklist stages. Gated to SCM/ADMIN; writes go through the
 * normal client — RLS on the npd_* tables covers SCM/ADMIN.
 */
export async function createNpdProject(input: {
  name: string;
  categoryId?: string | null;
  targetLaunchDate?: string | null;
  variationNames?: string | null;
}): Promise<ActionResult> {
  const profile = await requireRole("SCM", "ADMIN");
  const supabase = await createClient();

  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "Product name is required" };

  const targetLaunchDate = dateOrNull(input.targetLaunchDate);
  if (targetLaunchDate === undefined) {
    return { ok: false, error: "Invalid target launch date" };
  }

  const variationNames = parseVariationNames(input.variationNames);

  const { data: project, error } = await supabase
    .from("npd_projects")
    .insert({
      name,
      category_id: textOrNull(input.categoryId),
      target_launch_date: targetLaunchDate,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error || !project) {
    return { ok: false, error: error?.message ?? "Failed to create project" };
  }

  // Seed the 7 checklist stages (all not-done).
  const { error: chkError } = await supabase
    .from("npd_checklist")
    .insert(NPD_STAGE_KEYS.map((stage) => ({ project_id: project.id, stage })));
  if (chkError) {
    // Best-effort cleanup — deleting the project cascades to checklist rows.
    await supabase.from("npd_projects").delete().eq("id", project.id);
    return { ok: false, error: chkError.message };
  }

  if (variationNames.length > 0) {
    const { error: varError } = await supabase
      .from("npd_variations")
      .insert(variationNames.map((n) => ({ project_id: project.id, name: n })));
    if (varError) {
      await supabase.from("npd_projects").delete().eq("id", project.id);
      return { ok: false, error: varError.message };
    }
  }

  revalidatePath("/development");
  return { ok: true };
}

/** Update project header fields. Only provided keys are written. */
export async function updateNpdProject(
  id: string,
  fields: {
    name?: string;
    categoryId?: string | null;
    targetLaunchDate?: string | null;
    status?: string;
    notes?: string | null;
  }
): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");
  if (!id) return { ok: false, error: "Missing project id" };

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (fields.name !== undefined) {
    const name = fields.name.trim();
    if (!name) return { ok: false, error: "Product name is required" };
    update.name = name;
  }
  if (fields.categoryId !== undefined) {
    update.category_id = textOrNull(fields.categoryId);
  }
  if (fields.targetLaunchDate !== undefined) {
    const d = dateOrNull(fields.targetLaunchDate);
    if (d === undefined) return { ok: false, error: "Invalid target launch date" };
    update.target_launch_date = d;
  }
  if (fields.status !== undefined) {
    if (!isStatus(fields.status)) return { ok: false, error: "Invalid status" };
    update.status = fields.status;
  }
  if (fields.notes !== undefined) {
    update.notes = textOrNull(fields.notes);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("npd_projects")
    .update(update)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/development");
  return { ok: true };
}

/** Delete a project (cascades to variations + checklist). */
export async function deleteNpdProject(id: string): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");
  if (!id) return { ok: false, error: "Missing project id" };

  const supabase = await createClient();
  const { error } = await supabase.from("npd_projects").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/development");
  return { ok: true };
}

/** Add a single variation to an existing project. */
export async function addVariation(
  projectId: string,
  name: string
): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");
  if (!projectId) return { ok: false, error: "Missing project id" };

  const trimmed = (name ?? "").trim();
  if (!trimmed) return { ok: false, error: "Variation name is required" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("npd_variations")
    .insert({ project_id: projectId, name: trimmed });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/development");
  return { ok: true };
}

/**
 * Fill in a variation's commercial details later. Only provided keys are
 * written; empty strings become null.
 */
export async function updateVariation(
  id: string,
  fields: {
    name?: string;
    usp?: string | null;
    key_benefit?: string | null;
    rp_price?: number | null;
    rsp_price?: number | null;
    pack_size?: string | null;
    notes?: string | null;
  }
): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");
  if (!id) return { ok: false, error: "Missing variation id" };

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (fields.name !== undefined) {
    const name = fields.name.trim();
    if (!name) return { ok: false, error: "Variation name is required" };
    update.name = name;
  }
  if (fields.usp !== undefined) update.usp = textOrNull(fields.usp);
  if (fields.key_benefit !== undefined) {
    update.key_benefit = textOrNull(fields.key_benefit);
  }
  if (fields.rp_price !== undefined) {
    const p = priceOrNull(fields.rp_price);
    if (p === undefined) return { ok: false, error: "Invalid RP price" };
    update.rp_price = p;
  }
  if (fields.rsp_price !== undefined) {
    const p = priceOrNull(fields.rsp_price);
    if (p === undefined) return { ok: false, error: "Invalid RSP price" };
    update.rsp_price = p;
  }
  if (fields.pack_size !== undefined) {
    update.pack_size = textOrNull(fields.pack_size);
  }
  if (fields.notes !== undefined) update.notes = textOrNull(fields.notes);

  const supabase = await createClient();
  const { error } = await supabase
    .from("npd_variations")
    .update(update)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/development");
  return { ok: true };
}

/** Delete a variation row. */
export async function deleteVariation(id: string): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");
  if (!id) return { ok: false, error: "Missing variation id" };

  const supabase = await createClient();
  const { error } = await supabase.from("npd_variations").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/development");
  return { ok: true };
}

/**
 * Tick/untick a checklist stage. Upserts on (project_id, stage) so a missing
 * seed row is created on the fly; done_at is set to now (or cleared).
 */
export async function toggleChecklistStage(
  projectId: string,
  stage: string,
  done: boolean
): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");
  if (!projectId) return { ok: false, error: "Missing project id" };
  if (!isStage(stage)) return { ok: false, error: "Invalid stage" };

  const supabase = await createClient();
  const { error } = await supabase.from("npd_checklist").upsert(
    {
      project_id: projectId,
      stage,
      done,
      done_at: done ? new Date().toISOString() : null,
    },
    { onConflict: "project_id,stage" }
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/development");
  return { ok: true };
}

/**
 * Set/clear a stage's target date — used mainly for ARRIVAL (estimated
 * arrival date) but allowed on any stage.
 */
export async function setStageTargetDate(
  projectId: string,
  stage: string,
  date: string | null
): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");
  if (!projectId) return { ok: false, error: "Missing project id" };
  if (!isStage(stage)) return { ok: false, error: "Invalid stage" };

  const targetDate = dateOrNull(date);
  if (targetDate === undefined) return { ok: false, error: "Invalid date" };

  const supabase = await createClient();
  const { error } = await supabase.from("npd_checklist").upsert(
    { project_id: projectId, stage, target_date: targetDate },
    { onConflict: "project_id,stage" }
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/development");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// DVS dossier documents
// ---------------------------------------------------------------------------

/**
 * Upload one DVS dossier document for a project. Mirrors the purchase-orders
 * uploadDoc pattern: file goes to the existing private `permit-docs` bucket
 * (storage policies already allow authenticated writes there), then an
 * npd_documents row records it. Multiple files per (project, doc_type) are
 * allowed — e.g. two mock-ups.
 */
export async function uploadNpdDocument(
  projectId: string,
  docType: string,
  formData: FormData
): Promise<ActionResult> {
  const profile = await requireRole("SCM", "ADMIN");
  if (!projectId) return { ok: false, error: "Missing project id" };
  if (!isDocType(docType)) return { ok: false, error: "Invalid document type" };

  const file = formData.get("file");
  if (!isFile(file)) return { ok: false, error: "No file selected" };

  const supabase = await createClient();

  const bucket = "permit-docs";
  const path = `npd/${projectId}/${docType}/${Date.now()}_${slug(file.name)}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(path, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: true,
    });
  if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };

  const { error: docErr } = await supabase.from("npd_documents").insert({
    project_id: projectId,
    doc_type: docType,
    file_path: `${bucket}/${path}`,
    file_name: file.name,
    uploaded_by: profile.id,
  });
  if (docErr) return { ok: false, error: `Record failed: ${docErr.message}` };

  revalidatePath("/development");
  return { ok: true };
}

// Short-lived signed URL for a dossier document (private bucket) — same
// '<bucket>/<path>' slicing as purchase-orders getDocUrl.
export async function getNpdDocUrl(filePath: string): Promise<string | null> {
  await requireRole("SCM", "ADMIN");
  const supabase = await createClient();
  const slashIdx = filePath.indexOf("/");
  const bucket = filePath.slice(0, slashIdx);
  const path = filePath.slice(slashIdx + 1);
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

/**
 * Delete a dossier document row. DB row only — deleting the underlying
 * storage object is super-admin-gated by the bucket's storage policies, so
 * the file stays in `permit-docs` (orphaned) until an admin prunes it.
 */
export async function deleteNpdDocument(id: string): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");
  if (!id) return { ok: false, error: "Missing document id" };

  const supabase = await createClient();
  const { error } = await supabase.from("npd_documents").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/development");
  return { ok: true };
}

/**
 * Flip whether the SPIE letter counts toward the project's dossier — SPIE is
 * required only for NON-fish-ingredient pet food.
 */
export async function setSpieApplicable(
  projectId: string,
  applicable: boolean
): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");
  if (!projectId) return { ok: false, error: "Missing project id" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("npd_projects")
    .update({
      spie_applicable: applicable,
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/development");
  return { ok: true };
}
