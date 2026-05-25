// Sign in via Supabase, build the @supabase/ssr cookie, and fetch each page
// to confirm it renders (HTTP 200) without a server error.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ref = URL.match(/https:\/\/([^.]+)\./)[1];

// Sign in via the GoTrue REST endpoint (avoids supabase-js realtime/WS dependency)
const authRes = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({
    email: "justinquah@blossom-commerce.com",
    password: "GVD-0XngsmTnpJJg",
  }),
});
const session = await authRes.json();
if (!authRes.ok || !session.access_token) {
  console.error("Sign-in failed:", JSON.stringify(session));
  process.exit(1);
}
console.log("Signed in as", session.user.email);

// Build @supabase/ssr cookie: name sb-<ref>-auth-token, value "base64-" + b64(JSON), chunked at 3180
const cookieName = `sb-${ref}-auth-token`;
const payload = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64");
const CHUNK = 3180;
const cookies = [];
if (payload.length <= CHUNK) {
  cookies.push(`${cookieName}=${payload}`);
} else {
  for (let i = 0, idx = 0; i < payload.length; i += CHUNK, idx++) {
    cookies.push(`${cookieName}.${idx}=${payload.slice(i, i + CHUNK)}`);
  }
}
const cookieHeader = cookies.join("; ");

// Each page must return 200 AND contain its expected heading text.
const pages = [
  { path: "/dashboard", expect: "Inventory Dashboard" },
  { path: "/sales", expect: "Monthly totals" },
  { path: "/kpi", expect: "Supply Chain KPIs" },
  { path: "/projection", expect: "Inventory Projection" },
  { path: "/purchase-orders", expect: "PO &amp; Invoices" },
  { path: "/products", expect: "By product range" },
  { path: "/stock", expect: "Stock Levels" },
  { path: "/settings", expect: "Shopee Open API" },
];
let allOk = true;
for (const { path, expect } of pages) {
  const res = await fetch(`http://localhost:3001${path}`, {
    headers: { cookie: cookieHeader },
    redirect: "manual",
  });
  const body = res.status === 200 ? await res.text() : "";
  // Real Next.js server error renders the global-error boundary with this text:
  const serverErrored = body.includes("Application error: a server-side exception");
  const hasContent = body.includes(expect);
  const ok = res.status === 200 && hasContent && !serverErrored;
  if (!ok) allOk = false;
  console.log(
    `${ok ? "✓" : "✗"} ${path.padEnd(14)} HTTP ${res.status}` +
      (res.status === 307
        ? " → " + res.headers.get("location")
        : hasContent
        ? " · content OK"
        : " · MISSING EXPECTED CONTENT") +
      (serverErrored ? " · SERVER ERROR" : "")
  );
}
process.exit(allOk ? 0 : 1);
