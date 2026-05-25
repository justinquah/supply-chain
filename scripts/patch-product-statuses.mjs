// One-off update: discontinue 80g Can + Premium Pouch families,
// set 15g Creamy Treats cost = 1 RMB from SHANDONG.

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

// 1. Discontinue 80g Can + Premium Pouch families
const disc = await client.query(`
  UPDATE products
  SET is_active = false, updated_at = NOW()
  WHERE product_family IN ('80g Can', 'Premium Pouch')
  RETURNING sku, product_family, variation
`);
console.log(`Discontinued ${disc.rows.length} products:`);
for (const r of disc.rows) {
  console.log(`  ✗ ${r.sku.padEnd(45)} ${r.product_family} / ${r.variation}`);
}

// 2. 15g Creamy Treats → cost 1 RMB from SHANDONG
const shandong = await client.query(
  `SELECT id FROM profiles WHERE email = 'shandong@suppliers.placeholder'`
);
const shandongId = shandong.rows[0]?.id;
if (!shandongId) {
  console.error("SHANDONG supplier profile not found");
  process.exit(1);
}

const creamyProducts = await client.query(`
  SELECT id, sku FROM products WHERE product_family = '15g Creamy Treats' AND is_active = true
`);
console.log(`\n15g Creamy Treats: ${creamyProducts.rows.length} products`);
for (const p of creamyProducts.rows) {
  // Update product
  await client.query(
    `UPDATE products
     SET supplier_id = $1, unit_cost = 1, cost_currency = 'CNY', updated_at = NOW()
     WHERE id = $2`,
    [shandongId, p.id]
  );
  // Upsert product_supplier
  await client.query(
    `INSERT INTO product_suppliers (product_id, supplier_id, unit_cost, cost_currency, cost_per_units, is_primary)
     VALUES ($1, $2, 1, 'CNY', 1, true)
     ON CONFLICT (product_id, supplier_id) DO UPDATE SET
       unit_cost = 1, cost_currency = 'CNY', cost_per_units = 1, is_primary = true`,
    [p.id, shandongId]
  );
  console.log(`  ✓ ${p.sku}  →  1 CNY/unit from SHANDONG`);
}

// Quick verification
console.log("\n=== After ===");
const counts = await client.query(`
  SELECT
    COUNT(*) FILTER (WHERE is_active = true AND is_main = true) AS active_main,
    COUNT(*) FILTER (WHERE is_active = false) AS discontinued,
    COUNT(*) FILTER (WHERE is_active = true AND is_main = true AND supplier_id IS NULL) AS missing_supplier
  FROM products
`);
console.log(counts.rows[0]);

await client.end();
