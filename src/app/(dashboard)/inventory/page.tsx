"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/constants";

type Forecast = {
  productId: string;
  sku: string;
  sellerSku: string | null;
  name: string;
  threeMonthAvg: number;
  onlineTotal: number;
  offlineTotal: number;
  totalUnits: number;
  mtdTotal: number;
  mtdOnline: number;
  mtdOffline: number;
  mtdChannels: { channel: string; unitsSold: number; revenue: number }[];
  mtdDaysElapsed: number;
  dailyRunRate: number;
  projectedMonthTotal: number;
  currentStock: number;
  daysToOOS: number | null;
  inTransitQty: number;
  daysToOOSWithTransit: number | null;
  targetTurnover: number;
  actualTurnover: number | null;
  idealStock: number;
  stockStatus: "CRITICAL" | "AT_RISK" | "HEALTHY" | "OVERSTOCKED";
  promoUplift: number;
  adjustedForecast: number;
  channelBreakdown: { channel: string; unitsSold: number; revenue: number }[];
};

const statusConfig = {
  CRITICAL: { label: "Critical", color: "bg-red-100 text-red-700", icon: "🔴" },
  AT_RISK: { label: "At Risk", color: "bg-amber-100 text-amber-700", icon: "⚠️" },
  OVERSTOCKED: { label: "Overstocked", color: "bg-blue-100 text-blue-700", icon: "📦" },
  HEALTHY: { label: "Healthy", color: "bg-green-100 text-green-700", icon: "✅" },
};

const channelLabels: Record<string, string> = {
  SHOPEE: "Shopee",
  LAZADA: "Lazada",
  TIKTOK: "TikTok",
  AUTOCOUNT: "Offline",
  MANUAL: "Manual",
};

