"use client";

import { useState } from "react";
import { getDocUrl } from "../actions";

// Small client button that resolves a signed URL for the receipt proof photo
// (private receipt-photos bucket) on demand, same pattern as DocBadges.
export function ReceiptProofLink({ filePath }: { filePath: string }) {
  const [loading, setLoading] = useState(false);

  async function open() {
    setLoading(true);
    const url = await getDocUrl(filePath);
    setLoading(false);
    if (url) window.open(url, "_blank");
  }

  return (
    <button
      onClick={open}
      disabled={loading}
      className="text-[11px] px-1.5 py-0.5 rounded font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 cursor-pointer"
    >
      {loading ? "…" : "View photo"}
    </button>
  );
}
