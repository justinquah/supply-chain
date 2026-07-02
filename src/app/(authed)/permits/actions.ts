"use server";

import { revalidatePath } from "next/cache";
import { requireRole, createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PERMIT_TYPES, PERMIT_STATUSES } from "./constants";

type ActionResult = { ok: boolean; error?: string };
type UrlResult = { ok: boolean; url?: string; error?: string };

const PERMIT_DOCS_BUCKET = "permit-docs";

function isPermitType(v: string): boolean {
  return (PERMIT_TYPES as readonly string[]).includes(v);
}
function isPermitStatus(v: string): boolean {
  return (PERMIT_STATUSES as readonly string[]).includes(v);
}

function dateOrNull(v: FormDataEntryValue | null): string | null {
  const s = (v == null ? "" : String(v)).trim();
  return s === "" ? null : s;
}
function textOrNull(v: FormDataEntryValue | null): string | null {
  const s = (v == null ? "" : String(v)).trim();
  return s === "" ? null : s;
}

function isFile(v: FormDataEntryValue | null): v is File {
  return !!v && typeof v !== "string" && (v as File).size > 0;
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "file";
}

// Upload a permit document to the private permit-docs bucket. Returns the stored
// path on success, or an error string. Uses crypto.randomUUID() for uniqueness.
async function uploadPermitDoc(
  permitId: string,
  file: File
): Promise<{ path?: string; error?: string }> {
  const admin = createAdminClient();
  const path = `${permitId}/${crypto.randomUUID()}-${safeFilename(file.name)}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await admin.storage
    .from(PERMIT_DOCS_BUCKET)
    .upload(path, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (error) return { error: `Upload failed: ${error.message}` };
  return { path };
}

// Best-effort removal of a stored object (used when replacing a document).
async function removePermitDoc(path: string): Promise<void> {
  if (!path) return;
  const admin = createAdminClient();
  await admin.storage.from(PERMIT_DOCS_BUCKET).remove([path]);
}

/**
 * Create a permit. Gated to SCM/ADMIN; writes via the admin (service-role)
 * client — the app-layer role check is the security boundary. An attached
 * document (if present) is uploaded to permit-docs after the row is created so
 * the storage path can be namespaced under the new permit id.
 */
export async function createPermit(formData: FormData): Promise<ActionResult> {
  const profile = await requireRole("SCM", "ADMIN");

  const permitType = String(formData.get("permit_type") ?? "OTHER").trim() || "OTHER";
  if (!isPermitType(permitType)) return { ok: false, error: "Invalid permit type" };

  const status = String(formData.get("status") ?? "ACTIVE").trim() || "ACTIVE";
  if (!isPermitStatus(status)) return { ok: false, error: "Invalid status" };

  const admin = createAdminClient();
  const { data: inserted, error } = await admin
    .from("permits")
    .insert({
      permit_type: permitType,
      name: textOrNull(formData.get("name")),
      reference_no: textOrNull(formData.get("reference_no")),
      holder: textOrNull(formData.get("holder")),
      issued_date: dateOrNull(formData.get("issued_date")),
      expiry_date: dateOrNull(formData.get("expiry_date")),
      status,
      notes: textOrNull(formData.get("notes")),
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  const doc = formData.get("doc");
  if (isFile(doc) && inserted?.id) {
    const up = await uploadPermitDoc(inserted.id, doc);
    if (up.error) return { ok: false, error: up.error };
    const { error: docErr } = await admin
      .from("permits")
      .update({ doc_path: up.path, updated_at: new Date().toISOString() })
      .eq("id", inserted.id);
    if (docErr) return { ok: false, error: docErr.message };
  }

  revalidatePath("/permits");
  return { ok: true };
}

/**
 * Update a permit. Gated to SCM/ADMIN. If a new document is attached it replaces
 * any existing one (old object is best-effort removed).
 */
export async function updatePermit(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");

  if (!id) return { ok: false, error: "Missing permit id" };

  const permitType = String(formData.get("permit_type") ?? "OTHER").trim() || "OTHER";
  if (!isPermitType(permitType)) return { ok: false, error: "Invalid permit type" };

  const status = String(formData.get("status") ?? "ACTIVE").trim() || "ACTIVE";
  if (!isPermitStatus(status)) return { ok: false, error: "Invalid status" };

  const admin = createAdminClient();

  const update: Record<string, unknown> = {
    permit_type: permitType,
    name: textOrNull(formData.get("name")),
    reference_no: textOrNull(formData.get("reference_no")),
    holder: textOrNull(formData.get("holder")),
    issued_date: dateOrNull(formData.get("issued_date")),
    expiry_date: dateOrNull(formData.get("expiry_date")),
    status,
    notes: textOrNull(formData.get("notes")),
    updated_at: new Date().toISOString(),
  };

  const doc = formData.get("doc");
  if (isFile(doc)) {
    // Fetch the existing doc_path so we can remove it after a successful replace.
    const { data: existing } = await admin
      .from("permits")
      .select("doc_path")
      .eq("id", id)
      .maybeSingle();

    const up = await uploadPermitDoc(id, doc);
    if (up.error) return { ok: false, error: up.error };
    update.doc_path = up.path;

    if (existing?.doc_path) await removePermitDoc(existing.doc_path as string);
  }

  const { error } = await admin.from("permits").update(update).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/permits");
  return { ok: true };
}

/**
 * Delete a permit. Gated to SCM/ADMIN. Best-effort removes its document too.
 */
export async function deletePermit(id: string): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");

  if (!id) return { ok: false, error: "Missing permit id" };

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("permits")
    .select("doc_path")
    .eq("id", id)
    .maybeSingle();

  const { error } = await admin.from("permits").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  if (existing?.doc_path) await removePermitDoc(existing.doc_path as string);

  revalidatePath("/permits");
  return { ok: true };
}

/**
 * Mint a short-lived signed URL for a permit document. Mirrors getDocUrl:
 * uses the session client and createSignedUrl(path, 300). Re-checks the
 * SCM/ADMIN role before signing so the URL is never handed to an unauthorised
 * caller.
 */
export async function getPermitDocUrl(path: string): Promise<UrlResult> {
  await requireRole("SCM", "ADMIN");

  if (!path) return { ok: false, error: "Missing document path" };

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(PERMIT_DOCS_BUCKET)
    .createSignedUrl(path, 300);
  if (error) return { ok: false, error: error.message };
  if (!data?.signedUrl) return { ok: false, error: "Could not sign URL" };
  return { ok: true, url: data.signedUrl };
}
