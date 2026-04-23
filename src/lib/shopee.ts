import crypto from "crypto";
import { getIntegrationToken } from "./integration-tokens";

// Shopee Open API endpoints
// Test Account-Sandbox v2: openplatform.sandbox.test-stable.shopee.cn
// Live: partner.shopeemobile.com (regional) / openplatform.shopee.cn
const SHOPEE_URLS = {
  live: "https://partner.shopeemobile.com",
  sandbox: "https://openplatform.sandbox.test-stable.shopee.cn",
};

type ShopeeConfig = {
  partnerId: string;
  partnerKey: string;
  environment: "live" | "sandbox";
  accessToken?: string;
  shopId?: string;
};

function getConfig(): ShopeeConfig {
  return {
    partnerId: process.env.SHOPEE_PARTNER_ID || "",
    partnerKey: process.env.SHOPEE_PARTNER_KEY || "",
    environment: (process.env.SHOPEE_ENVIRONMENT as "live" | "sandbox") || "sandbox",
    accessToken: process.env.SHOPEE_ACCESS_TOKEN || "",
    shopId: process.env.SHOPEE_SHOP_ID || "",
  };
}

/**
 * Load config including tokens from DB (falls back to env vars)
 */
async function loadConfig(): Promise<ShopeeConfig> {
  const base = getConfig();
  const dbToken = await getIntegrationToken("SHOPEE");
  return {
    ...base,
    accessToken: dbToken.accessToken || base.accessToken,
    shopId: dbToken.shopId || base.shopId,
  };
}

function getBaseUrl(config: ShopeeConfig): string {
  return SHOPEE_URLS[config.environment] || SHOPEE_URLS.sandbox;
}

/**
 * Generate Shopee API signature
 *
 * Shop-level APIs: HMAC-SHA256(partner_key, partner_id + api_path + timestamp + access_token + shop_id)
 * Merchant-level APIs: similar but with merchant_id instead of shop_id
 * Public APIs: HMAC-SHA256(partner_key, partner_id + api_path + timestamp)
 *
 * Docs: https://open.shopee.com/documents/v2/OpenAPI%202.0%20Overview?module=87&type=2
 */
function generateSignature(
  apiPath: string,
  timestamp: number,
  partnerId: string,
  partnerKey: string,
  accessToken?: string,
  shopId?: string
): string {
  let baseString = `${partnerId}${apiPath}${timestamp}`;

  if (accessToken && shopId) {
    baseString += `${accessToken}${shopId}`;
  } else if (accessToken) {
    baseString += `${accessToken}`;
  }

  return crypto
    .createHmac("sha256", partnerKey)
    .update(baseString)
    .digest("hex");
}

/**
 * Make a request to Shopee API
 */
export async function shopeeRequest(
  method: "GET" | "POST",
  apiPath: string,
  queryParams: Record<string, string | number> = {},
  body: any = null,
  options: {
    useAccessToken?: boolean; // Default true
    useShopId?: boolean; // Default true
  } = {},
  config?: Partial<ShopeeConfig>
): Promise<any> {
  const loaded = await loadConfig();
  const cfg = { ...loaded, ...config };
  const { useAccessToken = true, useShopId = true } = options;

  if (!cfg.partnerId || !cfg.partnerKey) {
    throw new Error("Shopee API credentials not configured");
  }

  const timestamp = Math.floor(Date.now() / 1000);

  const needAccessToken = useAccessToken && cfg.accessToken;
  const needShopId = useShopId && cfg.shopId;

  const sign = generateSignature(
    apiPath,
    timestamp,
    cfg.partnerId,
    cfg.partnerKey,
    needAccessToken ? cfg.accessToken : undefined,
    needShopId ? cfg.shopId : undefined
  );

  const urlParams: Record<string, string> = {
    partner_id: cfg.partnerId,
    timestamp: String(timestamp),
    sign,
    ...Object.fromEntries(Object.entries(queryParams).map(([k, v]) => [k, String(v)])),
  };

  if (needAccessToken) urlParams.access_token = cfg.accessToken!;
  if (needShopId) urlParams.shop_id = cfg.shopId!;

  const url = new URL(apiPath, getBaseUrl(cfg));
  for (const [key, value] of Object.entries(urlParams)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();

  if (data.error) {
    console.error("Shopee API error:", data);
    throw new Error(
      `Shopee API error: ${data.error} - ${data.message || data.msg || "Unknown error"}`
    );
  }

  return data;
}

// ============ AUTH ============

/**
 * Generate OAuth authorization URL for seller
 */
export function getAuthorizationUrl(redirectUri: string): string {
  const config = getConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const apiPath = "/api/v2/shop/auth_partner";

  const sign = generateSignature(
    apiPath,
    timestamp,
    config.partnerId,
    config.partnerKey
  );

  const url = new URL(apiPath, getBaseUrl(config));
  url.searchParams.set("partner_id", config.partnerId);
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", sign);
  url.searchParams.set("redirect", redirectUri);

  return url.toString();
}

/**
 * Exchange authorization code for access token
 */
export async function getAccessToken(code: string, shopId: string): Promise<{
  access_token: string;
  refresh_token: string;
  expire_in: number;
}> {
  const config = getConfig();
  const apiPath = "/api/v2/auth/token/get";
  const timestamp = Math.floor(Date.now() / 1000);

  const sign = generateSignature(
    apiPath,
    timestamp,
    config.partnerId,
    config.partnerKey
  );

  const url = new URL(apiPath, getBaseUrl(config));
  url.searchParams.set("partner_id", config.partnerId);
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", sign);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      partner_id: parseInt(config.partnerId),
      shop_id: parseInt(shopId),
    }),
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(`Shopee auth error: ${data.error} - ${data.message}`);
  }

  return data;
}

