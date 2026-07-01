import Link from "next/link";
import { createClient, requireRole } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/constants";
import { RecordPaymentForm } from "./record-payment-form";
import { PaymentCalendar, type PaidEntry, type DueEntry } from "./payment-calendar";
import { getSlipUrl } from "./actions";

// ---------------------------------------------------------------------------
// Money helpers
// ---------------------------------------------------------------------------
function money(n: number | null | undefined, cur?: string | null) {
  if (n == null) return "—";
  const prefix = cur && cur !== "MYR" ? `${cur} ` : "RM ";
  return (
    prefix +
    Number(n).toLocaleString("en-MY", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Kuala_Lumpur",
  });
}

// Asia/KL "today" for initial calendar month
function klToday(): { year: number; month: number } {
  const dt = new Date().toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // "DD/MM/YYYY" in en-MY locale
  const parts = dt.split(/[\/ ,]+/).map(Number);
  // toLocaleString with numeric year/month/day typically: day/month/year
  return { year: parts[2], month: parts[1] - 1 };
}

// Convert a DB date string (or Date) to "YYYY-MM-DD" in Asia/KL
function toKlDate(d: string | Date | null | undefined): string | null {
  if (!d) return null;
  const dateObj = typeof d === "string" ? new Date(d) : d;
  return dateObj.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
  // en-CA gives ISO-style YYYY-MM-DD
}

