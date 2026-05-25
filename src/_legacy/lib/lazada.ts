import crypto from "crypto";
import { getIntegrationToken } from "./integration-tokens";

// Lazada API endpoints per region
const LAZADA_API_URLS: Record<string, string> = {
  MY: "https://api.lazada.com.my/rest",
  SG: "https://api.lazada.sg/rest",
  TH: "https://api.lazada.co.th/rest",
  ID: "https://api.lazada.co.id/rest",
  PH: "https://api.lazada.com.ph/rest",
  VN: "https://api.lazada.vn/rest",
};

const LAZADA_AUTH_URL = "https://auth.lazada.com/rest";

type LazadaConfig = {
  appKey: string;
  appSecret: string;
  accessToken?: string;
  country?: string;
};

function getConfig(): LazadaConfig {
  return {
    appKey: process.env.LAZADA_APP_KEY || "",
    appSecret: process.env.LAZADA_APP_SECRET || "",
    accessToken: process.env.LAZADA_ACCESS_TOKEN || "",
    country: process.env.LAZADA_COUNTRY || "MY",
  };
}

async function loadConfig(): Promise<LazadaConfig> {
  const base = getConfig();
  const dbToken = await getIntegrationToken("LAZADA");
  return {
    ...base,
    accessToken: dbToken.accessToken || base.accessToken,
    country: (dbToken.extra as any)?.country || base.country,
  };
}

/**
 * Generate Lazada API signature using HMAC-SHA256
 * Per Lazada docs: https://open.lazada.com/apps/doc/doc?nodeId=10472
 *
 * Algorithm:
 * 1. Sort all params alphabetically by key
 * 2. Concatenate: key1value1key2value2...
 * 3. Prepend API path
 * 4. HMAC-SHA256 with app_secret as key
 * 5. Uppercase hex
 */
function generateSignature(
  apiPath: string,
  params: Record<string, string>,
  appSecret: string
): string {
  const sortedKeys = Object.keys(params).sort();

  let signString = apiPath;
  for (const key of sortedKeys) {
    signString += key + params[key];
  }

  return crypto
    .createHmac("sha256", appSecret)
    .update(signString)
    .digest("hex")
    .toUpperCase();
}

/**
 * Make a request to Lazada API
 */
export async function lazadaRequest(
  method: "GET" | "POST",
  apiPath: string,
  additionalParams: Record<string, string> = {},
  useAuthUrl: boolean = false,
  config?: Partial<LazadaConfig>
): Promise<any> {
  const loaded = await loadConfig();
  const cfg = { ...loaded, ...config };

  if (!cfg.appKey || !cfg.appSecret) {
    throw new Error("Lazada API credentials not configured");
  }

  const timestamp = Date.now().toString();

  const params: Record<string, string> = {
    app_key: cfg.appKey,
    timestamp,
    sign_method: "sha256",
    ...additionalParams,
  };

  // Include access_token if available and not for auth endpoints
  if (cfg.accessToken && !apiPath.includes("/auth/")) {
    params.access_token = cfg.accessToken;
  }

  const sign = generateSignature(apiPath, params, cfg.appSecret);
  params.sign = sign;

  const baseUrl = useAuthUrl
    ? LAZADA_AUTH_URL
    : LAZADA_API_URLS[cfg.country || "MY"];

  const url = new URL(apiPath, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), { method });
  const data = await response.json();

  if (data.code && data.code !== "0") {
    console.error("Lazada API error:", data);
    throw new Error(
      `Lazada API error ${data.code}: ${data.message || data.detail || "Unknown error"}`
    );
  }

  return data;
}

// ============ AUTH ============

/**
 * Generate OAuth authorization URL
 */
