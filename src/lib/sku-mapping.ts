import { prisma } from "./prisma";

export type DecomposedItem = {
  productId: string;
  productSku: string;
  productName: string;
  units: number; // base product units (e.g. 6 pcs of ABC)
};

/**
 * Decompose a marketplace SKU + quantity into base product units
 *
 * Examples:
 * - "ABCX6" × 2 orders → [{ sku: ABC, units: 12 }]
 * - "ABC+CDE" × 1 order → [{ sku: ABC, units: 1 }, { sku: CDE, units: 1 }]
 * - "EFJ" (= 12× OPQ) × 3 orders → [{ sku: OPQ, units: 36 }]
 * - "ABC" (base SKU, no mapping) × 5 orders → [{ sku: ABC, units: 5 }]
 *
 * @param marketplaceSku The SKU from the order/sale (could be bundle or base)
 * @param soldQty Quantity sold in this order/row
 */
export async function resolveMarketplaceSku(
  marketplaceSku: string,
  soldQty: number
): Promise<DecomposedItem[]> {
  const trimmedSku = marketplaceSku.trim();
  if (!trimmedSku) return [];

  // 1. Check for explicit mapping first
  const mapping = await prisma.skuMapping.findUnique({
    where: { marketplaceSku: trimmedSku },
    include: {
      components: {
        include: {
          product: {
            select: { id: true, sku: true, name: true },
          },
        },
      },
    },
  });

  if (mapping && mapping.isActive && mapping.components.length > 0) {
    return mapping.components.map((c) => ({
      productId: c.product.id,
      productSku: c.product.sku,
      productName: c.product.name,
      units: c.quantity * soldQty,
    }));
  }

  // 2. Check if this SKU matches a base product directly (by sku, sellerSku, or barcode)
  const baseProduct = await prisma.product.findFirst({
    where: {
      OR: [
        { sku: trimmedSku },
        { sellerSku: trimmedSku },
        { barcode: trimmedSku },
      ],
    },
    select: { id: true, sku: true, name: true },
  });

  if (baseProduct) {
    return [
      {
        productId: baseProduct.id,
        productSku: baseProduct.sku,
        productName: baseProduct.name,
        units: soldQty,
      },
    ];
  }

  // 3. Try auto-parse as fallback (doesn't save mapping, just resolves this one time)
  const autoParsed = await tryAutoParse(trimmedSku);
  if (autoParsed) {
    return autoParsed.map((c) => ({
      ...c,
      units: c.units * soldQty,
    }));
  }

  // No match found
  return [];
}

/**
 * Try to auto-parse common SKU patterns:
 * - "ABCX6" or "ABC*6" or "ABC-6pcs" → 6× ABC
 * - "ABC+CDE" → 1× ABC + 1× CDE
 * - "ABC+CDEX2" → 1× ABC + 2× CDE
 */
export async function tryAutoParse(
  sku: string
): Promise<DecomposedItem[] | null> {
  // Pattern 1: Bundle with "+" separator (e.g. "ABC+CDE", "ABC+CDEX2")
  if (sku.includes("+")) {
    const parts = sku.split("+").map((p) => p.trim());
    const components: DecomposedItem[] = [];

    for (const part of parts) {
      const multResult = parseMultiplierSku(part);
      if (!multResult) return null;

      const product = await prisma.product.findFirst({
        where: {
          OR: [
            { sku: multResult.baseSku },
            { sellerSku: multResult.baseSku },
          ],
        },
        select: { id: true, sku: true, name: true },
      });

      if (!product) return null;

      components.push({
        productId: product.id,
        productSku: product.sku,
        productName: product.name,
        units: multResult.multiplier,
      });
    }

    return components;
  }

  // Pattern 2: Multiplier notation (e.g. "ABCX6", "ABC*6", "ABC-X6")
  const multResult = parseMultiplierSku(sku);
  if (multResult && multResult.multiplier > 1) {
    const product = await prisma.product.findFirst({
      where: {
        OR: [
          { sku: multResult.baseSku },
          { sellerSku: multResult.baseSku },
        ],
      },
      select: { id: true, sku: true, name: true },
    });

    if (product) {
      return [
        {
          productId: product.id,
          productSku: product.sku,
          productName: product.name,
          units: multResult.multiplier,
        },
      ];
    }
  }

  return null;
}

/**
 * Parse "ABCX6" → { baseSku: "ABC", multiplier: 6 }
 * Parse "ABC" → { baseSku: "ABC", multiplier: 1 }
 */
function parseMultiplierSku(
  sku: string
): { baseSku: string; multiplier: number } | null {
  if (!sku) return null;

  // Match patterns like "ABCX6", "ABC*6", "ABC x 6", "ABC-X6"
  const patterns = [
    /^(.+?)[xX*](\d+)$/, // ABCX6, ABC*6, ABCx6
    /^(.+?)\s*[xX*]\s*(\d+)$/, // ABC X 6, ABC * 6
    /^(.+?)-[xX](\d+)$/, // ABC-X6
  ];

  for (const pattern of patterns) {
    const match = sku.match(pattern);
    if (match) {
      return {
        baseSku: match[1].trim(),
        multiplier: parseInt(match[2]),
      };
    }
  }

  return { baseSku: sku, multiplier: 1 };
}

/**
 * Suggest mapping rules for a list of unmatched SKUs
 */
export async function suggestMappings(skus: string[]): Promise<
  {
    marketplaceSku: string;
    suggestion: DecomposedItem[] | null;
    confidence: "HIGH" | "MEDIUM" | "LOW";
  }[]
> {
  const results = [];

  for (const sku of skus) {
    const autoParsed = await tryAutoParse(sku);
    results.push({
      marketplaceSku: sku,
      suggestion: autoParsed,
      confidence: autoParsed ? ("HIGH" as const) : ("LOW" as const),
    });
  }

  return results;
}
