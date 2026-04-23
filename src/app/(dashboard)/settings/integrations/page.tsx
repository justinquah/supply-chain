"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type ConnectionStatus = {
  connected: boolean;
  status: string;
  message?: string;
  shops?: any[];
  appKey?: string;
  partnerId?: string;
  environment?: string;
  shop?: any;
  seller?: any;
};

type SyncResult = {
  success: boolean;
  totalOrders: number;
  matchedItems: number;
  unmatchedItems: number;
  monthlySalesUpdated: number;
  period: { startDate: string; endDate: string };
};

export default function IntegrationsPage() {
  const [tiktokStatus, setTiktokStatus] = useState<ConnectionStatus | null>(null);
  const [lazadaStatus, setLazadaStatus] = useState<ConnectionStatus | null>(null);
  const [shopeeStatus, setShopeeStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Sync form (shared date range)
  const [syncStartDate, setSyncStartDate] = useState("");
  const [syncEndDate, setSyncEndDate] = useState("");
  const [syncing, setSyncing] = useState<string>("");
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState("");

  // Lazada inventory sync
  const [invSyncing, setInvSyncing] = useState(false);
  const [invResult, setInvResult] = useState<any>(null);

  useEffect(() => {
    checkStatuses();
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    setSyncEndDate(now.toISOString().split("T")[0]);
    setSyncStartDate(thirtyDaysAgo.toISOString().split("T")[0]);
  }, []);

  async function checkStatuses() {
    try {
      const [ttRes, lzRes, spRes] = await Promise.all([
        fetch("/api/integrations/tiktok/auth?action=status"),
        fetch("/api/integrations/lazada/auth?action=status"),
        fetch("/api/integrations/shopee/auth?action=status"),
      ]);
      if (ttRes.ok) setTiktokStatus(await ttRes.json());
      if (lzRes.ok) setLazadaStatus(await lzRes.json());
      if (spRes.ok) setShopeeStatus(await spRes.json());
    } catch {}
    setLoading(false);
  }

  async function connectTikTok() {
    const res = await fetch("/api/integrations/tiktok/auth?action=authorize");
    if (res.ok) {
      const data = await res.json();
      window.open(data.authUrl, "_blank");
    }
  }

  async function connectLazada() {
    const res = await fetch("/api/integrations/lazada/auth?action=authorize");
    if (res.ok) {
      const data = await res.json();
      window.open(data.authUrl, "_blank");
    }
  }

  async function connectShopee() {
    const res = await fetch("/api/integrations/shopee/auth?action=authorize");
    if (res.ok) {
      const data = await res.json();
      window.open(data.authUrl, "_blank");
    }
  }

  async function syncShopeeInventory() {
    setInvSyncing(true);
    setInvResult(null);
    try {
      const res = await fetch("/api/integrations/shopee/sync-inventory", {
        method: "POST",
      });
      setInvResult(await res.json());
    } catch (e: any) {
      setInvResult({ error: e.message });
    }
    setInvSyncing(false);
  }

  async function syncOrders(platform: "tiktok" | "lazada" | "shopee") {
    setSyncing(`${platform}-orders`);
    setSyncError("");
    setSyncResult(null);

    try {
      const res = await fetch(`/api/integrations/${platform}/sync-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: syncStartDate, endDate: syncEndDate }),
      });

      const data = await res.json();
      if (res.ok) setSyncResult(data);
      else setSyncError(data.error || "Sync failed");
    } catch (e: any) {
      setSyncError(e.message || "Network error");
    }

    setSyncing("");
  }

  async function syncLazadaInventory() {
    setInvSyncing(true);
    setInvResult(null);
    try {
      const res = await fetch("/api/integrations/lazada/sync-inventory", {
        method: "POST",
      });
      const data = await res.json();
      setInvResult(data);
    } catch (e: any) {
      setInvResult({ error: e.message });
    }
    setInvSyncing(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Integrations</h1>
        <p className="text-sm text-gray-500">
          Connect marketplace APIs to auto-sync sales and inventory data
        </p>
      </div>

      {/* TikTok Shop */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.88-2.88 2.89 2.89 0 012.88-2.88c.28 0 .56.04.82.11v-3.5a6.37 6.37 0 00-.82-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.79a8.18 8.18 0 004.76 1.52V6.89a4.83 4.83 0 01-1-.2z" />
              </svg>
              TikTok Shop
            </CardTitle>
            <p className="text-sm text-gray-500 mt-1">
              Sync orders, products, and analytics from TikTok Shop
            </p>
          </div>
          {tiktokStatus && (
            <Badge
              className={
                tiktokStatus.connected
                  ? "bg-green-100 text-green-700"
                  : tiktokStatus.status === "NEEDS_AUTH"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-gray-100 text-gray-700"
              }
            >
              {tiktokStatus.connected
                ? "Connected"
                : tiktokStatus.status === "NEEDS_AUTH"
                ? "Needs Authorization"
                : "Not Configured"}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-gray-500">Checking connection...</p>
          ) : (
            <>
              {tiktokStatus?.status === "NOT_CONFIGURED" && (
                <div className="bg-gray-50 p-4 rounded-lg text-sm text-gray-600">
                  TikTok Shop API credentials are not configured. Add your App
                  Key and App Secret to the .env file.
                </div>
              )}

              {tiktokStatus?.status === "NEEDS_AUTH" && (
                <div className="space-y-3">
                  <div className="bg-amber-50 p-4 rounded-lg text-sm">
                    <p className="font-medium text-amber-800">
                      App configured (Key: {tiktokStatus.appKey})
                    </p>
                    <p className="text-amber-600 mt-1">
                      You need to authorize your TikTok Shop seller account to
                      connect.
                    </p>
                  </div>
                  <Button onClick={connectTikTok}>
                    Authorize TikTok Shop
                  </Button>
                </div>
              )}

              {tiktokStatus?.status === "ERROR" && (
                <div className="bg-red-50 p-4 rounded-lg text-sm text-red-600">
                  Connection error: {tiktokStatus.message}
                  <br />
                  <span className="text-xs text-red-400">
                    This is expected if Partner registration is still under
                    review.
                  </span>
                </div>
              )}

              {tiktokStatus?.connected && (
                <div className="bg-green-50 p-4 rounded-lg text-sm text-green-700">
                  Connected to TikTok Shop.
                  {tiktokStatus.shops?.length
                    ? ` ${tiktokStatus.shops.length} shop(s) authorized.`
                    : ""}
                </div>
              )}

              {/* Sync Controls */}
              {(tiktokStatus?.connected ||
                tiktokStatus?.status === "NEEDS_AUTH") && (
                <div className="border-t pt-4">
                  <h4 className="font-medium text-sm mb-3">
                    Sync TikTok Orders
                  </h4>
                  <div className="flex gap-3 items-end">
                    <div className="space-y-1">
                      <Label className="text-xs">Start Date</Label>
                      <Input
                        type="date"
                        value={syncStartDate}
                        onChange={(e) => setSyncStartDate(e.target.value)}
                        className="w-40"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">End Date</Label>
                      <Input
                        type="date"
                        value={syncEndDate}
                        onChange={(e) => setSyncEndDate(e.target.value)}
                        className="w-40"
                      />
                    </div>
                    <Button
                      onClick={() => syncOrders("tiktok")}
                      disabled={syncing === "tiktok-orders"}
                    >
                      {syncing === "tiktok-orders" ? "Syncing..." : "Sync Orders"}
                    </Button>
                  </div>

                  {syncError && (
                    <div className="mt-3 bg-red-50 p-3 rounded text-sm text-red-600">
                      {syncError}
                    </div>
                  )}

                  {syncResult && (
                    <div className="mt-3 bg-green-50 p-4 rounded-lg text-sm space-y-1">
                      <p className="font-medium text-green-700">
                        Sync Complete!
                      </p>
                      <p>Orders fetched: {syncResult.totalOrders}</p>
                      <p>Items matched to products: {syncResult.matchedItems}</p>
                      <p>
                        Unmatched items: {syncResult.unmatchedItems}
                        {syncResult.unmatchedItems > 0 && (
                          <span className="text-amber-600">
                            {" "}
                            (check SKU mapping)
                          </span>
                        )}
                      </p>
                      <p>
                        Monthly sales records updated:{" "}
                        {syncResult.monthlySalesUpdated}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Shopee */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <span className="text-lg">🛒</span>
              Shopee
              {shopeeStatus?.environment && (
                <Badge variant="secondary" className="text-xs">
                  {shopeeStatus.environment}
                </Badge>
              )}
            </CardTitle>
            <p className="text-sm text-gray-500 mt-1">
              Sync orders, sales, and inventory from Shopee Seller Center
            </p>
          </div>
          {shopeeStatus && (
            <Badge
              className={
                shopeeStatus.connected
                  ? "bg-green-100 text-green-700"
                  : shopeeStatus.status === "NEEDS_AUTH"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-gray-100 text-gray-700"
              }
            >
              {shopeeStatus.connected
                ? "Connected"
                : shopeeStatus.status === "NEEDS_AUTH"
                ? "Needs Authorization"
                : "Not Configured"}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {shopeeStatus?.status === "NOT_CONFIGURED" && (
            <div className="bg-gray-50 p-4 rounded-lg text-sm text-gray-600">
              Shopee API credentials are not configured. Add SHOPEE_PARTNER_ID
              and SHOPEE_PARTNER_KEY to the .env file.
            </div>
          )}

          {shopeeStatus?.status === "NEEDS_AUTH" && (
            <div className="space-y-3">
              <div className="bg-amber-50 p-4 rounded-lg text-sm">
                <p className="font-medium text-amber-800">
                  App configured (Partner ID: {(shopeeStatus as any).partnerId}, env: {(shopeeStatus as any).environment})
                </p>
                <p className="text-amber-600 mt-1">
                  Click to authorize your Shopee shop. You&apos;ll log in to
                  Shopee Seller Center and approve access.
                </p>
              </div>
              <Button onClick={connectShopee}>Authorize Shopee Shop</Button>
            </div>
          )}

          {shopeeStatus?.status === "ERROR" && (
            <div className="bg-red-50 p-4 rounded-lg text-sm text-red-600">
              Connection error: {shopeeStatus.message}
            </div>
          )}

          {shopeeStatus?.connected && (
            <div className="bg-green-50 p-4 rounded-lg text-sm text-green-700">
              Connected to Shopee Seller Center ({shopeeStatus.environment}).
            </div>
          )}

          {(shopeeStatus?.connected || shopeeStatus?.status === "NEEDS_AUTH") && (
            <>
              <div className="border-t pt-4">
                <h4 className="font-medium text-sm mb-3">Sync Shopee Orders</h4>
                <div className="flex gap-3 items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">Start Date</Label>
                    <Input
                      type="date"
                      value={syncStartDate}
                      onChange={(e) => setSyncStartDate(e.target.value)}
                      className="w-40"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">End Date</Label>
                    <Input
                      type="date"
                      value={syncEndDate}
                      onChange={(e) => setSyncEndDate(e.target.value)}
                      className="w-40"
                    />
                  </div>
                  <Button
                    onClick={() => syncOrders("shopee")}
                    disabled={syncing === "shopee-orders"}
                  >
                    {syncing === "shopee-orders" ? "Syncing..." : "Sync Orders"}
                  </Button>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-medium text-sm mb-2">Sync Shopee Inventory</h4>
                <p className="text-xs text-gray-500 mb-3">
                  Pulls current stock levels from Shopee and updates your product stock.
                </p>
                <Button
                  onClick={syncShopeeInventory}
                  disabled={invSyncing}
                  variant="outline"
                >
                  {invSyncing ? "Syncing..." : "Sync Inventory from Shopee"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Lazada */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <span className="text-lg">🏪</span>
              Lazada
            </CardTitle>
            <p className="text-sm text-gray-500 mt-1">
              Sync orders, sales, and inventory from Lazada Seller Center
            </p>
          </div>
          {lazadaStatus && (
            <Badge
              className={
                lazadaStatus.connected
                  ? "bg-green-100 text-green-700"
                  : lazadaStatus.status === "NEEDS_AUTH"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-gray-100 text-gray-700"
              }
            >
              {lazadaStatus.connected
                ? "Connected"
                : lazadaStatus.status === "NEEDS_AUTH"
                ? "Needs Authorization"
                : "Not Configured"}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {lazadaStatus?.status === "NOT_CONFIGURED" && (
            <div className="bg-gray-50 p-4 rounded-lg text-sm text-gray-600">
              Lazada API credentials are not configured. Add
              LAZADA_APP_KEY and LAZADA_APP_SECRET to the .env file.
            </div>
          )}

          {lazadaStatus?.status === "NEEDS_AUTH" && (
            <div className="space-y-3">
              <div className="bg-amber-50 p-4 rounded-lg text-sm">
                <p className="font-medium text-amber-800">
                  App configured (Key: {lazadaStatus.appKey})
                </p>
                <p className="text-amber-600 mt-1">
                  Authorize your Lazada seller account to connect.
                </p>
              </div>
              <Button onClick={connectLazada}>Authorize Lazada</Button>
            </div>
          )}

          {lazadaStatus?.status === "ERROR" && (
            <div className="bg-red-50 p-4 rounded-lg text-sm text-red-600">
              Connection error: {lazadaStatus.message}
            </div>
          )}

          {lazadaStatus?.connected && (
            <div className="bg-green-50 p-4 rounded-lg text-sm text-green-700">
              Connected to Lazada Seller Center.
            </div>
          )}

          {/* Lazada Sync Controls */}
          {(lazadaStatus?.connected || lazadaStatus?.status === "NEEDS_AUTH") && (
            <>
              <div className="border-t pt-4">
                <h4 className="font-medium text-sm mb-3">Sync Lazada Orders</h4>
                <div className="flex gap-3 items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">Start Date</Label>
                    <Input
                      type="date"
                      value={syncStartDate}
                      onChange={(e) => setSyncStartDate(e.target.value)}
                      className="w-40"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">End Date</Label>
                    <Input
                      type="date"
                      value={syncEndDate}
                      onChange={(e) => setSyncEndDate(e.target.value)}
                      className="w-40"
                    />
                  </div>
                  <Button
                    onClick={() => syncOrders("lazada")}
                    disabled={syncing === "lazada-orders"}
                  >
                    {syncing === "lazada-orders" ? "Syncing..." : "Sync Orders"}
                  </Button>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-medium text-sm mb-2">Sync Lazada Inventory</h4>
                <p className="text-xs text-gray-500 mb-3">
                  Pulls current stock levels from Lazada and updates your product stock.
                </p>
                <Button
                  onClick={syncLazadaInventory}
                  disabled={invSyncing}
                  variant="outline"
                >
                  {invSyncing ? "Syncing stock..." : "Sync Inventory from Lazada"}
                </Button>
                {invResult && (
                  <div className={`mt-3 p-3 rounded text-sm ${invResult.error ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"}`}>
                    {invResult.error ? (
                      <p>Error: {invResult.error}</p>
                    ) : (
                      <>
                        <p className="font-medium">Inventory Synced!</p>
                        <p>Products checked: {invResult.totalProducts}</p>
                        <p>Stock updated: {invResult.matched}</p>
                        <p>Unmatched (not on Lazada): {invResult.unmatched}</p>
                        {invResult.updates?.length > 0 && (
                          <div className="mt-2 text-xs">
                            <p className="font-medium">Recent updates:</p>
                            {invResult.updates.slice(0, 5).map((u: any) => (
                              <p key={u.sku}>
                                {u.sku}: {u.oldStock} → {u.newStock}
                              </p>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* AutoCount - Placeholder */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-gray-400">
            <span className="text-lg">📊</span>
            AutoCount
            <Badge variant="secondary">Coming Soon</Badge>
          </CardTitle>
          <p className="text-sm text-gray-400">
            Sync invoices and POs with AutoCount accounting system
          </p>
        </CardHeader>
      </Card>
    </div>
  );
}
