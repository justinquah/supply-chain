"use client";

import { useRouter, usePathname } from "next/navigation";

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function MonthSelector({
  months,
  selected,
}: {
  months: { year: number; month: number }[];
  selected: { year: number; month: number };
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">Month:</span>
      <select
        className="border border-gray-300 rounded-md px-2 py-1 text-sm bg-white"
        value={`${selected.year}-${selected.month}`}
        onChange={(e) => {
          const [y, m] = e.target.value.split("-");
          router.push(`${pathname}?y=${y}&m=${m}`);
        }}
      >
        {months.map((mo) => (
          <option key={`${mo.year}-${mo.month}`} value={`${mo.year}-${mo.month}`}>
            {MONTHS[mo.month]} {mo.year}
          </option>
        ))}
      </select>
    </div>
  );
}
