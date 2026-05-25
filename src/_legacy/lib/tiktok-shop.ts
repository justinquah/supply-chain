import crypto from "crypto";
import { getIntegrationToken } from "./integration-tokens";

const TIKTOK_SHOP_BASE_URL = "https://open-api.tiktokglobalshop.com";

type TikTokConfig = {
  appKey: string;
  appSecret: string;
  accessToken?: string;
  shopCipher?: string;
};

function getConfig(): TikTokConfig {
  return {
    appKey: process.env.TIKTOK_SHOP_APP_KEY || "",
    appSecret: process.env.TIKTOK_SHOP_APP_SECRET || "",
    accessToken: process.env.TIKTOK_SHOP_ACCESS_TOKEN || "",
    shopCipher: process.env.TIKTOK_SHOP_CIPHER || "",
  };
}

async function loadConfig(): Promise<TikTokConfig> {
  const base = getConfig();
  const dbToken = await getIntegrationToken("TIKTOK");
  return {
    ...base,
    accessToken: dbToken.accessToken || base.accessToken,
  };
}

/**
 * Generate HMAC-SHA256 signature for TikTok Shop API
 * https://partner.tiktokshop.com/docv2/page/678e3a4278f4c20311b8b57e
 */
function generateSignature(
  path: string,
  params: Record<string, string>,
  body: string | null,
  appSecret: string
): string {
  // 1. Sort params alphabetically
  const sortedKeys = Object.keys(params).sort();

  // 2. Build sign string: path + sorted params + body
  let signString = path;
  for (const key of sortedKeys) {
    signString += key + params[key];
  }
  if (body) {
    signString += body;
  }

  // 3. Wrap with app_secret
  const wrappedString = appSecret + signString + appSecret;

  // 4. HMAC-SHA256
  return crypto
    .createHmac("sha256", appSecret)
    .update(wrappedString)
    .digest("hex");
}

/**
 * Make a request to TikTok Shop API
 */
