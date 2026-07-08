"use client";

import { useMemo, useRef, useState } from "react";
import { importPoDocuments, type ImportPoDocumentsResult } from "../import-actions";
import { Button } from "@/components/ui/button";

type PoOption = { id: string; po_number: string };

// The 7 doc types (mirrors the doc_type enum + BUCKET map).
const DOC_TYPES = [
  "PO_PDF",
  "SUPPLIER_INVOICE",
  "BL",
  "PACKING_LIST",
  "K1_DRAFT",
  "K1_FINAL",
  "LOGISTICS_INVOICE",
] as const;

const DOC_TYPE_LABELS: Record<string, string> = {
  PO_PDF: "PO PDF",
  SUPPLIER_INVOICE: "Supplier invoice",
  BL: "Bill of Lading (BL)",
  PACKING_LIST: "Packing list",
  K1_DRAFT: "K1 (draft)",
  K1_FINAL: "K1 (final)",
  LOGISTICS_INVOICE: "Logistics invoice",
};

// Infer a doc type from filename keywords (order matters — most specific first).
function inferDocType(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("k1") && n.includes("draft")) return "K1_DRAFT";
  if (n.includes("k1")) return "K1_FINAL";
  if (n.includes("bl") || n.includes("bill of lading")) return "BL";
  if (n.includes("packing")) return "PACKING_LIST";
  if (n.includes("invoice") && (n.includes("logistic") || n.includes("freight"))) return "LOGISTICS_INVOICE";
  if (n.includes("invoice")) return "SUPPLIER_INVOICE";
  return "PO_PDF";
}

// Find the PO whose (uppercased) po_number is a substring of the (uppercased)
// filename. If several match, the LONGEST po_number wins.
function matchPo(name: string, pos: PoOption[]): string {
  const upper = name.toUpperCase();
  let bestId = "";
  let bestLen = -1;
  for (const po of pos) {
    const num = (po.po_number || "").toUpperCase();
    if (!num) continue;
    if (upper.includes(num) && num.length > bestLen) {
      bestId = po.id;
      bestLen = num.length;
    }
  }
  return bestId;
}

type RowState = {
  file: File;
  poId: string;
  docType: string;
  include: boolean;
};

export function BulkDocImport({ pos }: { pos: PoOption[] }) {
  const [rows, setRows] = useState<RowState[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportPoDocumentsResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setResult(null);
    setRows(
      files.map((file) => {
        const poId = matchPo(file.name, pos);
        return {
          file,
          poId,
          docType: inferDocType(file.name),
          include: true,
          // Auto-off when nothing matched (handled below via poId check).
        };
      }).map((r) => ({ ...r, include: !!r.poId }))
    );
  }

  function updateRow(idx: number, patch: Partial<RowState>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  const matchedCount = useMemo(() => rows.filter((r) => r.poId).length, [rows]);
  const needPoCount = useMemo(() => rows.filter((r) => !r.poId).length, [rows]);
  const includedRows = useMemo(() => rows.filter((r) => r.include), [rows]);
  // Block upload while any included row has no PO chosen.
  const hasIncludedMissingPo = includedRows.some((r) => !r.poId);

  async function handleUpload() {
    const toUpload = rows.filter((r) => r.include && r.poId);
    if (toUpload.length === 0) return;

    const fd = new FormData();
    for (const r of toUpload) {
      fd.append("files", r.file);
      fd.append("po_id", r.poId);
      fd.append("doc_type", r.docType);
    }

    setUploading(true);
    setResult(null);
    const res = await importPoDocuments(fd);
    setUploading(false);
    setResult(res);
    if (res.ok) {
      setRows([]);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-600">Documents (any files)</span>
          <input
            ref={fileRef}
            type="file"
            multiple
            onChange={handleFiles}
            className="text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-gray-100 file:text-gray-700 file:text-sm hover:file:bg-gray-200"
          />
        </label>
      </div>

      {rows.length > 0 && (
        <>
          <p className="text-sm text-gray-600">
            {rows.length} file{rows.length === 1 ? "" : "s"} ·{" "}
            <span className="text-emerald-700">{matchedCount} matched</span> ·{" "}
            <span className={needPoCount ? "text-amber-700" : "text-gray-500"}>
              {needPoCount} need a PO
            </span>
          </p>

          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50/60">
                  <th className="py-2 pl-4 pr-3 font-medium">Include</th>
                  <th className="py-2 px-3 font-medium">File</th>
                  <th className="py-2 px-3 font-medium">Matched PO</th>
                  <th className="py-2 pr-4 pl-3 font-medium">Document type</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const noPo = !r.poId;
                  return (
                    <tr
                      key={i}
                      className={
                        "border-b border-gray-100 last:border-0 " +
                        (noPo ? "bg-amber-50/60" : "")
                      }
                    >
                      <td className="py-2 pl-4 pr-3">
                        <input
                          type="checkbox"
                          checked={r.include}
                          onChange={(e) => updateRow(i, { include: e.target.checked })}
                        />
                      </td>
                      <td className="py-2 px-3 text-gray-700 max-w-[18rem] truncate" title={r.file.name}>
                        {r.file.name}
                      </td>
                      <td className="py-2 px-3">
                        <select
                          value={r.poId}
                          onChange={(e) => updateRow(i, { poId: e.target.value })}
                          className={
                            "border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 " +
                            (noPo ? "border-amber-400" : "border-gray-300")
                          }
                        >
                          <option value="">— choose PO —</option>
                          {pos.map((po) => (
                            <option key={po.id} value={po.id}>
                              {po.po_number || "(draft)"}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-4 pl-3">
                        <select
                          value={r.docType}
                          onChange={(e) => updateRow(i, { docType: e.target.value })}
                          className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
                        >
                          {DOC_TYPES.map((dt) => (
                            <option key={dt} value={dt}>
                              {DOC_TYPE_LABELS[dt]}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              onClick={handleUpload}
              disabled={uploading || includedRows.length === 0 || hasIncludedMissingPo}
            >
              {uploading
                ? "Uploading…"
                : `Upload ${includedRows.length} document${includedRows.length === 1 ? "" : "s"}`}
            </Button>
            {hasIncludedMissingPo && (
              <span className="text-sm text-amber-700">
                Choose a PO for every included row, or un-check it.
              </span>
            )}
          </div>
        </>
      )}

      {result && (
        <div className="text-sm">
          {result.ok ? (
            <div className="space-y-3">
              <p className="text-emerald-700">
                Uploaded {result.uploaded ?? 0} document{result.uploaded === 1 ? "" : "s"}
                {result.failed?.length ? `, ${result.failed.length} failed` : ""}.
              </p>
              {result.failed && result.failed.length > 0 && (
                <div className="border border-amber-200 bg-amber-50 rounded-md p-3">
                  <p className="font-medium text-amber-800">Failed:</p>
                  <ul className="mt-1 space-y-0.5 text-amber-700">
                    {result.failed.map((f, i) => (
                      <li key={i}>
                        {f.file}: {f.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-red-600">Error: {result.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
