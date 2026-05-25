import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

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

const ref = process.env.SUPABASE_PROJECT_REF;
const pw = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD);
const client = new pg.Client({
  connectionString: `postgresql://postgres:${pw}@db.${ref}.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log("=== Products with no supplier ===");
const orphans = await client.query(`
  SELECT p.sku, p.product_family, p.variation
  FROM products p
  LEFT JOIN product_suppliers ps ON ps.product_id = p.id
  WHERE ps.id IS NULL AND p.is_active = true AND p.is_main = true
  ORDER BY p.product_family, p.sku
`);
console.log(`  ${orphans.rows.length} products without any supplier link:`);
for (const r of orphans.rows) {
  console.log(`    ${r.sku.padEnd(45)} ${r.product_family} / ${r.variation}`);
}

console.log("\n=== Primary suppliers chosen (sample) ===");
const primaries = await client.query(`
  SELECT p.sku, p.product_family, prof.name AS primary_supplier,
         ps.unit_cost, ps.cost_currency,
         (SELECT COUNT(*) FROM product_suppliers WHERE product_id = p.id) AS supplier_count
  FROM products p
  JOIN product_suppliers ps ON ps.product_id = p.id AND ps.is_primary
  JOIN profiles prof ON prof.id = ps.supplier_id
  ORDER BY p.product_family, p.sku
`);
console.log(`  ${primaries.rows.length} products with primary supplier:`);
for (const r of primaries.rows) {
  const cost = `${r.unit_cost} ${r.cost_currency}/unit`;
  const fam = r.product_family.padEnd(28);
  const sup = (r.primary_supplier.length > 30 ? r.primary_supplier.slice(0, 27) + "..." : r.primary_supplier).padEnd(30);
  console.log(`    ${r.sku.padEnd(40)} ${fam} → ${sup} ${cost} (${r.supplier_count} supplier(s))`);
}

console.log("\n=== SKU mapping samples (bundles & fractions) ===");
const mappings = await client.query(`
  SELECT m.variant_sku, p.sku AS main_sku, m.units_per_variant
  FROM sku_mappings m
  JOIN products p ON p.id = m.main_product_id
  WHERE m.units_per_variant != 1
  ORDER BY p.sku, m.units_per_variant
  LIMIT 20
`);
for (const r of mappings.rows) {
  console.log(`    ${r.variant_sku.padEnd(50)} → ${r.main_sku.padEnd(40)} × ${r.units_per_variant}`);
}

await client.end();
