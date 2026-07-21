import Link from "next/link";
import { createClient, requireRole } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/constants";
import { EmailSupplierButton } from "../purchase-orders/email-supplier-button";
import { paymentSlipEmail } from "@/lib/supplier-email";
import { RecordPaymentForm } from "./record-payment-form";
import {
  PaymentCalendar,
  type PaidEntry,
  type DueEntry,
  type BaEntry,
  type FinancingEntry,
} from "./payment-calendar";
import { getSlipUrl } from "./actions";
import { EditBaTermsFormWrapper } from "./edit-ba-wrapper";
import {
  FinancingObligations,
  type FinancingObligationRow,
} from "./financing-obligations";
import { isSettled } from "@/lib/financing";
import {
  BankFacilities,
  type BankCreditLimitRow,
  type BankFacility,
} from "./bank-facilities";

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

// Asia/KL "today" for initial calendar month and BA calculations
function klTodayInfo(): { year: number; month: number; todayIso: string } {
  const dt = new Date().toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // "DD/MM/YYYY" in en-MY locale
  const parts = dt.split(/[\/ ,]+/).map(Number);
  const year = parts[2];
  const month = parts[1] - 1; // 0-indexed
  const day = parts[0];
  const todayIso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { year, month, todayIso };
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
  // ACCOUNTS = FINANCE, SCM = ADMIN.
  const profile = await requireRole("FINANCE", "ACCOUNTS", "ADMIN", "SCM");
  const isFinance =
    profile.role === "FINANCE" || profile.role === "ACCOUNTS";

  const supabase = await createClient();

  // (a) Finance inbox: POs with outstanding balance + (c) calendar data
  const [
    { data: posRaw },
    { data: balancesRaw },
    { data: paymentsRaw },
    { data: fxRows },
    { data: financingRaw },
    { data: bankLimitsRaw },
  ] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select(
        "id, po_number, invoice_currency, deposit_percent, payment_terms, " +
          "deposit_due_date, balance_due_date, actual_eta, targeted_eta, supplier_id, " +
          "supplier:profiles!supplier_id(name, company_name)"
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("v_po_balance")
      .select("po_id, total_amount, amount_paid, balance_remaining"),
    supabase
      .from("payments")
      .select(
        "id, po_id, amount, currency, paid_at, due_date, notes, payment_slip_path, " +
          "payment_method, ba_term_days, ba_due_date"
      )
      .eq("status", "PAID")
      .order("paid_at", { ascending: false }),
    // FX rates (currency -> rate_to_myr) for MYR-estimate calendar conversion.
    supabase.from("fx_rates").select("currency, rate_to_myr"),
    // Standalone bank financing obligations (BA + Invoice Financing).
    // status/paid_at are deliberately NOT selected — paid state is derived from
    // due_date (BA/IF always settle on their due date), so those columns are
    // vestigial and must not drive any display logic.
    supabase
      .from("financing_obligations")
      .select("id, kind, reference, bank, amount, currency, due_date, notes")
      .order("due_date", { ascending: true }),
    // Bank facility limits — one row per bank, matched to financing_obligations.bank.
    supabase
      .from("bank_credit_limits")
      .select("bank, short_name, limit_amount, currency, notes")
      .order("short_name", { ascending: true }),
  ]);

  // currency -> rate_to_myr; missing rate treated as 1 (best-effort estimate).
  const fxMap = new Map<string, number>();
  for (const r of (fxRows ?? []) as any[]) {
    const rate = Number(r.rate_to_myr);
    if (Number.isFinite(rate)) fxMap.set(String(r.currency), rate);
  }
  const toMyr = (amount: number, cur: string | null | undefined): number =>
    Number(amount) * (fxMap.get(String(cur ?? "MYR")) ?? 1);

  const pos = (posRaw ?? []) as any[];
  const balances = (balancesRaw ?? []) as {
    po_id: string;
    total_amount: number;
    amount_paid: number;
    balance_remaining: number;
  }[];
  type PaymentRow = {
    id: string;
    po_id: string;
    amount: number;
    currency: string;
    paid_at: string | null;
    due_date: string | null;
    notes: string | null;
    payment_slip_path: string | null;
    payment_method: "BANK_BALANCE" | "BANKERS_ACCEPTANCE";
    ba_term_days: number | null;
    ba_due_date: string | null;
  };
  const payments = (paymentsRaw ?? []) as unknown as PaymentRow[];

  // Build balance lookup
  const balMap = new Map(balances.map((b) => [b.po_id, b]));
  // Build po lookup for easy number resolution
  const poMap = new Map(pos.map((po) => [po.id, po]));
  // Build payments-by-po lookup
  const payByPo = new Map<string, PaymentRow[]>();
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

  // (c) Calendar data
  const { year: klYear, month: klMonth, todayIso } = klTodayInfo();
  const todayEpoch = new Date(todayIso).getTime();

  // Paid entries: BANK_BALANCE payments on their paid_at date (actual cash out)
  const paidEntries: PaidEntry[] = payments
    .filter((p) => p.paid_at != null && p.payment_method === "BANK_BALANCE")
    .map((p) => ({
      date: toKlDate(p.paid_at)!,
      amount: Number(p.amount),
      amountMyr: toMyr(Number(p.amount), p.currency),
      currency: p.currency ?? "MYR",
      poId: p.po_id,
      poNumber: poMap.get(p.po_id)?.po_number ?? null,
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
    const poCurrency = po.invoice_currency || "MYR";

    // Deposit leg: unpaid when amount_paid < deposit_amount
    if (
      depositAmount > 0 &&
      po.deposit_due_date &&
      amountPaid < depositAmount
    ) {
      dueEntries.push({
        date: po.deposit_due_date,
        amount: depositAmount,
        amountMyr: toMyr(depositAmount, poCurrency),
        leg: "DEPOSIT",
        poId: po.id,
        poNumber: po.po_number ?? null,
      });
    }

    // Balance leg: unpaid when amount_paid < total_amount
    if (
      balanceAmount > 0 &&
      po.balance_due_date &&
      amountPaid < totalAmount
    ) {
      dueEntries.push({
        date: po.balance_due_date,
        amount: balanceAmount,
        amountMyr: toMyr(balanceAmount, poCurrency),
        leg: "BALANCE",
        poId: po.id,
        poNumber: po.po_number ?? null,
      });
    }
  }

  // BA entries: BANKERS_ACCEPTANCE payments on their ba_due_date
  const baEntries: BaEntry[] = payments
    .filter(
      (p) =>
        p.payment_method === "BANKERS_ACCEPTANCE" && p.ba_due_date != null
    )
    .map((p) => {
      const dueDateEpoch = new Date(p.ba_due_date!).getTime();
      const daysUntil = Math.round((dueDateEpoch - todayEpoch) / 86400000);
      return {
        date: p.ba_due_date!,
        amount: Number(p.amount),
        amountMyr: toMyr(Number(p.amount), p.currency),
        currency: p.currency ?? "MYR",
        poId: p.po_id,
        poNumber: poMap.get(p.po_id)?.po_number ?? null,
        paymentId: p.id,
        daysUntil,
      };
    });

  // Upcoming BA list: ba_due_date >= today, sorted by date
  const upcomingBas = baEntries
    .filter((e) => e.daysUntil >= 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // (d) Standalone financing obligations (BA + Invoice Financing).
  // Paid state is DERIVED: due_date <= today (Asia/KL) => settled.
  const financingRows = (financingRaw ?? []) as FinancingObligationRow[];

  // Calendar entries: every obligation (financing amounts are already MYR).
  // The calendar itself derives settled vs due from `date` against `todayKl`.
  const financingEntries: FinancingEntry[] = financingRows
    .filter((f) => f.due_date)
    .map((f) => ({
      date: toKlDate(f.due_date)!,
      amount: Number(f.amount),
      amountMyr: toMyr(Number(f.amount), f.currency),
      kind: f.kind,
      reference: f.reference,
      bank: f.bank,
      currency: f.currency ?? "MYR",
    }));

  // (e) Bank facility limits + utilisation.
  // Only outstanding obligations (due_date > today) consume a facility.
  const bankLimits = (bankLimitsRaw ?? []) as BankCreditLimitRow[];

  const outstandingByBank = new Map<string, number>();
  for (const f of financingRows) {
    if (!f.bank) continue;
    if (isSettled(f.due_date, todayIso)) continue;
    const prev = outstandingByBank.get(f.bank) ?? 0;
    // Convert to MYR so foreign-currency obligations still consume a MYR limit.
    outstandingByBank.set(f.bank, prev + toMyr(Number(f.amount), f.currency));
  }

  const bankFacilities: BankFacility[] = bankLimits.map((b) => {
    const limit = Number(b.limit_amount ?? 0);
    const outstanding = outstandingByBank.get(b.bank) ?? 0;
    return {
      bank: b.bank,
      shortName: b.short_name || b.bank,
      limit,
      outstanding,
      available: limit - outstanding,
      utilisationPct: limit > 0 ? (outstanding / limit) * 100 : 0,
      currency: b.currency || "MYR",
      notes: b.notes ?? null,
    };
  });

  // Generate signed URLs for payment slips (only for slips that exist)
  const slipUrls = new Map<string, string>();
  for (const p of payments) {
    if (p.payment_slip_path) {
      const url = await getSlipUrl(p.payment_slip_path);
      if (url) slipUrls.set(p.id, url);
    }
  }

  // --- Supplier contacts for the "Email supplier" payment-advice draft -------
  // Fetched through the service-role client because the profiles RLS policy
  // (`id = auth.uid() OR has_role('SCM','ADMIN')`) hides supplier rows from
  // FINANCE/ACCOUNTS — same pattern the PO detail page uses for product costs.
  // Scoped to the suppliers of POs that already have a payment slip on this
  // page, and reads only the two contact-list columns. profiles.email is the
  // supplier's LOGIN address (a placeholder) and is deliberately NOT read.
  const slipSupplierIds = [
    ...new Set(
      payments
        .filter((p) => p.payment_slip_path)
        .map((p) => poMap.get(p.po_id)?.supplier_id as string | undefined)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const supplierContacts = new Map<
    string,
    { name: string | null; to: string[]; cc: string[] }
  >();
  if (slipSupplierIds.length > 0) {
    // Fail soft: createAdminClient() throws when SUPABASE_SERVICE_ROLE_KEY is
    // unset. Contacts are a convenience here, so a missing key must degrade to
    // a disabled "Email supplier" button — never take the Finance page down.
    try {
      const admin = createAdminClient();
      const { data: contactRows } = await admin
        .from("profiles")
        .select("id, name, company_name, supplier_contact_emails, supplier_cc_emails")
        .in("id", slipSupplierIds);
      const rows = (contactRows ?? []) as unknown as {
        id: string;
        name: string | null;
        company_name: string | null;
        supplier_contact_emails: string[] | null;
        supplier_cc_emails: string[] | null;
      }[];
      for (const c of rows) {
        supplierContacts.set(String(c.id), {
          name: c.company_name || c.name || null,
          to: c.supplier_contact_emails ?? [],
          cc: c.supplier_cc_emails ?? [],
        });
      }
    } catch (e) {
      console.error("[finance] supplier contact lookup failed:", e);
    }
  }
  const contactsFor = (poId: string) => {
    const sid = poMap.get(poId)?.supplier_id as string | undefined;
    return (sid && supplierContacts.get(sid)) || null;
  };

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

      {/* (c) Payment calendar — first thing Finance sees */}
      <Card>
        <CardHeader>
          <CardTitle>Payment calendar</CardTitle>
        </CardHeader>
        <CardContent>
          <PaymentCalendar
            paidEntries={paidEntries}
            dueEntries={dueEntries}
            baEntries={baEntries}
            upcomingBas={upcomingBas}
            financingEntries={financingEntries}
            initialYear={klYear}
            initialMonth={klMonth}
            todayKl={todayIso}
          />
        </CardContent>
      </Card>

      {/* (d) Financing obligations (BA / Invoice Financing) */}
      <Card>
        <CardHeader>
          <CardTitle>
            Financing obligations (BA / Invoice Financing)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FinancingObligations
            obligations={financingRows}
            todayKl={todayIso}
            banks={bankLimits}
            canManage={
              profile.role === "SCM" ||
              profile.role === "ADMIN" ||
              profile.role === "ACCOUNTS" ||
              profile.role === "FINANCE"
            }
          />
        </CardContent>
      </Card>

      {/* (e) Bank facility limits + utilisation */}
      <Card>
        <CardHeader>
          <CardTitle>Bank facility limits</CardTitle>
        </CardHeader>
        <CardContent>
          <BankFacilities facilities={bankFacilities} />
        </CardContent>
      </Card>

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
                // COALESCE(actual_eta, targeted_eta) for BA base date
                const poEta: string | null =
                  po.actual_eta ?? po.targeted_eta ?? null;

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
                        {poPayments.map((p) => (
                          <PaymentRow
                            key={p.id}
                            payment={p}
                            slipUrl={slipUrls.get(p.id) ?? null}
                            isFinance={isFinance}
                            poNumber={po.po_number ?? null}
                            supplierContacts={contactsFor(po.id)}
                          />
                        ))}
                      </div>
                    )}

                    <RecordPaymentForm
                      poId={po.id}
                      poNumber={po.po_number ?? null}
                      supplierName={supplierName}
                      isFinance={isFinance}
                      poEta={poEta}
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
                      {poPayments.map((p) => (
                        <PaymentRow
                          key={p.id}
                          payment={p}
                          slipUrl={slipUrls.get(p.id) ?? null}
                          isFinance={isFinance}
                          poNumber={po.po_number ?? null}
                          supplierContacts={contactsFor(po.id)}
                        />
                      ))}
                    </div>
                  );
                })}
            </>
          )}
        </CardContent>
      </Card>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline payment row with optional BA edit
