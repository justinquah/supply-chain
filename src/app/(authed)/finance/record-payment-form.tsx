"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { recordPayment, updateBaTerms } from "./actions";

const inputCls =
  "w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500 block mb-1">{label}</span>
      {children}
    </label>
  );
}

// Add ba_term_days to a base date and return "YYYY-MM-DD"
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type RecordProps = {
  poId: string;
  poNumber: string | null;
  supplierName: string | null;
  /** Whether the current signed-in user is FINANCE (only they can submit). */
  isFinance: boolean;
  /** COALESCE(actual_eta, targeted_eta) from the PO for BA base date. */
  poEta: string | null;
};

export function RecordPaymentForm({
  poId,
  poNumber,
  supplierName,
  isFinance,
  poEta,
}: RecordProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Payment method state
  const [method, setMethod] = useState<"BANK_BALANCE" | "BANKERS_ACCEPTANCE">(
    "BANK_BALANCE"
  );
  const [paidAt, setPaidAt] = useState<string>("");
  const [baTermDays, setBaTermDays] = useState<number>(120);
  const [baDueDateOverride, setBaDueDateOverride] = useState<string>("");

  // Compute the BA base date: COALESCE(poEta, paidAt)
  const baBaseDate = poEta || paidAt;
  const computedBaDueDate =
    baBaseDate && method === "BANKERS_ACCEPTANCE"
      ? addDays(baBaseDate, baTermDays)
      : "";

  // When method changes back to BANK_BALANCE, reset BA fields
  useEffect(() => {
    if (method === "BANK_BALANCE") {
      setBaTermDays(120);
      setBaDueDateOverride("");
    }
  }, [method]);

  if (!isFinance) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    fd.set("po_id", poId);
    // Pass the computed base date so server can recalculate if no override
    if (baBaseDate) fd.set("ba_base_date", baBaseDate);
    const res = await recordPayment(fd);
    setSaving(false);
    if (res.ok) {
      setMsg("Payment recorded.");
      setOpen(false);
      setMethod("BANK_BALANCE");
      setPaidAt("");
      setBaTermDays(120);
      setBaDueDateOverride("");
      router.refresh();
    } else {
      setMsg(`Error: ${res.error}`);
    }
  }

  return (
    <div>
      {!open && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(true);
            setMsg(null);
          }}
        >
          Record payment
        </Button>
      )}

      {open && (
        <form
          onSubmit={handleSubmit}
          className="mt-3 border border-gray-200 rounded-lg p-4 space-y-3 bg-white"
        >
          <p className="text-sm font-medium text-gray-800">
            Record payment — {poNumber || "draft"}{" "}
            {supplierName ? `· ${supplierName}` : ""}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Amount (MYR) *">
              <input
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                className={inputCls}
                placeholder="0.00"
              />
            </Field>
            <Field label="Currency">
              <select name="currency" className={inputCls} defaultValue="MYR">
                <option value="MYR">MYR</option>
                <option value="USD">USD</option>
              </select>
            </Field>
            <Field label="Date paid *">
              <input
                name="paid_at"
                type="date"
                required
                className={inputCls}
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
              />
            </Field>
            <Field label="Leg">
              <select name="leg" className={inputCls} defaultValue="OTHER">
                <option value="DEPOSIT">Deposit</option>
                <option value="BALANCE">Balance</option>
                <option value="OTHER">Other</option>
              </select>
            </Field>
          </div>

          {/* Payment method */}
          <Field label="Payment method *">
            <select
              name="payment_method"
              className={inputCls}
              value={method}
              onChange={(e) =>
                setMethod(e.target.value as "BANK_BALANCE" | "BANKERS_ACCEPTANCE")
              }
            >
              <option value="BANK_BALANCE">Bank Balance</option>
              <option value="BANKERS_ACCEPTANCE">Banker&apos;s Acceptance (BA)</option>
            </select>
          </Field>

          {/* BA-specific fields */}
          {method === "BANKERS_ACCEPTANCE" && (
            <div className="rounded-md bg-blue-50 border border-blue-200 p-3 space-y-3">
              <p className="text-xs text-blue-700 font-medium">
                Banker&apos;s Acceptance — the supplier is paid now; cash settles on the BA due date.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="BA term (days, 0–120)">
                  <input
                    name="ba_term_days"
                    type="number"
                    min={0}
                    max={120}
                    className={inputCls}
                    value={baTermDays}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isNaN(v)) setBaTermDays(v);
                    }}
                  />
                </Field>
                <div>
                  <span className="text-xs text-gray-500 block mb-1">
                    Computed BA due date
                    {poEta ? " (based on PO ETA)" : " (based on paid date)"}
                  </span>
                  <div className="text-sm text-blue-800 font-medium py-1.5">
                    {computedBaDueDate || "—"}
                  </div>
                  {poEta && (
                    <p className="text-xs text-gray-400">
                      PO ETA: {poEta}
                    </p>
                  )}
                </div>
              </div>
              <Field label="Override BA due date (optional)">
                <input
                  name="ba_due_date_override"
                  type="date"
                  className={inputCls}
                  value={baDueDateOverride}
                  onChange={(e) => setBaDueDateOverride(e.target.value)}
                  placeholder="Leave blank to use computed date"
                />
              </Field>
              {!baDueDateOverride && computedBaDueDate && (
                <p className="text-xs text-blue-600">
                  Will use computed date: <strong>{computedBaDueDate}</strong>
                </p>
              )}
            </div>
          )}

          <Field label="Notes">
            <input name="notes" className={inputCls} placeholder="optional" />
          </Field>

          <label className="block">
            <span className="text-xs text-gray-500 block mb-1">
              Payment slip (optional)
            </span>
            <input
              type="file"
              name="payment_slip"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              className="block w-full text-xs text-gray-600 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
            />
          </label>

          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "Saving…" : "Save payment"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setMsg(null);
              }}
            >
              Cancel
            </Button>
            {msg && (
              <span
                className={
                  "text-sm " +
                  (msg.startsWith("Error") ? "text-red-600" : "text-emerald-700")
                }
              >
                {msg}
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit BA terms inline
// ---------------------------------------------------------------------------
type EditBaProps = {
  paymentId: string;
  currentTermDays: number | null;
  currentDueDate: string | null;
  onDone: () => void;
};

export function EditBaTermsForm({
  paymentId,
  currentTermDays,
  currentDueDate,
  onDone,
}: EditBaProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [termDays, setTermDays] = useState<number>(currentTermDays ?? 120);
  const [dueDate, setDueDate] = useState<string>(currentDueDate ?? "");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const res = await updateBaTerms(paymentId, termDays, dueDate);
    setSaving(false);
    if (res.ok) {
      router.refresh();
      onDone();
    } else {
      setMsg(`Error: ${res.error}`);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-2 rounded border border-blue-200 bg-blue-50 p-3 space-y-2"
    >
      <p className="text-xs font-medium text-blue-800">Update BA terms</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs text-gray-500 block mb-1">Term (days)</span>
          <input
            type="number"
            min={0}
            max={120}
            className={inputCls}
            value={termDays}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v)) setTermDays(v);
            }}
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500 block mb-1">BA due date</span>
          <input
            type="date"
            required
            className={inputCls}
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving…" : "Update"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        {msg && <span className="text-xs text-red-600">{msg}</span>}
      </div>
    </form>
  );
}
