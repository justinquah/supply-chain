"use client";

import { useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Types passed from the server page
// ---------------------------------------------------------------------------
export type PaidEntry = {
  date: string; // "YYYY-MM-DD" in Asia/KL
  amount: number;
  currency: string;
  poId: string;
  poNumber: string | null;
};

export type DueEntry = {
  date: string; // "YYYY-MM-DD" in Asia/KL
  amount: number;
  leg: "DEPOSIT" | "BALANCE";
  poId: string;
  poNumber: string | null;
};

type Props = {
  paidEntries: PaidEntry[];
  dueEntries: DueEntry[];
  /** Initial year (today's year in KL). */
  initialYear: number;
  /** Initial month (0-indexed, today's month in KL). */
  initialMonth: number;
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function PaymentCalendar({
  paidEntries,
  dueEntries,
  initialYear,
  initialMonth,
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

  // Build index maps for current month
  const paidByDay = new Map<string, PaidEntry[]>();
  const dueByDay = new Map<string, DueEntry[]>();

  let monthTotalPaid = 0;
  let monthTotalDue = 0;

  for (const e of paidEntries) {
    const [ey, em] = e.date.split("-").map(Number);
    if (ey === year && em === month + 1) {
      const arr = paidByDay.get(e.date) ?? [];
      arr.push(e);
      paidByDay.set(e.date, arr);
      monthTotalPaid += e.amount;
    }
  }
  for (const e of dueEntries) {
    const [ey, em] = e.date.split("-").map(Number);
    if (ey === year && em === month + 1) {
      const arr = dueByDay.get(e.date) ?? [];
      arr.push(e);
      dueByDay.set(e.date, arr);
      monthTotalDue += e.amount;
    }
  }

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
    <div className="space-y-4">
      {/* Header */}
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

      {/* Month summary */}
      <div className="flex flex-wrap gap-4 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-emerald-500 inline-block" />
          <span className="text-gray-600">Paid this month:</span>
          <span className="font-semibold text-emerald-700 tabular-nums">
            {formatCurrency(monthTotalPaid)}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-amber-400 inline-block" />
          <span className="text-gray-600">Due this month:</span>
          <span className="font-semibold text-amber-700 tabular-nums">
            {formatCurrency(monthTotalDue)}
          </span>
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
          const hasPaid = paid && paid.length > 0;
          const hasDue = due && due.length > 0;

          return (
            <div
              key={key}
              className={
                "bg-white min-h-[72px] p-1.5 text-xs " +
                (hasPaid || hasDue ? "ring-1 ring-inset " : "") +
                (hasPaid && hasDue
                  ? "ring-emerald-300"
                  : hasPaid
                  ? "ring-emerald-200"
                  : hasDue
                  ? "ring-amber-200"
                  : "")
              }
            >
              <div className="font-medium text-gray-700 mb-1">{day}</div>

              {/* Paid entries */}
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

              {/* Due entries */}
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
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded bg-emerald-50 border border-emerald-300 inline-block" />
          Paid (green)
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded bg-amber-50 border border-amber-300 inline-block" />
          Due / unpaid (amber)
        </span>
      </div>
    </div>
  );
}