// ---------------------------------------------------------------------------
type PaymentRowProps = {
  payment: {
    id: string;
    po_id: string;
    amount: number;
    currency: string;
    paid_at: string | null;
    due_date: string | null;
    notes: string | null;
    payment_slip_path: string | null;
    payment_method: "BANK_BALANCE" | "BANKERS_ACCEPTANCE";
    ba_term_days: number | null;
    ba_due_date: string | null;
  };
  slipUrl: string | null;
  isFinance: boolean;
  poNumber: string | null;
  supplierContacts: { name: string | null; to: string[]; cc: string[] } | null;
};

function PaymentRow({
  payment: p,
  slipUrl,
  isFinance,
  poNumber,
  supplierContacts,
}: PaymentRowProps) {
  const isBa = p.payment_method === "BANKERS_ACCEPTANCE";

  // Payment-advice draft — only offered once a slip actually exists, since the
  // whole point of the mail is "the slip is attached".
  const slipDraft = p.payment_slip_path
    ? paymentSlipEmail({
        poNumber,
        supplierName: supplierContacts?.name ?? null,
        amount: Number(p.amount),
        currency: p.currency ?? null,
        paidOn: p.paid_at,
      })
    : null;

  return (
    <div
      className={
        "rounded px-3 py-2 space-y-1 " +
        (isBa
          ? "bg-blue-50 border border-blue-100"
          : "bg-emerald-50 border border-emerald-100")
      }
    >
      <div className="flex items-center gap-3 text-sm flex-wrap">
        <span
          className={
            "font-medium tabular-nums " +
            (isBa ? "text-blue-800" : "text-emerald-700")
          }
        >
          {p.currency !== "MYR" ? `${p.currency} ` : ""}
          {formatCurrency(Number(p.amount))}
        </span>
        <span
          className={
            "text-xs px-1.5 py-0.5 rounded font-medium " +
            (isBa
              ? "bg-blue-100 text-blue-700"
              : "bg-emerald-100 text-emerald-700")
          }
        >
          {isBa ? "BA" : "Bank"}
        </span>
        <span className="text-gray-500 text-xs">
          paid {p.paid_at ? fmtDate(p.paid_at) : "—"}
        </span>
        {p.notes && (
          <span className="text-gray-400 text-xs">{p.notes}</span>
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
      {slipDraft && (
        <div className="pt-1">
          <EmailSupplierButton
            recipients={{
              to: supplierContacts?.to ?? [],
              cc: supplierContacts?.cc ?? [],
            }}
            subject={slipDraft.subject}
            body={slipDraft.body}
            label="Email supplier — payment advice"
            attachmentHint="Attach the payment slip before sending."
            size="xs"
          />
        </div>
      )}
      {isBa && p.ba_due_date && (
        <div className="text-xs text-blue-700">
          BA due: <strong>{fmtDate(p.ba_due_date)}</strong>
          {p.ba_term_days != null && (
            <span className="ml-1 text-blue-500">({p.ba_term_days}d term)</span>
          )}
          {isFinance && (
            <EditBaInline
              paymentId={p.id}
              currentTermDays={p.ba_term_days}
              currentDueDate={p.ba_due_date}
            />
          )}
        </div>
      )}
    </div>
  );
}

function EditBaInline({
  paymentId,
  currentTermDays,
  currentDueDate,
}: {
  paymentId: string;
  currentTermDays: number | null;
  currentDueDate: string | null;
}) {
  return (
    <EditBaTermsFormWrapper
      paymentId={paymentId}
      currentTermDays={currentTermDays}
      currentDueDate={currentDueDate}
    />
  );
}
