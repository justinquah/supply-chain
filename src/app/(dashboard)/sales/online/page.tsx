"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/constants";

const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const platformConfig: Record<string, { label: string; color: string; bgColor: string }> = {
  SHOPEE: { label: "Shopee", color: "text-orange-600", bgColor: "bg-orange-100 text-orange-700" },
  LAZADA: { label: "Lazada", color: "text-blue-600", bgColor: "bg-blue-100 text-blue-700" },
  TIKTOK: { label: "TikTok", color: "text-gray-900", bgColor: "bg-gray-200 text-gray-800" },
};

export default function OnlineSalesPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState(6);
  const [selectedPlatform, setSelectedPlatform] = useState("");

  useEffect(() => {
    const url = selectedPlatform
      ? `/api/sales/online?months=${months}&channel=${selectedPlatform}`
      : `/api/sales/online?months=${months}`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); });
  }, [months, selectedPlatform]);

  if (loading) return <p className="p-6 text-gray-500">Loading...</p>;
  if (!data) return null;

  const platforms = Object.entries(data.platformTotals || {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Online Sales</h1>
          <p className="text-sm text-gray-500">Shopee, Lazada, and TikTok marketplace performance</p>
        </div>
        <div className="flex gap-2">
          {[3, 6, 12].map((m) => (
            <Button key={m} variant={months === m ? "default" : "outline"} size="sm" onClick={() => setMonths(m)}>{m}M</Button>
          ))}
        </div>
      </div>

      {/* Platform filter */}
      <div className="flex gap-2">
        <Button variant={selectedPlatform === "" ? "default" : "outline"} size="sm" onClick={() => setSelectedPlatform("")}>All Platforms</Button>
        {["SHOPEE", "LAZADA", "TIKTOK"].map((p) => (
          <Button key={p} variant={selectedPlatform === p ? "default" : "outline"} size="sm" onClick={() => setSelectedPlatform(p)}>
            {platformConfig[p]?.label || p}
          </Button>
        ))}
      </div>

      {/* Total + Platform Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-gray-500">Total Online Revenue</div>
            <div className="text-2xl font-bold">{formatCurrency(data.totalRevenue)}</div>
            <div className="text-xs text-gray-400">{data.totalUnits.toLocaleString()} units</div>
          </CardContent>
        </Card>
        {platforms.map(([platform, totals]: [string, any]) => {
          const cfg = platformConfig[platform];
          return (
            <Card key={platform} className="cursor-pointer hover:shadow-md" onClick={() => setSelectedPlatform(platform)}>
              <CardContent className="pt-4">
                <div className="text-sm text-gray-500">{cfg?.label || platform}</div>
                <div className={`text-2xl font-bold ${cfg?.color || ""}`}>{formatCurrency(totals.revenue)}</div>
                <div className="text-xs text-gray-400">{totals.units.toLocaleString()} units | {totals.products} SKUs</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Monthly Trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Monthly Platform Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left">
                  <th className="p-3 font-medium">Month</th>
                  {(selectedPlatform ? [selectedPlatform] : ["SHOPEE", "LAZADA", "TIKTOK"]).map((p) => (
                    <th key={`${p}-u`} className="p-3 font-medium text-right">
                      <Badge className={platformConfig[p]?.bgColor || ""}>{platformConfig[p]?.label || p}</Badge>
                      <div className="text-xs text-gray-400 mt-1">Units</div>
                    </th>
                  ))}
                  {(selectedPlatform ? [selectedPlatform] : ["SHOPEE", "LAZADA", "TIKTOK"]).map((p) => (
                    <th key={`${p}-r`} className="p-3 font-medium text-right">
                      <div className="text-xs text-gray-400">Revenue</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.monthlyTrend.map((m: any) => {
                  const monthKey = m.month;
                  const [year, mon] = monthKey.split("-");
                  return (
                    <tr key={monthKey} className="border-b">
                      <td className="p-3 font-medium">{monthNames[parseInt(mon)]} {year}</td>
                      {(selectedPlatform ? [selectedPlatform] : ["SHOPEE", "LAZADA", "TIKTOK"]).map((p) => (
                        <td key={`${p}-u`} className="p-3 text-right">
                          {m[p]?.units?.toLocaleString() || 0}
                        </td>
                      ))}
                      {(selectedPlatform ? [selectedPlatform] : ["SHOPEE", "LAZADA", "TIKTOK"]).map((p) => (
                        <td key={`${p}-r`} className="p-3 text-right">
                          {m[p] ? formatCurrency(m[p].revenue) : "-"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Top Products by Platform */}
      {Object.entries(data.topByPlatform || {}).map(([platform, products]: [string, any]) => {
        const cfg = platformConfig[platform];
        return (
          <Card key={platform}>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                Top Products -
                <Badge className={cfg?.bgColor || ""}>{cfg?.label || platform}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-left">
                      <th className="p-3 font-medium">#</th>
                      <th className="p-3 font-medium">Product</th>
                      <th className="p-3 font-medium text-right">Units</th>
                      <th className="p-3 font-medium text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.slice(0, 10).map((p: any, i: number) => (
                      <tr key={p.sku} className="border-b">
                        <td className="p-3 text-gray-400">{i + 1}</td>
                        <td className="p-3">
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-gray-400">{p.sku}</div>
                        </td>
                        <td className="p-3 text-right">{p.units.toLocaleString()}</td>
                        <td className="p-3 text-right font-medium">{formatCurrency(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
