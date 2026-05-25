// Import current inventory + planned arrivals from the SCM working file.
// Stock -> stock_snapshots (recorded 2026-05-18, source MANUAL)
// Arrivals (May/Jun/Jul/Aug) -> incoming_stock (expected mid-month)
// Idempotent: clears prior MANUAL snapshots dated 2026-05-18 and prior file-sourced incoming.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import XLSX from "xlsx";

const envPath = resolve(process.cwd(), ".env.local");
for (const raw of readFileSync(envPath, "utf8").split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq < 0) continue;
  let val = line.slice(eq + 1).trim();
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  const key = line.slice(0, eq).trim();
  if (!(key in process.env)) process.env[key] = val;
}

const FILE = "/Users/boonsunquah/Downloads/JJANGX3 Supply Chain File-18th May, 2026.xlsx";
const SNAPSHOT_DATE = "2026-05-18";
const ARRIVALS = [
  { col: 20, date: "2026-05-15", label: "May" },
  { col: 28, date: "2026-06-15", label: "Jun" },
  { col: 35, date: "2026-07-15", label: "Jul" },
  { col: 41, date: "2026-08-15", label: "Aug" },
];

const ref = process.env.SUPABASE_PROJECT_REF;
const pw = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD);
const client = new pg.Client({
  connectionString: `postgresql://postgres:${pw}@db.${ref}.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

// Add alias mappings for eco-pouch SKUs the SCM file writes without the -6PCS suffix
const ECO_ALIASES = [
  ["BC-ECO-CHK-MACK-70GX6", "BC-ECO-CHK-MACK-70GX-6PCS"],
  ["BC-ECO-CHK-SAR-70GX6", "BC-ECO-CHK-SAR-70GX-6PCS"],
  ["BC-ECO-CHK-SAL-TUNA-70GX6", "BC-ECO-CHK-SAL-TUNA-70GX-6PCS"],
];
for (const [alias, mainSku] of ECO_ALIASES) {
  const m = await client.query("SELECT id FROM products WHERE sku=$1", [mainSku]);
  if (m.rows[0]) {
    await client.query(
      `INSERT INTO sku_mappings (variant_sku, main_product_id, units_per_variant, variant_name, notes)
       VALUES ($1,$2,1,$1,'alias: SCM file naming')
       ON CONFLICT (variant_sku, main_product_id) DO NOTHING`,
      [alias, m.rows[0].id]
    );
  }
}

// Resolution map: products.sku (factor 1) + sku_mappings.variant_sku (factor = units_per_variant)
const resolveMap = new Map();
const prods = await client.query("SELECT id, sku FROM products");
for (const r of prods.rows)
  resolveMap.set(r.sku.trim().toUpperCase(), { id: r.id, factor: 1 });
const maps = await client.query(
  "SELECT variant_sku, main_product_id, units_per_variant FROM sku_mappings"
);
for (const r of maps.rows) {
  const k = r.variant_sku.trim().toUpperCase();
  if (!resolveMap.has(k))
    resolveMap.set(k, { id: r.main_product_id, factor: Number(r.units_per_variant) });
}

const wb = XLSX.readFile(FILE);
const rows = XLSX.utils.sheet_to_json(wb.Sheets["JJANGX3 Master File(Inventory o"], {
  header: 1,
  defval: null,
});

// Clear prior imports from this source
await client.query("DELETE FROM stock_snapshots WHERE source='MANUAL' AND recorded_at::date = $1", [SNAPSHOT_DATE]);
await client.query("DELETE FROM incoming_stock WHERE notes = 'SCM file 18 May 2026'");

const unmatched = new Set();
const stockByProduct = new Map(); // pid -> summed main-unit stock
const arrivalByProductDate = new Map(); // `${pid}|${date}` -> summed main-unit qty

for (let i = 2; i < rows.length; i++) {
  const r = rows[i];
  const sku = r[0];
  if (!sku || typeof sku !== "string" || !sku.includes("-")) continue;
  const hit = resolveMap.get(sku.trim().toUpperCase());
  if (!hit) {
    if (r[18] != null || r[20] != null) unmatched.add(sku.trim());
    continue;
  }
  const { id: pid, factor } = hit;

  const inv = Number(r[18]);
  if (Number.isFinite(inv))
    stockByProduct.set(pid, (stockByProduct.get(pid) || 0) + inv * factor);

  for (const a of ARRIVALS) {
    const q = Number(r[a.col]);
    if (Number.isFinite(q) && q > 0) {
      const key = `${pid}|${a.date}`;
      arrivalByProductDate.set(key, (arrivalByProductDate.get(key) || 0) + q * factor);
    }
  }
}

let stockN = 0, arrivalN = 0;
for (const [pid, qty] of stockByProduct) {
  await client.query(
    `INSERT INTO stock_snapshots (product_id, quantity, source, recorded_at)
     VALUES ($1,$2,'MANUAL',$3::timestamptz)`,
    [pid, Math.round(qty), SNAPSHOT_DATE + "T00:00:00+08:00"]
  );
  stockN++;
}
for (const [key, qty] of arrivalByProductDate) {
  const [pid, date] = key.split("|");
  await client.query(
    `INSERT INTO incoming_stock (product_id, quantity, expected_date, status, notes)
     VALUES ($1,$2,$3,'EXPECTED','SCM file 18 May 2026')`,
    [pid, Math.round(qty), date]
  );
  arrivalN++;
}

console.log(`Stock snapshots imported: ${stockN}`);
console.log(`Arrival entries imported:  ${arrivalN}`);
if (unmatched.size) {
  console.log(`\nUnmatched SKUs (have inventory but not in products): ${unmatched.size}`);
  for (const s of unmatched) console.log("  - " + s);
}

// Show top coverage risks now that stock is loaded
console.log("\n=== Lowest coverage (months) among selling products ===");
const risk = await client.query(`
  SELECT name, variation, current_stock, ROUND(ams_total) ams, ROUND(coverage_months,2) cov, incoming_total
  FROM product_dashboard
  WHERE is_main AND is_active AND ams_total > 0
  ORDER BY coverage_months ASC NULLS LAST LIMIT 10
`);
for (const r of risk.rows) {
  console.log(`  ${(r.name||'').slice(0,38).padEnd(40)} stock=${String(r.current_stock).padStart(6)} ams=${String(r.ams).padStart(6)} cov=${String(r.cov).padStart(5)}mo incoming=${r.incoming_total}`);
}

await client.end();
console.log("\nDone.");
