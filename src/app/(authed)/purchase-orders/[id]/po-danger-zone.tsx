"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelPurchaseOrder, deletePurchaseOrder } from "../actions";

// SCM/ADMIN: cancel a PO (keeps its history, stops it counting as incoming) or
// permanently delete a Draft/Cancelled PO that has no payments. Rendering is
// gated on the server; both actions re-check role and rules.
export function PoDangerZone({
  poId,
  poNumber,
  status,
}: {
  poId: string;
  poNumber: string | null;
  status: string;
}) {
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const canCancel = status !== "CANCELLED" && status !== "COMPLETED";
  const canDelete = status === "DRAFT" || status === "CANCELLED";
  const label = poNumber || "this PO";

  function doCancel() {
    setErr(null);
    startTransition(async () => {
      const res = await cancelPurchaseOrder(poId, reason);
      if (res.ok) {
        setCancelOpen(false);
        setReason("");
        router.refresh();
      } else setErr(res.error ?? "Could not cancel");
    });
  }

  function doDelete() {
    if (
      !window.confirm(
        `Permanently delete ${label}? Its documents, lines and history are removed and this can't be undone.`
      )
    )
      return;
    setErr(null);
    startTransition(async () => {
      const res = await deletePurchaseOrder(poId);
      if (res.ok) router.push("/purchase-orders");
      else setErr(res.error ?? "Could not delete");
    });
  }

  if (!canCancel && !canDelete) return null;

  return (
    <div className="border-t border-gray-100 pt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {canCancel && !cancelOpen && (
          <button
            type="button"
            onClick={() => setCancelOpen(true)}
            className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
          >
            Cancel PO
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={doDelete}
            disabled={isPending}
            className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isPending && !cancelOpen ? "Deleting…" : "Delete PO permanently"}
          </button>
        )}
        <span className="text-[11px] text-gray-400">
          {status === "CANCELLED"
            ? "Cancelled — not counted as incoming. To reopen, set a status above."
            : status === "DRAFT"
            ? "Drafts aren't counted as incoming. Delete removes it for good."
            : "Cancelling keeps the record but stops its quantity counting as incoming."}
        </span>
      </div>
      {cancelOpen && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={isPending}
            placeholder="Reason (required) — e.g. supplier can't fulfil, duplicate PO"
            className="flex-1 min-w-[260px] border border-gray-300 rounded-md px-2.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
          />
          <button
            type="button"
            onClick={doCancel}
            disabled={isPending || !reason.trim()}
            className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isPending ? "Cancelling…" : "Confirm cancel"}
          </button>
          <button
            type="button"
            onClick={() => {
              setCancelOpen(false);
              setErr(null);
            }}
            disabled={isPending}
            className="text-xs text-gray-500 hover:text-gray-800"
          >
            Back
          </button>
        </div>
      )}
      {err && <div className="text-xs text-red-600">{err}</div>}
    </div>
  );
}