// ---------------------------------------------------------------------------
// Page — gated to FINANCE + ADMIN (read-only for ADMIN; write is FINANCE-only)
// ---------------------------------------------------------------------------
export default async function FinancePage() {
  const profile = await requireRole("FINANCE", "ADMIN");
  const isFinance = profile.role === "FINANCE";

  const supabase = await createClient();

  // (a) Finance inbox: POs with outstanding balance
  // Join purchase_orders + v_po_balance + supplier profile.
  // v_po_balance is a view on purchase_orders so we query them separately to
  // avoid ORM type gymnastics, then merge.
  const [{ data: posRaw }, { data: balancesRaw }, { data: paymentsRaw }] =
    await Promise.all([
      supabase
        .from("purchase_orders")
        .select(
          "id, po_number, invoice_currency, deposit_percent, payment_terms, " +
            "deposit_due_date, balance_due_date, " +
            "supplier:profiles!supplier_id(name, company_name)"
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("v_po_balance")
        .select("po_id, total_amount, amount_paid, balance_remaining"),
      supabase
        .from("payments")
        .select("id, po_id, amount, currency, paid_at, due_date, notes, payment_slip_path")
        .eq("status", "PAID")
        .order("paid_at", { ascending: false }),
    ]);

  const pos = (posRaw ?? []) as any[];
  const balances = (balancesRaw ?? []) as {
    po_id: string;
    total_amount: number;
    amount_paid: number;
    balance_remaining: number;
  }[];
  const payments = (paymentsRaw ?? []) as {
    id: string;
    po_id: string;
    amount: number;
    currency: string;
    paid_at: string | null;
    due_date: string | null;
    notes: string | null;
    payment_slip_path: string | null;
  }[];

  // Build balance lookup
  const balMap = new Map(balances.map((b) => [b.po_id, b]));
  // Build payments-by-po lookup
  const payByPo = new Map<string, typeof payments>();
  for (const p of payments) {
    const arr = payByPo.get(p.po_id) ?? [];
    arr.push(p);
    payByPo.set(p.po_id, arr);
  }

  // Inbox rows: POs with balance_remaining > 0
  const inboxRows = pos
    .map((po) => {
      const bal = balMap.get(po.id);
      return { po, bal };
    })
    .filter(({ bal }) => bal && Number(bal.balance_remaining) > 0)
    .sort((a, b) => {
      // Sort by soonest due (deposit_due_date or balance_due_date), null last
      const aDate =
        a.po.deposit_due_date || a.po.balance_due_date || "9999-12-31";
      const bDate =
        b.po.deposit_due_date || b.po.balance_due_date || "9999-12-31";
      return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
    });

  // (c) Calendar data — derive paid entries and due entries
  const paidEntries: PaidEntry[] = payments
    .filter((p) => p.paid_at != null)
    .map((p) => ({
      date: toKlDate(p.paid_at)!,
      amount: Number(p.amount),
      currency: p.currency ?? "MYR",
      poId: p.po_id,
      poNumber:
        pos.find((po) => po.id === p.po_id)?.po_number ?? null,
    }));

  // Due entries: for each PO with balance_remaining > 0, compute unpaid legs
  const dueEntries: DueEntry[] = [];
  for (const po of pos) {
    const bal = balMap.get(po.id);
    if (!bal) continue;
    const totalAmount = Number(bal.total_amount ?? 0);
    const amountPaid = Number(bal.amount_paid ?? 0);
    if (totalAmount <= 0) continue;

    const depositPct = Number(po.deposit_percent ?? 0);
    const depositAmount = Math.round((totalAmount * depositPct) / 100 * 100) / 100;
    const balanceAmount = Math.round((totalAmount - depositAmount) * 100) / 100;

    // Deposit leg: unpaid when amount_paid < deposit_amount
    if (
      depositAmount > 0 &&
      po.deposit_due_date &&
      amountPaid < depositAmount
    ) {
      dueEntries.push({
        date: po.deposit_due_date,
        amount: depositAmount,
        leg: "DEPOSIT",
        poId: po.id,
        poNumber: po.po_number ?? null,
      });
    }

    // Balance leg: unpaid when amount_paid < total_amount (i.e., balance not fully settled)
    if (
      balanceAmount > 0 &&
      po.balance_due_date &&
      amountPaid < totalAmount
    ) {
      dueEntries.push({
        date: po.balance_due_date,
        amount: balanceAmount,
        leg: "BALANCE",
        poId: po.id,
        poNumber: po.po_number ?? null,
      });
    }
  }

  const { year: klYear, month: klMonth } = klToday();

  // Generate signed URLs for payment slips (only for slips that exist)
  const slipUrls = new Map<string, string>();
  for (const p of payments) {
    if (p.payment_slip_path) {
      const url = await getSlipUrl(p.payment_slip_path);
      if (url) slipUrls.set(p.id, url);
    }
  }

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold">Finance</h1>
        <p className="text-sm text-gray-500 mt-1">
          Outstanding PO balances, payment recording
          {isFinance ? "" : " (read-only)"}, and the payment calendar.
          {!isFinance && (
            <span className="ml-1 text-amber-700">
              Only Finance role can record payments.
            </span>
          )}
        </p>
      </div>

      {/* (a) Finance inbox */}
      <Card>
        <CardHeader>
          <CardTitle>Outstanding balances ({inboxRows.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {inboxRows.length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center px-4">
              No POs with outstanding balances.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="py-2.5 pl-4 pr-3 font-medium">PO number</th>
                    <th className="py-2.5 px-3 font-medium">Supplier</th>
                    <th className="py-2.5 px-3 font-medium text-right">Total</th>
                    <th className="py-2.5 px-3 font-medium text-right">Paid</th>
                    <th className="py-2.5 px-3 font-medium text-right">Balance</th>
                    <th className="py-2.5 px-3 font-medium">Deposit due</th>
                    <th className="py-2.5 px-3 font-medium">Balance due</th>
                    <th className="py-2.5 pr-4 pl-3 font-medium">Terms</th>
                  </tr>
                </thead>
                <tbody>
                  {inboxRows.map(({ po, bal }) => {
                    const supplier = po.supplier as
                      | { name?: string; company_name?: string }
                      | null;
                    const cur = po.invoice_currency || "MYR";
                    return (
                      <tr
                        key={po.id}
                        className="border-b border-gray-100 hover:bg-gray-50"
                      >
                        <td className="py-2.5 pl-4 pr-3 font-medium">
                          <Link
                            href={`/purchase-orders/${po.id}`}
                            className="text-brand hover:underline"
                          >
                            {po.po_number || (
                              <span className="text-gray-400 italic">draft</span>
                            )}
                          </Link>
                        </td>
                        <td className="py-2.5 px-3 text-gray-600">
                          {supplier?.company_name || supplier?.name || "—"}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-gray-600">
                          {money(bal?.total_amount, cur)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-emerald-700">
                          {money(bal?.amount_paid, cur)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-amber-700">
                          {money(bal?.balance_remaining, cur)}
                        </td>
                        <td className="py-2.5 px-3 text-gray-600">
                          {fmtDate(po.deposit_due_date)}
                        </td>
                        <td className="py-2.5 px-3 text-gray-600">
                          {fmtDate(po.balance_due_date)}
                        </td>
                        <td className="py-2.5 pr-4 pl-3 text-gray-600">
                          {po.payment_terms || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* (b) Payment detail + record per PO */}
      <Card>
        <CardHeader>
          <CardTitle>Payment history &amp; record</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {inboxRows.length === 0 && payments.length === 0 ? (
            <p className="text-sm text-gray-500">No payments recorded yet.</p>
          ) : (
            <>
              {/* Show all POs that have outstanding balance (for recording) */}
              {inboxRows.map(({ po, bal }) => {
                const supplier = po.supplier as
                  | { name?: string; company_name?: string }
                  | null;
                const supplierName =
                  supplier?.company_name || supplier?.name || null;
                const cur = po.invoice_currency || "MYR";
                const poPayments = payByPo.get(po.id) ?? [];

                return (
                  <div
                    key={po.id}
                    className="border border-gray-200 rounded-lg p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <Link
                          href={`/purchase-orders/${po.id}`}
                          className="font-medium text-brand hover:underline"
                        >
                          {po.po_number || "Draft PO"}
                        </Link>
                        {supplierName && (
                          <span className="text-sm text-gray-500 ml-2">
                            {supplierName}
                          </span>
                        )}
                      </div>
                      <div className="text-sm tabular-nums">
                        <span className="text-gray-500">Balance: </span>
                        <span className="font-semibold text-amber-700">
                          {money(bal?.balance_remaining, cur)}
                        </span>
                        <span className="text-gray-400 ml-2 text-xs">
                          / {money(bal?.total_amount, cur)}
                        </span>
                      </div>
                    </div>

                    {/* Existing payments */}
                    {poPayments.length > 0 && (
                      <div className="space-y-1">
                        {poPayments.map((p) => {
                          const slipUrl = slipUrls.get(p.id);
                          return (
                            <div
                              key={p.id}
                              className="flex items-center gap-3 text-sm text-gray-700 bg-emerald-50 rounded px-3 py-1.5"
                            >
                              <span className="text-emerald-700 font-medium tabular-nums">
                                {money(p.amount, p.currency)}
                              </span>
                              <span className="text-gray-500">
                                {p.paid_at
                                  ? fmtDate(p.paid_at)
                                  : "—"}
                              </span>
                              {p.notes && (
                                <span className="text-gray-500 text-xs">
                                  {p.notes}
                                </span>
                              )}
                              {slipUrl && (
                                <a
                                  href={slipUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-brand hover:underline"
                                >
                                  Slip
                                </a>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <RecordPaymentForm
                      poId={po.id}
                      poNumber={po.po_number ?? null}
                      supplierName={supplierName}
                      isFinance={isFinance}
                    />
                  </div>
                );
              })}

              {/* POs that are fully paid but have payment history */}
              {pos
                .filter((po) => {
                  const bal = balMap.get(po.id);
                  const hasPayments = (payByPo.get(po.id) ?? []).length > 0;
                  const outstanding = bal && Number(bal.balance_remaining) > 0;
                  return hasPayments && !outstanding;
                })
                .map((po) => {
                  const poPayments = payByPo.get(po.id) ?? [];
                  const bal = balMap.get(po.id);
                  const supplier = po.supplier as
                    | { name?: string; company_name?: string }
                    | null;
                  const cur = po.invoice_currency || "MYR";

                  return (
                    <div
                      key={po.id}
                      className="border border-gray-100 rounded-lg p-4 space-y-2 opacity-80"
                    >
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <Link
                          href={`/purchase-orders/${po.id}`}
                          className="font-medium text-gray-700 hover:underline"
                        >
                          {po.po_number || "Draft PO"}
                        </Link>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                          Fully paid — {money(bal?.amount_paid, cur)}
                        </span>
                      </div>
                      {poPayments.map((p) => {
                        const slipUrl = slipUrls.get(p.id);
                        return (
                          <div
                            key={p.id}
                            className="flex items-center gap-3 text-sm text-gray-600"
                          >
                            <span className="tabular-nums">
                              {money(p.amount, p.currency)}
                            </span>
                            <span className="text-gray-400">
                              {p.paid_at ? fmtDate(p.paid_at) : "—"}
                            </span>
                            {p.notes && (
                              <span className="text-xs text-gray-400">{p.notes}</span>
                            )}
                            {slipUrl && (
                              <a
                                href={slipUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-brand hover:underline"
                              >
                                Slip
                              </a>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
            </>
          )}
        </CardContent>
      </Card>

      {/* (c) Payment calendar */}
      <Card>
        <CardHeader>
          <CardTitle>Payment calendar</CardTitle>
        </CardHeader>
        <CardContent>
          <PaymentCalendar
            paidEntries={paidEntries}
            dueEntries={dueEntries}
            initialYear={klYear}
            initialMonth={klMonth}
          />
        </CardContent>
      </Card>
    </div>
  );
}
