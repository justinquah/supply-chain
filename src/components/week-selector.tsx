"use client";

import { useRouter, usePathname } from "next/navigation";

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Format a 'YYYY-MM-DD' date string as "29 Jun 2026" (no TZ shift). */
function fmt(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return `${day} ${MONTHS[m]} ${y}`;
}

export function WeekSelector({
  weeks,
  selected,
}: {
  weeks: string[];
  selected: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">Stock week:</span>
      <select
        className="border border-gray-300 rounded-md px-2 py-1 text-sm bg-white"
        value={selected}
        onChange={(e) => router.push(`${pathname}?w=${e.target.value}`)}
      >
        {weeks.map((w) => (
          <option key={w} value={w}>
            {fmt(w)}
          </option>
        ))}
      </select>
    </div>
  );
}
