/**
 * Add missing products to catalog based on analysis of Qianyi + AutoCount sales files.
 * Creates new series where needed (Jelly Pouch, Samples, Discontinued 80g, Promotional).
 */
import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";

function getPrismaClient() {
  if (process.env.TURSO_DATABASE_URL) {
    console.log("Using Turso");
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

type NewProduct = {
  sku: string;
  sellerSku?: string; // alternative SKU that also shows up in sales files (for mapping)
  barcode?: string;
  variationName: string;
  fullName: string;
  wholesalePrice: number;
  retailPrice: number;
  seriesName: string;
  category: "Cat Food" | "Cat Litter" | "Accessories";
  packSize: string;
  weightKg: number;
  volumeCbm: number;
  unitsPerCarton: number;
  isActive?: boolean;
};

const NEW_PRODUCTS: NewProduct[] = [
  // === NEW SERIES: Jelly Pouch 70g ===
  {
    sku: "BC-PF-PCH-MARKEREL-JELLY-70G",
    sellerSku: "BC-PF-MARKEREL-JELLY-SALMON-70", // AutoCount shortened SKU (will be mapped)
    variationName: "Mackerel in Jelly",
    fullName: "JJANGX3 Jelly Pouch Mackerel 70g",
    wholesalePrice: 1.36,
    retailPrice: 1.60,
    seriesName: "JJANGX3 Jelly Pouch 70g",
    category: "Cat Food",
    packSize: "70G X 6 X 15",
    weightKg: 0.07,
    volumeCbm: 0.0001,
    unitsPerCarton: 90,
  },
  {
    sku: "BC-PF-PCH-MARKEREL-JELLY-SALMON-70G",
    variationName: "Mackerel & Salmon in Jelly",
    fullName: "JJANGX3 Jelly Pouch Mackerel & Salmon 70g",
    wholesalePrice: 1.36,
    retailPrice: 1.60,
    seriesName: "JJANGX3 Jelly Pouch 70g",
    category: "Cat Food",
    packSize: "70G X 6 X 15",
    weightKg: 0.07,
    volumeCbm: 0.0001,
    unitsPerCarton: 90,
  },
  {
    sku: "BC-PF-PCH-TUNARED-JELLY-70G",
    variationName: "Red Tuna in Jelly",
    fullName: "JJANGX3 Jelly Pouch Red Tuna 70g",
    wholesalePrice: 1.36,
    retailPrice: 1.60,
    seriesName: "JJANGX3 Jelly Pouch 70g",
    category: "Cat Food",
    packSize: "70G X 6 X 15",
    weightKg: 0.07,
    volumeCbm: 0.0001,
    unitsPerCarton: 90,
  },
  {
    sku: "BC-PF-PCH-TUNARED-JELLY-CHICKEN-70G",
    sellerSku: "BC-PF-TUNARED-JELLY-CHICKEN-70",
    variationName: "Red Tuna & Chicken in Jelly",
    fullName: "JJANGX3 Jelly Pouch Red Tuna & Chicken 70g",
    wholesalePrice: 1.36,
    retailPrice: 1.60,
    seriesName: "JJANGX3 Jelly Pouch 70g",
    category: "Cat Food",
    packSize: "70G X 6 X 15",
    weightKg: 0.07,
    volumeCbm: 0.0001,
    unitsPerCarton: 90,
  },
  {
    sku: "BC-PF-PCH-TUNARED-OCEANFISH-JELLY-70G",
    sellerSku: "BC-PF-PCH-TUNARED-OCEANFISH-70",
    variationName: "Red Tuna & Ocean Fish in Jelly",
    fullName: "JJANGX3 Jelly Pouch Red Tuna & Ocean Fish 70g",
    wholesalePrice: 1.36,
    retailPrice: 1.60,
    seriesName: "JJANGX3 Jelly Pouch 70g",
    category: "Cat Food",
    packSize: "70G X 6 X 15",
    weightKg: 0.07,
    volumeCbm: 0.0001,
    unitsPerCarton: 90,
  },

  // === NEW SERIES: Premium Wet 80g (older/discontinued) ===
  {
    sku: "BC-PF-CAN-TUNA-PURE-80G",
    variationName: "Pure Tuna",
    fullName: "JJANGX3 Premium Wet Cat Food Pure Tuna 80g (Old)",
    wholesalePrice: 1.50,
    retailPrice: 1.90,
    seriesName: "JJANGX3 Premium Wet Cat Food 80g (Legacy)",
    category: "Cat Food",
    packSize: "80G X 24",
    weightKg: 0.08,
    volumeCbm: 0.00012,
    unitsPerCarton: 24,
  },
  {
    sku: "BC-PF-CAN-TUNA-CRAB-80G",
    variationName: "Tuna & Crab",
    fullName: "JJANGX3 Premium Wet Cat Food Tuna & Crab 80g (Old)",
    wholesalePrice: 1.50,
    retailPrice: 1.90,
    seriesName: "JJANGX3 Premium Wet Cat Food 80g (Legacy)",
    category: "Cat Food",
    packSize: "80G X 24",
    weightKg: 0.08,
    volumeCbm: 0.00012,
    unitsPerCarton: 24,
  },

  // === NEW SERIES: Dry Food Samples 40g ===
  {
    sku: "BC-SAMPLE-DF-HAIR-SKIN-40G",
    variationName: "Hair & Skin",
    fullName: "JJANGX3 Premium Dry Food Hair & Skin Sample 40g",
    wholesalePrice: 0.50,
    retailPrice: 1.00,
    seriesName: "JJANGX3 Premium Dry Food Sample 40g",
    category: "Cat Food",
    packSize: "40G X 50",
    weightKg: 0.04,
    volumeCbm: 0.00008,
    unitsPerCarton: 50,
  },
  {
    sku: "BC-SAMPLE-DF-INDOOR-CAT-40G",
    variationName: "Indoor Cat",
    fullName: "JJANGX3 Classic Dry Food Indoor Cat Sample 40g",
    wholesalePrice: 0.50,
    retailPrice: 1.00,
    seriesName: "JJANGX3 Premium Dry Food Sample 40g",
    category: "Cat Food",
    packSize: "40G X 50",
    weightKg: 0.04,
    volumeCbm: 0.00008,
    unitsPerCarton: 50,
  },

  // === NEW SERIES: Small Dry Food 100g ===
  {
    sku: "BC-DRY-KITTEN-100G",
    variationName: "Kitten",
    fullName: "JJANGX3 Dry Food Kitten 100g (Small Pack)",
    wholesalePrice: 2.00,
    retailPrice: 2.90,
    seriesName: "JJANGX3 Small Dry Food Pack 100g",
    category: "Cat Food",
    packSize: "100G X 30",
    weightKg: 0.1,
    volumeCbm: 0.0002,
    unitsPerCarton: 30,
  },

  // === ADDITION TO EXISTING: Bentonite 10L - Baby Powder ===
  {
    sku: "CATLITTER-BABY POWDER-10L",
    variationName: "Baby Powder",
    fullName: "JJANGX3 Premium Bentonite Cat Litter 10L Baby Powder",
    wholesalePrice: 14.30,
    retailPrice: 17.90,
    seriesName: "JJANGX3 Premium Bentonite Cat Litter 10L", // existing series
    category: "Cat Litter",
    packSize: "10L/7KG X 1",
    weightKg: 7.0,
    volumeCbm: 0.012,
    unitsPerCarton: 1,
  },

  // === NEW SERIES: Bulk 8kg Classic Dry Food (=same as 500g x 16 bulk SKU) ===
  {
    sku: "JJ-DF-BABY-8KG",
    variationName: "Baby Cat (8kg bulk)",
    fullName: "JJANGX3 Classic Dry Food Baby Cat 8KG",
    wholesalePrice: 63.92,
    retailPrice: 79.90,
    seriesName: "JJANGX3 Classic Dry Food 8kg Bulk",
    category: "Cat Food",
    packSize: "8KG X 1",
    weightKg: 8.0,
    volumeCbm: 0.02,
    unitsPerCarton: 1,
  },
  {
    sku: "JJ-DF-INDOOR-8KG",
    variationName: "Indoor Cat (8kg bulk)",
    fullName: "JJANGX3 Classic Dry Food Indoor Cat 8KG",
    wholesalePrice: 63.92,
    retailPrice: 79.90,
    seriesName: "JJANGX3 Classic Dry Food 8kg Bulk",
    category: "Cat Food",
    packSize: "8KG X 1",
    weightKg: 8.0,
    volumeCbm: 0.02,
    unitsPerCarton: 1,
  },

  // === NEW SERIES: Accessories & Promotional ===
  {
    sku: "BC-CATLITTER-SCOOP-SAMPLE",
    variationName: "Cat Litter Scoop (sample)",
    fullName: "JJANGX3 Cat Litter Scoop Sample",
    wholesalePrice: 0.50,
    retailPrice: 1.00,
    seriesName: "JJANGX3 Accessories",
    category: "Accessories",
    packSize: "1 PC",
    weightKg: 0.05,
    volumeCbm: 0.0005,
    unitsPerCarton: 100,
  },
  {
    sku: "JJ-GWP-SOCKS",
    variationName: "GWP Socks",
    fullName: "JJANGX3 GWP Socks (Promotional)",
    wholesalePrice: 0,
    retailPrice: 0,
    seriesName: "JJANGX3 Accessories",
    category: "Accessories",
    packSize: "1 PAIR",
    weightKg: 0.05,
    volumeCbm: 0.0002,
    unitsPerCarton: 100,
  },
  {
    sku: "PETPAD-S",
    variationName: "Pet Pad Small",
    fullName: "JJANGX3 Pet Pad (Small)",
    wholesalePrice: 3.0,
    retailPrice: 4.90,
    seriesName: "JJANGX3 Accessories",
    category: "Accessories",
    packSize: "1 PKT",
    weightKg: 0.3,
    volumeCbm: 0.001,
    unitsPerCarton: 20,
  },
];

async function main() {
  console.log("📦 Adding missing products");
  console.log("=".repeat(60));

  // Ensure all needed categories exist
  const categories = new Map<string, string>();
  for (const name of ["Cat Food", "Cat Litter", "Accessories"]) {
    const cat = await prisma.productCategory.upsert({
      where: { name },
      update: {},
      create: {
        name,
        defaultTargetTurnover: name === "Cat Food" ? 8 : name === "Cat Litter" ? 5 : 4,
      },
    });
    categories.set(name, cat.id);
  }
  console.log(`✓ Categories: ${[...categories.keys()].join(", ")}`);

  // Get default supplier
  const supplier = await prisma.user.findFirst({ where: { role: "SUPPLIER" } });
  if (!supplier) throw new Error("No supplier found");

  // Ensure all needed series exist
  const seriesMap = new Map<string, string>();
  for (const p of NEW_PRODUCTS) {
    if (seriesMap.has(p.seriesName)) continue;
    const categoryId = categories.get(p.category);
    if (!categoryId) throw new Error(`Category ${p.category} not found`);
    const s = await prisma.productSeries.upsert({
      where: { name: p.seriesName },
      update: { packSize: p.packSize },
      create: {
        name: p.seriesName,
        categoryId,
        brand: "JJANGX3",
        packSize: p.packSize,
      },
    });
    seriesMap.set(p.seriesName, s.id);
  }
  console.log(`✓ Series ensured: ${seriesMap.size}`);

  // Create products
  let created = 0;
  let updated = 0;
  for (const p of NEW_PRODUCTS) {
    const categoryId = categories.get(p.category)!;
    const seriesId = seriesMap.get(p.seriesName)!;

    const data = {
      sku: p.sku,
      sellerSku: p.sellerSku || null,
      barcode: p.barcode || null,
      name: p.fullName,
      brand: "JJANGX3",
      seriesId,
      variationName: p.variationName,
      categoryId,
      supplierId: supplier.id,
      unitCost: p.wholesalePrice,
      sellingPrice: p.retailPrice,
      weightPerUnit: p.weightKg,
      volumePerUnit: p.volumeCbm,
      unitsPerCarton: p.unitsPerCarton,
      reorderPoint: Math.max(20, p.unitsPerCarton),
      isActive: p.isActive !== false,
    };

    const existing = await prisma.product.findFirst({
      where: {
        OR: [
          { sku: p.sku },
          ...(p.barcode ? [{ barcode: p.barcode }] : []),
        ],
      },
    });
    if (existing) {
      await prisma.product.update({ where: { id: existing.id }, data });
      updated++;
      console.log(`  ↻ ${p.sku.padEnd(42)} | ${p.variationName}`);
    } else {
      await prisma.product.create({ data });
      created++;
      console.log(`  ✓ ${p.sku.padEnd(42)} | ${p.variationName}`);
    }
  }

  console.log();
  console.log(`✅ Created: ${created}, Updated: ${updated}`);

  // Report total products
  const total = await prisma.product.count({ where: { isActive: true } });
  const seriesCount = await prisma.productSeries.count({ where: { isActive: true } });
  console.log(`📊 Total active products: ${total} across ${seriesCount} series`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());
