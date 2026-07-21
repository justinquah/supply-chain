"use client";

// PO timing & reorder intelligence for the Insights page. Compares each
// product's stock runway (coverage) against its incoming POs (EXPECTED
// incoming_stock, by ETA) and turns the signals into actionable tasks:
//   • expedite (will stock out before arrival / overdue) — propose an earlier ETA
//   • delay    (overstocked with more coming)           — propose a later ETA
//   • issue-new-PO (low with nothing on the way)         — suggest a 1-shipment qty
// Expedite & Delay are grouped by PO (the action is on the PO). The SCM accepts
// the proposed ETA or overrides it, then Applies → applyPoTiming writes it to the
// PO + its in-transit lines and records a resolved po_timing_actions row, so the
// task moves to "Recently resolved". New-PO is per product (no PO exists yet).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyPoTiming } from "@/app/(authed)/purchase-orders/actions";
import { EmailSupplierButton } from "@/app/(authed)/purchase-orders/email-supplier-button";
import { poTimingEmail } from "@/lib/supplier-email";

/** Supplier mailing lists for one PO (empty when the viewer may not email). */
export type PoSupplier = { name: string | null; to: string[]; cc: string[] };

/**
 * A timing action applied during this page session. Held at the top level (not
 * inside the task row) because applying an ETA + router.refresh() re-derives the
 * task lists, which unmounts the row — the "tell the supplier" follow-up has to
 * outlive that. `from` is the ETA as it stood BEFORE the change.
 */
type AppliedTiming = {
  poId: string;
  po: string;
  from: string | null;
  to: string;
  actionType: "delay" | "expedite";
};

const IDEAL = 1.5; // target months of cover
const OVER = 3; // overstock threshold (months)

export type ReorderProduct = {
  id: string;
  sku: string;
  stock: number;
  ams: number; // monthly
  coverage: number | null; // months
  unitsPerShipment?: number | null; // one shipment's loading size (main units)
};
export type IncLine = { qty: number; eta: string | null; po: string | null; poId: string | null };

