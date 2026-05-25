// Seed supplier accounts + import MASTER SKU FILE.xlsx into Supabase.
//
// Idempotent — re-runs are safe.
// Uses direct DB access (SUPABASE_DB_PASSWORD).

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import XLSX from "xlsx";

// ---------- env loading ----------
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

// ---------- constants ----------
const SUPPLIERS = [
  { name: "SANLIN INDUSTRIAL GROUP (HK) LIMITED",   email: "sanlin@suppliers.placeholder",   short: "sanlin"    },
  { name: "DALIAN JIU ZHOU YUAN TRADING CO. LTD",   email: "dalian@suppliers.placeholder",   short: "dalian"    },
  { name: "SIAM INTERNATIONAL",                      email: "siam@suppliers.placeholder",      short: "siam"      },
  { name: "SHANDONG FANBEI PET FOOD CO. LTD",        email: "shandong@suppliers.placeholder",  short: "shandong"  },
  { name: "XINTAI NUODE PET PRODUCTS CO. LTD",       email: "xintai@suppliers.placeholder",    short: "xintai"    },
  { name: "NUTRIX PUBLIC LIMITED COMPANY",           email: "nutrix@suppliers.placeholder",    short: "nutrix"    },
];

const CATEGORIES = [
  { name: "Wet food",   default_target_turnover: 6 },
  { name: "Dry Food",   default_target_turnover: 6 },
  { name: "Cat litter", default_target_turnover: 6 },
  { name: "GWP",        default_target_turnover: 12 },
];

// MYR-equivalent for cross-currency comparison (approximate, 2026)
const FX_TO_MYR = { MYR: 1, USD: 4.7, CNY: 0.65, THB: 0.13 };

// Manual fixes from user clarification
const QUANTITY_FIXES = {
  // Row 41,42,43 — Sub sku-3 "X-70GX6(48pcs)" should be 8 main units
  "BC-ECO-CHK-MACK-70GX6(48pcs)":     8,
  "BC-ECO-CHK-SAR-70GX6(48pcs)":      8,
  "BC-ECO-CHK-SAL-TUNA-70GX6(48pcs)": 8,
};

// Products user marked discontinued
const DISCONTINUED_SKUS = new Set([
  "BC-PF-CAN-TUNA-PURE-80G",
]);

// ---------- helpers ----------
function parseCost(raw, supplierName) {
  if (raw == null || raw === "" || raw === 0) return null;
  const s = String(raw).trim();

  // Try to detect currency
  let currency = null;
  let numStr = s;

  if (s.startsWith("$")) {
    currency = "USD";
    numStr = s.slice(1);
  } else if (/^RMB/i.test(s) || s.includes("¥")) {
    currency = "CNY";
    numStr = s.replace(/^RMB\s*/i, "").replace(/¥/g, "");
  } else if (s.includes("฿") || /^THB/i.test(s)) {
    currency = "THB";
    numStr = s.replace(/฿/g, "").replace(/^THB\s*/i, "");
  } else if (/^[\d.,]+$/.test(s)) {
    // Plain number — based on user clarification, Siam/Thai products use plain THB
    currency = "THB";
  } else {
    return { error: `Could not parse cost: "${s}"`, raw: s };
  }

  const num = parseFloat(numStr.replace(/,/g, ""));
  if (isNaN(num)) return { error: `NaN cost: "${s}"`, raw: s };
  return { amount: num, currency };
}

function parseLoadingCapacity(raw) {
  if (raw == null || raw === "" || raw === 0) return null;
  const s = String(raw).trim();
  const num = parseFloat(s.replace(/[^\d.]/g, ""));
  if (isNaN(num)) return null;
  return num;
}

function matchSupplier(name, supplierIdMap) {
  if (!name || name === "0") return null;
  // Match by case-insensitive substring on first word
  const needle = name.trim().toLowerCase();
  for (const s of SUPPLIERS) {
    if (needle.includes(s.short) || s.name.toLowerCase() === needle) {
      return supplierIdMap.get(s.email);
    }
  }
  return null;
}