/**
 * Refresh expired access token
 */
export async function refreshAccessToken(
  refreshToken: string,
  shopId: string
): Promise<any> {
  const config = getConfig();
  const apiPath = "/api/v2/auth/access_token/get";
  const timestamp = Math.floor(Date.now() / 1000);

  const sign = generateSignature(
    apiPath,
    timestamp,
    config.partnerId,
    config.partnerKey
  );

  const url = new URL(apiPath, getBaseUrl(config));
  url.searchParams.set("partner_id", config.partnerId);
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", sign);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      refresh_token: refreshToken,
      shop_id: parseInt(shopId),
      partner_id: parseInt(config.partnerId),
    }),
  });

  return response.json();
}

// ============ SHOP INFO ============

/**
 * Get shop profile info
 */
export async function getShopInfo(): Promise<any> {
  return shopeeRequest("GET", "/api/v2/shop/get_shop_info");
}

// ============ ORDERS ============

/**
 * Get order list
 * time_range_field: create_time or update_time
 */
export async function getOrderList(params: {
  time_range_field?: "create_time" | "update_time";
  time_from: number; // Unix timestamp
  time_to: number;
  page_size?: number;
  cursor?: string;
  order_status?: string; // UNPAID, READY_TO_SHIP, PROCESSED, SHIPPED, COMPLETED, IN_CANCEL, CANCELLED, INVOICE_PENDING
}): Promise<any> {
  return shopeeRequest("GET", "/api/v2/order/get_order_list", {
    time_range_field: params.time_range_field || "create_time",
    time_from: params.time_from,
    time_to: params.time_to,
    page_size: params.page_size || 50,
    cursor: params.cursor || "",
    order_status: params.order_status || "COMPLETED",
  });
}

/**
 * Get order detail (up to 50 orders at once)
 */
export async function getOrderDetail(
  orderSnList: string[],
  responseFields?: string[]
): Promise<any> {
  return shopeeRequest("GET", "/api/v2/order/get_order_detail", {
    order_sn_list: orderSnList.join(","),
    response_optional_fields: (
      responseFields || ["item_list", "total_amount", "create_time"]
    ).join(","),
  });
}

// ============ PRODUCTS ============

/**
 * Get item list (product list)
 */
export async function getItemList(params: {
  offset?: number;
  page_size?: number;
  item_status?: string; // NORMAL, BANNED, DELETED, UNLIST
  update_time_from?: number;
  update_time_to?: number;
}): Promise<any> {
  return shopeeRequest("GET", "/api/v2/product/get_item_list", {
    offset: params.offset || 0,
    page_size: params.page_size || 50,
    item_status: params.item_status || "NORMAL",
    ...(params.update_time_from && { update_time_from: params.update_time_from }),
    ...(params.update_time_to && { update_time_to: params.update_time_to }),
  });
}

/**
 * Get item base info (by item IDs)
 */
export async function getItemBaseInfo(itemIds: number[]): Promise<any> {
  return shopeeRequest("GET", "/api/v2/product/get_item_base_info", {
    item_id_list: itemIds.join(","),
  });
}

// ============ STOCK/INVENTORY ============

/**
 * Get stock info for items
 */
export async function getItemsStock(itemIds: number[]): Promise<any> {
  return shopeeRequest("GET", "/api/v2/product/get_item_list_by_page", {
    item_id_list: itemIds.join(","),
  });
}

// ============ LOGISTICS ============

/**
 * Get shipping parameter info
 */
export async function getShippingParameter(orderSn: string): Promise<any> {
  return shopeeRequest("GET", "/api/v2/logistics/get_shipping_parameter", {
    order_sn: orderSn,
  });
}

// ============ PUBLIC API ============

/**
 * Get list of authorized shops for this app
 */
export async function getShopsByPartner(): Promise<any> {
  return shopeeRequest("GET", "/api/v2/public/get_shops_by_partner", {}, null, {
    useAccessToken: false,
    useShopId: false,
  });
}