function fmt(n: number) {
  return Math.round(n).toLocaleString("en-MY");
}
function cov1(c: number | null) {
  return c == null ? "—" : c.toFixed(1) + " mo";
}
function fmtEta(eta: string | null) {
  if (!eta) return "no ETA";
  const [, m, d] = eta.split("-").map(Number);
  const M = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${M[m]}`;
}
// Add n days to a YYYY-MM-DD string, returning YYYY-MM-DD (UTC-safe).
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type Item = { sku: string; cov: number | null; note: string };
type PoGroup = {
  poId: string | null;
  po: string;
  eta: string | null;
  overdue: boolean;
  status: string;
  items: Item[];
  sort: number;
  minCov: number | null;
  maxCov: number | null;
};
type FlatRow = { sku: string; cov: number | null; note: string; sort: number };

// Proposed ETA for a PO group, from its worst product coverage + current ETA.
function proposedEta(g: PoGroup, actionType: "delay" | "expedite", todayISO: string): string {
  const cur = g.eta;
  if (actionType === "delay") {
    // Push out so stock draws toward target. cov = the group's max coverage.
    const cov = g.maxCov ?? OVER;
    const laterOfEta = addDays(cur ?? todayISO, 30); // currentEta + 30d
    const drawDown = addDays(todayISO, Math.round((cov - IDEAL) * 30)); // today + (cov-1.5)mo
    return laterOfEta > drawDown ? laterOfEta : drawDown;
  }
  // Expedite: arrive by the stock-out date. cov = the group's min coverage.
  const cov = g.minCov ?? 0;
  const keepEta = cur ?? todayISO; // currentEta
  const stockOut = addDays(todayISO, Math.round(cov * 30)); // today + cov mo
  return keepEta < stockOut ? keepEta : stockOut;
}

export function PoReorderInsights({
  products,
  incoming,
  todayISO,
  resolvedDelay,
  resolvedExpedite,
  poSuppliers = {},
}: {
  products: ReorderProduct[];
  incoming: Record<string, IncLine[]>;
  todayISO: string;
  resolvedDelay: string[];
  resolvedExpedite: string[];
  /** poId -> supplier mailing lists. Empty for roles that cannot email. */
  poSuppliers?: Record<string, PoSupplier>;
}) {
  // Timing actions applied in this session -> the follow-up supplier email.
  const [applied, setApplied] = useState<Record<string, AppliedTiming>>({});
  const markApplied = (a: AppliedTiming) =>
    setApplied((prev) => ({ ...prev, [a.poId]: a }));

  const today = new Date(todayISO + "T00:00:00Z").getTime();
  const daysTo = (eta: string | null) =>
    eta ? Math.round((new Date(eta + "T00:00:00Z").getTime() - today) / 86400000) : null;

  const expediteBy = new Map<string, PoGroup>();
  const delayBy = new Map<string, PoGroup>();
  const newPo: FlatRow[] = [];

  const addTo = (
    map: Map<string, PoGroup>,
    poId: string | null,
    po: string | null,
    eta: string | null,
    overdue: boolean,
    status: string,
    groupSort: number,
    cov: number | null,
    item: Item
  ) => {
    const key = poId ?? po ?? "(no PO#)";
    let g = map.get(key);
    if (!g) {
      g = { poId, po: po ?? "(no PO#)", eta, overdue, status, items: [], sort: groupSort, minCov: cov, maxCov: cov };
      map.set(key, g);
    }
    // keep the earliest ETA / worst sort for the group
    if ((eta ?? "9999") < (g.eta ?? "9999")) g.eta = eta;
    if (overdue) g.overdue = true;
    if (groupSort < g.sort) {
      g.sort = groupSort;
      g.status = status;
    }
    if (cov != null) {
      g.minCov = g.minCov == null ? cov : Math.min(g.minCov, cov);
      g.maxCov = g.maxCov == null ? cov : Math.max(g.maxCov, cov);
    }
    g.items.push(item);
  };

  for (const p of products) {
    if (!(p.ams > 0)) continue;
    const cov = p.coverage != null ? Number(p.coverage) : p.stock / p.ams;
    const inc = incoming[p.id] ?? [];

    if (inc.length === 0) {
      if (cov != null && cov < IDEAL) {
        const need = Math.max(0, 2 * p.ams - p.stock);
        const ups = p.unitsPerShipment;
        let note: string;
        if (ups != null && ups > 0) {
          const shipments = Math.max(1, Math.ceil(need / ups));
          const suggestQty = shipments * ups;
          note = `order ≈ ${shipments} shipment${shipments === 1 ? "" : "s"} = ${fmt(suggestQty)} u`;
        } else {
          note = `order ~${fmt(need)} u (to ~2 mo) · set loading size in Products`;
        }
        newPo.push({ sku: p.sku, cov, note, sort: cov });
      }
      continue;
    }

    let earliest: IncLine | null = null;
    for (const l of inc) if (!earliest || (l.eta ?? "9999") < (earliest.eta ?? "9999")) earliest = l;
    const eta = earliest?.eta ?? null;
    const po = earliest?.po ?? null;
    const poId = earliest?.poId ?? null;
    const d = daysTo(eta);
    const runway = (cov ?? 0) * 30;

    if (cov != null && cov > OVER) {
      addTo(delayBy, poId, po, eta, false, "overstocked · consider delaying", -cov, cov, {
        sku: p.sku,
        cov,
        note: cov1(cov) + " cover",
      });
    } else if (d == null || d <= 0 || runway < d) {
      const overdue = d != null && d <= 0;
      const gap = d != null ? Math.round(d - runway) : null;
      addTo(
        expediteBy,
        poId,
        po,
        eta,
        overdue,
        overdue ? "overdue — follow up" : "runs out before ETA",
        overdue ? -1e9 : gap ?? 0,
        cov,
        { sku: p.sku, cov, note: overdue ? "overdue" : gap != null ? `~${gap}d short` : "late" }
      );
    }
  }

  const expedite = [...expediteBy.values()].sort((a, b) => a.sort - b.sort);
  const delay = [...delayBy.values()].sort((a, b) => a.sort - b.sort);
  newPo.sort((a, b) => a.sort - b.sort);

  const resolvedDelaySet = new Set(resolvedDelay);
  const resolvedExpediteSet = new Set(resolvedExpedite);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <PoGroupCard
        title={`Expedite — pull forward (${expedite.length})`}
        tone="bad"
        hint="a variation stocks out before the PO arrives"
        groups={expedite}
        actionType="expedite"
        resolvedSet={resolvedExpediteSet}
        todayISO={todayISO}
        poSuppliers={poSuppliers}
        applied={applied}
        onApplied={markApplied}
        empty="No PO needs expediting."
      />
      <FlatCard
        title={`Issue new PO (${newPo.length})`}
        tone="bad"
        hint="low cover · nothing incoming"
        rows={newPo}
        empty="Nothing needs a new PO."
      />
      <PoGroupCard
        title={`Delay — push back (${delay.length})`}
        tone="warn"
        hint="overstocked · more on the way"
        groups={delay}
        actionType="delay"
        resolvedSet={resolvedDelaySet}
        todayISO={todayISO}
        poSuppliers={poSuppliers}
        applied={applied}
        onApplied={markApplied}
        empty="No PO worth delaying."
      />
    </div>
  );
}

function Shell({
  title,
  tone,
  hint,
  children,
}: {
  title: string;
  tone: "bad" | "warn";
  hint: string;
  children: React.ReactNode;
}) {
  const dot = tone === "bad" ? "bg-red-500" : "bg-amber-500";
  const edge = tone === "bad" ? "border-l-red-400" : "border-l-amber-400";
  return (
    <div className={"rounded-lg border border-gray-200 border-l-4 p-3 bg-white " + edge}>
      <div className="flex items-center gap-1.5">
        <span className={"h-2 w-2 rounded-full " + dot} />
        <div className="text-sm font-medium text-gray-800">{title}</div>
      </div>
      <div className="text-[11px] text-gray-400 mb-2 ml-3.5">{hint}</div>
      {children}
    </div>
  );
}

function PoGroupCard({
  title,
  tone,
  hint,
  groups,
  actionType,
  resolvedSet,
  todayISO,
  poSuppliers,
  applied,
  onApplied,
  empty,
}: {
  title: string;
  tone: "bad" | "warn";
  hint: string;
  groups: PoGroup[];
  actionType: "delay" | "expedite";
  resolvedSet: Set<string>;
  todayISO: string;
  poSuppliers: Record<string, PoSupplier>;
  applied: Record<string, AppliedTiming>;
  onApplied: (a: AppliedTiming) => void;
  empty: string;
}) {
  const active = groups.filter((g) => !(g.poId && resolvedSet.has(g.poId)));
  const resolved = groups.filter((g) => g.poId && resolvedSet.has(g.poId));
  // Applied in this session, for this card's action — the supplier still has to
  // be told, so this survives the task row disappearing from the lists above.
  const justApplied = Object.values(applied).filter(
    (a) => a.actionType === actionType
  );

  return (
    <Shell title={title} tone={tone} hint={hint}>
      {justApplied.length > 0 && (
        <div className="mb-3 space-y-2">
          <div className="text-[11px] font-medium text-gray-500">
            Just applied — tell the supplier ({justApplied.length})
          </div>
          {justApplied.map((a) => {
            const sup = poSuppliers[a.poId] ?? null;
            const draft = poTimingEmail({
              poNumber: a.po,
              supplierName: sup?.name ?? null,
              kind: actionType === "expedite" ? "EXPEDITE" : "DELAY",
              currentEta: a.from,
              requestedEta: a.to,
            });
            return (
              <div
                key={a.poId}
                className="rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1.5"
              >
                <div className="text-xs font-medium text-emerald-700">
                  <span className="font-mono">{a.po}</span> · {fmtEta(a.from)}{" "}
                  <span className="text-emerald-400">→</span> {fmtEta(a.to)}
                </div>
                <div className="mt-1">
                  <EmailSupplierButton
                    recipients={{ to: sup?.to ?? [], cc: sup?.cc ?? [] }}
                    subject={draft.subject}
                    body={draft.body}
                    label={
                      actionType === "expedite"
                        ? "Email supplier — expedite"
                        : "Email supplier — delay"
                    }
                    size="xs"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {active.length === 0 && resolved.length === 0 ? (
        <p className="text-xs text-gray-400 py-1">{empty}</p>
      ) : (
        <>
          <ul className="space-y-2 max-h-80 overflow-y-auto">
            {active.map((g) => (
              <ActivePoGroup
                key={g.poId ?? g.po}
                group={g}
                actionType={actionType}
                proposed={proposedEta(g, actionType, todayISO)}
                onApplied={onApplied}
              />
            ))}
          </ul>
          {resolved.length > 0 && (
            <div className="mt-3 border-t border-gray-100 pt-2">
              <div className="text-[11px] font-medium text-gray-400 mb-1">
                Recently resolved ({resolved.length})
              </div>
              <ul className="space-y-1">
                {resolved.map((g) => (
                  <li
                    key={g.poId ?? g.po}
                    className="flex items-center justify-between gap-2 rounded-md bg-gray-50 px-2 py-1 text-xs text-gray-400"
                  >
                    <span className="font-mono truncate">
                      <span className="text-emerald-500">✓</span> {g.po}
                    </span>
                    <span className="shrink-0">ETA {fmtEta(g.eta)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}

// One actionable PO task: PO#, current → proposed ETA, an editable date input,
// and an Apply button. On success it shows an inline "Resolved" line and
// refreshes the page (so the task re-renders under "Recently resolved").
function ActivePoGroup({
  group,
  actionType,
  proposed,
  onApplied,
}: {
  group: PoGroup;
  actionType: "delay" | "expedite";
  proposed: string;
  onApplied: (a: AppliedTiming) => void;
}) {
  const router = useRouter();
  // The ETA as it stood before this row was touched — the supplier email needs
  // to state both the current and the requested date.
  const [etaBefore] = useState<string | null>(group.eta);
  const [eta, setEta] = useState(proposed);
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const label = actionType === "delay" ? "OK to delay" : "OK to expedite";

  function apply() {
    if (!group.poId) {
      setErr("This PO has no id yet");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eta)) {
      setErr("Pick a date");
      return;
    }
    setErr(null);
    startTransition(async () => {
      const res = await applyPoTiming(group.poId!, actionType, eta);
      if (res.ok) {
        setDone(eta);
        onApplied({
          poId: group.poId!,
          po: group.po,
          from: etaBefore,
          to: eta,
          actionType,
        });
        router.refresh();
      } else {
        setErr(res.error ?? "Failed to apply");
      }
    });
  }

  return (
    <li className="rounded-md bg-gray-50 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-800 font-mono">{group.po}</span>
        <span className={"text-[11px] font-medium " + (group.overdue ? "text-red-600" : "text-gray-500")}>
          {fmtEta(group.eta)} · {group.status}
        </span>
      </div>

      {done ? (
        <div className="mt-1 text-xs font-medium text-emerald-600">
          ✓ Resolved — ETA {fmtEta(done)}
        </div>
      ) : (
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-gray-500">
            {fmtEta(group.eta)} <span className="text-gray-300">→</span>
          </span>
          <input
            type="date"
            value={eta}
            disabled={isPending}
            onChange={(e) => {
              setEta(e.target.value);
              setErr(null);
            }}
            className="border border-gray-300 rounded-md px-1.5 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={apply}
            disabled={isPending || !group.poId}
            className="rounded-md bg-brand/10 text-brand px-2 py-0.5 text-[11px] font-medium hover:bg-brand/20 disabled:opacity-50"
          >
            {isPending ? "Saving…" : label}
          </button>
          {err && <span className="text-[10px] text-red-600">{err}</span>}
        </div>
      )}

      <ul className="mt-1 divide-y divide-gray-100">
        {group.items.map((it, i) => (
          <li key={it.sku + i} className="flex items-center justify-between gap-2 py-1 text-xs">
            <span className="text-gray-600 font-mono truncate">{it.sku}</span>
            <span className="text-gray-400 shrink-0">
              {cov1(it.cov)} · {it.note}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

function FlatCard({
  title,
  tone,
  hint,
  rows,
  empty,
}: {
  title: string;
  tone: "bad" | "warn";
  hint: string;
  rows: FlatRow[];
  empty: string;
}) {
  return (
    <Shell title={title} tone={tone} hint={hint}>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400 py-1">{empty}</p>
      ) : (
        <ul className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
          {rows.map((r, i) => (
            <li key={r.sku + i} className="py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-700 font-mono truncate">{r.sku}</span>
                <span className="text-xs text-gray-500 shrink-0">{cov1(r.cov)}</span>
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">{r.note}</div>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
