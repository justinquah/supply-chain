// Create initial SUPER_ADMIN users directly via SQL.
//
// Uses direct DB access (SUPABASE_DB_PASSWORD) — does NOT require service_role key.
//
// Generates a random password for each user and prints credentials.
// Safe to re-run: skips users whose email already exists.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
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
if (!process.env.SUPABASE_DB_PASSWORD) {
  console.error("SUPABASE_DB_PASSWORD missing in .env.local");
  process.exit(1);
}

const USERS = [
  { email: "justinquah@blossom-commerce.com", name: "Justin",    role: "SUPER_ADMIN" },
  { email: "woanjinq@13media.co",             name: "Woan Jinq", role: "SUPER_ADMIN" },
];

function generatePassword() {
  // 16-char URL-safe random password
  return randomBytes(12).toString("base64url");
}

const client = new pg.Client({
  connectionString: `postgresql://postgres:${pw}@db.${ref}.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log("Creating SUPER_ADMIN users…\n");
const created = [];

for (const u of USERS) {
  // Skip if already exists
  const existing = await client.query("SELECT id FROM auth.users WHERE email=$1", [u.email]);
  if (existing.rows.length > 0) {
    console.log(`✓  ${u.email} — already exists, skipping`);
    // Make sure their profile has SUPER_ADMIN role
    await client.query(
      `UPDATE public.profiles SET role='SUPER_ADMIN', name=$2 WHERE id=$1`,
      [existing.rows[0].id, u.name]
    );
    continue;
  }

  const password = generatePassword();
  // Insert into auth.users — Supabase's auth schema
  // The on-create trigger we set up will populate public.profiles automatically
  // and read `role` from raw_user_meta_data.
  const insertRes = await client.query(
    `
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      $1,
      extensions.crypt($2, extensions.gen_salt('bf')),
      NOW(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      $3::jsonb,
      NOW(), NOW(), '', '', '', ''
    )
    RETURNING id
    `,
    [
      u.email,
      password,
      JSON.stringify({ name: u.name, role: u.role }),
    ]
  );
  console.log(`✓  ${u.email}  (id=${insertRes.rows[0].id.slice(0, 8)}…)`);
  created.push({ ...u, password });
}

console.log("\nVerifying profile rows…");
const profiles = await client.query(
  `SELECT email, name, role FROM public.profiles WHERE email = ANY($1::text[]) ORDER BY email`,
  [USERS.map((u) => u.email)]
);
for (const p of profiles.rows) {
  console.log(`   ${p.email.padEnd(40)} ${p.name.padEnd(15)} ${p.role}`);
}

if (created.length > 0) {
  console.log("\n" + "=".repeat(60));
  console.log("NEW CREDENTIALS — save these somewhere safe:");
  console.log("=".repeat(60));
  for (const u of created) {
    console.log(`\n  ${u.name}`);
    console.log(`    Email:    ${u.email}`);
    console.log(`    Password: ${u.password}`);
  }
  console.log("\n" + "=".repeat(60));
  console.log("Users can change their password later via the login page.");
}

await client.end();
