// Run a SQL migration file against Supabase Postgres.
//
// Usage:
//   node scripts/run-migration.mjs supabase/migrations/0001_initial_schema.sql
//
// Requires SUPABASE_DB_PASSWORD in .env.local (and SUPABASE_PROJECT_REF + SUPABASE_DB_REGION
// or override with SUPABASE_DB_URL).

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const { Client } = pg;

// --- load .env.local manually (no extra deps) -----------------------------
const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}

// --- resolve connection ---------------------------------------------------
function buildConnectionString() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;

  const password = process.env.SUPABASE_DB_PASSWORD;
  const ref = process.env.SUPABASE_PROJECT_REF || "ajkkxmshwealsjfsevhw";
  if (!password) {
    throw new Error(
      "SUPABASE_DB_PASSWORD not set. Add it to .env.local:\n" +
        '  SUPABASE_DB_PASSWORD="your-db-password-here"'
    );
  }
  // Direct connection (port 5432) — required for DDL
  const encoded = encodeURIComponent(password);
  return `postgresql://postgres:${encoded}@db.${ref}.supabase.co:5432/postgres`;
}

// --- main -----------------------------------------------------------------
const sqlPath = process.argv[2];
if (!sqlPath) {
  console.error("Usage: node scripts/run-migration.mjs <path-to-sql>");
  process.exit(1);
}
const absPath = resolve(process.cwd(), sqlPath);
if (!existsSync(absPath)) {
  console.error(`SQL file not found: ${absPath}`);
  process.exit(1);
}

const sql = readFileSync(absPath, "utf8");
console.log(`Loaded migration: ${sqlPath} (${sql.length.toLocaleString()} chars)`);

const client = new Client({
  connectionString: buildConnectionString(),
  ssl: { rejectUnauthorized: false }, // Supabase requires TLS
});

try {
  console.log("Connecting to Supabase…");
  await client.connect();
  console.log("Connected. Running SQL…");
  const t0 = Date.now();
  await client.query(sql);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`✅ Migration completed in ${elapsed}s`);

  // Quick verification
  const { rows } = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
  );
  console.log(`\nPublic tables (${rows.length}):`);
  for (const r of rows) console.log(`  • ${r.tablename}`);
} catch (err) {
  console.error("\n❌ Migration failed:");
  console.error(err.message);
  if (err.position) console.error(`  at SQL position ${err.position}`);
  process.exit(1);
} finally {
  await client.end();
}
