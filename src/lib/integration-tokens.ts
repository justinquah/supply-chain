import { prisma } from "./prisma";

/**
 * Get stored access token for a marketplace provider.
 * Falls back to env var for backward compatibility.
 */
export async function getIntegrationToken(
  provider: "SHOPEE" | "TIKTOK" | "LAZADA" | "AUTOCOUNT"
): Promise<{
  accessToken: string | null;
  refreshToken: string | null;
  shopId: string | null;
  shopName: string | null;
  extra: Record<string, any> | null;
}> {
  try {
    const token = await prisma.integrationToken.findUnique({
      where: { provider },
    });

    if (token) {
      return {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        shopId: token.shopId,
        shopName: token.shopName,
        extra: token.extra ? JSON.parse(token.extra) : null,
      };
    }
  } catch {
    // Table might not exist yet on first migration
  }

  // Fallback to env vars
  const envPrefix = provider;
  return {
    accessToken: process.env[`${envPrefix}_ACCESS_TOKEN`] || null,
    refreshToken: process.env[`${envPrefix}_REFRESH_TOKEN`] || null,
    shopId:
      process.env[`${envPrefix}_SHOP_ID`] ||
      process.env[`${envPrefix}_ACCOUNT_ID`] ||
      null,
    shopName: null,
    extra: null,
  };
}

/**
 * Save or update access token for a provider
 */
export async function saveIntegrationToken(params: {
  provider: "SHOPEE" | "TIKTOK" | "LAZADA" | "AUTOCOUNT";
  accessToken: string;
  refreshToken?: string;
  shopId?: string;
  shopName?: string;
  extra?: Record<string, any>;
  expiresAt?: Date;
}) {
  const data = {
    accessToken: params.accessToken,
    refreshToken: params.refreshToken || null,
    shopId: params.shopId || null,
    shopName: params.shopName || null,
    extra: params.extra ? JSON.stringify(params.extra) : null,
    expiresAt: params.expiresAt || null,
  };

  return prisma.integrationToken.upsert({
    where: { provider: params.provider },
    update: data,
    create: { provider: params.provider, ...data },
  });
}
