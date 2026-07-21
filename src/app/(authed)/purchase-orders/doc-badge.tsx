"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getDocUrl, uploadPoDocument } from "./actions";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, formatBytes } from "@/lib/constants";

const LABEL: Record<string, string> = {
  PO_PDF: "PO",
  SUPPLIER_INVOICE: "INV",
  BL: "BL",
  PACKING_LIST: "PL",
  K1_DRAFT: "K1-D",
  K1_FINAL: "K1",
  LOGISTICS_INVOICE: "LOG-INV",
};

// Spelled-out names for the badge tooltips ("K1-D" on its own is opaque).
const FULL_LABEL: Record<string, string> = {
  PO_PDF: "PO PDF",
  SUPPLIER_INVOICE: "supplier invoice",
  BL: "Bill of Lading",
  PACKING_LIST: "packing list",
  K1_DRAFT: "K1 (draft)",
  K1_FINAL: "K1 (final)",
  LOGISTICS_INVOICE: "logistics invoice",
};

// The badge row. K1_DRAFT sits alongside K1_FINAL so both customs forms can be
// uploaded straight from the list, same as every other type here.
const ORDER = ["PO_PDF", "SUPPLIER_INVOICE", "BL", "PACKING_LIST", "K1_DRAFT", "K1_FINAL"];

export function DocBadges({
  poId,
  docs,
  canUpload = true,
}: {
  poId: string;
  docs: { id: string; doc_type: string; file_path: string; file_name: string }[];
  canUpload?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pendingType = useRef<string | null>(null);
  const byType = new Map(docs.map((d) => [d.doc_type, d]));

  async function openDoc(filePath: string, id: string) {
    setBusy(id);
    setErr(null);
    try {
      const url = await getDocUrl(filePath);
      if (url) window.open(url, "_blank");
      else setErr("Could not open that document.");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Could not open that document.");
    } finally {
      setBusy(null);
    }
  }

  function pickFile(docType: string) {
    setErr(null);
    pendingType.current = docType;
    inputRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const docType = pendingType.current;
    e.target.value = ""; // allow re-picking the same file
    if (!file || !docType) return;

    // Pre-flight the Server Action body limit. Over it, Next.js rejects the POST
    // with a 413 and uploadPoDocument never runs, so it cannot report anything —
    // checking here is the only way the user gets a real message.
    if (file.size > MAX_UPLOAD_BYTES) {
      setErr(
        `${LABEL[docType] ?? docType} is ${formatBytes(file.size)} — over the ${MAX_UPLOAD_LABEL} limit. Compress it and retry.`
      );
      return;
    }

    setBusy("up:" + docType);
    try {
      const fd = new FormData();
      fd.set("doc_type", docType);
      fd.set("file", file);
      const res = await uploadPoDocument(poId, fd);
      if (res.ok) router.refresh();
      else setErr(res.error ?? "Upload failed");
    } catch (ex) {
      // Without this the rejection was swallowed: `busy` stayed set, the badge
      // sat on "…" forever and nothing was shown to the user.
      setErr(
        `Upload failed: ${ex instanceof Error ? ex.message : "the server rejected the request"}`
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex gap-1 flex-wrap items-center">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        className="hidden"
        onChange={onFile}
      />
      {ORDER.map((t) => {
        const doc = byType.get(t);
        const present = !!doc;
        const uploading = busy === "up:" + t;
        if (present) {
          return (
            <button
              key={t}
              disabled={busy === doc!.id}
              onClick={() => openDoc(doc!.file_path, doc!.id)}
              title={`Open ${doc!.file_name}`}
              className="text-[11px] px-1.5 py-0.5 rounded font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 cursor-pointer transition-colors"
            >
              {busy === doc!.id ? "…" : LABEL[t]}
            </button>
          );
        }
        // Missing → click to upload (when allowed).
        return (
          <button
            key={t}
            disabled={!canUpload || uploading}
            onClick={() => pickFile(t)}
            title={
              canUpload
                ? `Upload ${FULL_LABEL[t] ?? LABEL[t]} (max ${MAX_UPLOAD_LABEL})`
                : `${FULL_LABEL[t] ?? LABEL[t]} not uploaded`
            }
            className={
              "text-[11px] px-1.5 py-0.5 rounded font-medium transition-colors " +
              (canUpload
                ? "bg-gray-100 text-gray-400 hover:bg-brand/10 hover:text-brand cursor-pointer"
                : "bg-gray-100 text-gray-300 cursor-default")
            }
          >
            {uploading ? "…" : LABEL[t]}
          </button>
        );
      })}
      {err && (
        // w-full so a long message wraps onto its own line inside the table cell
        // instead of being clipped to a few unreadable pixels.
        <span className="w-full text-[10px] leading-tight text-red-600" title={err}>
          {err}
        </span>
      )}
    </div>
  );
}
