// Import monthly online + offline sales into Supabase.
// Online: filter to status 'shipped', group by System Product Code + platform.
// Offline: aggregate 'From Autocount' sheet by Item Code.
// Resolves each SKU -> main product (direct products.sku or sku_mappings.variant_sku),
// stores units_equivalent. Unknown SKUs logged to unknown_skus.
//
// Idempotent: deletes existing rows for each (year, month, channel) before inserting.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import XLSX from "xlsx";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
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
}

const DL = "/Users/boonsunquah/Downloads";
const FILES = [
  { year: 2026, month: 1, channel: "ONLINE",  path: `${DL}/2026.01-Online Order.xlsx` },
  { year: 2026, month: 2, channel: "ONLINE",  path: `${DL}/2026.02-Online order.xlsx` },
  { year: 2026, month: 3, channel: "ONLINE",  path: `${DL}/2026.03-Online order.xlsx` },
  { year: 2026, month: 4, channel: "ONLINE",  path: `${DL}/2026.04-Online order.xlsx` },
  { year: 2026, month: 1, channel: "OFFLINE", path: `${DL}/01. Blossom Wholesales Sold Unit Report Jan 2026.xlsx` },
  { year: 2026, month: 2, channel: "OFFLINE", path: `${DL}/02. Blossom Wholesales Sold Unit Report Feb 2026.xlsx` },
  { year: 2026, month: 3, channel: "OFFLINE", path: `${DL}/03. Blossom Wholesales Sold Unit Report Mar 2026 (2).xlsx` },
  { year: 2026, month: 4, channel: "OFFLINE", path: `${DL}/04. Blossom Wholesales Sold Unit Report Apr 2026.xlsx` },
];

const ref = process.env.SUPABASE_PROJECT_REF;
const pw = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD);
const client = new pg.Client({
  connectionString: `postgresql://postgres:${pw}@db.${ref}.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

// ---- Build SKU resolution map ----
// direct products.sku -> {productId, factor:1}
// sku_mappings.variant_sku -> {productId, factor:units_per_variant}
const resolveMap = new Map();
{
  const prods = await client.query("SELECT id, sku FROM products");
  for (const p of prods.rows) {
    resolveMap.set(p.sku.trim().toUpperCase(), { productId: p.id, factor: 1, via: "product" });
  }
  const maps = await client.query(
    "SELECT variant_sku, main_product_id, units_per_variant FROM sku_mappings"
  );
  for (const m of maps.rows) {
    const key = m.variant_sku.trim().toUpperCase();
    // don't overwrite a direct product match
    if (!resolveMap.has(key)) {
      resolveMap.set(key, {
        productId: m.main_product_id,
        factor: Number(m.units_per_variant),
        via: "mapping",
      });
    }
  }
}
console.log(`Resolution map: ${resolveMap.size} known SKUs\n`);

const unknownAgg = new Map(); // sku -> {count, units}

function aggregateOnline(path) {
  const wb = XLSX.readFile(path);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
  // key: sku|platform -> qty
  const agg = new Map();
  for (const r of rows) {
    const status = String(r[" Order Status"] || r["Order Status"] || "").trim().toLowerCase();
    if (status !== "shipped") continue; // shipped-only
    const code = (r[" System Product Code"] || r["System Product Code"] || "").toString().trim();
    if (!code) continue;
    const platform = (r[" Platform"] || r["Platform"] || "OTHER").toString().trim();
    const qty = Number(r[" Quantity"] || r["Quantity"]) || 0;
    if (qty === 0) continue;
    const key = code + "||" + platform;
    agg.set(key, (agg.get(key) || 0) + qty);
  }
  return agg; // Map "sku||platform" -> qty
}

function aggregateOffline(path) {
  const wb = XLSX.readFile(path);
  const sheet = wb.Sheets["From Autocount"] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  const agg = new Map();
  for (const r of rows) {
    const code = (r["Item Code"] || "").toString().trim();
    if (!code) continue;
    const qty = Number(r["Qty"]) || 0;
    if (qty === 0) continue;
    agg.set(code, (agg.get(code) || 0) + qty);
  }
  return agg; // Map sku -> qty
}

for (const f of FILES) {
  if (!existsSync(f.path)) {
    console.log(`⚠ MISSING: ${f.path}`);
    continue;
  }
  const label = `${f.year}-${String(f.month).padStart(2, "0")} ${f.channel}`;
  const agg = f.channel === "ONLINE" ? aggregateOnline(f.path) : aggregateOffline(f.path);

  // Clear existing rows for this period+channel
  await client.query(
    "DELETE FROM monthly_sales WHERE year=$1 AND month=$2 AND channel=$3",
    [f.year, f.month, f.channel]
  );

  let inserted = 0, knownUnits = 0, unknownUnits = 0, unknownCount = 0;
  for (const [key, qty] of agg) {
    let sku, platform;
    if (f.channel === "ONLINE") {
      [sku, platform] = key.split("||");
    } else {
      sku = key;
      platform = null;
    }
    const hit = resolveMap.get(sku.trim().toUpperCase());
    if (!hit) {
      unknownCount++;
      unknownUnits += qty;
      const u = unknownAgg.get(sku) || { count: 0, units: 0 };
      u.count += 1; u.units += qty;
      unknownAgg.set(sku, u);
      continue; // don't insert unknowns into monthly_sales
    }
    const unitsEquivalent = qty * hit.factor;
    knownUnits += unitsEquivalent;
    await client.query(
      `INSERT INTO monthly_sales
         (year, month, channel, platform, variant_sku, main_product_id, qty_sold_variant, units_equivalent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [f.year, f.month, f.channel, platform, sku, hit.productId, qty, unitsEquivalent]
    );
    inserted++;
  }

  await client.query(
    `INSERT INTO sales_uploads (year, month, channel, file_name, rows_imported, units_total)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (year, month, channel) DO UPDATE SET
       file_name=EXCLUDED.file_name, rows_imported=EXCLUDED.rows_imported,
       units_total=EXCLUDED.units_total, uploaded_at=NOW()`,
    [f.year, f.month, f.channel, f.path.split("/").pop(), inserted, knownUnits]
  );

  console.log(
    `${label.padEnd(18)} rows:${String(inserted).padStart(4)}  ` +
    `known units:${String(knownUnits).padStart(8)}  ` +
    `unknown SKUs:${String(unknownCount).padStart(3)} (${unknownUnits} units)`
  );
}

