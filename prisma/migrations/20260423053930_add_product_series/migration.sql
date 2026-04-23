-- CreateTable
CREATE TABLE "ProductSeries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "brand" TEXT DEFAULT 'JJANGX3',
    "packSize" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductSeries_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "sellerSku" TEXT,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "seriesId" TEXT,
    "variationName" TEXT,
    "categoryId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "unitCost" REAL NOT NULL,
    "sellingPrice" REAL,
    "weightPerUnit" REAL NOT NULL,
    "volumePerUnit" REAL NOT NULL,
    "unitsPerCarton" INTEGER NOT NULL DEFAULT 1,
    "minOrderQty" INTEGER NOT NULL DEFAULT 1,
    "currentStock" INTEGER NOT NULL DEFAULT 0,
    "reorderPoint" INTEGER NOT NULL DEFAULT 0,
    "targetTurnover" REAL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Product_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "ProductSeries" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("barcode", "categoryId", "createdAt", "currentStock", "id", "isActive", "minOrderQty", "name", "reorderPoint", "sellerSku", "sellingPrice", "sku", "supplierId", "targetTurnover", "unitCost", "unitsPerCarton", "updatedAt", "volumePerUnit", "weightPerUnit") SELECT "barcode", "categoryId", "createdAt", "currentStock", "id", "isActive", "minOrderQty", "name", "reorderPoint", "sellerSku", "sellingPrice", "sku", "supplierId", "targetTurnover", "unitCost", "unitsPerCarton", "updatedAt", "volumePerUnit", "weightPerUnit" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE UNIQUE INDEX "Product_sellerSku_key" ON "Product"("sellerSku");
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");
CREATE INDEX "Product_seriesId_idx" ON "Product"("seriesId");
CREATE INDEX "Product_supplierId_idx" ON "Product"("supplierId");
CREATE INDEX "Product_sku_idx" ON "Product"("sku");
CREATE INDEX "Product_sellerSku_idx" ON "Product"("sellerSku");
CREATE INDEX "Product_barcode_idx" ON "Product"("barcode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ProductSeries_name_key" ON "ProductSeries"("name");

-- CreateIndex
CREATE INDEX "ProductSeries_categoryId_idx" ON "ProductSeries"("categoryId");
