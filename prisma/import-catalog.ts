/**
 * Import JJANGX3 catalog: 37 products organized into 9 series
 *
 * Data sources:
 * - PDF catalog (barcode, full name, pack size, wholesale price, RSP)
 * - Qianyi ERP inventory (ERP code, stock levels) - matched via barcode or name
 *
 * Run with:
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/import-catalog.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";

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

type CatalogItem = {
  // Required
  sku: string; // ERP code (primary identifier)
  barcode: string;
  variationName: string;
  wholesalePrice: number;
  retailPrice: number;

  // Optional
  sellerSku?: string; // If different from sku
  stock?: number; // Current stock from Qianyi
  name?: string; // Full name (will be generated from series + variation if not given)
};

type SeriesConfig = {
  seriesName: string;
  category: "Cat Food" | "Cat Litter";
  packSize: string;
  weightPerUnitKg: number; // per single unit (1 can, 1 pouch, 1 bag)
  volumePerUnitCbm: number; // per single unit in CBM
  unitsPerCarton: number;
  items: CatalogItem[];
};

const CATALOG: SeriesConfig[] = [
  // === CAT FOOD - Premium Wet 400g (5 variations) ===
  {
    seriesName: "JJANGX3 Premium Wet Cat Food 400g",
    category: "Cat Food",
    packSize: "400G X 24",
    weightPerUnitKg: 0.4,
    volumePerUnitCbm: 0.0005,
    unitsPerCarton: 24,
    items: [
      { sku: "BC-PF-CAN-TUNA-400G",         barcode: "9551010080793", variationName: "Fresh Tuna",          wholesalePrice: 4.17, retailPrice: 4.90, stock: 13830 },
      { sku: "BC-PF-CAN-OCEAN-FISH-400G",   barcode: "9551010080809", variationName: "Ocean Fish",          wholesalePrice: 4.17, retailPrice: 4.90, stock: 5212 },
      { sku: "BC-PF-CAN-MACKEREL-400G",     barcode: "9551010080816", variationName: "Mackerel",            wholesalePrice: 4.17, retailPrice: 4.90, stock: 14314 },
      { sku: "BC-PF-CAN-TUNA-CHICKEN-400G", barcode: "9551010080823", variationName: "Tuna Topping Chicken",wholesalePrice: 4.17, retailPrice: 4.90, stock: 15278 },
      { sku: "BC-PF-CAN-TUNA-KITTEN-400G",  barcode: "9551010080830", variationName: "Kitten (Fresh Tuna)", wholesalePrice: 4.17, retailPrice: 4.90, stock: 6421 },
    ],
  },

  // === CAT FOOD - Eco-Choice Pouch 70g (7 variations) ===
  {
    seriesName: "JJANGX3 Eco-Choice Pouch 70g",
    category: "Cat Food",
    packSize: "70G X 6 X 15 / 70G X 6 X 8",
    weightPerUnitKg: 0.07,
    volumePerUnitCbm: 0.0001,
    unitsPerCarton: 90, // 6 x 15
    items: [
      { sku: "BC-PF-ECO-PCH-K-TUNA-CHICK-70G",    barcode: "9551010081448", variationName: "Kitten Chicken Goat Milk", wholesalePrice: 1.36, retailPrice: 1.60, stock: 52246 },
      { sku: "BC-PF-ECO-PCH-TUNA-CHICKEN-70G",    barcode: "9551010081455", variationName: "Tuna Chicken",             wholesalePrice: 1.36, retailPrice: 1.60, stock: 46642 },
      { sku: "BC-PF-ECO-PCH-SALMON-TUNA-70G",     barcode: "9551010081462", variationName: "Salmon Tuna",              wholesalePrice: 1.36, retailPrice: 1.60, stock: 58506 },
      { sku: "BC-PF-ECO-PCH-CHICK-SALMON-70G",    barcode: "9551010081479", variationName: "Chicken Salmon",           wholesalePrice: 1.36, retailPrice: 1.60, stock: 62402 },
      { sku: "BC-PF-ECO-PCH-CHICK-TUNA-SALMON-70G", barcode: "9551010082025", variationName: "Chicken Tuna Salmon",    wholesalePrice: 6.80, retailPrice: 7.99 },
      { sku: "BC-PF-ECO-PCH-CHICK-SARDINE-70G",   barcode: "9551010082056", variationName: "Chicken Sardine",          wholesalePrice: 6.80, retailPrice: 7.99 },
      { sku: "BC-PF-ECO-PCH-CHICK-MACKEREL-70G",  barcode: "9551010082087", variationName: "Chicken Mackerel",         wholesalePrice: 6.80, retailPrice: 7.99 },
    ],
  },

  // === CAT TREATS - Creamy 15g (3 variations) ===
  {
    seriesName: "JJANGX3 Cat Creamy Treats 15g",
    category: "Cat Food",
    packSize: "15G X 20 X 60",
    weightPerUnitKg: 0.015,
    volumePerUnitCbm: 0.00003,
    unitsPerCarton: 1200, // 20 x 60
    items: [
      { sku: "BC-CREAMY-TREATS-SALMON-15G",  barcode: "9551010080120", variationName: "Salmon",  wholesalePrice: 0.80, retailPrice: 1.00 },
      { sku: "BC-CREAMY-TREATS-TUNA-15G",    barcode: "9551010080137", variationName: "Tuna",    wholesalePrice: 0.80, retailPrice: 1.00 },
      { sku: "BC-CREAMY-TREATS-CHICKEN-15G", barcode: "9551010080144", variationName: "Chicken", wholesalePrice: 0.80, retailPrice: 1.00, stock: 55423 },
    ],
  },

  // === CAT FOOD - Premium Dry 1kg (3 variations) ===
  {
    seriesName: "JJANGX3 Premium Dry Food 1kg",
    category: "Cat Food",
    packSize: "1KG X 12",
    weightPerUnitKg: 1.0,
    volumePerUnitCbm: 0.002,
    unitsPerCarton: 12,
    items: [
      { sku: "BC-DF-HAIR-SKIN-1KG",    barcode: "9551010080694", variationName: "Hair & Skin",    wholesalePrice: 15.92, retailPrice: 19.90, stock: 3905 },
      { sku: "BC-DF-MOTHER-BABY-1KG",  barcode: "9551010080700", variationName: "Mother & Baby",  wholesalePrice: 15.92, retailPrice: 19.90, stock: 3674 },
      { sku: "BC-DF-KITTEN-1KG",       barcode: "9551010080717", variationName: "Kitten",         wholesalePrice: 15.92, retailPrice: 19.90, stock: 2405 },
    ],
  },

  // === CAT FOOD - Classic Dry 500g (2 variations) ===
  {
    seriesName: "JJANGX3 Classic Dry Food 500g (8kg carton)",
    category: "Cat Food",
    packSize: "500G X 16",
    weightPerUnitKg: 0.5,
    volumePerUnitCbm: 0.0012,
    unitsPerCarton: 16,
    items: [
      { sku: "JJ-DF-BABY-500G",   barcode: "9551010080946", sellerSku: "9551010080922", variationName: "Baby Cat",   wholesalePrice: 63.92, retailPrice: 79.90, stock: 34361 },
      { sku: "JJ-DF-INDOOR-500G", barcode: "9551010080953", sellerSku: "9551010080939", variationName: "Indoor Cat", wholesalePrice: 63.92, retailPrice: 79.90, stock: 17028 },
    ],
  },

  // === CAT LITTER - Cassava 1.25kg (1 variation) ===
  {
    seriesName: "JJANGX3 Cassava Cat Litter 1.25kg",
    category: "Cat Litter",
    packSize: "1.25KG X 7",
    weightPerUnitKg: 1.25,
    volumePerUnitCbm: 0.003,
    unitsPerCarton: 7,
    items: [
      { sku: "BC-CATLITTER-CASSAVA", barcode: "9551010081783", variationName: "Original", wholesalePrice: 10.50, retailPrice: 15.00, stock: 4439 },
    ],
  },

  // === CAT LITTER - 3-in-1 Tofu 2kg (3 variations) ===
  {
    seriesName: "JJANGX3 3-in-1 Tofu Cat Litter 2kg",
    category: "Cat Litter",
    packSize: "2KG X 8",
    weightPerUnitKg: 2.0,
    volumePerUnitCbm: 0.0045,
    unitsPerCarton: 8,
    items: [
      { sku: "JJ-TOFUMIX-ORIGINAL-2KG", barcode: "9551010081387", variationName: "Original", wholesalePrice: 8.72, retailPrice: 10.90, stock: 2086 },
      { sku: "JJ-TOFUMIX-CHARCOAL-2KG", barcode: "9551010081394", variationName: "Charcoal", wholesalePrice: 8.72, retailPrice: 10.90, stock: 2191 },
      { sku: "JJ-TOFUMIX-PEACH-2KG",    barcode: "9551010081400", variationName: "Peach",    wholesalePrice: 8.72, retailPrice: 10.90, stock: 1463 },
    ],
  },

  // === CAT LITTER - Premium Bentonite 5L (4 variations) ===
  {
    seriesName: "JJANGX3 Premium Bentonite Cat Litter 5L",
    category: "Cat Litter",
    packSize: "5L/4KG X 4",
    weightPerUnitKg: 4.0,
    volumePerUnitCbm: 0.006,
    unitsPerCarton: 4,
    items: [
      { sku: "JJ-CATLITTER-BUBBLE GUM-5L", barcode: "9551010081141", variationName: "Bubble Gum", wholesalePrice: 7.57, retailPrice: 8.90, stock: 5617 },
      { sku: "JJ-CATLITTER-LEMON-5L",      barcode: "9551010081158", variationName: "Lemon",      wholesalePrice: 7.57, retailPrice: 8.90, stock: 4503 },
      { sku: "JJ-CATLITTER-LAVENDER-5L",   barcode: "9551010081165", variationName: "Lavender",   wholesalePrice: 7.57, retailPrice: 8.90, stock: 4258 },
      { sku: "JJ-CATLITTER-COFFEE-5L",     barcode: "9551010081745", variationName: "Coffee",     wholesalePrice: 7.57, retailPrice: 8.90, stock: 3794 },
    ],
  },

  // === CAT LITTER - Premium Bentonite 10L (4 variations) ===
  {
    seriesName: "JJANGX3 Premium Bentonite Cat Litter 10L",
    category: "Cat Litter",
    packSize: "10L/7KG X 1",
    weightPerUnitKg: 7.0,
    volumePerUnitCbm: 0.012,
    unitsPerCarton: 1,
    items: [
      { sku: "JJ-CATLITTER-LEMON-10L",       barcode: "9551010080045", variationName: "Lemon",      wholesalePrice: 14.30, retailPrice: 17.90, stock: 99 },
      { sku: "JJ-CATLITTER-LAVENDER-10L",    barcode: "9551010080472", variationName: "Lavender",   wholesalePrice: 14.30, retailPrice: 17.90, stock: 991 },
      { sku: "CATLITTER-BUBBLE GUM-10L",     barcode: "9551010080670", variationName: "Bubble Gum", wholesalePrice: 14.30, retailPrice: 17.90, stock: 1118 },
      { sku: "JJ-CATLITTER-COFFEE-10L",      barcode: "9551010080687", variationName: "Coffee",     wholesalePrice: 14.30, retailPrice: 17.90, stock: 1082 },
    ],
  },

  // === CAT LITTER - Classic Tofu 6L (5 variations) ===
  {
    seriesName: "JJANGX3 Classic Tofu Cat Litter 6L",
    category: "Cat Litter",
    packSize: "6L/1.6KG X 10",
    weightPerUnitKg: 1.6,
    volumePerUnitCbm: 0.0075,
    unitsPerCarton: 10,
    items: [
      { sku: "BC-CATLITTER-COFFEE-6L",   barcode: "9551010081769", variationName: "Robusta Coffee", wholesalePrice: 6.70, retailPrice: 7.90, stock: 26501 },
      { sku: "BC-CATLITTER-ORIGINAL-6L", barcode: "9551010080960", variationName: "Original",       wholesalePrice: 6.70, retailPrice: 7.90, stock: 7584 },
      { sku: "BC-CATLITTER-CHARCOAL-6L", barcode: "9551010080977", variationName: "Charcoal",       wholesalePrice: 6.70, retailPrice: 7.90, stock: 11818 },
      { sku: "BC-CATLITTER-PEACH-6L",    barcode: "9551010080984", variationName: "Peach",          wholesalePrice: 6.70, retailPrice: 7.90, stock: 2690 },
      { sku: "BC-CATLITTER-CANDY-6L",    barcode: "9551010081537", variationName: "Candy",          wholesalePrice: 6.70, retailPrice: 7.90, stock: 5362 },
    ],
  },
];

async function main() {
  console.log("📦 JJANGX3 Catalog Import");
  console.log("=".repeat(60));

  // 1. Ensure categories exist
  const categories = new Map<string, string>();
  for (const name of ["Cat Food", "Cat Litter"]) {
    const cat = await prisma.productCategory.upsert({
      where: { name },
      update: {},
      create: {
        name,
        defaultTargetTurnover: name === "Cat Food" ? 8 : 5,
      },
    });
    categories.set(name, cat.id);
  }
  console.log(`✓ Categories ready: ${[...categories.keys()].join(", ")}`);

  // 2. Find or create a default supplier (placeholder until real supplier data added)
  let supplier = await prisma.user.findFirst({
    where: { role: "SUPPLIER" },
  });
  if (!supplier) {
    throw new Error("No supplier user found. Seed users first.");
  }
  console.log(`✓ Using supplier: ${supplier.companyName || supplier.name}`);

  // 3. Create series + products
  let seriesCreated = 0;
  let productsCreated = 0;
  let productsUpdated = 0;

  for (const s of CATALOG) {
    const categoryId = categories.get(s.category);
    if (!categoryId) throw new Error(`Category not found: ${s.category}`);

    const series = await prisma.productSeries.upsert({
      where: { name: s.seriesName },
      update: {
        packSize: s.packSize,
      },
      create: {
        name: s.seriesName,
        categoryId,
        brand: "JJANGX3",
        packSize: s.packSize,
      },
    });
    seriesCreated++;
    console.log(`\n📚 Series: ${s.seriesName}`);

    for (const item of s.items) {
      const fullName = item.name || `${s.seriesName.replace("JJANGX3 ", "")} - ${item.variationName}`;
      const productData = {
        sku: item.sku,
        sellerSku: item.sellerSku || null,
        barcode: item.barcode,
        name: fullName,
        seriesId: series.id,
        variationName: item.variationName,
        categoryId,
        supplierId: supplier.id,
        unitCost: item.wholesalePrice,
        sellingPrice: item.retailPrice,
        weightPerUnit: s.weightPerUnitKg,
        volumePerUnit: s.volumePerUnitCbm,
        unitsPerCarton: s.unitsPerCarton,
        currentStock: item.stock || 0,
        reorderPoint: Math.max(50, Math.ceil(s.unitsPerCarton * 2)), // 2 cartons
        isActive: true,
      };

      // Check existing by sku OR barcode (either may collide)
      const existing = await prisma.product.findFirst({
        where: {
          OR: [
            { sku: item.sku },
            { barcode: item.barcode },
          ],
        },
      });

      if (existing) {
        await prisma.product.update({
          where: { id: existing.id },
          data: productData,
        });
        productsUpdated++;
        console.log(`  ↻ ${item.sku.padEnd(40)} | ${item.variationName}`);
      } else {
        await prisma.product.create({ data: productData });
        productsCreated++;
        console.log(`  ✓ ${item.sku.padEnd(40)} | ${item.variationName} | stock: ${item.stock || 0}`);
      }
    }
  }

  // 4. Summary
  console.log("\n" + "=".repeat(60));
  console.log(`✅ Import complete!`);
  console.log(`   Series created/updated: ${seriesCreated}`);
  console.log(`   Products created: ${productsCreated}`);
  console.log(`   Products updated: ${productsUpdated}`);

  // Delete old sample products (SKUs like CF-WET-001)
  const samplesDeleted = await prisma.product.deleteMany({
    where: {
      sku: {
        in: ["CF-WET-001", "CF-WET-002", "CF-DRY-001", "CF-DRY-002", "CL-CLMP-001", "CL-CLMP-002", "CL-TOFU-001", "CF-TREAT-001"],
      },
    },
  });
  console.log(`   Sample products removed: ${samplesDeleted.count}`);

  const totalStock = await prisma.product.aggregate({
    _sum: { currentStock: true },
    where: { isActive: true },
  });
  console.log(`   Total stock across all products: ${totalStock._sum.currentStock?.toLocaleString()}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
