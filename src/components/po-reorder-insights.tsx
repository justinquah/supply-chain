// PO timing & reorder intelligence for the dashboard. Compares each product's
// stock runway (coverage) against its incoming POs (EXPECTED incoming_stock, by ETA)
// and flags: expedite (will stock out before arrival / overdue), delay (overstocked
// with more coming), and issue-new-PO (low with nothing on the way).
// Expedite & Delay are grouped by PO (the action is on the PO) → the affected
// variations are listed under it. New-PO is per product (no PO exists yet).

const IDEAL = 1.5; // target months of cover
const OVER = 3; // overstock threshold (months)

export type ReorderProduct = {
  id: string;
  sku: string;
  stock: number;
  ams: number; // monthly
  coverage: number | null; // months
};
export type IncLine = { qty: number; eta: string | null; po: string | null };

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

type Item = { sku: string; cov: number | null; note: string };
type PoGroup = { po: string; eta: string | null; overdue: boolean; status: string; items: Item[]; sort: number };
type FlatRow = { sku: string; cov: number | null; note: string; sort: number };

export function PoReorderInsights({
  products,
  incoming,
  todayISO,
}: {
  products: ReorderProduct[];
  incoming: Record<string, IncLine[]>;
  todayISO: string;
}) {
  const today = new Date(todayISO + "T00:00:00Z").getTime();
  const daysTo = (eta: string | null) =>
    eta ? Math.round((new Date(eta + "T00:00:00Z").getTime() - today) / 86400000) : null;

  const expediteBy = new Map<string, PoGroup>();
  const delayBy = new Map<string, PoGroup>();
  const newPo: FlatRow[] = [];

  const addTo = (
    map: Map<string, PoGroup>,
    po: string | null,
    eta: string | null,
    overdue: boolean,
    status: string,
    groupSort: number,
    item: Item
  ) => {
    const key = po ?? "(no PO#)";
    let g = map.get(key);
    if (!g) {
      g = { po: key, eta, overdue, status, items: [], sort: groupSort };
      map.set(key, g);
    }
    // keep the earliest ETA / worst sort for the group
    if ((eta ?? "9999") < (g.eta ?? "9999")) g.eta = eta;
    if (overdue) g.overdue = true;
    if (groupSort < g.sort) {
      g.sort = groupSort;
      g.status = status;
    }
    g.items.push(item);
  };

  for (const p of products) {
    if (!(p.ams > 0)) continue;
    const cov = p.coverage != null ? Number(p.coverage) : p.stock / p.ams;
    const inc = incoming[p.id] ?? [];

    if (inc.length === 0) {
      if (cov != null && cov < IDEAL) {
        const suggest = Math.max(0, Math.round(2 * p.ams - p.stock));
        newPo.push({ sku: p.sku, cov, note: `order ~${fmt(suggest)} u (to ~2 mo)`, sort: cov });
      }
      continue;
    }

    let earliest: IncLine | null = null;
    for (const l of inc) if (!earliest || (l.eta ?? "9999") < (earliest.eta ?? "9999")) earliest = l;
    const eta = earliest?.eta ?? null;
    const po = earliest?.po ?? null;
    const d = daysTo(eta);
    const runway = (cov ?? 0) * 30;

    if (cov != null && cov > OVER) {
      addTo(delayBy, po, eta, false, "overstocked · consider delaying", -cov, {
        sku: p.sku,
        cov,
        note: cov1(cov) + " cover",
      });
    } else if (d == null || d <= 0 || runway < d) {
      const overdue = d != null && d <= 0;
      const gap = d != null ? Math.round(d - runway) : null;
      addTo(
        expediteBy,
        po,
        eta,
        overdue,
        overdue ? "overdue — follow up" : "runs out before ETA",
        overdue ? -1e9 : gap ?? 0,
        { sku: p.sku, cov, note: overdue ? "overdue" : gap != null ? `~${gap}d short` : "late" }
      );
    }
  }

  const expedite = [...expediteBy.values()].sort((a, b) => a.sort - b.sort);
  const delay = [...delayBy.values()].sort((a, b) => a.sort - b.sort);
  newPo.sort((a, b) => a.sort - b.sort);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <PoGroupCard
        title={`Expedite — pull forward (${expedite.length})`}
        tone="bad"
        hint="a variation stocks out before the PO arrives"
        groups={expedite}
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
  empty,
}: {
  title: string;
  tone: "bad" | "warn";
  hint: string;
  groups: PoGroup[];
  empty: string;
}) {
  return (
    <Shell title={title} tone={tone} hint={hint}>
      {groups.length === 0 ? (
        <p className="text-xs text-gray-400 py-1">{empty}</p>
      ) : (
        <ul className="space-y-2 max-h-80 overflow-y-auto">
          {groups.map((g) => (
            <li key={g.po} className="rounded-md bg-gray-50 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-gray-800 font-mono">{g.po}</span>
                <span className={"text-[11px] font-medium " + (g.overdue ? "text-red-600" : "text-gray-500")}>
                  {fmtEta(g.eta)} · {g.status}
                </span>
              </div>
              <ul className="mt-1 divide-y divide-gray-100">
                {g.items.map((it, i) => (
                  <li key={it.sku + i} className="flex items-center justify-between gap-2 py-1 text-xs">
                    <span className="text-gray-600 font-mono truncate">{it.sku}</span>
                    <span className="text-gray-400 shrink-0">
                      {cov1(it.cov)} · {it.note}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Shell>
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
