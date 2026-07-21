"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { uploadPoDocument } from "../actions";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, formatBytes } from "@/lib/constants";

// Friendly labels for each doc_type enum value (default = PO PDF).
const DOC_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "PO_PDF", label: "PO PDF" },
  { value: "SUPPLIER_INVOICE", label: "Supplier invoice" },
  { value: "BL", label: "Bill of Lading" },
  { value: "PACKING_LIST", label: "Packing list" },
  { value: "K1_DRAFT", label: "K1 (draft)" },
  { value: "K1_FINAL", label: "K1 (final)" },
  { value: "LOGISTICS_INVOICE", label: "Logistics invoice" },
];

const inputCls =
  "w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40";

// Always-available document upload — works at any workflow stage, independent of
// the per-stage forms. Visible to the internal roles that handle PO paperwork.
export function DocUpload({ poId }: { poId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);

    // Server Actions reject an over-limit body with a 413 before the action
    // runs, so uploadPoDocument can never report this — check client-side.
    const picked = fd.get("file");
    if (picked instanceof File && picked.size > MAX_UPLOAD_BYTES) {
      setMsg(
        `Error: ${picked.name} is ${formatBytes(picked.size)} — over the ${MAX_UPLOAD_LABEL} upload limit. Compress it and retry.`
      );
      return;
    }

    setSaving(true);
    setMsg(null);
    try {
      const res = await uploadPoDocument(poId, fd);
      if (res.ok) {
        setMsg("Uploaded.");
        form.reset();
        router.refresh();
      } else {
        setMsg(`Error: ${res.error}`);
      }
    } catch (ex) {
      setMsg(
        `Error: ${ex instanceof Error ? ex.message : "the server rejected the upload"}`
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-end gap-3"
    >
      <label className="block">
        <span className="text-xs text-gray-500 block mb-1">Document type</span>
        <select name="doc_type" defaultValue="PO_PDF" className={inputCls}>
          {DOC_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs text-gray-500 block mb-1">File</span>
        <input
          type="file"
          name="file"
          required
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          className="block w-full text-xs text-gray-600 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
        />
      </label>
      <Button type="submit" disabled={saving}>
        {saving ? "Uploading…" : "Upload"}
      </Button>
      {msg && (
        <span
          className={
            "text-sm " + (msg.startsWith("Error") ? "text-red-600" : "text-emerald-700")
          }
        >
          {msg}
        </span>
      )}
    </form>
  );
}
