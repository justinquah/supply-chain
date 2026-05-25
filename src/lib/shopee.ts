import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";

// Sandbox vs live is controlled by SHOPEE_ENVIRONMENT. Going live = change env + re-auth.
const SHOPEE_URLS = {
  live: "https://partner.shopeemobile.com",
  sandbox: "https://openplatform.sandbox.test-stable.shopee.cn",
};

function env() {
  return {
    partnerId: process.env.SHOPEE_PARTNER_ID || "",
    partnerKey: process.env.SHOPEE_PARTNER_KEY || "",
    environment: (process.env.SHOPEE_ENVIRONMENT as "live" | "sandbox") || "sandbox",
  };
}

function baseUrl() {
  return SHOPEE_URLS[env().environment] || SHOPEE_URLS.sandbox;
}

function sign(
  apiPath: string,
  timestamp: number,
  opts: { accessToken?: string; shopId?: string } = {}
): string {
  const { partnerId, partnerKey } = env();
  let base = `${partnerId}${apiPath}${timestamp}`;
  if (opts.accessToken && opts.shopId) base += `${opts.accessToken}${opts.shopId}`;
  else if (opts.accessToken) base += `${opts.accessToken}`;
  return crypto.createHmac("sha256", partnerKey).update(base).digest("hex");
}

// ---------- token storage (Supabase) ----------
export type ShopeeTokens = {
  access_token: string | null;
  refresh_token: string | null;
  shop_id: string | null;
  shop_name: string | null;
  expires_at: string | null;
  environment: string | null;
};

export async function getShopeeTokens(): Promise<ShopeeTokens | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("integration_tokens")
    .select("access_token, refresh_token, shop_id, shop_name, expires_at, environment")
    .eq("provider", "SHOPEE")
    .maybeSingle();
  return data ?? null;
}

async function saveShopeeTokens(t: {
  access_token: string;
  refresh_token: string;
  shop_id: string;
  expires_in: number;
  shop_name?: string;
}) {
  const supabase = await createClient();
  const expiresAt = new Date(Date.now() + (t.expires_in - 120) * 1000).toISOString();
  await supabase.from("integration_tokens").upsert({
    provider: "SHOPEE",
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    shop_id: t.shop_id,
    shop_name: t.shop_name ?? null,
    environment: env().environment,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });
}

// ---------- OAuth ----------
export function getAuthorizationUrl(redirectUri: string): string {
  const { partnerId } = env();
  const apiPath = "/api/v2/shop/auth_partner";
  const ts = Math.floor(Date.now() / 1000);
  const s = sign(apiPath, ts);
  const url = new URL(apiPath, baseUrl());
  url.searchParams.set("partner_id", partnerId);
  url.searchParams.set("timestamp", String(ts));
  url.searchParams.set("sign", s);
  url.searchParams.set("redirect", redirectUri);
  return url.toString();
}

export async function exchangeCodeForToken(code: string, shopId: string) {
  const { partnerId } = env();
  const apiPath = "/api/v2/auth/token/get";
  const ts = Math.floor(Date.now() / 1000);
  const s = sign(apiPath, ts);
  const url = new URL(apiPath, baseUrl());
  url.searchParams.set("partner_id", partnerId);
  url.searchParams.set("timestamp", String(ts));
  url.searchParams.set("sign", s);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      partner_id: parseInt(partnerId),
      shop_id: parseInt(shopId),
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`${data.error}: ${data.message}`);
  await saveShopeeTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    shop_id: shopId,
    expires_in: data.expire_in,
  });
  return data;
}

async function refreshToken(refresh: string, shopId: string) {
  const { partnerId } = env();
  const apiPath = "/api/v2/auth/access_token/get";
  const ts = Math.floor(Date.now() / 1000);
  const s = sign(apiPath, ts);
  const url = new URL(apiPath, baseUrl());
  url.searchParams.set("partner_id", partnerId);
  url.searchParams.set("timestamp", String(ts));
  url.searchParams.set("sign", s);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      refresh_token: refresh,
      shop_id: parseInt(shopId),
      partner_id: parseInt(partnerId),
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`${data.error}: ${data.message}`);
  await saveShopeeTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    shop_id: shopId,
    expires_in: data.expire_in,
  });
  return data.access_token as string;
}

// Returns a valid access token, refreshing if expired. Throws if not connected.
async function getValidToken(): Promise<{ accessToken: string; shopId: string }> {
  const tokens = await getShopeeTokens();
  if (!tokens?.shop_id || !tokens.refresh_token)
    throw new Error("Shopee not connected — authorize the shop first.");

  const expired =
    !tokens.access_token ||
    !tokens.expires_at ||
    new Date(tokens.expires_at).getTime() < Date.now();

  if (expired) {
    const newToken = await refreshToken(tokens.refresh_token, tokens.shop_id);
    return { accessToken: newToken, shopId: tokens.shop_id };
  }
  return { accessToken: tokens.access_token!, shopId: tokens.shop_id };
}

// ---------- shop API ----------
async function shopGet(apiPath: string, params: Record<string, string | number> = {}) {
  const { partnerId } = env();
  const { accessToken, shopId } = await getValidToken();
  const ts = Math.floor(Date.now() / 1000);
  const s = sign(apiPath, ts, { accessToken, shopId });
  const usp = new URLSearchParams({
    partner_id: partnerId,
    timestamp: String(ts),
    sign: s,
    access_token: accessToken,
    shop_id: shopId,
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  });
  const res = await fetch(`${baseUrl()}${apiPath}?${usp}`, {
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.json();
  if (data.error) throw new Error(`${data.error}: ${data.message || data.msg}`);
  return data;
}

// ---------- high-level sync ----------
export type ShopeeStockItem = {
  itemId: number;
  sku: string | null;
  name: string;
  stock: number;
};

export async function fetchShopeeStock(): Promise<ShopeeStockItem[]> {
  const all: ShopeeStockItem[] = [];
  let offset = 0;
  const pageSize = 50;

  for (let guard = 0; guard < 50; guard++) {
    const list = await shopGet("/api/v2/product/get_item_list", {
      offset,
      page_size: pageSize,
      item_status: "NORMAL",
    });
    const items = list.response?.item || [];
    if (items.length === 0) break;

    const ids = items.map((i: any) => i.item_id);
    // Batch base info (max 50)
    const info = await shopGet("/api/v2/product/get_item_base_info", {
      item_id_list: ids.join(","),
    });
    for (const it of info.response?.item_list || []) {
      const stock =
        it.stock_info_v2?.summary_info?.total_available_stock ??
        it.stock_info?.[0]?.current_stock ??
        0;
      all.push({
        itemId: it.item_id,
        sku: it.item_sku || null,
        name: it.item_name || "",
        stock: Number(stock) || 0,
      });
    }
    if (!list.response?.has_next_page) break;
    offset = list.response?.next_offset ?? offset + pageSize;
  }
  return all;
}
