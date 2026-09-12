"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  amendPoQuantities,
  recordCreditNote,
  type AmendmentLineInput,
} from "../actions";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, formatBytes } from "@/lib/constants";

// One line as rendered by the modal. `incomingStockId` is the row's id in
// `incoming_stock` — the server action uses it to update the exact line.
export type AmendmentLineRow = {
  incomingStockId: string;
  productSku: string;
  productLabel: string; // "range - variation" or product name
  oldQty: number;
};

const inputCls =
  "w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40";

// Panel shown on the PO detail page for SCM/ADMIN/FINANCE/ACCOUNTS once the PO
// is Sent or later. Exposes two entry points:
//   1. "Amend quantities" — SCM/Finance edits the shipped quantities and either
//      overwrites the supplier invoice amount OR flags a pending credit note.
//   2. "Record credit note" — finance attaches the supplier's credit note (doc
//      optional) so the effective payable is reduced without touching the
//      original invoice_amount.
export function AmendmentsPanel({
  poId,
  currency,
  lines,
  currentInvoiceAmount,
}: {
  poId: string;
  currency: string | null;
  lines: AmendmentLineRow[];
  currentInvoiceAmount: number | null;
}) {
  const [mode, setMode] = useState<"idle" | "amend" | "credit">("idle");

  return (
    <div className="space-y-4">
      {mode === "idle" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setMode("amend")} disabled={lines.length === 0}>
            Amend quantities
          </Button>
          <Button variant="outline" onClick={() => setMode("credit")}>
            Record credit note
          </Button>
          {lines.length === 0 && (
            <span className="text-xs text-gray-400">
              No lines yet — amendments become available after shipping lines exist.
            </span>
          )}
        </div>
      )}

      {mode === "amend" && (
        <AmendForm
          poId={poId}
          currency={currency}
          lines={lines}
          currentInvoiceAmount={currentInvoiceAmount}
          onClose={() => setMode("idle")}
        />
      )}
      {mode === "credit" && (
        <CreditNoteForm
          poId={poId}
          currency={currency}
          onClose={() => setMode("idle")}
        />
      )}
    </div>
  );
}

