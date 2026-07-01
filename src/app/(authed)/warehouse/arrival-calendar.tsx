"use client";

import { useState } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types passed from the server page
// ---------------------------------------------------------------------------
export type ArrivalEntry = {
  date: string; // "YYYY-MM-DD" — COALESCE(actual_eta, targeted_eta)
  poId: string;
  poNumber: string | null;
  supplierName: string | null;
  status: string;
  statusLabel: string;
  daysUntil: number; // computed from today (KL)
};

export type AwaitingUnloadEntry = {
  poId: string;
  poNumber: string | null;
  supplierName: string | null;
  containerArrivedAt: string; // "YYYY-MM-DD"
};

type Props = {
  arrivals: ArrivalEntry[];
  /** All arrivals sorted by ETA (ascending) for the "arriving soon" list. */
  upcomingArrivals: ArrivalEntry[];
  awaitingUnload: AwaitingUnloadEntry[];
  initialYear: number;
  initialMonth: number; // 0-indexed
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

// Urgency classes for a calendar entry chip: overdue = red, <=3 days = amber, else neutral.
function urgencyCls(daysUntil: number): string {
  if (daysUntil < 0) return "bg-red-50 text-red-800";
  if (daysUntil <= 3) return "bg-amber-50 text-amber-800";
  return "bg-gray-50 text-gray-700";
}

function urgencyRing(daysUntil: number): string {
  if (daysUntil < 0) return "ring-1 ring-inset ring-red-200";
  if (daysUntil <= 3) return "ring-1 ring-inset ring-amber-200";
  return "";
}

export function ArrivalCalendar({
  arrivals,
  upcomingArrivals,
  awaitingUnload,
  initialYear,
  initialMonth,
  todayKl,
}: Props) {
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);

  function prev() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  }
  function next() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  }

  const byDay = new Map<string, ArrivalEntry[]>();
  for (const e of arrivals) {
    const [ey, em] = e.date.split("-").map(Number);
    if (ey === year && em === month + 1) {
      const arr = byDay.get(e.date) ?? [];
      arr.push(e);
      byDay.set(e.date, arr);
    }
  }

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Calendar */}
      <div className="lg:col-span-2 space-y-4">
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

        <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-b-md overflow-hidden -mt-4">
          {cells.map((day, idx) => {
            if (day === null) {
              return <div key={`empty-${idx}`} className="bg-gray-50 min-h-[80px]" />;
            }
            const key = isoDate(year, month, day);
            const entries = byDay.get(key);
            const hasEntries = entries && entries.length > 0;
            const isToday = key === todayKl;
            const worstDays = hasEntries
              ? Math.min(...entries.map((e) => e.daysUntil))
              : null;

            return (
              <div
                key={key}
                className={
                  "bg-white min-h-[80px] p-1.5 text-xs " +
                  (hasEntries && worstDays != null ? urgencyRing(worstDays) : "") +
                  (isToday ? " bg-gray-50" : "")
                }
              >
                <div
                  className={
                    "font-medium mb-1 " + (isToday ? "text-brand" : "text-gray-700")
                  }
                >
                  {day}
                </div>
                {entries?.map((e) => (
                  <Link
                    key={e.poId}
                    href={`/purchase-orders/${e.poId}`}
                    className={
                      "block rounded px-1 py-0.5 mb-0.5 leading-tight hover:opacity-80 " +
                      urgencyCls(e.daysUntil)
                    }
                  >
                    <div className="font-medium truncate">
                      {e.poNumber || "draft"}
                    </div>
                    <div className="opacity-70 truncate">
                      {e.supplierName || "—"}
                    </div>
                  </Link>
                ))}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded bg-red-50 border border-red-300 inline-block" />
            Overdue
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded bg-amber-50 border border-amber-300 inline-block" />
            Arriving within 3 days
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded bg-gray-50 border border-gray-300 inline-block" />
            Later
          </span>
        </div>
      </div>

      {/* Arriving soon + awaiting unload */}
      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            Arriving soon ({upcomingArrivals.length})
          </h3>
          {upcomingArrivals.length === 0 ? (
            <p className="text-sm text-gray-500">No upcoming arrivals.</p>
          ) : (
            <ul className="space-y-2">
              {upcomingArrivals.map((e) => (
                <li
                  key={e.poId}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/purchase-orders/${e.poId}`}
                      className="font-medium text-brand hover:underline"
                    >
                      {e.poNumber || "draft"}
                    </Link>
                    {e.daysUntil < 0 ? (
                      <span className="text-xs font-medium text-red-600">
                        {Math.abs(e.daysUntil)}d overdue
                      </span>
                    ) : e.daysUntil === 0 ? (
                      <span className="text-xs font-medium text-red-600">Today</span>
                    ) : (
                      <span
                        className={
                          "text-xs font-medium " +
                          (e.daysUntil <= 3 ? "text-amber-700" : "text-gray-500")
                        }
                      >
                        {e.daysUntil}d
                      </span>
                    )}
                  </div>
                  <div className="text-gray-500 text-xs mt-0.5">
                    {e.supplierName || "—"} · {fmtDate(e.date)} · {e.statusLabel}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            Awaiting unload ({awaitingUnload.length})
          </h3>
          {awaitingUnload.length === 0 ? (
            <p className="text-sm text-gray-500">
              No containers waiting to be unloaded.
            </p>
          ) : (
            <ul className="space-y-2">
              {awaitingUnload.map((e) => (
                <li
                  key={e.poId}
                  className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm"
                >
                  <Link
                    href={`/purchase-orders/${e.poId}`}
                    className="font-medium text-brand hover:underline"
                  >
                    {e.poNumber || "draft"}
                  </Link>
                  <div className="text-gray-600 text-xs mt-0.5">
                    {e.supplierName || "—"} · arrived {fmtDate(e.containerArrivedAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
