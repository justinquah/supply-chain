"use client";

import { useState } from "react";
import { getSupplierDocUrl } from "./actions";

/**
 * "View" button for a supplier's own PO document. Requests a short-lived signed
 * URL via the server action (which re-verifies PO ownership) and opens it in a
 * new tab. Mirrors the DocBadges pattern from the internal PO views.
 */
export function SupplierDocLink({
  poId,
  filePath,
  fileName,
}: {
  poId: string;
  filePath: string;
  fileName: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setLoading(true);
    setError(null);
    const res = await getSupplierDocUrl(poId, filePath);
    setLoading(false);
    if (res.ok && res.url) {
      window.open(res.url, "_blank");
    } else {
      setError(res.error || "Unavailable");
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={open}
        disabled={loading}
        title={`View ${fileName}`}
        className="text-xs px-2 py-0.5 rounded font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors disabled:opacity-50"
      >
        {loading ? "…" : "View"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
