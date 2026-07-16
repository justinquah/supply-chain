"use client";

import { useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Types passed from the server page
// ---------------------------------------------------------------------------
export type PaidEntry = {
  date: string; // "YYYY-MM-DD" in Asia/KL — BANK_BALANCE payments on their paid_at
  amount: number;
  amountMyr: number; // MYR-equivalent estimate (amount × rate_to_myr)
  currency: string;
  poId: string;
  poNumber: string | null;
};

export type DueEntry = {
  date: string; // "YYYY-MM-DD" in Asia/KL
  amount: number;
  amountMyr: number; // MYR-equivalent estimate
  leg: "DEPOSIT" | "BALANCE";
  poId: string;
  poNumber: string | null;
};

export type BaEntry = {
  date: string; // "YYYY-MM-DD" in Asia/KL — ba_due_date
  amount: number;
  amountMyr: number; // MYR-equivalent estimate
  currency: string;
  poId: string;
  poNumber: string | null;
  paymentId: string;
  daysUntil: number; // computed from today
};

export type FinancingEntry = {
  // "YYYY-MM-DD" due_date. BA/IF settle automatically on this date, so paid
  // state is derived here: date <= todayKl => settled, date > todayKl => due.
  date: string;
  amount: number;
  amountMyr: number; // MYR-equivalent estimate (financing is already MYR → ×1)
  kind: "BA" | "INVOICE_FINANCING";
  reference: string | null;
  bank: string | null;
  currency: string;
};

type Props = {
  paidEntries: PaidEntry[];
  dueEntries: DueEntry[];
  baEntries: BaEntry[];
  /** All upcoming BAs (ba_due_date >= today), sorted by date, for the list. */
  upcomingBas: BaEntry[];
  /** All financing obligations, for the calendar dots/day totals. */
  financingEntries: FinancingEntry[];
  /** Initial year (today's year in KL). */
  initialYear: number;
  /** Initial month (0-indexed, today's month in KL). */
  initialMonth: number;
  /** Today as "YYYY-MM-DD" in Asia/KL for highlighting and BA list. */
  todayKl: string;
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// MYR-estimate formatter (no currency prefix — caller labels "MYR est.")
function myrEst(n: number): string {
  return `RM ${n.toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} est.`;
}

// Friendly kind label for a financing obligation.
function financingKindLabel(kind: "BA" | "INVOICE_FINANCING"): string {
  return kind === "BA" ? "BA" : "IF";
}

// Short calendar marker label, e.g. "IF010 · Maybank" or "BA · UOB".
function financingMarker(e: FinancingEntry): string {
  const lead = e.reference || financingKindLabel(e.kind);
  return e.bank ? `${lead} · ${e.bank}` : lead;
}

export function PaymentCalendar({
  paidEntries,
  dueEntries,
  baEntries,
  upcomingBas,
  financingEntries,
  initialYear,
  initialMonth,
  todayKl,
}: Props) {
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth); // 0-indexed

  function prev() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function next() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  // Build index maps for current month. Month totals are in MYR estimate.
  const paidByDay = new Map<string, PaidEntry[]>();
  const dueByDay = new Map<string, DueEntry[]>();
  const baByDay = new Map<string, BaEntry[]>();
  const financingByDay = new Map<string, FinancingEntry[]>();

  let monthTotalPaid = 0; // MYR est.
  let monthTotalDue = 0; // MYR est.
  let monthTotalBa = 0; // MYR est.
  let monthTotalFinancingSettled = 0; // MYR est. — due_date already passed
  let monthTotalFinancingDue = 0; // MYR est. — still outstanding

  for (const e of paidEntries) {
    const [ey, em] = e.date.split("-").map(Number);
    if (ey === year && em === month + 1) {
      const arr = paidByDay.get(e.date) ?? [];
      arr.push(e);
      paidByDay.set(e.date, arr);
      monthTotalPaid += e.amountMyr;
    }
  }
  for (const e of dueEntries) {
    const [ey, em] = e.date.split("-").map(Number);
    if (ey === year && em === month + 1) {
      const arr = dueByDay.get(e.date) ?? [];
      arr.push(e);
      dueByDay.set(e.date, arr);
      monthTotalDue += e.amountMyr;
    }
  }
  for (const e of baEntries) {
    const [ey, em] = e.date.split("-").map(Number);
    if (ey === year && em === month + 1) {
      const arr = baByDay.get(e.date) ?? [];
      arr.push(e);
      baByDay.set(e.date, arr);
      monthTotalBa += e.amountMyr;
    }
  }
  for (const e of financingEntries) {
    const [ey, em] = e.date.split("-").map(Number);
    if (ey === year && em === month + 1) {
      const arr = financingByDay.get(e.date) ?? [];
      arr.push(e);
      financingByDay.set(e.date, arr);
      // Auto-settled once the due date arrives — no manual paid toggle exists.
      if (e.date <= todayKl) monthTotalFinancingSettled += e.amountMyr;
      else monthTotalFinancingDue += e.amountMyr;
    }
  }

  // Total upcoming outflows for the visible month (MYR est.) = due + BA +
  // financing that has not settled yet. Settled financing is already cash out.
  const monthTotalUpcoming =
    monthTotalDue + monthTotalBa + monthTotalFinancingDue;

  // Calendar grid
  const firstDay = new Date(year, month, 1).getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="space-y-6">
      {/* Month nav */}
      <div className="flex items-center gap-3">
        <button
          onClick={prev}
          className="px-2 py-1 rounded-md border border-gray-200 text-sm hover:bg-gray-50"
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="font-semibold text-gray-900 min-w-[160px] text-center">
          {MONTH_NAMES[month]} {year}
        </span>
        <button
          onClick={next}
          className="px-2 py-1 rounded-md border border-gray-200 text-sm hover:bg-gray-50"
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      {/* Month summary — all totals are MYR estimates (mixed-currency converted). */}
      <div className="flex flex-wrap gap-4 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-emerald-500 inline-block" />
          <span className="text-gray-600">Paid this month:</span>
          <span className="font-semibold text-emerald-700 tabular-nums">
            {myrEst(monthTotalPaid)}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-amber-400 inline-block" />
          <span className="text-gray-600">To be paid:</span>
          <span className="font-semibold text-amber-700 tabular-nums">
            {myrEst(monthTotalDue)}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-blue-500 inline-block" />
          <span className="text-gray-600">BA settling:</span>
          <span className="font-semibold text-blue-700 tabular-nums">
            {myrEst(monthTotalBa)}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-indigo-500 inline-block" />
          <span className="text-gray-600">Financing due (BA/IF):</span>
          <span className="font-semibold text-indigo-700 tabular-nums">
            {myrEst(monthTotalFinancingDue)}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-gray-300 inline-block" />
          <span className="text-gray-600">Financing settled:</span>
          <span className="font-semibold text-gray-500 tabular-nums">
            {myrEst(monthTotalFinancingSettled)}
          </span>
        </span>
      </div>

      {/* Total upcoming outflows for the visible month (MYR est.) */}
      <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-sm flex flex-wrap items-center gap-2">
        <span className="text-gray-600 font-medium">
          Total upcoming this month (due + BA + financing):
        </span>
        <span className="font-semibold text-gray-900 tabular-nums">
          {myrEst(monthTotalUpcoming)}
        </span>
        <span className="text-xs text-gray-400">
          MYR estimate — foreign amounts converted at current FX.
        </span>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-t-md overflow-hidden">
        {DAY_HEADERS.map((d) => (
          <div
            key={d}
            className="bg-gray-50 text-xs font-medium text-gray-500 text-center py-1.5"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-b-md overflow-hidden">
        {cells.map((day, idx) => {
          if (day === null) {
            return <div key={`empty-${idx}`} className="bg-gray-50 min-h-[72px]" />;
          }
          const key = isoDate(year, month, day);
          const paid = paidByDay.get(key);
          const due = dueByDay.get(key);
          const ba = baByDay.get(key);
          const financing = financingByDay.get(key);
          const hasPaid = paid && paid.length > 0;
          const hasDue = due && due.length > 0;
          const hasBa = ba && ba.length > 0;
          const hasFinancing = financing && financing.length > 0;
          const isToday = key === todayKl;

          // Every financing entry in this cell shares this cell's date, so the
          // whole day is either settled or still due.
          const financingSettled = key <= todayKl;
          const hasFinancingDue = hasFinancing && !financingSettled;

          // Per-day upcoming outflow total (MYR est.) = due + BA + financing
          // that has not settled yet.
          const dayUpcomingMyr =
            (due?.reduce((s, e) => s + e.amountMyr, 0) ?? 0) +
            (ba?.reduce((s, e) => s + e.amountMyr, 0) ?? 0) +
            (hasFinancingDue
              ? financing!.reduce((s, e) => s + e.amountMyr, 0)
              : 0);
          const hasUpcoming = hasDue || hasBa || hasFinancingDue;

          // Ring colour: paid > financing due > ba > due > financing settled
          let ringCls = "";
          if (hasPaid) ringCls = "ring-1 ring-inset ring-emerald-200";
          else if (hasFinancingDue) ringCls = "ring-1 ring-inset ring-indigo-200";
          else if (hasBa) ringCls = "ring-1 ring-inset ring-blue-200";
          else if (hasDue) ringCls = "ring-1 ring-inset ring-amber-200";
          else if (hasFinancing) ringCls = "ring-1 ring-inset ring-gray-200";

          return (
            <div
              key={key}
              className={
                "bg-white min-h-[72px] p-1.5 text-xs " +
                ringCls +
                (isToday ? " bg-gray-50" : "")
              }
            >
              <div
                className={
                  "font-medium mb-1 " +
                  (isToday
                    ? "text-brand"
                    : "text-gray-700")
                }
              >
                {day}
              </div>

              {/* Paid (cash out) — green */}
              {paid?.map((e, i) => (
                <div
                  key={`paid-${i}`}
                  className="rounded px-1 py-0.5 mb-0.5 bg-emerald-50 text-emerald-800 leading-tight"
                >
                  <div className="font-medium tabular-nums">
                    {e.currency !== "MYR" ? `${e.currency} ` : ""}
                    {formatCurrency(e.amount).replace("RM ", "")}
                  </div>
                  <Link
                    href={`/purchase-orders/${e.poId}`}
                    className="hover:underline opacity-70"
                  >
                    {e.poNumber || "draft"}
                  </Link>
                </div>
              ))}

              {/* Due / to be paid — amber */}
              {due?.map((e, i) => (
                <div
                  key={`due-${i}`}
                  className="rounded px-1 py-0.5 mb-0.5 bg-amber-50 text-amber-800 leading-tight"
                >
                  <div className="font-medium tabular-nums">
                    {formatCurrency(e.amount).replace("RM ", "")}
                  </div>
                  <div className="opacity-70">
                    <Link href={`/purchase-orders/${e.poId}`} className="hover:underline">
                      {e.poNumber || "draft"}
                    </Link>{" "}
                    <span className="text-[10px]">
                      {e.leg === "DEPOSIT" ? "dep." : "bal."}
                    </span>
                  </div>
                </div>
              ))}

              {/* BA settling — blue */}
              {ba?.map((e, i) => (
                <div
                  key={`ba-${i}`}
                  className="rounded px-1 py-0.5 mb-0.5 bg-blue-50 text-blue-800 leading-tight"
                >
                  <div className="font-medium tabular-nums">
                    {e.currency !== "MYR" ? `${e.currency} ` : ""}
                    {formatCurrency(e.amount).replace("RM ", "")}
                  </div>
                  <div className="opacity-70">
                    <Link href={`/purchase-orders/${e.poId}`} className="hover:underline">
                      {e.poNumber || "draft"}
                    </Link>{" "}
                    <span className="text-[10px]">BA</span>
                  </div>
                </div>
              ))}

              {/* Financing (BA / Invoice Financing) — indigo while due,
                  muted grey once the due date has passed (auto-settled). */}
              {financing?.map((e, i) => (
                <div
                  key={`fin-${i}`}
                  className={
                    "rounded px-1 py-0.5 mb-0.5 leading-tight " +
                    (financingSettled
                      ? "bg-gray-50 text-gray-500"
                      : "bg-indigo-50 text-indigo-800")
                  }
                >
                  <div className="font-medium tabular-nums">
                    {e.currency !== "MYR" ? `${e.currency} ` : ""}
                    {formatCurrency(e.amount).replace("RM ", "")}
                  </div>
                  <div className="opacity-70 truncate" title={financingMarker(e)}>
                    {financingMarker(e)}
                    {financingSettled && " · paid"}
                  </div>
                </div>
              ))}

              {/* Per-day upcoming total (MYR est.) */}
              {hasUpcoming && (
                <div className="mt-0.5 pt-0.5 border-t border-gray-100 text-[10px] font-semibold text-gray-600 tabular-nums">
                  {myrEst(dayUpcomingMyr)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded bg-emerald-50 border border-emerald-300 inline-block" />
          Paid — bank balance (green)
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded bg-amber-50 border border-amber-300 inline-block" />
          Scheduled / unpaid (amber)
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded bg-blue-50 border border-blue-300 inline-block" />
          BA settling (blue)
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded bg-indigo-50 border border-indigo-300 inline-block" />
          Financing due — BA / Invoice Financing (indigo)
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded bg-gray-50 border border-gray-300 inline-block" />
          Financing settled — auto-paid on due date (grey)
        </span>
      </div>

      {/* Upcoming BA settlements list */}
      {upcomingBas.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            Upcoming BA settlements ({upcomingBas.length})
          </h3>
          <div className="rounded-lg border border-blue-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-blue-50 text-left text-gray-600 text-xs">
                  <th className="py-2 pl-3 pr-2 font-medium">PO</th>
                  <th className="py-2 px-2 font-medium">Amount</th>
                  <th className="py-2 px-2 font-medium">BA due date</th>
                  <th className="py-2 pl-2 pr-3 font-medium">Days until</th>
                </tr>
              </thead>
              <tbody>
                {upcomingBas.map((e) => (
                  <tr
                    key={e.paymentId}
                    className="border-t border-blue-100 hover:bg-blue-50/50"
                  >
                    <td className="py-2 pl-3 pr-2 font-medium">
                      <Link
                        href={`/purchase-orders/${e.poId}`}
                        className="text-brand hover:underline"
                      >
                        {e.poNumber || "draft"}
                      </Link>
                    </td>
                    <td className="py-2 px-2 tabular-nums text-blue-800">
                      {e.currency !== "MYR" ? `${e.currency} ` : ""}
                      {formatCurrency(e.amount)}
                    </td>
                    <td className="py-2 px-2 text-gray-700">
                      {fmtDate(e.date)}
                    </td>
                    <td className="py-2 pl-2 pr-3">
                      {e.daysUntil === 0 ? (
                        <span className="text-red-600 font-medium">Today</span>
                      ) : e.daysUntil < 0 ? (
                        <span className="text-red-600 font-medium">
                          {Math.abs(e.daysUntil)}d overdue
                        </span>
                      ) : (
                        <span
                          className={
                            e.daysUntil <= 7
                              ? "text-amber-700 font-medium"
                              : "text-gray-600"
                          }
                        >
                          {e.daysUntil}d
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
