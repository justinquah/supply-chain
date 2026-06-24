"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  approvePO,
  recordInvoice,
  markShipped,
  markReceived,
} from "../actions";

type Result = { ok: boolean; error?: string };

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

function FileField({ label, name, required }: { label: string; name: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500 block mb-1">
        {label}
        {required && " *"}
      </span>
      <input
        type="file"
        name={name}
        required={required}
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        className="block w-full text-xs text-gray-600 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
      />
    </label>
  );
}

// Wraps a stage form: handles submit -> server action -> refresh.
function StageForm({
  poId,
  action,
  submitLabel,
  children,
}: {
  poId: string;
  action: (fd: FormData) => Promise<Result>;
  submitLabel: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    fd.set("po_id", poId);
    const res = await action(fd);
    setSaving(false);
    if (res.ok) {
      setMsg("Done.");
      router.refresh();
    } else {
      setMsg(`Error: ${res.error}`);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {children}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : submitLabel}
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
  );
}

type Props = {
  poId: string;
  status: string;
  paymentTerms: string | null;
  // Receive-gate context (only meaningful at SHIPPED).
  balanceRemaining: number;
  hasBl: boolean;
  hasK1: boolean;
};

export function StageForms({
  poId,
  status,
  paymentTerms,
  balanceRemaining,
  hasBl,
  hasK1,
}: Props) {
  // DRAFT → PO_APPROVED (Accounts/Admin)
  if (status === "DRAFT") {
    return (
      <StageForm poId={poId} action={approvePO} submitLabel="Approve PO">
        <p className="text-sm text-gray-600">
          Upload the signed PO PDF and set the PO number and targeted ETA.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="PO number *">
            <input name="po_number" required className={inputCls} placeholder="PO-2026-001" />
          </Field>
          <Field label="Targeted ETA">
            <input name="targeted_eta" type="date" className={inputCls} />
          </Field>
        </div>
        <FileField label="Signed PO PDF" name="file_po" required />
      </StageForm>
    );
  }

  // PO_APPROVED → INVOICE_RECEIVED (SCM/Admin)
  if (status === "PO_APPROVED") {
    return (
      <StageForm poId={poId} action={recordInvoice} submitLabel="Record invoice">
        <p className="text-sm text-gray-600">
          Upload the supplier invoice and key its amount, number and date.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Invoice number *">
            <input name="invoice_number" required className={inputCls} placeholder="INV-..." />
          </Field>
          <Field label="Invoice amount *">
            <input
              name="invoice_amount"
              type="number"
              step="0.01"
              required
              className={inputCls}
              placeholder="0.00"
            />
          </Field>
          <Field label="Invoice date">
            <input name="invoice_date" type="date" className={inputCls} />
          </Field>
          <Field label="Payment terms (confirm)">
            <input
              name="payment_terms"
              className={inputCls}
              defaultValue={paymentTerms ?? ""}
              placeholder="confirm or amend"
            />
          </Field>
        </div>
        <FileField label="Supplier invoice" name="file_invoice" required />
      </StageForm>
    );
  }

  // INVOICE_RECEIVED → SHIPPED (Logistics/Admin)
  if (status === "INVOICE_RECEIVED") {
    return (
      <StageForm poId={poId} action={markShipped} submitLabel="Mark shipped">
        <p className="text-sm text-gray-600">
          Upload the Bill of Lading and final K1, then set the actual ETA.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FileField label="Bill of Lading (BL)" name="file_bl" required={!hasBl} />
          <FileField label="K1 (final)" name="file_k1" required={!hasK1} />
          <Field label="Actual ETA">
            <input name="actual_eta" type="date" className={inputCls} />
          </Field>
        </div>
        {(hasBl || hasK1) && (
          <p className="text-xs text-gray-500">
            {hasBl && "BL already uploaded. "}
            {hasK1 && "K1 already uploaded. "}
            Re-upload only if replacing.
          </p>
        )}
      </StageForm>
    );
  }

  // SHIPPED → RECEIVED (Warehouse/Admin) — GATED
  if (status === "SHIPPED") {
    const blocked = !hasBl || !hasK1 || balanceRemaining !== 0;
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Confirm goods received. This is gated: both BL and K1 must be on file and
          the balance must be fully paid.
        </p>
        <ul className="text-sm space-y-1">
          <GateRow ok={hasBl} label="Bill of Lading uploaded" />
          <GateRow ok={hasK1} label="K1 (final) uploaded" />
          <GateRow
            ok={balanceRemaining === 0}
            label={
              balanceRemaining === 0
                ? "Balance fully paid"
                : `Outstanding balance: ${balanceRemaining.toLocaleString("en-MY", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })} (Finance must record payment)`
            }
          />
        </ul>
        <StageForm poId={poId} action={markReceived} submitLabel="Mark received">
          <Field label="Remark">
            <input name="remark" className={inputCls} placeholder="optional note" />
          </Field>
          <FileField label="Proof photo" name="file_proof" />
          {blocked && (
            <p className="text-xs text-amber-700">
              The receive action will be rejected until all checks above are green.
              This is expected: balance only clears once Finance records payments
              (a later increment).
            </p>
          )}
        </StageForm>
      </div>
    );
  }

  return null;
}

function GateRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={ok ? "text-emerald-600" : "text-amber-600"}>
        {ok ? "✓" : "•"}
      </span>
      <span className={ok ? "text-gray-700" : "text-amber-700"}>{label}</span>
    </li>
  );
}