// ---- Log unknown SKUs ----
console.log(`\nLogging ${unknownAgg.size} unknown SKUs...`);
for (const [sku, info] of unknownAgg) {
  await client.query(
    `INSERT INTO unknown_skus (sku, occurrence_count, context, resolution)
     VALUES ($1,$2,$3,'PENDING')
     ON CONFLICT (sku) DO UPDATE SET
       occurrence_count = unknown_skus.occurrence_count + EXCLUDED.occurrence_count,
       last_seen_at = NOW()`,
    [sku, info.count, "sales import Jan-Apr 2026"]
  );
}

// ---- Summary ----
console.log("\n=== SALES SUMMARY (units_equivalent, main-product units) ===");
const summary = await client.query(`
  SELECT year, month, channel, SUM(units_equivalent)::int AS units
  FROM monthly_sales GROUP BY year, month, channel ORDER BY year, month, channel
`);
for (const r of summary.rows) {
  console.log(`  ${r.year}-${String(r.month).padStart(2,"0")} ${r.channel.padEnd(8)} ${r.units}`);
}

console.log("\n=== TOP 10 UNKNOWN SKUs (need review) ===");
const topUnknown = await client.query(
  `SELECT sku, occurrence_count FROM unknown_skus WHERE resolution='PENDING'
   ORDER BY occurrence_count DESC LIMIT 10`
);
for (const r of topUnknown.rows) console.log(`  ${r.sku.padEnd(45)} x${r.occurrence_count}`);
const totalUnknown = await client.query(`SELECT COUNT(*) FROM unknown_skus WHERE resolution='PENDING'`);
console.log(`  ... ${totalUnknown.rows[0].count} unknown SKUs total`);

await client.end();
console.log("\nDone.");