// ---------- main ----------
const ref = process.env.SUPABASE_PROJECT_REF;
const pw = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD);
const client = new pg.Client({
  connectionString: `postgresql://postgres:${pw}@db.${ref}.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const flags = [];

// ===== 1. Seed suppliers =====
console.log("\n=== 1. Suppliers ===");
const supplierIdMap = new Map();
for (const sup of SUPPLIERS) {
  const existing = await client.query("SELECT id FROM auth.users WHERE email=$1", [sup.email]);
  let userId;
  if (existing.rows.length > 0) {
    userId = existing.rows[0].id;
    await client.query(
      `UPDATE public.profiles SET role='SUPPLIER', name=$2, company_name=$2 WHERE id=$1`,
      [userId, sup.name]
    );
    console.log(`✓ ${sup.name} (already exists)`);
  } else {
    const password = "TempPass-" + Math.random().toString(36).slice(2, 10);
    const ins = await client.query(
      `
      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, email_change,
        email_change_token_new, recovery_token
      ) VALUES (
        '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
        'authenticated','authenticated',$1,extensions.crypt($2, extensions.gen_salt('bf')),
        NOW(),'{"provider":"email","providers":["email"]}'::jsonb,$3::jsonb,
        NOW(),NOW(),'','','',''
      ) RETURNING id
      `,
      [sup.email, password, JSON.stringify({ name: sup.name, role: "SUPPLIER" })]
    );
    userId = ins.rows[0].id;
    // Also set company_name on profile
    await client.query(`UPDATE public.profiles SET company_name=$1 WHERE id=$2`, [sup.name, userId]);
    console.log(`+ ${sup.name} (created, password ${password})`);
  }
  supplierIdMap.set(sup.email, userId);
}

// ===== 2. Seed categories =====
console.log("\n=== 2. Categories ===");
const categoryIdMap = new Map();
for (const cat of CATEGORIES) {
  const ins = await client.query(
    `INSERT INTO product_categories (name, default_target_turnover)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET default_target_turnover=EXCLUDED.default_target_turnover
     RETURNING id`,
    [cat.name, cat.default_target_turnover]
  );
  categoryIdMap.set(cat.name.toLowerCase(), ins.rows[0].id);
  console.log(`✓ ${cat.name}`);
}

// ===== 3. Read & parse Excel =====
console.log("\n=== 3. Reading MASTER SKU FILE.xlsx ===");
const wb = XLSX.readFile("/Users/boonsunquah/Downloads/MASTER SKU FILE.xlsx");
const ws = wb.Sheets[wb.SheetNames[0]];
const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

// Skip header row, drop trailing empties
const dataRows = rawRows.slice(1).filter((r) => r.some((c) => c != null && c !== ""));
console.log(`Found ${dataRows.length} data rows`);

// Forward-fill Excel-merged-cell convention. A new product family is marked by
// column 0 (Product name) being set. Within a family, columns 3-10 inherit
// from the family's first row when they're blank.
const FAMILY_INHERIT_COLS = [3, 4, 5, 6, 7, 8, 9, 10]; // Category .. Cost2
const filled = dataRows.map((r) => r.slice());
for (let i = 1; i < filled.length; i++) {
  const sameFamily = filled[i][0] == null || filled[i][0] === "";
  if (sameFamily) {
    filled[i][0] = filled[i - 1][0];
    for (const c of FAMILY_INHERIT_COLS) {
      if (filled[i][c] == null || filled[i][c] === "") filled[i][c] = filled[i - 1][c];
    }
  }
}

// ===== 4. Import products + sku_mappings + product_suppliers =====
console.log("\n=== 4. Importing products ===");
let imported = 0, skipped = 0;
const productIdBySku = new Map();
const allMappings = [];

for (let rowIdx = 0; rowIdx < filled.length; rowIdx++) {
  const r = filled[rowIdx];
  const [productName, mainSku, variation, category, packSize, loadingCap,
         sup1Name, cost1Raw, uomRaw, sup2Name, cost2Raw,
         sku1, qty1, sku2, qty2, sku3, qty3, sku4, qty4, sku5, qty5] = r;

  // Skip placeholder "New" rows
  if (!mainSku || mainSku === "New") {
    skipped++;
    flags.push(`Row ${rowIdx + 2}: skipped (Main SKU = "${mainSku}", ${productName || "no product name"} / ${variation || "no variation"})`);
    continue;
  }

  const isGWP = (productName || "").toUpperCase() === "GWP";
  const catName = isGWP ? "GWP" : (category || "").toLowerCase();
  const categoryId = categoryIdMap.get(catName);
  if (!categoryId) {
    flags.push(`Row ${rowIdx + 2} [${mainSku}]: unknown category "${category}", using GWP`);
  }

  // Parse costs and pick primary supplier (lower MYR-equivalent per main unit)
  const sup1Id = matchSupplier(sup1Name, supplierIdMap);
  const sup2Id = matchSupplier(sup2Name, supplierIdMap);

  let uom = parseFloat(uomRaw);
  if (isNaN(uom) || uom <= 0) uom = 1;

  const supEntries = [];
  for (const [supId, costRaw, name] of [[sup1Id, cost1Raw, sup1Name], [sup2Id, cost2Raw, sup2Name]]) {
    if (!supId || costRaw == null || costRaw === 0 || costRaw === "") continue;
    const parsed = parseCost(costRaw, name);
    if (!parsed || parsed.error) {
      flags.push(`Row ${rowIdx + 2} [${mainSku}]: ${parsed?.error || "no cost for supplier " + name}`);
      continue;
    }
    const perUnit = parsed.amount / uom;
    const myrEq = perUnit * (FX_TO_MYR[parsed.currency] || 1);
    supEntries.push({ supId, perUnit, currency: parsed.currency, perUnits: uom, myrEq });
  }
  supEntries.sort((a, b) => a.myrEq - b.myrEq);
  if (supEntries.length > 0) supEntries[0].isPrimary = true;

  const primarySupplierId = supEntries[0]?.supId || sup1Id || sup2Id || null;
  const primaryCost = supEntries[0]?.perUnit || null;
  const primaryCurrency = supEntries[0]?.currency || "MYR";

  const isDiscontinued = DISCONTINUED_SKUS.has(mainSku);
  const isMain = !isGWP;

  // Insert/update product
  const prodIns = await client.query(
    `
    INSERT INTO products
      (sku, name, category_id, supplier_id, unit_cost, cost_currency,
       units_per_carton, pack_size, loading_capacity, product_family, variation,
       is_main, is_active)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (sku) DO UPDATE SET
      name           = EXCLUDED.name,
      category_id    = EXCLUDED.category_id,
      supplier_id    = EXCLUDED.supplier_id,
      unit_cost      = EXCLUDED.unit_cost,
      cost_currency  = EXCLUDED.cost_currency,
      pack_size      = EXCLUDED.pack_size,
      loading_capacity = EXCLUDED.loading_capacity,
      product_family = EXCLUDED.product_family,
      variation      = EXCLUDED.variation,
      is_main        = EXCLUDED.is_main,
      is_active      = EXCLUDED.is_active,
      updated_at     = NOW()
    RETURNING id
    `,
    [
      mainSku,
      [productName, variation].filter(Boolean).join(" - ") || mainSku,
      categoryId || categoryIdMap.get("gwp"),
      primarySupplierId,
      primaryCost,
      primaryCurrency,
      Math.max(1, Math.round(uom)) || 1,
      packSize || null,
      parseLoadingCapacity(loadingCap),
      productName || null,
      variation || null,
      isMain,
      !isDiscontinued,
    ]
  );
  const productId = prodIns.rows[0].id;
  productIdBySku.set(mainSku, productId);

  // Insert product_suppliers entries
  await client.query(`DELETE FROM product_suppliers WHERE product_id=$1`, [productId]);
  for (const e of supEntries) {
    await client.query(
      `INSERT INTO product_suppliers (product_id, supplier_id, unit_cost, cost_currency, cost_per_units, is_primary)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (product_id, supplier_id) DO UPDATE SET
         unit_cost=EXCLUDED.unit_cost, cost_currency=EXCLUDED.cost_currency,
         cost_per_units=EXCLUDED.cost_per_units, is_primary=EXCLUDED.is_primary`,
      [productId, e.supId, e.perUnit, e.currency, e.perUnits, !!e.isPrimary]
    );
  }

  // Collect sku_mappings (skip Sub sku-1 since it equals main SKU)
  const subSkus = [[sku2, qty2], [sku3, qty3], [sku4, qty4], [sku5, qty5]];
  for (const [variantSku, rawQty] of subSkus) {
    if (!variantSku) continue;
    let qty = rawQty;
    if (qty == null || qty === "") {
      if (QUANTITY_FIXES[variantSku] != null) {
        qty = QUANTITY_FIXES[variantSku];
        flags.push(`Row ${rowIdx + 2} [${variantSku}]: quantity was null, applied fix → ${qty}`);
      } else {
        flags.push(`Row ${rowIdx + 2} [${variantSku}]: null quantity, skipped mapping`);
        continue;
      }
    }
    qty = parseFloat(qty);
    if (isNaN(qty) || qty <= 0) {
      flags.push(`Row ${rowIdx + 2} [${variantSku}]: invalid quantity "${rawQty}", skipped`);
      continue;
    }
    allMappings.push({ variantSku, mainProductId: productId, qty, mainSku });
  }

  imported++;
}

console.log(`\n  Imported: ${imported}`);
console.log(`  Skipped:  ${skipped}`);

// ===== 5. Insert sku_mappings =====
console.log(`\n=== 5. SKU mappings (${allMappings.length}) ===`);
await client.query("DELETE FROM sku_mappings");
for (const m of allMappings) {
  await client.query(
    `INSERT INTO sku_mappings (variant_sku, main_product_id, units_per_variant, variant_name)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (variant_sku, main_product_id) DO UPDATE SET
       units_per_variant=EXCLUDED.units_per_variant`,
    [m.variantSku, m.mainProductId, m.qty, m.variantSku]
  );
}
console.log(`  ${allMappings.length} mappings inserted`);

// ===== 6. Summary =====
console.log("\n=== SUMMARY ===");
const rcProducts   = await client.query("SELECT COUNT(*) FROM products");
const rcMain       = await client.query("SELECT COUNT(*) FROM products WHERE is_main=true AND is_active=true");
const rcInactive   = await client.query("SELECT sku FROM products WHERE is_active=false");
const rcGwp        = await client.query("SELECT sku FROM products WHERE is_main=false");
const rcMappings   = await client.query("SELECT COUNT(*) FROM sku_mappings");
const rcSupRel     = await client.query("SELECT COUNT(*) FROM product_suppliers");
console.log(`  Products total:       ${rcProducts.rows[0].count}`);
console.log(`  Active main products: ${rcMain.rows[0].count}`);
console.log(`  Inactive (discontinued): ${rcInactive.rows.map(r => r.sku).join(", ") || "(none)"}`);
console.log(`  GWP (non-main):       ${rcGwp.rows.map(r => r.sku).join(", ") || "(none)"}`);
console.log(`  SKU mappings:         ${rcMappings.rows[0].count}`);
console.log(`  Product-supplier links: ${rcSupRel.rows[0].count}`);

if (flags.length > 0) {
  console.log(`\n=== FLAGS (${flags.length}) ===`);
  for (const f of flags) console.log("  ⚠ " + f);
}

await client.end();
console.log("\nDone.");
