// Tiny inline SVG sparkline for monthly series. Presentational; safe in server
// or client components. Colour follows momentum (up/down/flat).

export function Sparkline({
  values,
  width = 88,
  height = 26,
  dir = "flat",
}: {
  values: number[];
  width?: number;
  height?: number;
  dir?: "up" | "down" | "flat";
}) {
  const n = values.length;
  if (n === 0) return <span className="text-gray-300 text-xs">—</span>;

  const stroke =
    dir === "up" ? "#059669" : dir === "down" ? "#dc2626" : "#9ca3af"; // emerald-600 / red-600 / gray-400
  const pad = 2;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const stepX = n > 1 ? (width - pad * 2) / (n - 1) : 0;
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const pts = values.map((v, i) => `${pad + i * stepX},${y(v).toFixed(1)}`);

  const lastX = pad + (n - 1) * stepX;
  const lastY = y(values[n - 1]);

  return (
    <svg width={width} height={height} className="inline-block align-middle" aria-hidden="true">
      {n === 1 ? (
        <circle cx={lastX} cy={lastY} r={2} fill={stroke} />
      ) : (
        <>
          <polyline
            points={pts.join(" ")}
            fill="none"
            stroke={stroke}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx={lastX} cy={lastY} r={2} fill={stroke} />
        </>
      )}
    </svg>
  );
}
