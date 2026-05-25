"use client";

import { useState } from "react";
import { getDocUrl } from "./actions";

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
  docs,
}: {
  docs: { id: string; doc_type: string; file_path: string; file_name: string }[];
}) {
  const [loading, setLoading] = useState<string | null>(null);
  const byType = new Map(docs.map((d) => [d.doc_type, d]));

  async function open(filePath: string, id: string) {
    setLoading(id);
    const url = await getDocUrl(filePath);
    setLoading(null);
    if (url) window.open(url, "_blank");
  }

  return (
    <div className="flex gap-1 flex-wrap">
      {ORDER.map((t) => {
        const doc = byType.get(t);
        const present = !!doc;
        return (
          <button
            key={t}
            disabled={!present || loading === doc?.id}
            onClick={() => doc && open(doc.file_path, doc.id)}
            title={present ? `Open ${doc!.file_name}` : `${LABEL[t]} not uploaded`}
            className={
              "text-[11px] px-1.5 py-0.5 rounded font-medium transition-colors " +
              (present
                ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 cursor-pointer"
                : "bg-gray-100 text-gray-300 cursor-default")
            }
          >
            {loading === doc?.id ? "…" : LABEL[t]}
          </button>
        );
      })}
    </div>
  );
}
