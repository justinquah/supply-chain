// Test Shopee Open API connectivity against the sandbox shop in .env.
// Steps: verify partner creds -> refresh token -> list items -> get stock.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import crypto from "node:crypto";

// load .env (sandbox creds live there, not .env.local)
for (const f of [".env", ".env.local"]) {
  try {
    for (const raw of readFileSync(resolve(process.cwd(), f), "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      let v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      const k = line.slice(0, eq).trim();
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {}
}

const HOST = "https://openplatform.sandbox.test-stable.shopee.cn";
const PARTNER_ID = process.env.SHOPEE_PARTNER_ID;
let PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY;
const SHOP_ID = process.env.SHOPEE_SHOP_ID;
let ACCESS_TOKEN = process.env.SHOPEE_ACCESS_TOKEN;
const REFRESH_TOKEN = process.env.SHOPEE_REFRESH_TOKEN;

function sign(path, ts, { accessToken, shopId } = {}, key = PARTNER_KEY) {
  let base = `${PARTNER_ID}${path}${ts}`;
  if (accessToken && shopId) base += `${accessToken}${shopId}`;
  return crypto.createHmac("sha256", key).update(base).digest("hex");
}

async function publicCall(path, body) {
  const ts = Math.floor(Date.now() / 1000);
  const s = sign(path, ts);
  const url = `${HOST}${path}?partner_id=${PARTNER_ID}&timestamp=${ts}&sign=${s}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function shopCall(path, params = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const s = sign(path, ts, { accessToken: ACCESS_TOKEN, shopId: SHOP_ID });
  const usp = new URLSearchParams({
    partner_id: PARTNER_ID,
    timestamp: String(ts),
    sign: s,
    access_token: ACCESS_TOKEN,
    shop_id: SHOP_ID,
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  });
  const res = await fetch(`${HOST}${path}?${usp}`, {
    headers: { "Content-Type": "application/json" },
  });
  return res.json();
}

console.log("Shopee sandbox test");
console.log("  partner_id:", PARTNER_ID, "| shop_id:", SHOP_ID);
console.log("  host:", HOST, "\n");

// 1. Refresh access token (tokens expire ~4h)
console.log("1. Refreshing access token…");
let refresh = await publicCall("/api/v2/auth/access_token/get", {
  refresh_token: REFRESH_TOKEN,
  shop_id: parseInt(SHOP_ID),
  partner_id: parseInt(PARTNER_ID),
});
if (refresh.error === "refresh_token_expired") {
  console.log("   ⚠ refresh_token_expired — the sign was VALID (reached token check).");
  console.log("     Partner credentials are good; the saved tokens have simply lapsed.");
} else if (refresh.error) {
  console.log("   error:", refresh.error, "-", refresh.message);
}
if (refresh.access_token) {
  ACCESS_TOKEN = refresh.access_token;
  console.log("   ✓ new access_token obtained (expires in", refresh.expire_in, "s)");
} else {
  console.log("   ✗ refresh failed:", JSON.stringify(refresh).slice(0, 200));
  console.log("   (continuing with existing token to test signing)");
}

// 2. Verify partner-level: get authorized shops
console.log("\n2. get_shops_by_partner…");
{
  const ts = Math.floor(Date.now() / 1000);
  const s = sign("/api/v2/public/get_shops_by_partner", ts);
  const url = `${HOST}/api/v2/public/get_shops_by_partner?partner_id=${PARTNER_ID}&timestamp=${ts}&sign=${s}`;
  const r = await (await fetch(url)).json();
  console.log("   ", JSON.stringify(r).slice(0, 250));
}

// 3. List items
console.log("\n3. get_item_list…");
const list = await shopCall("/api/v2/product/get_item_list", {
  offset: 0,
  page_size: 20,
  item_status: "NORMAL",
});
if (list.error) {
  console.log("   ✗", list.error, "-", list.message);
} else {
  const items = list.response?.item || [];
  console.log("   ✓ items returned:", items.length, "| total:", list.response?.total_count);
  const ids = items.map((i) => i.item_id).slice(0, 10);
  console.log("   item_ids:", ids.join(", ") || "(none)");

  // 4. Stock for those items
  if (ids.length) {
    console.log("\n4. get_item_base_info (names + stock)…");
    const info = await shopCall("/api/v2/product/get_item_base_info", {
      item_id_list: ids.join(","),
    });
    if (info.error) {
      console.log("   ✗", info.error, "-", info.message);
    } else {
      for (const it of (info.response?.item_list || []).slice(0, 10)) {
        const stock =
          it.stock_info_v2?.summary_info?.total_available_stock ??
          it.stock_info?.[0]?.current_stock ??
          "?";
        console.log(`   • ${String(it.item_id).padEnd(12)} ${(it.item_name||"").slice(0,40).padEnd(42)} stock=${stock} sku=${it.item_sku||"-"}`);
      }
    }
  }
}
console.log("\nDone.");