export async function tiktokShopRequest(
  method: "GET" | "POST" | "PUT",
  path: string,
  queryParams: Record<string, string> = {},
  body: any = null,
  config?: Partial<TikTokConfig>
): Promise<any> {
  const loaded = await loadConfig();
  const cfg = { ...loaded, ...config };

  if (!cfg.appKey || !cfg.appSecret) {
    throw new Error("TikTok Shop API credentials not configured");
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();

  // Common query params
  const params: Record<string, string> = {
    app_key: cfg.appKey,
    timestamp,
    ...queryParams,
  };

  // Add shop_cipher if available
  if (cfg.shopCipher) {
    params.shop_cipher = cfg.shopCipher;
  }

  const bodyStr = body ? JSON.stringify(body) : null;

  // Generate signature
  const sign = generateSignature(path, params, bodyStr, cfg.appSecret);
  params.sign = sign;

  // Build URL
  const url = new URL(path, TIKTOK_SHOP_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  // Make request
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (cfg.accessToken) {
    headers["x-tts-access-token"] = cfg.accessToken;
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: bodyStr,
  });

  const data = await response.json();

  if (data.code !== 0) {
    console.error("TikTok Shop API error:", data);
    throw new Error(
      `TikTok API error ${data.code}: ${data.message || "Unknown error"}`
    );
  }

  return data.data;
}

// ============ AUTH ============

/**
 * Generate the OAuth authorization URL for seller to authorize the app
 */
export function getAuthorizationUrl(redirectUri: string): string {
  const config = getConfig();
  const state = crypto.randomBytes(16).toString("hex");

  return `https://services.tiktokshop.com/open/authorize?app_key=${config.appKey}&state=${state}`;
}

/**
 * Exchange authorization code for access token
 */
export async function getAccessToken(authCode: string): Promise<{
  access_token: string;
  refresh_token: string;
  access_token_expire_in: number;
  refresh_token_expire_in: number;
}> {
  const config = getConfig();

  const data = await tiktokShopRequest(
    "GET",
    "/authorization/202309/token",
    {
      app_key: config.appKey,
      auth_code: authCode,
      grant_type: "authorized_code",
    },
    null,
    config
  );

  return data;
}

/**
 * Refresh an expired access token
 */
export async function refreshAccessToken(refreshToken: string): Promise<any> {
  const config = getConfig();

  return tiktokShopRequest(
    "GET",
    "/authorization/202309/token",
    {
      app_key: config.appKey,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    },
    null,
    config
  );
}

/**
 * Get authorized shops
 */
export async function getAuthorizedShops(): Promise<any> {
  return tiktokShopRequest("GET", "/authorization/202309/shops");
}

// ============ ORDERS ============

/**
 * Get order list with filters
 */
export async function getOrders(params: {
  create_time_ge?: number; // Unix timestamp
  create_time_lt?: number;
  update_time_ge?: number;
  update_time_lt?: number;
  order_status?: string;
  page_size?: number;
  page_token?: string;
}): Promise<any> {
  return tiktokShopRequest("POST", "/order/202309/orders/search", {}, {
    page_size: params.page_size || 50,
    ...params,
  });
}

/**
 * Get order detail by order ID
 */
export async function getOrderDetail(orderId: string): Promise<any> {
  return tiktokShopRequest("GET", `/order/202309/orders/${orderId}`);
}

// ============ PRODUCTS ============

/**
 * Search products in TikTok Shop
 */
export async function searchProducts(params: {
  page_size?: number;
  page_token?: string;
  status?: string;
}): Promise<any> {
  return tiktokShopRequest("POST", "/product/202309/products/search", {}, {
    page_size: params.page_size || 50,
    ...params,
  });
}

// ============ ANALYTICS ============

/**
 * Get shop performance per hour
 */
export async function getShopPerformance(params: {
  start_date: string; // YYYY-MM-DD
  end_date: string;
}): Promise<any> {
  return tiktokShopRequest(
    "GET",
    "/data/202309/shop/performances",
    {
      start_date: params.start_date,
      end_date: params.end_date,
    }
  );
}

/**
 * Get product stats
 */
export async function getProductStats(params: {
  start_date: string;
  end_date: string;
  page_size?: number;
}): Promise<any> {
  return tiktokShopRequest("POST", "/data/202309/products", {}, {
    page_size: params.page_size || 50,
    start_date: params.start_date,
    end_date: params.end_date,
  });
}

/**
 * Get GMV trend performances
 */
export async function getGMVTrend(params: {
  start_date: string;
  end_date: string;
}): Promise<any> {
  return tiktokShopRequest(
    "GET",
    "/data/202309/gmv/trends",
    {
      start_date: params.start_date,
      end_date: params.end_date,
    }
  );
}

/**
 * Get bestselling products
 */
export async function getBestsellers(params: {
  start_date: string;
  end_date: string;
  page_size?: number;
}): Promise<any> {
  return tiktokShopRequest("POST", "/data/202309/bestsellers", {}, {
    page_size: params.page_size || 20,
    start_date: params.start_date,
    end_date: params.end_date,
  });
}

/**
 * Get LIVE performance
 */
export async function getLivePerformance(params: {
  start_date: string;
  end_date: string;
}): Promise<any> {
  return tiktokShopRequest(
    "GET",
    "/data/202309/live/performances",
    {
      start_date: params.start_date,
      end_date: params.end_date,
    }
  );
}

// ============ FINANCE ============

/**
 * Get financial statements
 */
export async function getStatements(params: {
  start_date: string;
  end_date: string;
  page_size?: number;
}): Promise<any> {
  return tiktokShopRequest("POST", "/finance/202309/statements/search", {}, {
    page_size: params.page_size || 20,
    statement_time_ge: Math.floor(new Date(params.start_date).getTime() / 1000),
    statement_time_lt: Math.floor(new Date(params.end_date).getTime() / 1000),
  });
}
