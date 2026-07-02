import { requireRole, createClient } from "@/lib/supabase/server";
import { PermitsManager, type Permit } from "./permits-manager";
import { classifyExpiry, todayKL } from "./expiry";

export default async function PermitsPage() {
  // Gate: only SCM/ADMIN manage permits / licences.
  await requireRole("SCM", "ADMIN");

  const supabase = await createClient();

  const { data: permits } = await supabase
    .from("permits")
    .select(
      "id, permit_type, name, reference_no, holder, issued_date, expiry_date, " +
        "status, doc_path, notes"
    )
    // Nulls-last on expiry_date, then ascending (soonest expiry first).
    .order("expiry_date", { ascending: true, nullsFirst: false });

  const today = todayKL();
  const rows = (permits ?? []) as unknown as Permit[];

  let expired = 0;
  let soon = 0;
  for (const p of rows) {
    const info = classifyExpiry(p.expiry_date, today);
    if (info.state === "expired") expired++;
    else if (info.state === "soon") soon++;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Permits &amp; Licences</h1>
        <p className="text-sm text-gray-500 mt-1">
          Track permit expiry so renewals aren&apos;t missed
        </p>
        <p className="text-sm mt-2">
          <span
            className={
              expired > 0 ? "text-red-600 font-medium" : "text-gray-400"
            }
          >
            {expired} expired
          </span>
          <span className="text-gray-300"> · </span>
          <span
            className={soon > 0 ? "text-amber-600 font-medium" : "text-gray-400"}
          >
            {soon} expiring soon
          </span>
        </p>
      </div>

      <PermitsManager permits={rows} today={today} />
    </div>
  );
}
