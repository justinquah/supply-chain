// One-off verification of the initial schema.
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
    if (!(line.slice(0, eq).trim() in process.env)) process.env[line.slice(0, eq).trim()] = val;
  }
}

const ref = process.env.SUPABASE_PROJECT_REF;
const pw = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD);
const client = new pg.Client({
  connectionString: `postgresql://postgres:${pw}@db.${ref}.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const q = async (sql) => (await client.query(sql)).rows;

const views = await q("SELECT viewname FROM pg_views WHERE schemaname='public'");
const enums = await q(`
  SELECT typname FROM pg_type WHERE typtype='e' AND typnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')
`);
const buckets = await q("SELECT id FROM storage.buckets ORDER BY id");
const policies = await q(`
  SELECT schemaname||'.'||tablename AS tbl, COUNT(*) AS n
  FROM pg_policies WHERE schemaname='public' GROUP BY tbl ORDER BY tbl
`);
const fns = await q(`
  SELECT proname FROM pg_proc WHERE pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')
  ORDER BY proname
`);

console.log(`\nVIEWS (${views.length}):`);
for (const r of views) console.log("  • " + r.viewname);
console.log(`\nENUMS (${enums.length}):`);
for (const r of enums) console.log("  • " + r.typname);
console.log(`\nSTORAGE BUCKETS (${buckets.length}):`);
for (const r of buckets) console.log("  • " + r.id);
console.log(`\nFUNCTIONS (${fns.length}):`);
for (const r of fns) console.log("  • " + r.proname);
console.log(`\nRLS POLICIES (per table):`);
for (const r of policies) console.log(`  • ${r.tbl.padEnd(35)} ${r.n}`);

await client.end();