// -- Amend quantities form ---------------------------------------------------
function AmendForm({
  poId,
  currency,
  lines,
  currentInvoiceAmount,
  onClose,
}: {
  poId: string;
  currency: string | null;
  lines: AmendmentLineRow[];
  currentInvoiceAmount: number | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [qtys, setQtys] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.incomingStockId, String(l.oldQty)]))
  );
  const [reason, setReason] = useState("");
  const [invoiceMode, setInvoiceMode] = useState<"revise" | "credit_expected">(
    "revise"
  );
  const [revisedAmount, setRevisedAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!reason.trim()) {
      setErr("Reason is required");
      return;
    }
    const changed: AmendmentLineInput[] = [];
    for (const l of lines) {
      const raw = qtys[l.incomingStockId];
      const n = raw == null || raw === "" ? l.oldQty : Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        setErr(`Invalid quantity for ${l.productLabel}`);
        return;
      }
      if (n !== l.oldQty) {
        changed.push({ incomingStockId: l.incomingStockId, newQuantity: n });
      }
    }
    if (changed.length === 0) {
      setErr("No quantities changed");
      return;
    }
    const revisedNum =
      invoiceMode === "revise" && revisedAmount.trim() !== ""
        ? Number(revisedAmount)
        : null;
    if (invoiceMode === "revise" && revisedNum != null && !Number.isFinite(revisedNum)) {
      setErr("Revised invoice amount must be a number");
      return;
    }

    setSaving(true);
    setErr(null);
    const res = await amendPoQuantities({
      poId,
      lines: changed,
      reason: reason.trim(),
      revisedInvoiceAmount: revisedNum,
      creditNoteExpected: invoiceMode === "credit_expected",
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (res.ok) {
      onClose();
      router.refresh();
    } else {
      setErr(res.error || "Failed");
    }
  }

  return (
    <div className="rounded-md border border-gray-200 bg-white p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Amend quantities</h4>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-gray-500 hover:text-gray-800"
        >
          Cancel
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-100">
              <th className="py-1.5 pr-3">Product</th>
              <th className="py-1.5 pr-3 text-right">Ordered</th>
              <th className="py-1.5 pr-3 text-right">Actual qty</th>
              <th className="py-1.5 pr-3 text-right">Δ</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const raw = qtys[l.incomingStockId] ?? "";
              const n = raw === "" ? l.oldQty : Number(raw);
              const delta = Number.isFinite(n) ? n - l.oldQty : 0;
              return (
                <tr key={l.incomingStockId} className="border-b border-gray-50">
                  <td className="py-1 pr-3">
                    <div>{l.productLabel}</div>
                    <div className="text-[10px] text-gray-400">{l.productSku}</div>
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">{l.oldQty}</td>
                  <td className="py-1 pr-3 text-right">
                    <input
                      type="number"
                      min="0"
                      value={qtys[l.incomingStockId] ?? ""}
                      onChange={(e) =>
                        setQtys((s) => ({ ...s, [l.incomingStockId]: e.target.value }))
                      }
                      className="w-24 border border-gray-300 rounded-md px-2 py-1 text-right"
                    />
                  </td>
                  <td
                    className={
                      "py-1 pr-3 text-right tabular-nums " +
                      (delta === 0
                        ? "text-gray-400"
                        : delta < 0
                          ? "text-red-600"
                          : "text-emerald-700")
                    }
                  >
                    {delta === 0 ? "—" : (delta > 0 ? "+" : "") + delta}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <div className="text-xs text-gray-500 mb-1">Invoice handling</div>
        <div className="flex gap-4 text-xs">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={invoiceMode === "revise"}
              onChange={() => setInvoiceMode("revise")}
            />
            <span>Overwrite invoice amount</span>
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={invoiceMode === "credit_expected"}
              onChange={() => setInvoiceMode("credit_expected")}
            />
            <span>Credit note expected (finance will attach)</span>
          </label>
        </div>
        {invoiceMode === "revise" && (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              step="0.01"
              min="0"
              value={revisedAmount}
              onChange={(e) => setRevisedAmount(e.target.value)}
              placeholder={
                currentInvoiceAmount != null
                  ? `was ${currentInvoiceAmount}`
                  : "revised amount"
              }
              className={inputCls + " max-w-xs"}
            />
            <span className="text-xs text-gray-500">{currency || "MYR"}</span>
          </div>
        )}
      </div>

      <label className="block">
        <span className="text-xs text-gray-500 block mb-1">Reason *</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. supplier shipped short by 200 units"
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className="text-xs text-gray-500 block mb-1">Notes (optional)</span>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={inputCls}
        />
      </label>

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Apply amendment"}
        </Button>
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
    </div>
  );
}

// -- Credit note form -------------------------------------------------------
function CreditNoteForm({
  poId,
  currency,
  onClose,
}: {
  poId: string;
  currency: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const picked = fd.get("file");
    if (picked instanceof File && picked.size > MAX_UPLOAD_BYTES) {
      setMsg(
        `Error: ${picked.name} is ${formatBytes(picked.size)} — over the ${MAX_UPLOAD_LABEL} limit.`
      );
      return;
    }
    fd.set("po_id", poId);
    setSaving(true);
    setMsg(null);
    const res = await recordCreditNote(fd);
    setSaving(false);
    if (res.ok) {
      onClose();
      router.refresh();
    } else {
      setMsg(`Error: ${res.error}`);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border border-gray-200 bg-white p-3 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Record credit note</h4>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-gray-500 hover:text-gray-800"
        >
          Cancel
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-gray-500 block mb-1">Credit note number *</span>
          <input required name="credit_note_number" className={inputCls} />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500 block mb-1">
            Amount * ({currency || "MYR"})
          </span>
          <input
            required
            name="credit_note_amount"
            type="number"
            step="0.01"
            min="0"
            className={inputCls}
          />
        </label>
      </div>
      <label className="block">
        <span className="text-xs text-gray-500 block mb-1">File (optional)</span>
        <input
          type="file"
          name="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          className="block w-full text-xs text-gray-600 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
        />
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Record credit note"}
        </Button>
        {msg && (
          <span
            className={
              "text-xs " + (msg.startsWith("Error") ? "text-red-600" : "text-emerald-700")
            }
          >
            {msg}
          </span>
        )}
      </div>
    </form>
  );
}
