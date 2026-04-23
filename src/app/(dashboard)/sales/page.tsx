"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/constants";

const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const channelLabels: Record<string, string> = {
  SHOPEE: "Shopee",
  LAZADA: "Lazada",
  TIKTOK: "TikTok",
  AUTOCOUNT: "Offline (AutoCount)",
  MANUAL: "Manual Entry",
};

const channelColors: Record<string, string> = {
  SHOPEE: "bg-orange-100 text-orange-700",
  LAZADA: "bg-blue-100 text-blue-700",
  TIKTOK: "bg-gray-900 text-white",
  AUTOCOUNT: "bg-green-100 text-green-700",
};

export default function SalesOverviewPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState(6);

  useEffect(() => {
    fetch(`/api/sales/overview?months=${months}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); });
  }, [months]);

  if (loading) return <p className="p-6 text-gray-500">Loading sales data...</p>;
  if (!data) return <p className="p-6 text-gray-500">No data</p>;

  const gt = data.grandTotal;
  const onlinePct = gt.totalUnits > 0 ? Math.round((gt.onlineUnits / gt.totalUnits) * 100) : 0;
  const offlinePct = 100 - onlinePct;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sales Overview</h1>
          <p className="text-sm text-gray-500">Combined online and offline sales performance</p>
        </div>
        <div className="flex gap-2">
          {[3, 6, 12].map((m) => (
            <Button key={m} variant={months === m ? "default" : "outline"} size="sm" onClick={() => setMonths(m)}>
              {m}M
            </Button>
          ))}
        </div>
      </div>

      {/* Grand Total Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-gray-500">Total Revenue</div>
            <div className="text-2xl font-bold">{formatCurrency(gt.totalRevenue)}</div>
            <div className="text-xs text-gray-400">Last {months} months</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-gray-500">Total Units Sold</div>
            <div className="text-2xl font-bold">{gt.totalUnits.toLocaleString()}</div>
            <div className="text-xs text-gray-400">Across all channels</div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md" onClick={() => {}}>
          <Link href="/sales/online">
            <CardContent className="pt-4">
              <div className="text-sm text-gray-500">Online Sales</div>
              <div className="text-2xl font-bold text-blue-600">{formatCurrency(gt.onlineRevenue)}</div>
              <div className="text-xs text-gray-400">{gt.onlineUnits.toLocaleString()} units ({onlinePct}%)</div>
            </CardContent>
          </Link>
        </Card>
        <Card className="cursor-pointer hover:shadow-md">
          <Link href="/sales/offline">
            <CardContent className="pt-4">
              <div className="text-sm text-gray-500">Offline Sales</div>
              <div className="text-2xl font-bold text-green-600">{formatCurrency(gt.offlineRevenue)}</div>
              <div className="text-xs text-gray-400">{gt.offlineUnits.toLocaleString()} units ({offlinePct}%)</div>
            </CardContent>
          </Link>
        </Card>
      </div>

      {/* Online vs Offline Bar */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Online vs Offline Split</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-8 rounded-lg overflow-hidden">
            <div className="bg-blue-500 flex items-center justify-center text-white text-xs font-medium" style={{ width: `${onlinePct}%` }}>
              {onlinePct > 10 ? `Online ${onlinePct}%` : ""}
            </div>
            <div className="bg-green-500 flex items-center justify-center text-white text-xs font-medium" style={{ width: `${offlinePct}%` }}>
              {offlinePct > 10 ? `Offline ${offlinePct}%` : ""}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Monthly Trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Monthly Sales Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left">
                  <th className="p-3 font-medium">Month</th>
                  <th className="p-3 font-medium text-right">Online Units</th>
                  <th className="p-3 font-medium text-right">Offline Units</th>
                  <th className="p-3 font-medium text-right">Total Units</th>
                  <th className="p-3 font-medium text-right">Online Revenue</th>
                  <th className="p-3 font-medium text-right">Offline Revenue</th>
                  <th className="p-3 font-medium text-right">Total Revenue</th>
                  <th className="p-3 font-medium">Split</th>
                </tr>
              </thead>
              <tbody>
                {data.monthlyData.map((m: any) => {
                  const onPct = m.total > 0 ? Math.round((m.online / m.total) * 100) : 0;
                  return (
                    <tr key={`${m.year}-${m.month}`} className="border-b">
                      <td className="p-3 font-medium">{monthNames[m.month]} {m.year}</td>
                      <td className="p-3 text-right text-blue-600">{m.online.toLocaleString()}</td>
                      <td className="p-3 text-right text-green-600">{m.offline.toLocaleString()}</td>
                      <td className="p-3 text-right font-medium">{m.total.toLocaleString()}</td>
                      <td className="p-3 text-right text-blue-600">{formatCurrency(m.onlineRevenue)}</td>
                      <td className="p-3 text-right text-green-600">{formatCurrency(m.offlineRevenue)}</td>
                      <td className="p-3 text-right font-bold">{formatCurrency(m.totalRevenue)}</td>
                      <td className="p-3">
                        <div className="flex h-4 rounded overflow-hidden w-24">
                          <div className="bg-blue-400" style={{ width: `${onPct}%` }} />
                          <div className="bg-green-400" style={{ width: `${100 - onPct}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Top Products */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Top Products by Revenue</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left">
                  <th className="p-3 font-medium">#</th>
                  <th className="p-3 font-medium">Product</th>
                  <th className="p-3 font-medium">Category</th>
                  <th className="p-3 font-medium text-right">Online</th>
                  <th className="p-3 font-medium text-right">Offline</th>
                  <th className="p-3 font-medium text-right">Total Units</th>
                  <th className="p-3 font-medium text-right">Revenue</th>
                  <th className="p-3 font-medium">Channels</th>
                </tr>
              </thead>
              <tbody>
                {data.topProducts.slice(0, 15).map((p: any, i: number) => (
                  <tr key={p.productId} className="border-b">
                    <td className="p-3 text-gray-400">{i + 1}</td>
                    <td className="p-3">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-gray-400">{p.sellerSku || p.sku}</div>
                    </td>
                    <td className="p-3"><Badge variant="secondary">{p.category}</Badge></td>
                    <td className="p-3 text-right text-blue-600">{p.onlineUnits.toLocaleString()}</td>
                    <td className="p-3 text-right text-green-600">{p.offlineUnits.toLocaleString()}</td>
                    <td className="p-3 text-right font-medium">{p.totalUnits.toLocaleString()}</td>
                    <td className="p-3 text-right font-bold">{formatCurrency(p.totalRevenue)}</td>
                    <td className="p-3">
                      <div className="flex gap-1 flex-wrap">
                        {Object.keys(p.byChannel).map((ch) => (
                          <Badge key={ch} className={`text-xs ${channelColors[ch] || "bg-gray-100 text-gray-700"}`}>
                            {channelLabels[ch]?.split(" ")[0] || ch}
                          </Badge>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
