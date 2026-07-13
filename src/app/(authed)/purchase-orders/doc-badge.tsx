"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getDocUrl, uploadPoDocument } from "./actions";

const LABEL: Record<string, string> = {
  PO_PDF: "PO",
  SUPPLIER_INVOICE: "INV",
  BL: "BL",
  PACKING_LIST: "PL",
  K1_FINAL: "K1",
  K1_DRAFT: "K1✏",
  LOGISTICS_INVOICE: "LOG-INV",
};

const ORDER = ["PO_PDF", "SUPPLIER_INVOICE", "BL", "PACKING_LIST", "K1_FINAL"];

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
    const url = await getDocUrl(filePath);
    setBusy(null);
    if (url) window.open(url, "_blank");
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
    setBusy("up:" + docType);
    const fd = new FormData();
    fd.set("doc_type", docType);
    fd.set("file", file);
    const res = await uploadPoDocument(poId, fd);
    setBusy(null);
    if (res.ok) router.refresh();
    else setErr(res.error ?? "Upload failed");
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
            title={canUpload ? `Upload ${LABEL[t]}` : `${LABEL[t]} not uploaded`}
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
      {err && <span className="text-[10px] text-red-600 ml-1">{err}</span>}
    </div>
  );
}
