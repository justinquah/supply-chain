// PO timing & reorder intelligence for the dashboard. Compares each product's
// stock runway (coverage) against its incoming POs (EXPECTED incoming_stock, by ETA)
// and flags: expedite (will stock out before arrival / overdue), delay (overstocked
// with more coming), and issue-new-PO (low with nothing on the way).

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
  const [y, m, d] = eta.split("-").map(Number);
  const M = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${M[m]}`;
}

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

  type Row = {
    sku: string;
    cov: number | null;
    po: string | null;
    eta: string | null;
    note: string;
    sort: number;
  };
  const expedite: Row[] = [];
  const delay: Row[] = [];
  const newPo: Row[] = [];

  for (const p of products) {
    if (!(p.ams > 0)) continue;
    const cov = p.coverage != null ? Number(p.coverage) : p.ams > 0 ? p.stock / p.ams : null;
    const inc = incoming[p.id] ?? [];

    if (inc.length === 0) {
      if (cov != null && cov < IDEAL) {
        const suggest = Math.max(0, Math.round(2 * p.ams - p.stock));
        newPo.push({
          sku: p.sku,
          cov,
          po: null,
          eta: null,
          note: `order ~${fmt(suggest)} u (to ~2 mo)`,
          sort: cov,
        });
      }
      continue;
    }

    // earliest incoming
    let earliest: IncLine | null = null;
    for (const l of inc) {
      if (!earliest || (l.eta ?? "9999") < (earliest.eta ?? "9999")) earliest = l;
    }
    const eta = earliest?.eta ?? null;
    const po = earliest?.po ?? null;
    const d = daysTo(eta);
    const runway = (cov ?? 0) * 30;

    if (cov != null && cov > OVER) {
      const totalInc = inc.reduce((s, l) => s + l.qty, 0);
      delay.push({
        sku: p.sku,
        cov,
        po,
        eta,
        note: `${cov1(cov)} cover · +${fmt(totalInc)} u incoming`,
        sort: -cov,
      });
    } else if (d == null || d <= 0 || runway < d) {
      const overdue = d != null && d <= 0;
      const gap = d != null ? Math.round(d - runway) : null;
      expedite.push({
        sku: p.sku,
        cov,
        po,
        eta,
        note: overdue
          ? "overdue — follow up"
          : gap != null
          ? `runs out ~${gap}d before ETA`
          : "arrives late",
        sort: overdue ? -1e9 : gap ?? 0,
      });
    }
  }

  expedite.sort((a, b) => a.sort - b.sort);
  delay.sort((a, b) => a.sort - b.sort);
  newPo.sort((a, b) => a.sort - b.sort);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <ReorderCard
        title={`Expedite — pull forward (${expedite.length})`}
        tone="bad"
        hint="stocks out before the PO arrives"
        rows={expedite}
        empty="No PO needs expediting."
      />
      <ReorderCard
        title={`Issue new PO (${newPo.length})`}
        tone="bad"
        hint="low cover · nothing incoming"
        rows={newPo}
        empty="Nothing needs a new PO."
      />
      <ReorderCard
        title={`Delay — push back (${delay.length})`}
        tone="warn"
        hint="overstocked · more on the way"
        rows={delay}
        empty="No PO worth delaying."
      />
    </div>
  );
}

function ReorderCard({
  title,
  tone,
  hint,
  rows,
  empty,
}: {
  title: string;
  tone: "bad" | "warn";
  hint: string;
  rows: { sku: string; cov: number | null; po: string | null; eta: string | null; note: string }[];
  empty: string;
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
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400 py-1">{empty}</p>
      ) : (
        <ul className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
          {rows.map((r, i) => (
            <li key={r.sku + i} className="py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-gray-700 font-mono text-xs truncate">{r.sku}</span>
                <span className="text-xs text-gray-500 shrink-0">{cov1(r.cov)}</span>
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5 flex items-center justify-between gap-2">
                <span className="truncate">
                  {r.po ? `${r.po} · ${fmtEta(r.eta)}` : r.note}
                </span>
                {r.po && <span className="shrink-0">{r.note}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