export default function InventoryPage() {
  const { data: session } = useSession();
  const user = session?.user as any;

  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [loading, setLoading] = useState(true);
  const [riskOnly, setRiskOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    const res = await fetch(`/api/inventory/forecast?riskOnly=${riskOnly}`);
    if (res.ok) setForecasts(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, [riskOnly]);

  // Summary counts
  const critical = forecasts.filter((f) => f.stockStatus === "CRITICAL").length;
  const atRisk = forecasts.filter((f) => f.stockStatus === "AT_RISK").length;
  const overstocked = forecasts.filter((f) => f.stockStatus === "OVERSTOCKED").length;
  const healthy = forecasts.filter((f) => f.stockStatus === "HEALTHY").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inventory & Forecasting</h1>
          <p className="text-sm text-gray-500">
            Stock levels, demand forecast, and risk assessment
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/inventory/qianyi-import">
            <Button variant="outline">Import from Qianyi</Button>
          </a>
          <a href="/inventory/import">
            <Button variant="outline">Import Sales Data</Button>
          </a>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="cursor-pointer hover:shadow-md" onClick={() => setRiskOnly(false)}>
          <CardContent className="pt-4">
            <div className="text-sm text-gray-500">Critical</div>
            <div className="text-2xl font-bold text-red-600">{critical}</div>
            <div className="text-xs text-gray-400">{"< 7 days stock"}</div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md" onClick={() => setRiskOnly(false)}>
          <CardContent className="pt-4">
            <div className="text-sm text-gray-500">At Risk</div>
            <div className="text-2xl font-bold text-amber-600">{atRisk}</div>
            <div className="text-xs text-gray-400">{"< 21 days stock"}</div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md" onClick={() => setRiskOnly(false)}>
          <CardContent className="pt-4">
            <div className="text-sm text-gray-500">Overstocked</div>
            <div className="text-2xl font-bold text-blue-600">{overstocked}</div>
            <div className="text-xs text-gray-400">{"> 1.5x ideal"}</div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md" onClick={() => setRiskOnly(false)}>
          <CardContent className="pt-4">
            <div className="text-sm text-gray-500">Healthy</div>
            <div className="text-2xl font-bold text-green-600">{healthy}</div>
            <div className="text-xs text-gray-400">Within target range</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <Button
          variant={riskOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setRiskOnly(!riskOnly)}
        >
          {riskOnly ? "Showing At-Risk Only" : "Show At-Risk Only"}
        </Button>
      </div>

      {/* Inventory Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-gray-500">Loading forecasts...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left">
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Product</th>
                    <th className="p-3 font-medium text-right">Stock</th>
                    <th className="p-3 font-medium text-right">MTD Sold</th>
                    <th className="p-3 font-medium text-right">Daily Rate</th>
                    <th className="p-3 font-medium text-right">Days to OOS</th>
                    <th className="p-3 font-medium text-right">In Transit</th>
                    <th className="p-3 font-medium text-right">3M Avg</th>
                    <th className="p-3 font-medium text-right">Turnover</th>
                    <th className="p-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {forecasts.map((f) => {
                    const sc = statusConfig[f.stockStatus];
                    const isExpanded = expandedId === f.productId;
                    return (
                      <>
                        <tr
                          key={f.productId}
                          className="border-b hover:bg-gray-50 cursor-pointer"
                          onClick={() =>
                            setExpandedId(isExpanded ? null : f.productId)
                          }
                        >
                          <td className="p-3">
                            <Badge className={sc.color}>
                              {sc.icon} {sc.label}
                            </Badge>
                          </td>
                          <td className="p-3">
                            <div className="font-medium">{f.name}</div>
                            <div className="text-xs text-gray-400">
                              {f.sellerSku || f.sku}
                            </div>
                          </td>
                          <td className="p-3 text-right font-medium">
                            {f.currentStock.toLocaleString()}
                          </td>
                          <td className="p-3 text-right">
                            <div>{f.mtdTotal.toLocaleString()}</div>
                            <div className="text-xs text-gray-400">
                              {f.mtdOnline} online / {f.mtdOffline} offline
                            </div>
                          </td>
                          <td className="p-3 text-right">
                            {f.dailyRunRate}/day
                          </td>
                          <td className="p-3 text-right">
                            <span
                              className={
                                f.daysToOOS !== null && f.daysToOOS <= 7
                                  ? "text-red-600 font-bold"
                                  : f.daysToOOS !== null && f.daysToOOS <= 21
                                  ? "text-amber-600 font-medium"
                                  : ""
                              }
                            >
                              {f.daysToOOS !== null
                                ? `${f.daysToOOS} days`
                                : "∞"}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            {f.inTransitQty > 0 ? (
                              <span className="text-purple-600">
                                {f.inTransitQty.toLocaleString()}
                              </span>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="p-3 text-right">
                            {f.threeMonthAvg.toLocaleString()}/mo
                            {f.promoUplift > 0 && (
                              <div className="text-xs text-orange-500">
                                +{f.promoUplift} promo
                              </div>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            <div>
                              {f.actualTurnover !== null
                                ? `${f.actualTurnover}x`
                                : "-"}
                            </div>
                            <div className="text-xs text-gray-400">
                              target: {f.targetTurnover}x
                            </div>
                          </td>
                          <td className="p-3 text-center">
                            <span className="text-gray-400">
                              {isExpanded ? "▲" : "▼"}
                            </span>
                          </td>
                        </tr>

                        {/* Expanded Detail Row */}
                        {isExpanded && (
                          <tr key={`${f.productId}-detail`} className="bg-gray-50">
                            <td colSpan={10} className="p-4">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {/* Channel Breakdown - 3 Month Avg */}
                                <div>
                                  <h4 className="font-medium text-sm mb-2">
                                    3-Month Avg by Channel
                                  </h4>
                                  <div className="space-y-1">
                                    {f.channelBreakdown.map((ch) => (
                                      <div
                                        key={ch.channel}
                                        className="flex justify-between text-sm"
                                      >
                                        <span className="text-gray-600">
                                          {channelLabels[ch.channel] || ch.channel}
                                        </span>
                                        <span>
                                          {ch.unitsSold} units ({formatCurrency(ch.revenue)})
                                        </span>
                                      </div>
                                    ))}
                                    <div className="border-t pt-1 flex justify-between font-medium text-sm">
                                      <span>Online</span>
                                      <span>{f.onlineTotal} units</span>
                                    </div>
                                    <div className="flex justify-between font-medium text-sm">
                                      <span>Offline</span>
                                      <span>{f.offlineTotal} units</span>
                                    </div>
                                    <div className="border-t pt-1 flex justify-between font-bold text-sm">
                                      <span>Total</span>
                                      <span>{f.totalUnits} units/mo</span>
                                    </div>
                                  </div>
                                </div>

                                {/* MTD Channel Breakdown */}
                                <div>
                                  <h4 className="font-medium text-sm mb-2">
                                    MTD (Day {f.mtdDaysElapsed})
                                  </h4>
                                  <div className="space-y-1">
                                    {f.mtdChannels.map((ch) => (
                                      <div
                                        key={ch.channel}
                                        className="flex justify-between text-sm"
                                      >
                                        <span className="text-gray-600">
                                          {channelLabels[ch.channel] || ch.channel}
                                        </span>
                                        <span>{ch.unitsSold} units</span>
                                      </div>
                                    ))}
                                    <div className="border-t pt-1 flex justify-between text-sm">
                                      <span>Online</span>
                                      <span className="font-medium">{f.mtdOnline}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                      <span>Offline</span>
                                      <span className="font-medium">{f.mtdOffline}</span>
                                    </div>
                                    <div className="border-t pt-1 flex justify-between font-bold text-sm">
                                      <span>Total MTD</span>
                                      <span>{f.mtdTotal}</span>
                                    </div>
                                    <div className="flex justify-between text-sm text-gray-500">
                                      <span>Projected month</span>
                                      <span>{f.projectedMonthTotal}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Stock Health */}
                                <div>
                                  <h4 className="font-medium text-sm mb-2">
                                    Stock Health
                                  </h4>
                                  <div className="space-y-1 text-sm">
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Current stock</span>
                                      <span>{f.currentStock.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Ideal stock</span>
                                      <span>{f.idealStock.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">In transit</span>
                                      <span>{f.inTransitQty.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Days to OOS</span>
                                      <span className="font-medium">
                                        {f.daysToOOS ?? "∞"}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">
                                        Days to OOS (with transit)
                                      </span>
                                      <span className="font-medium">
                                        {f.daysToOOSWithTransit ?? "∞"}
                                      </span>
                                    </div>
                                    {f.promoUplift > 0 && (
                                      <>
                                        <div className="border-t pt-1 flex justify-between text-orange-600">
                                          <span>Promo uplift</span>
                                          <span>+{f.promoUplift} units</span>
                                        </div>
                                        <div className="flex justify-between font-medium">
                                          <span>Adjusted forecast</span>
                                          <span>{f.adjustedForecast}/mo</span>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                  {forecasts.length === 0 && (
                    <tr>
                      <td colSpan={10} className="p-6 text-center text-gray-500">
                        {riskOnly
                          ? "No at-risk products found"
                          : "No products found"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
