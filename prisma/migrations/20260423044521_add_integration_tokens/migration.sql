-- CreateTable
CREATE TABLE "IntegrationToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "shopId" TEXT,
    "shopName" TEXT,
    "extra" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationToken_provider_key" ON "IntegrationToken"("provider");

-- CreateIndex
CREATE INDEX "IntegrationToken_provider_idx" ON "IntegrationToken"("provider");
