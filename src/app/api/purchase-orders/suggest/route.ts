import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { getProductForecast } from "@/lib/demand-forecast";
import { getContainerSpecs, recommendContainer, calculateLoadTotals } from "@/lib/container-optimizer";
import { addDays } from "date-fns";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const body = await req.json();
  const { supplierId, targetMonths = 2, containerPreference } = body;

  // If no supplierId, suggest the cheapest supplier per product across all
  // If supplierId provided, only show products from that supplier

  let productsToSuggest;

  if (supplierId) {
    // Products available from this specific supplier (via ProductSupplier or direct)
    const supplierPricings = await prisma.productSupplier.findMany({
      where: { supplierId, isActive: true },
      include: {
        product: {
          include: { category: true },
        },
      },
    });

    productsToSuggest = supplierPricings.map((sp) => ({
      product: sp.product,
      unitCost: sp.unitCost,
      currency: sp.currency,
      leadTimeDays: sp.leadTimeDays,
      transitDays: sp.transitDays,
      supplierId: sp.supplierId,
      isPreferred: sp.isPreferred,
    }));

    // Also include products with direct supplierId but no ProductSupplier entry
    if (productsToSuggest.length === 0) {
      const directProducts = await prisma.product.findMany({
        where: { supplierId, isActive: true },
        include: { category: true },
      });
      productsToSuggest = directProducts.map((p) => ({
        product: p,
        unitCost: p.unitCost,
        currency: "RMB",
        leadTimeDays: 30,
        transitDays: 21,
        supplierId,
        isPreferred: true,
      }));
    }
  } else {
    // No supplier specified - get all products and find cheapest supplier for each
    const allProducts = await prisma.product.findMany({
      where: { isActive: true },
      include: { category: true },
    });

    productsToSuggest = [];
    for (const product of allProducts) {
      const pricings = await prisma.productSupplier.findMany({
        where: { productId: product.id, isActive: true },
        orderBy: { unitCost: "asc" },
      });

      if (pricings.length > 0) {
        const cheapest = pricings[0];
        productsToSuggest.push({
          product,
          unitCost: cheapest.unitCost,
          currency: cheapest.currency,
          leadTimeDays: cheapest.leadTimeDays,
          transitDays: cheapest.transitDays,
          supplierId: cheapest.supplierId,
          isPreferred: cheapest.isPreferred,
          alternativeSuppliers: pricings.length - 1,
          allPricings: pricings.map((p) => ({
            supplierId: p.supplierId,
            unitCost: p.unitCost,
            currency: p.currency,
            leadTimeDays: p.leadTimeDays,
          })),
        });
      } else {
        // Fallback to product's default supplier
        productsToSuggest.push({
          product,
          unitCost: product.unitCost,
          currency: "RMB",
          leadTimeDays: 30,
          transitDays: 21,
          supplierId: product.supplierId,
          isPreferred: true,
          alternativeSuppliers: 0,
        });
      }
    }
  }

  const suggestions = [];

  for (const item of productsToSuggest) {
    const product = item.product;
    const forecast = await getProductForecast(product.id);
    if (!forecast) continue;

    const adjustedMonthly = forecast.adjustedForecast;
    const needed = adjustedMonthly * targetMonths;
    const available = product.currentStock + forecast.inTransitQty;
    let suggestedQty = Math.max(0, needed - available);

    if (suggestedQty > 0 && product.unitsPerCarton > 1) {
      suggestedQty = Math.ceil(suggestedQty / product.unitsPerCarton) * product.unitsPerCarton;
    }
    if (suggestedQty > 0 && product.minOrderQty > suggestedQty) {
      suggestedQty = product.minOrderQty;
    }

    // Calculate proposed ETA
    const proposedEta = addDays(new Date(), item.leadTimeDays + item.transitDays);

    suggestions.push({
      productId: product.id,
      sku: product.sku,
      sellerSku: product.sellerSku,
      name: product.name,
      unitCost: item.unitCost,
      currency: item.currency,
      supplierId: item.supplierId,
      isPreferred: item.isPreferred,
      alternativeSuppliers: (item as any).alternativeSuppliers || 0,
      allPricings: (item as any).allPricings || [],
      leadTimeDays: item.leadTimeDays,
      transitDays: item.transitDays,
      proposedEta: proposedEta.toISOString(),
      weightPerUnit: product.weightPerUnit,
      volumePerUnit: product.volumePerUnit,
      unitsPerCarton: product.unitsPerCarton,
      currentStock: product.currentStock,
      inTransitQty: forecast.inTransitQty,
      threeMonthAvg: forecast.threeMonthAvg,
      promoUplift: forecast.promoUplift,
      adjustedForecast: forecast.adjustedForecast,
      daysToOOS: forecast.daysToOOS,
      stockStatus: forecast.stockStatus,
      suggestedQty,
      totalCost: Math.round(suggestedQty * item.unitCost * 100) / 100,
      weightSubtotal: Math.round(suggestedQty * product.weightPerUnit * 100) / 100,
      volumeSubtotal: Math.round(suggestedQty * product.volumePerUnit * 10000) / 10000,
    });
  }

  // Container recommendation
  const itemsWithQty = suggestions.filter((s) => s.suggestedQty > 0);
  const loadTotals = calculateLoadTotals(
    itemsWithQty.map((s) => ({
      quantity: s.suggestedQty,
      weightPerUnit: s.weightPerUnit,
      volumePerUnit: s.volumePerUnit,
    }))
  );

  const specs = await getContainerSpecs();
  const containerRec = recommendContainer(loadTotals.totalWeightKg, loadTotals.totalVolumeCbm, specs);

  const totalAmount = suggestions.reduce((a, b) => a + b.totalCost, 0);

  // Get max lead time for proposed ETA
  const maxLeadTime = Math.max(...suggestions.filter(s => s.suggestedQty > 0).map(s => s.leadTimeDays + s.transitDays), 0);
  const overallProposedEta = addDays(new Date(), maxLeadTime);

  return NextResponse.json({
    suggestions,
    summary: {
      totalProducts: suggestions.length,
      productsToOrder: itemsWithQty.length,
      totalAmount: Math.round(totalAmount * 100) / 100,
      totalWeightKg: loadTotals.totalWeightKg,
      totalVolumeCbm: loadTotals.totalVolumeCbm,
      proposedEta: overallProposedEta.toISOString(),
      maxLeadTimeDays: maxLeadTime,
    },
    containerRecommendation: containerRec,
    containerSpecs: specs,
  });
}