export function getAuthorizationUrl(redirectUri: string): string {
  const config = getConfig();
  const state = crypto.randomBytes(16).toString("hex");

  const url = new URL("https://auth.lazada.com/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("force_auth", "true");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("client_id", config.appKey);
  url.searchParams.set("state", state);

  return url.toString();
}

/**
 * Exchange authorization code for access token
 */
export async function getAccessToken(authCode: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  country: string;
  account_id: string;
  account: string;
}> {
  const data = await lazadaRequest(
    "GET",
    "/auth/token/create",
    { code: authCode },
    true
  );

  return data;
}

/**
 * Refresh expired access token
 */
export async function refreshAccessToken(refreshToken: string): Promise<any> {
  return lazadaRequest(
    "GET",
    "/auth/token/refresh",
    { refresh_token: refreshToken },
    true
  );
}

// ============ ORDERS ============

/**
 * Get orders from Lazada
 */
export async function getOrders(params: {
  created_after?: string; // ISO 8601
  created_before?: string;
  updated_after?: string;
  updated_before?: string;
  status?: string;
  limit?: number;
  offset?: number;
  sort_by?: string;
  sort_direction?: string;
}): Promise<any> {
  const queryParams: Record<string, string> = {};

  if (params.created_after) queryParams.created_after = params.created_after;
  if (params.created_before) queryParams.created_before = params.created_before;
  if (params.updated_after) queryParams.updated_after = params.updated_after;
  if (params.updated_before) queryParams.updated_before = params.updated_before;
  if (params.status) queryParams.status = params.status;
  if (params.limit) queryParams.limit = String(params.limit);
  if (params.offset) queryParams.offset = String(params.offset);
  if (params.sort_by) queryParams.sort_by = params.sort_by;
  if (params.sort_direction) queryParams.sort_direction = params.sort_direction;

  return lazadaRequest("GET", "/orders/get", queryParams);
}

/**
 * Get order items (line items) for specific orders
 */
export async function getMultipleOrderItems(orderIds: string[]): Promise<any> {
  return lazadaRequest("GET", "/orders/items/get", {
    order_ids: JSON.stringify(orderIds),
  });
}

/**
 * Get single order details
 */
export async function getOrder(orderId: string): Promise<any> {
  return lazadaRequest("GET", "/order/get", { order_id: orderId });
}

// ============ PRODUCTS ============

/**
 * Get products from Lazada
 */
export async function getProducts(params: {
  filter?: string; // "live", "all", "inactive", etc.
  search?: string;
  limit?: number;
  offset?: number;
  sku_seller_list?: string[];
}): Promise<any> {
  const queryParams: Record<string, string> = {
    filter: params.filter || "all",
  };

  if (params.search) queryParams.search = params.search;
  if (params.limit) queryParams.limit = String(params.limit);
  if (params.offset) queryParams.offset = String(params.offset);
  if (params.sku_seller_list)
    queryParams.sku_seller_list = JSON.stringify(params.sku_seller_list);

  return lazadaRequest("GET", "/products/get", queryParams);
}

// ============ STOCK/INVENTORY ============

/**
 * Get stock/inventory for products
 */
export async function getStock(skuList: string[]): Promise<any> {
  return lazadaRequest("GET", "/products/sellable-quantity/get", {
    seller_skus: JSON.stringify(skuList),
  });
}

/**
 * Update stock quantity for products
 */
export async function updateStock(updates: { seller_sku: string; quantity: number }[]): Promise<any> {
  // Lazada expects XML payload for stock updates in their classic API
  // For REST API, we use products/stock/update
  const payload = updates.map((u) => ({
    SellerSku: u.seller_sku,
    Quantity: u.quantity,
  }));

  return lazadaRequest("POST", "/product/price_quantity/update", {
    payload: JSON.stringify({ Product: { Skus: { Sku: payload } } }),
  });
}

// ============ SELLER ============

/**
 * Get seller info
 */
export async function getSellerInfo(): Promise<any> {
  return lazadaRequest("GET", "/seller/get");
}

// ============ FINANCE ============

/**
 * Get transaction details
 */
export async function getTransactions(params: {
  start_time: string;
  end_time: string;
  trans_type?: string;
  limit?: number;
  offset?: number;
}): Promise<any> {
  const queryParams: Record<string, string> = {
    start_time: params.start_time,
    end_time: params.end_time,
  };

  if (params.trans_type) queryParams.trans_type = params.trans_type;
  if (params.limit) queryParams.limit = String(params.limit);
  if (params.offset) queryParams.offset = String(params.offset);

  return lazadaRequest("GET", "/finance/transaction/detail/get", queryParams);
}
