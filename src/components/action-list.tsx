export function ActionList({
  title,
  tone,
  hint,
  rows,
  empty,
}: {
  title: string;
  tone: "bad" | "warn";
  hint: string;
  rows: { sku: string; right: string }[];
  empty: string;
}) {
  const dot = tone === "bad" ? "bg-red-500" : "bg-amber-500";
  const edge = tone === "bad" ? "border-l-red-400" : "border-l-amber-400";
  return (
    <div className={"rounded-lg border border-gray-200 border-l-4 p-3 " + edge}>
      <div className="flex items-center gap-1.5">
        <span className={"h-2 w-2 rounded-full " + dot} />
        <div className="text-sm font-medium text-gray-800">{title}</div>
      </div>
      <div className="text-[11px] text-gray-400 mb-2 ml-3.5">{hint}</div>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400 py-1">{empty}</p>
      ) : (
        <ul className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.sku} className="flex items-center justify-between py-1.5 text-sm gap-3">
              <span className="text-gray-700 font-mono text-xs truncate">{r.sku}</span>
              <span className="text-gray-500 tabular-nums text-xs whitespace-nowrap">{r.right}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
