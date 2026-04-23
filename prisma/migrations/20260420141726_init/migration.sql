-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "companyName" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "defaultTargetTurnover" REAL NOT NULL DEFAULT 6,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "sellerSku" TEXT,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
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
    CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SkuMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketplaceSku" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SkuMappingComponent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mappingId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    CONSTRAINT "SkuMappingComponent_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "SkuMapping" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SkuMappingComponent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductSupplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "unitCost" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RMB',
    "leadTimeDays" INTEGER NOT NULL DEFAULT 30,
    "transitDays" INTEGER NOT NULL DEFAULT 21,
    "moq" INTEGER NOT NULL DEFAULT 1,
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductSupplier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProductSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MonthlySales" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'MANUAL',
    "unitsSold" INTEGER NOT NULL,
    "revenue" REAL NOT NULL DEFAULT 0,
    "enteredBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MonthlySales_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MonthlySales_enteredBy_fkey" FOREIGN KEY ("enteredBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Promo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "channel" TEXT,
    "upliftType" TEXT NOT NULL DEFAULT 'UNITS',
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PromoProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "promoId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "upliftValue" REAL NOT NULL,
    CONSTRAINT "PromoProduct_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "Promo" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PromoProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockAvailability" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "availableQty" INTEGER NOT NULL,
    "leadTimeDays" INTEGER,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StockAvailability_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockAvailability_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "poNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "containerType" TEXT,
    "totalWeight" REAL NOT NULL DEFAULT 0,
    "totalVolume" REAL NOT NULL DEFAULT 0,
    "totalAmount" REAL NOT NULL DEFAULT 0,
    "depositPercent" REAL NOT NULL DEFAULT 0,
    "depositAmount" REAL NOT NULL DEFAULT 0,
    "depositPaidDate" DATETIME,
    "balanceDueDays" INTEGER NOT NULL DEFAULT 30,
    "currency" TEXT NOT NULL DEFAULT 'RM',
    "requestedEta" DATETIME,
    "notes" TEXT,
    "supplierNotes" TEXT,
    "supplierInvoiceNo" TEXT,
    "confirmedAt" DATETIME,
    "sentToSupplierAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "POLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" REAL NOT NULL,
    "totalCost" REAL NOT NULL,
    "weightSubtotal" REAL NOT NULL,
    "volumeSubtotal" REAL NOT NULL,
    "suggestedQty" INTEGER,
    "batchNumber" TEXT,
    "notes" TEXT,
    CONSTRAINT "POLineItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "POLineItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContainerConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "maxWeightKg" REAL NOT NULL,
    "maxVolumeCbm" REAL NOT NULL,
    "estimatedCost" REAL NOT NULL DEFAULT 0,
    "description" TEXT
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseOrderId" TEXT NOT NULL,
    "shipmentRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "etd" DATETIME,
    "eta" DATETIME,
    "actualArrival" DATETIME,
    "portOfOrigin" TEXT,
    "portOfDest" TEXT NOT NULL DEFAULT 'Port Klang',
    "shippingLine" TEXT,
    "vesselName" TEXT,
    "containerNumber" TEXT,
    "logisticsUserId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Shipment_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ETAUpdate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shipmentId" TEXT NOT NULL,
    "previousEta" DATETIME,
    "newEta" DATETIME NOT NULL,
    "reason" TEXT,
    "updatedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ETAUpdate_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ETAUpdate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ETAChangeRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shipmentId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "currentEta" DATETIME NOT NULL,
    "requestedEta" DATETIME NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "respondedById" TEXT,
    "responseNote" TEXT,
    "respondedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ETAChangeRequest_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ETAChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ETAChangeRequest_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShipmentDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shipmentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileData" BLOB NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShipmentDocument_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ShipmentDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseOrderId" TEXT NOT NULL,
    "payee" TEXT NOT NULL DEFAULT 'SUPPLIER',
    "payeeUserId" TEXT,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RM',
    "dueDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidDate" DATETIME,
    "invoiceRef" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payment_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentSlip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paymentId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileData" BLOB NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentSlip_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentSlip_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_name_key" ON "ProductCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sellerSku_key" ON "Product"("sellerSku");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "Product_supplierId_idx" ON "Product"("supplierId");

-- CreateIndex
CREATE INDEX "Product_sku_idx" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_sellerSku_idx" ON "Product"("sellerSku");

-- CreateIndex
CREATE INDEX "Product_barcode_idx" ON "Product"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "SkuMapping_marketplaceSku_key" ON "SkuMapping"("marketplaceSku");

-- CreateIndex
CREATE INDEX "SkuMapping_marketplaceSku_idx" ON "SkuMapping"("marketplaceSku");

-- CreateIndex
CREATE INDEX "SkuMappingComponent_mappingId_idx" ON "SkuMappingComponent"("mappingId");

-- CreateIndex
CREATE INDEX "SkuMappingComponent_productId_idx" ON "SkuMappingComponent"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "SkuMappingComponent_mappingId_productId_key" ON "SkuMappingComponent"("mappingId", "productId");

-- CreateIndex
CREATE INDEX "ProductSupplier_productId_idx" ON "ProductSupplier"("productId");

-- CreateIndex
CREATE INDEX "ProductSupplier_supplierId_idx" ON "ProductSupplier"("supplierId");

-- CreateIndex
CREATE INDEX "ProductSupplier_unitCost_idx" ON "ProductSupplier"("unitCost");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSupplier_productId_supplierId_key" ON "ProductSupplier"("productId", "supplierId");

-- CreateIndex
CREATE INDEX "MonthlySales_productId_idx" ON "MonthlySales"("productId");

-- CreateIndex
CREATE INDEX "MonthlySales_channel_idx" ON "MonthlySales"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlySales_productId_year_month_channel_key" ON "MonthlySales"("productId", "year", "month", "channel");

-- CreateIndex
CREATE INDEX "Promo_year_month_idx" ON "Promo"("year", "month");

-- CreateIndex
CREATE INDEX "PromoProduct_promoId_idx" ON "PromoProduct"("promoId");

-- CreateIndex
CREATE INDEX "PromoProduct_productId_idx" ON "PromoProduct"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoProduct_promoId_productId_key" ON "PromoProduct"("promoId", "productId");

-- CreateIndex
CREATE INDEX "StockAvailability_productId_idx" ON "StockAvailability"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_createdById_idx" ON "PurchaseOrder"("createdById");

-- CreateIndex
CREATE INDEX "POLineItem_purchaseOrderId_idx" ON "POLineItem"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "POLineItem_productId_idx" ON "POLineItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ContainerConfig_type_key" ON "ContainerConfig"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_purchaseOrderId_key" ON "Shipment"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "Shipment_status_idx" ON "Shipment"("status");

-- CreateIndex
CREATE INDEX "Shipment_eta_idx" ON "Shipment"("eta");

-- CreateIndex
CREATE INDEX "ETAUpdate_shipmentId_idx" ON "ETAUpdate"("shipmentId");

-- CreateIndex
CREATE INDEX "ETAChangeRequest_shipmentId_idx" ON "ETAChangeRequest"("shipmentId");

-- CreateIndex
CREATE INDEX "ETAChangeRequest_status_idx" ON "ETAChangeRequest"("status");

-- CreateIndex
CREATE INDEX "ShipmentDocument_shipmentId_idx" ON "ShipmentDocument"("shipmentId");

-- CreateIndex
CREATE INDEX "ShipmentDocument_type_idx" ON "ShipmentDocument"("type");

-- CreateIndex
CREATE INDEX "Payment_purchaseOrderId_idx" ON "Payment"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "Payment_payee_idx" ON "Payment"("payee");

-- CreateIndex
CREATE INDEX "Payment_payeeUserId_idx" ON "Payment"("payeeUserId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_dueDate_idx" ON "Payment"("dueDate");

-- CreateIndex
CREATE INDEX "PaymentSlip_paymentId_idx" ON "PaymentSlip"("paymentId");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
