"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { NPD_STAGE_COUNT } from "./constants";

// ---------------------------------------------------------------------------
// Types passed from the server page
// ---------------------------------------------------------------------------
export type CalendarProject = {
  id: string;
  name: string;
  category: string | null;
  /** target_launch_date as "YYYY-MM-DD", or null when not set yet. */
  date: string | null;
  /** Checklist stages ticked done (out of NPD_STAGE_COUNT = 7). */
  doneCount: number;
  status: "ACTIVE" | "LAUNCHED";
};

type Props = {
  /** ACTIVE + LAUNCHED projects only (on-hold/cancelled stay off the calendar). */
  projects: CalendarProject[];
  /** Initial year (today's year in KL). */
  initialYear: number;
  /** Initial month (0-indexed, today's month in KL). */
  initialMonth: number;
  /** Today as "YYYY-MM-DD" in Asia/KL for highlighting and the upcoming list. */
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

// Format a bare "YYYY-MM-DD" date, e.g. "12 Aug 2026" (UTC to avoid TZ shift).
function fmtDate(d: string) {
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Whole days from `from` to `to` (both "YYYY-MM-DD").
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000
  );
}

function ProgressChip({ doneCount }: { doneCount: number }) {
  const complete = doneCount >= NPD_STAGE_COUNT;
  return (
    <span
      className={cn(
        "inline-block text-xs font-medium px-2 py-0.5 rounded-full tabular-nums",
        complete
          ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
          : "bg-gray-100 text-gray-600 border border-gray-200"
      )}
    >
      {doneCount}/{NPD_STAGE_COUNT}
    </span>
  );
}

export function LaunchCalendar({
  projects,
  initialYear,
  initialMonth,
  todayKl,
}: Props) {
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth); // 0-indexed

  function prev() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  }
  function next() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  }

  // Index dated projects by day for the visible month.
  const byDay = new Map<string, CalendarProject[]>();
  for (const p of projects) {
    if (!p.date) continue;
    const [py, pm] = p.date.split("-").map(Number);
    if (py === year && pm === month + 1) {
      const arr = byDay.get(p.date) ?? [];
      arr.push(p);
      byDay.set(p.date, arr);
    }
  }

  // Upcoming launches (today or later), soonest first.
  const upcoming = projects
    .filter((p) => p.date !== null && p.date >= todayKl)
    .sort((a, b) => a.date!.localeCompare(b.date!));

  // Projects with no launch date yet.
  const undated = projects.filter((p) => p.date === null);

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

      <div className="rounded-md overflow-hidden">
        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 gap-px bg-gray-200 pb-px">
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
        <div className="grid grid-cols-7 gap-px bg-gray-200">
          {cells.map((day, idx) => {
          if (day === null) {
            return <div key={`empty-${idx}`} className="bg-gray-50 min-h-[72px]" />;
          }
          const key = isoDate(year, month, day);
          const launches = byDay.get(key);
          const isToday = key === todayKl;
          const hasLaunch = launches && launches.length > 0;

          return (
            <div
              key={key}
              className={cn(
                "bg-white min-h-[72px] p-1.5 text-xs",
                hasLaunch && "ring-1 ring-inset ring-blue-200",
                isToday && "bg-gray-50"
              )}
            >
              <div
                className={cn(
                  "font-medium mb-1",
                  isToday ? "text-brand" : "text-gray-700"
                )}
              >
                {day}
              </div>

              {launches?.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    "rounded px-1 py-0.5 mb-0.5 leading-tight",
                    p.status === "LAUNCHED"
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-blue-50 text-blue-800"
                  )}
                  title={`${p.name} · ${p.doneCount}/${NPD_STAGE_COUNT}`}
                >
                  <div className="font-medium truncate">
                    {p.name} · {p.doneCount}/{NPD_STAGE_COUNT}
                  </div>
                  {p.category && (
                    <div className="opacity-70 truncate">{p.category}</div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded bg-blue-50 border border-blue-300 inline-block" />
          Planned launch (active project)
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded bg-emerald-50 border border-emerald-300 inline-block" />
          Launched
        </span>
      </div>

      {/* Upcoming launches */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">
          Upcoming launches ({upcoming.length})
        </h3>
        {upcoming.length === 0 ? (
          <p className="text-sm text-gray-400">
            No upcoming launch dates — set a target launch date on a project
            below to see it here.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {upcoming.map((p) => {
              const days = daysBetween(todayKl, p.date!);
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
                >
                  <span className="font-medium text-gray-900">{p.name}</span>
                  <span className="text-gray-500">{p.category ?? "—"}</span>
                  <span className="text-gray-600 whitespace-nowrap">
                    {fmtDate(p.date!)}
                  </span>
                  <ProgressChip doneCount={p.doneCount} />
                  <span
                    className={cn(
                      "ml-auto text-xs font-medium tabular-nums",
                      days <= 30 ? "text-amber-700" : "text-gray-500"
                    )}
                  >
                    {days === 0 ? "Today" : `${days}d to launch`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* No launch date set */}
      {undated.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-2">
            No launch date set ({undated.length})
          </h3>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {undated.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
              >
                <span className="font-medium text-gray-900">{p.name}</span>
                <span className="text-gray-500">{p.category ?? "—"}</span>
                <ProgressChip doneCount={p.doneCount} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
