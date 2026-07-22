import Link from "next/link";
import { createClient, getCurrentUser, requireRole } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PoForm } from "./po-form";
import { DocBadges } from "./doc-badge";
import { PoFilters, type FilterOption } from "./po-filters";
import {
  PO_DRAFT_CREATORS,
  PO_WORKFLOW_COLORS,
  PO_WORKFLOW_LABELS,
  PO_WORKFLOW_STATES,
  canActOnState,
  expectedEta,
} from "@/lib/po-workflow";

function money(n: number | null, cur: string | null) {
  if (n == null) return "—";
  return `${cur || "MYR"} ${Number(n).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// DATE columns arrive as plain 'YYYY-MM-DD'. Format from the parts rather than
// via `new Date()` so the KL/UTC boundary can never shift the day.
function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return "—";
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return "—";
  return `${Number(m[3])} ${month} ${m[1]}`;
}

/** 'YYYY-MM-DD' -> 'YYYY-MM' (the arrival-month filter key), or null. */
function monthKey(d: string | null | undefined): string | null {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})/.exec(d);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** 'YYYY-MM' -> 'Aug 2026'. */
function monthLabel(key: string): string {
  const [y, mm] = key.split("-");
  return `${MONTHS[Number(mm) - 1] ?? mm} ${y}`;
}

// Sentinel used by the arrival-month filter for POs with no ETA at all.
const NO_ETA = "none";

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ supplier?: string; month?: string; status?: string }>;
}) {
  // Internal-only: rejects STAFF and SUPPLIER (suppliers use /supplier).
  await requireRole("SCM", "ADMIN", "ACCOUNTS", "FINANCE", "WAREHOUSE", "LOGISTICS");
  const supabase = await createClient();
  const profile = await getCurrentUser();
  const role = profile?.role ?? "";
  const canDraft = PO_DRAFT_CREATORS.includes(role as never);
  const canUploadDoc = (["SCM", "ADMIN", "ACCOUNTS", "FINANCE", "LOGISTICS"] as string[]).includes(role);

  const sp = await searchParams;
  const filters = {
    supplier: String(sp?.supplier ?? "").trim(),
    month: String(sp?.month ?? "").trim(),
    status: String(sp?.status ?? "").trim(),
  };

  const [{ data: pos }, { data: suppliers }, { data: groups }, { data: products }] =
    await Promise.all([
      supabase
        .from("purchase_orders")
        .select(
          "id, po_number, status, invoice_number, invoice_amount, expected_invoice_amount, invoice_currency, product_group, created_at, supplier_id, targeted_eta, supplier_eta, logistics_eta, actual_eta, supplier:profiles!supplier_id(name, company_name), po_documents(id, doc_type, file_path, file_name)"
        )
        .order("created_at", { ascending: false }),
      // Phase-1 substitute: the SUPPLIER role was removed in migration 0011 (all SUPPLIER
      // rows remapped to ADMIN). Populate the supplier dropdown with any profile that has
      // a company_name — these are the actual supplier contacts in the system.
      supabase
        .from("profiles")
        .select("id, name, company_name")
        .not("company_name", "is", null)
        .order("company_name"),
      supabase.from("product_groups").select("name").order("name"),
      // Active products for the PO create form's product-lines picker.
      supabase
        .from("products")
        .select("id, sku, name, product_family, units_per_carton")
        .eq("is_active", true)
        .order("sku"),
    ]);

  const allRows = (pos ?? []) as any[];
  const supplierOpts = (suppliers ?? []).map((s: any) => ({
    id: s.id,
    label: s.company_name || s.name,
  }));
  const groupNames = (groups ?? []).map((g: any) => g.name);
  const productOpts = (products ?? []).map((p: any) => ({
    id: p.id,
    label: `${p.sku} — ${p.name}`,
    unitsPerCarton: Number(p.units_per_carton) || 1,
  }));

  // --- Expected ETA (actual → logistics → supplier → targeted) --------------
  // Computed once per row and reused by both the column and the month filter,
  // so the dropdown can never offer a month the table does not show.
  const decorated = allRows.map((po) => {
    const eta = expectedEta(po);
    return { po, eta, month: monthKey(eta) };
  });

  // --- Filter option lists (built from ALL rows, so they stay stable) -------
  const supplierFilterOpts: FilterOption[] = [];
  const seenSuppliers = new Set<string>();
  for (const { po } of decorated) {
    const id = po.supplier_id ? String(po.supplier_id) : "";
    if (!id || seenSuppliers.has(id)) continue;
    seenSuppliers.add(id);
    supplierFilterOpts.push({
      value: id,
      label: po.supplier?.company_name || po.supplier?.name || "(unnamed supplier)",
    });
  }
  supplierFilterOpts.sort((a, b) => a.label.localeCompare(b.label));

  const monthKeys = [...new Set(decorated.map((d) => d.month).filter(Boolean) as string[])].sort();
  const monthFilterOpts: FilterOption[] = monthKeys.map((k) => ({
    value: k,
    label: monthLabel(k),
  }));
  if (decorated.some((d) => !d.month)) {
    monthFilterOpts.push({ value: NO_ETA, label: "No ETA yet" });
  }

  const presentStatuses = new Set(decorated.map((d) => String(d.po.status)));
  const statusFilterOpts: FilterOption[] = [
    // Workflow order first, then anything legacy still present in the data.
    ...PO_WORKFLOW_STATES.filter((s) => presentStatuses.has(s)),
    ...[...presentStatuses].filter(
      (s) => !(PO_WORKFLOW_STATES as readonly string[]).includes(s)
    ).sort(),
  ].map((s) => ({ value: s, label: PO_WORKFLOW_LABELS[s] || s }));

  // --- Apply filters --------------------------------------------------------
  const rows = decorated.filter(({ po, month }) => {
    if (filters.supplier && String(po.supplier_id ?? "") !== filters.supplier) return false;
    if (filters.month) {
      if (filters.month === NO_ETA) {
        if (month) return false;
      } else if (month !== filters.month) return false;
    }
    if (filters.status && String(po.status) !== filters.status) return false;
    return true;
  });

  const filtersActive = !!(filters.supplier || filters.month || filters.status);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Purchase Orders</h1>
          <p className="text-sm text-gray-500 mt-1">
            Every PO tracked through its hand-offs: Draft → Created → Sent →
            Shipped → Completed
          </p>
        </div>
        {canDraft && (
          <div className="flex items-center gap-2">
            <Link
              href="/purchase-orders/import"
              className="inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Import POs
            </Link>
            <Link
              href="/purchase-orders/import-docs"
              className="inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Import documents
            </Link>
            <Link
              href="/purchase-orders/import-lines"
              className="inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Import PO lines
            </Link>
            <PoForm suppliers={supplierOpts} groups={groupNames} products={productOpts} />
          </div>
        )}
      </div>

      <Card>
        <CardContent className="py-4">
          <PoFilters
            suppliers={supplierFilterOpts}
            months={monthFilterOpts}
            statuses={statusFilterOpts}
            current={filters}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>
            {rows.length} record{rows.length === 1 ? "" : "s"}
            {filtersActive && (
              <span className="text-sm font-normal text-gray-500">
                {" "}
                of {decorated.length}
              </span>
            )}
          </CardTitle>
          <span className="text-xs text-gray-500">
            Click a PO number to open it · amber dot = needs your action
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2.5 pl-4 pr-3 font-medium">PO number</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 px-3 font-medium">Supplier</th>
                  <th className="py-2.5 px-3 font-medium text-right">Amount</th>
                  <th className="py-2.5 px-3 font-medium whitespace-nowrap">Expected ETA</th>
                  <th className="py-2.5 px-3 font-medium">Product range</th>
                  <th className="py-2.5 pr-4 pl-3 font-medium">Documents</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ po, eta }) => {
                  const needsYou = canActOnState(role, po.status);
                  const amount =
                    po.invoice_amount ?? po.expected_invoice_amount ?? null;
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
                      <td className="py-2.5 px-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={
                              "text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap " +
                              (PO_WORKFLOW_COLORS[po.status] ||
                                "bg-gray-100 text-gray-700")
                            }
                          >
                            {PO_WORKFLOW_LABELS[po.status] || po.status}
                          </span>
                          {needsYou && (
                            <span
                              title="Needs your action"
                              className="inline-block h-2 w-2 rounded-full bg-amber-500"
                            />
                          )}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-gray-600">
                        {po.supplier?.company_name || po.supplier?.name || "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-gray-600">
                        {money(amount, po.invoice_currency)}
                      </td>
                      <td
                        className="py-2.5 px-3 text-gray-600 whitespace-nowrap"
                        title={
                          eta
                            ? po.actual_eta
                              ? "Actual arrival"
                              : po.logistics_eta
                                ? "Logistics ETA"
                                : po.supplier_eta
                                  ? "Supplier ETA"
                                  : "Targeted ETA"
                            : "No ETA captured yet"
                        }
                      >
                        {fmtDate(eta)}
                      </td>
                      <td className="py-2.5 px-3 text-gray-600">
                        {po.product_group || "—"}
                      </td>
                      <td className="py-2.5 pr-4 pl-3">
                        <DocBadges
                          poId={po.id}
                          docs={po.po_documents || []}
                          canUpload={canUploadDoc}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && (
            <p className="text-sm text-gray-500 py-10 text-center">
              {decorated.length === 0 ? (
                <>
                  No purchase orders yet.{" "}
                  {canDraft ? "Click “New PO (draft)” to add one." : ""}
                </>
              ) : (
                "No purchase orders match these filters."
              )}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
