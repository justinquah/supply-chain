// Shared BA / Invoice Financing rules — imported by both server components
// (finance/page.tsx) and client components (financing-obligations, calendar),
// so this module must stay free of "use client".

// BA/IF obligations are always paid on their due date — there is no manual
// paid/unpaid toggle. Settled state is derived: due on or before today (KL).
export function isSettled(dueDate: string | null, todayKl: string): boolean {
  if (!dueDate) return false;
  return String(dueDate).slice(0, 10) <= todayKl;
}
