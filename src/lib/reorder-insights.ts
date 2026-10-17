// PO timing & reorder classification, shared by the Insights page (to count
// pending SCM actions) and the PoReorderInsights card (to render them), so the
// count and the cards can never disagree. Compares each product's stock runway
// (coverage) against its incoming POs (EXPECTED incoming_stock, by ETA):
//   • expedite — stocks out before the PO arrives / overdue  (grouped per PO)
//   • delay    — overstocked with more on the way            (grouped per PO)
//   • new PO   — low cover with nothing incoming             (per product)

export const REORDER_IDEAL = 1.5; // target months of cover
export const REORDER_OVER = 3; // overstock threshold (months)

export type ReorderProduct = {
  id: string;
  sku: string;
  stock: number;
  ams: number; // monthly
  coverage: number | null; // months
  unitsPerShipment?: number | null; // one shipment's loading size (main units)
  discontinuePlanned?: boolean;
  discontinueNote?: string | null;
};
export type IncLine = { qty: number; eta: string | null; po: string | null; poId: string | null };

export type ReorderItem = { sku: string; cov: number | null; note: string };
export type PoGroup = {
  poId: string | null;
  po: string;
  eta: string | null;
  overdue: boolean;
  status: string;
  items: ReorderItem[];
  sort: number;
  minCov: number | null;
  maxCov: number | null;
};
export type NewPoRow = {
  productId: string;
  sku: string;
  cov: number | null;
  note: string;
  sort: number;
  discontinuePlanned: boolean;
  discontinueNote: string | null;
};

function fmt(n: number) {
  return Math.round(n).toLocaleString("en-MY");
}
function cov1(c: number | null) {
  return c == null ? "—" : c.toFixed(1) + " mo";
}

export function classifyReorder(
  products: ReorderProduct[],
  incoming: Record<string, IncLine[]>,
  todayISO: string
): { expedite: PoGroup[]; delay: PoGroup[]; newPo: NewPoRow[] } {
  const today = new Date(todayISO + "T00:00:00Z").getTime();
  const daysTo = (eta: string | null) =>
    eta ? Math.round((new Date(eta + "T00:00:00Z").getTime() - today) / 86400000) : null;

  const expediteBy = new Map<string, PoGroup>();
  const delayBy = new Map<string, PoGroup>();
  const newPo: NewPoRow[] = [];

  const addTo = (
    map: Map<string, PoGroup>,
    poId: string | null,
    po: string | null,
    eta: string | null,
    overdue: boolean,
    status: string,
    groupSort: number,
    cov: number | null,
    item: ReorderItem
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
      if (cov != null && cov < REORDER_IDEAL) {
        const need = Math.max(0, 2 * p.ams - p.stock);
        const ups = p.unitsPerShipment;
        let note: string;
        if (ups != null && ups > 0) {
          const shipments = Math.max(1, Math.ceil(need / ups));
          note = `order ≈ ${shipments} shipment${shipments === 1 ? "" : "s"} = ${fmt(shipments * ups)} u`;
        } else {
          note = `order ~${fmt(need)} u (to ~2 mo) · set loading size in Products`;
        }
        newPo.push({
          productId: p.id,
          sku: p.sku,
          cov,
          note,
          sort: cov,
          discontinuePlanned: !!p.discontinuePlanned,
          discontinueNote: p.discontinueNote ?? null,
        });
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

    if (cov != null && cov > REORDER_OVER) {
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

  return {
    expedite: [...expediteBy.values()].sort((a, b) => a.sort - b.sort),
    delay: [...delayBy.values()].sort((a, b) => a.sort - b.sort),
    newPo: newPo.sort((a, b) => a.sort - b.sort),
  };
}

// Pending vs done per task type — drives the Insights summary strip.
export type ReorderStatusCounts = {
  expedite: { pending: number; done: number };
  delay: { pending: number; done: number };
  newPo: { pending: number; discontinuing: number };
};

export function reorderStatusCounts(
  c: ReturnType<typeof classifyReorder>,
  resolvedExpedite: Set<string>,
  resolvedDelay: Set<string>
): ReorderStatusCounts {
  const split = (groups: PoGroup[], resolved: Set<string>) => {
    const done = groups.filter((g) => g.poId && resolved.has(g.poId)).length;
    return { pending: groups.length - done, done };
  };
  const discontinuing = c.newPo.filter((r) => r.discontinuePlanned).length;
  return {
    expedite: split(c.expedite, resolvedExpedite),
    delay: split(c.delay, resolvedDelay),
    newPo: { pending: c.newPo.length - discontinuing, discontinuing },
  };
}
