import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";
import bcryptjs from "bcryptjs";

function getPrismaClient() {
  if (process.env.TURSO_DATABASE_URL) {
    console.log("Using Turso:", process.env.TURSO_DATABASE_URL);
    const libsql = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    const adapter = new PrismaLibSQL(libsql);
    return new PrismaClient({ adapter } as any);
  }
  return new PrismaClient();
}

const prisma = getPrismaClient();

async function main() {
  console.log("Seeding database...");

  const adminHash = await bcryptjs.hash("admin123", 12);
  const financeHash = await bcryptjs.hash("finance123", 12);
  const supplierHash = await bcryptjs.hash("supplier123", 12);
  const logisticsHash = await bcryptjs.hash("logistics123", 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@supplychain.local" },
    update: {},
    create: { email: "admin@supplychain.local", passwordHash: adminHash, name: "Admin User", role: "ADMIN" },
  });

  const finance = await prisma.user.upsert({
    where: { email: "finance@supplychain.local" },
    update: {},
    create: { email: "finance@supplychain.local", passwordHash: financeHash, name: "Finance User", role: "FINANCE" },
  });

  const supplier1 = await prisma.user.upsert({
    where: { email: "supplier1@catfood.com" },
    update: {},
    create: { email: "supplier1@catfood.com", passwordHash: supplierHash, name: "Cat Food Supplier", role: "SUPPLIER", companyName: "Premium Pet Foods Co." },
  });

  const supplier2 = await prisma.user.upsert({
    where: { email: "supplier2@catlitter.com" },
    update: {},
    create: { email: "supplier2@catlitter.com", passwordHash: supplierHash, name: "Cat Litter Supplier", role: "SUPPLIER", companyName: "Clean Paws Litter Inc." },
  });

  // Third supplier who also sells some of the same products
  const supplier3 = await prisma.user.upsert({
    where: { email: "supplier3@petgoods.com" },
    update: {},
    create: { email: "supplier3@petgoods.com", passwordHash: supplierHash, name: "Dalian Jiu Zhou Yuan", role: "SUPPLIER", companyName: "DALIAN JIU ZHOU YUAN TRADING CO., LTD" },
  });

  const logistics1 = await prisma.user.upsert({
    where: { email: "logistics@freight.com" },
    update: {},
    create: { email: "logistics@freight.com", passwordHash: logisticsHash, name: "FastFreight Logistics", role: "LOGISTICS", companyName: "FastFreight Logistics Sdn Bhd" },
  });

  const logistics2 = await prisma.user.upsert({
    where: { email: "logistics2@oceanlink.com" },
    update: {},
    create: { email: "logistics2@oceanlink.com", passwordHash: logisticsHash, name: "OceanLink Shipping", role: "LOGISTICS", companyName: "OceanLink Shipping & Forwarding Sdn Bhd" },
  });

  const logistics3 = await prisma.user.upsert({
    where: { email: "logistics3@cargopro.com" },
    update: {},
    create: { email: "logistics3@cargopro.com", passwordHash: logisticsHash, name: "CargoPro Express", role: "LOGISTICS", companyName: "CargoPro Express (M) Sdn Bhd" },
  });

  console.log("Users created (3 suppliers, 3 logistics partners)");

  // Categories
  const catFood = await prisma.productCategory.upsert({
    where: { name: "Cat Food" },
    update: { defaultTargetTurnover: 8 },
    create: { name: "Cat Food", defaultTargetTurnover: 8 },
  });

  const catLitter = await prisma.productCategory.upsert({
    where: { name: "Cat Litter" },
    update: { defaultTargetTurnover: 5 },
    create: { name: "Cat Litter", defaultTargetTurnover: 5 },
  });

  // Container configs
  await prisma.containerConfig.upsert({
    where: { type: "20FT" },
    update: {},
    create: { type: "20FT", maxWeightKg: 21700, maxVolumeCbm: 33.2, estimatedCost: 3500, description: "Standard 20-foot container (TEU)" },
  });

  await prisma.containerConfig.upsert({
    where: { type: "40FT" },
    update: {},
    create: { type: "40FT", maxWeightKg: 26500, maxVolumeCbm: 67.7, estimatedCost: 5500, description: "Standard 40-foot container (FEU)" },
  });

  // Products (primary supplier)
  const sampleProducts = [
    { sku: "CF-WET-001", sellerSku: "BC-PF-CAN-TUNA-PURE-85G", barcode: "8851234560001", name: "Premium Wet Cat Food - Tuna 85g", categoryId: catFood.id, supplierId: supplier1.id, unitCost: 3.50, sellingPrice: 5.90, weightPerUnit: 0.095, volumePerUnit: 0.00015, unitsPerCarton: 24, targetTurnover: 10 },
    { sku: "CF-WET-002", sellerSku: "BC-PF-CAN-CHKN-PURE-85G", barcode: "8851234560002", name: "Premium Wet Cat Food - Chicken 85g", categoryId: catFood.id, supplierId: supplier1.id, unitCost: 3.20, sellingPrice: 5.50, weightPerUnit: 0.095, volumePerUnit: 0.00015, unitsPerCarton: 24, targetTurnover: 10 },
    { sku: "CF-DRY-001", sellerSku: "BC-PF-DRY-ADULT-1500G", barcode: "8851234560003", name: "Dry Cat Food - Adult 1.5kg", categoryId: catFood.id, supplierId: supplier1.id, unitCost: 18.00, sellingPrice: 29.90, weightPerUnit: 1.6, volumePerUnit: 0.003, unitsPerCarton: 6 },
    { sku: "CF-DRY-002", sellerSku: "BC-PF-DRY-KITN-1200G", barcode: "8851234560004", name: "Dry Cat Food - Kitten 1.2kg", categoryId: catFood.id, supplierId: supplier1.id, unitCost: 20.00, sellingPrice: 32.90, weightPerUnit: 1.3, volumePerUnit: 0.0025, unitsPerCarton: 6 },
    { sku: "CL-CLMP-001", sellerSku: "BC-CL-CLMP-10L", barcode: "8851234560005", name: "Clumping Cat Litter 10L", categoryId: catLitter.id, supplierId: supplier2.id, unitCost: 12.00, sellingPrice: 19.90, weightPerUnit: 8.0, volumePerUnit: 0.012, unitsPerCarton: 3 },
    { sku: "CL-CLMP-002", sellerSku: "BC-CL-CLMP-5L", barcode: "8851234560006", name: "Clumping Cat Litter 5L", categoryId: catLitter.id, supplierId: supplier2.id, unitCost: 7.00, sellingPrice: 11.90, weightPerUnit: 4.0, volumePerUnit: 0.006, unitsPerCarton: 6, targetTurnover: 4 },
    { sku: "CL-TOFU-001", sellerSku: "BC-CL-TOFU-JJX3-6L", barcode: "9551010080045", name: "JJANGX3 Tofu Cat Litter 6L", categoryId: catLitter.id, supplierId: supplier3.id, unitCost: 5.20, sellingPrice: 24.90, weightPerUnit: 1.6, volumePerUnit: 0.007, unitsPerCarton: 6, targetTurnover: 6 },
    { sku: "CF-TREAT-001", sellerSku: "BC-PF-TRT-SLMN-60G", barcode: "8851234560008", name: "Cat Treats - Salmon 60g", categoryId: catFood.id, supplierId: supplier1.id, unitCost: 5.00, sellingPrice: 8.90, weightPerUnit: 0.07, volumePerUnit: 0.0001, unitsPerCarton: 48, targetTurnover: 8 },
  ];

  for (const p of sampleProducts) {
    await prisma.product.upsert({
      where: { sku: p.sku },
      update: {},
      create: { ...p, currentStock: Math.floor(Math.random() * 500) + 50, reorderPoint: Math.floor(Math.random() * 100) + 20 },
    });
  }

  console.log(`${sampleProducts.length} products created`);

  // Multi-supplier pricing: some products available from multiple suppliers
  const products = await prisma.product.findMany();
  const productMap = new Map(products.map(p => [p.sku, p]));

  const supplierPricings = [
    // Cat food products - supplier1 (primary, cheapest) and supplier3 (alternative)
    { sku: "CF-WET-001", supplierId: supplier1.id, unitCost: 3.50, currency: "RMB", leadTimeDays: 25, transitDays: 21, isPreferred: true },
    { sku: "CF-WET-001", supplierId: supplier3.id, unitCost: 3.80, currency: "RMB", leadTimeDays: 20, transitDays: 18, isPreferred: false },
    { sku: "CF-WET-002", supplierId: supplier1.id, unitCost: 3.20, currency: "RMB", leadTimeDays: 25, transitDays: 21, isPreferred: true },
    { sku: "CF-WET-002", supplierId: supplier3.id, unitCost: 3.50, currency: "RMB", leadTimeDays: 20, transitDays: 18, isPreferred: false },
    { sku: "CF-DRY-001", supplierId: supplier1.id, unitCost: 18.00, currency: "RMB", leadTimeDays: 30, transitDays: 21, isPreferred: true },
    { sku: "CF-DRY-002", supplierId: supplier1.id, unitCost: 20.00, currency: "RMB", leadTimeDays: 30, transitDays: 21, isPreferred: true },
    // Cat litter - supplier2 (primary) and supplier3 (alternative, cheaper on tofu)
    { sku: "CL-CLMP-001", supplierId: supplier2.id, unitCost: 12.00, currency: "RMB", leadTimeDays: 20, transitDays: 21, isPreferred: true },
    { sku: "CL-CLMP-001", supplierId: supplier3.id, unitCost: 11.50, currency: "RMB", leadTimeDays: 30, transitDays: 18, isPreferred: false },
    { sku: "CL-CLMP-002", supplierId: supplier2.id, unitCost: 7.00, currency: "RMB", leadTimeDays: 20, transitDays: 21, isPreferred: true },
    { sku: "CL-TOFU-001", supplierId: supplier3.id, unitCost: 5.20, currency: "RMB", leadTimeDays: 25, transitDays: 18, isPreferred: true },
    { sku: "CL-TOFU-001", supplierId: supplier2.id, unitCost: 5.80, currency: "RMB", leadTimeDays: 20, transitDays: 21, isPreferred: false },
    { sku: "CF-TREAT-001", supplierId: supplier1.id, unitCost: 5.00, currency: "RMB", leadTimeDays: 25, transitDays: 21, isPreferred: true },
  ];

  for (const sp of supplierPricings) {
    const product = productMap.get(sp.sku);
    if (!product) continue;
    await prisma.productSupplier.upsert({
      where: { productId_supplierId: { productId: product.id, supplierId: sp.supplierId } },
      update: {},
      create: { productId: product.id, supplierId: sp.supplierId, unitCost: sp.unitCost, currency: sp.currency, leadTimeDays: sp.leadTimeDays, transitDays: sp.transitDays, isPreferred: sp.isPreferred },
    });
  }

  console.log(`${supplierPricings.length} supplier pricings created`);

  // Monthly sales data
  const now = new Date();
  const channels = ["SHOPEE", "LAZADA", "TIKTOK", "AUTOCOUNT"];

  for (const product of products) {
    for (let i = 1; i <= 6; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      for (const channel of channels) {
        let multiplier = 1;
        if (channel === "SHOPEE") multiplier = 1.5;
        else if (channel === "TIKTOK") multiplier = 1.2;
        else if (channel === "LAZADA") multiplier = 0.8;
        else if (channel === "AUTOCOUNT") multiplier = 0.5;
        const unitsSold = Math.floor((Math.random() * 60 + 20) * multiplier);
        const revenue = unitsSold * (product.sellingPrice || product.unitCost * 1.5);
        await prisma.monthlySales.upsert({
          where: { productId_year_month_channel: { productId: product.id, year, month, channel } },
          update: {},
          create: { productId: product.id, year, month, channel, unitsSold, revenue, enteredBy: admin.id },
        });
      }
    }
  }

  console.log("Monthly sales data created");

  // Sample promo
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  await prisma.promo.create({
    data: {
      name: `Shopee ${nextMonth.getMonth() + 1}.${nextMonth.getMonth() + 1} Sale`,
      year: nextMonth.getFullYear(),
      month: nextMonth.getMonth() + 1,
      channel: "SHOPEE",
      upliftType: "PERCENT",
      notes: "Expected 50% uplift based on last year",
      products: {
        create: products.slice(0, 4).map((p) => ({ productId: p.id, upliftValue: 50 })),
      },
    },
  });

  console.log("Promo created");

  console.log("\n--- Seed Complete ---");
  console.log("Login credentials:");
  console.log("  Admin:      admin@supplychain.local / admin123");
  console.log("  Finance:    finance@supplychain.local / finance123");
  console.log("  Supplier 1: supplier1@catfood.com / supplier123");
  console.log("  Supplier 2: supplier2@catlitter.com / supplier123");
  console.log("  Supplier 3: supplier3@petgoods.com / supplier123 (Dalian Jiu Zhou Yuan)");
  console.log("  Logistics 1: logistics@freight.com / logistics123 (FastFreight)");
  console.log("  Logistics 2: logistics2@oceanlink.com / logistics123 (OceanLink)");
  console.log("  Logistics 3: logistics3@cargopro.com / logistics123 (CargoPro)");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
