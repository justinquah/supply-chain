"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/constants";

const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function OfflineSalesPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState(6);

  useEffect(() => {
    fetch(`/api/sales/offline?months=${months}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); });
  }, [months]);

  if (loading) return <p className="p-6 text-gray-500">Loading...</p>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Offline Sales</h1>
          <p className="text-sm text-gray-500">Wholesale and retail sales from AutoCount invoices</p>
        </div>
        <div className="flex gap-2">
          {[3, 6, 12].map((m) => (
            <Button key={m} variant={months === m ? "default" : "outline"} size="sm" onClick={() => setMonths(m)}>{m}M</Button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-gray-500">Total Offline Revenue</div>
            <div className="text-2xl font-bold text-green-600">{formatCurrency(data.totalRevenue)}</div>
            <div className="text-xs text-gray-400">Last {months} months</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-gray-500">Total Units Sold</div>
            <div className="text-2xl font-bold">{data.totalUnits.toLocaleString()}</div>
            <div className="text-xs text-gray-400">Wholesale + retail</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-gray-500">Avg Monthly</div>
            <div className="text-2xl font-bold">
              {formatCurrency(data.totalRevenue / (data.monthlyTrend.length || 1))}
            </div>
            <div className="text-xs text-gray-400">
              {Math.round(data.totalUnits / (data.monthlyTrend.length || 1)).toLocaleString()} units/mo
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Category Breakdown */}
      {data.categoryBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Sales by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.categoryBreakdown.map((cat: any) => {
                const pct = data.totalRevenue > 0 ? Math.round((cat.revenue / data.totalRevenue) * 100) : 0;
                return (
                  <div key={cat.category}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{cat.category}</Badge>
                        <span className="text-sm text-gray-500">{cat.units.toLocaleString()} units</span>
                      </div>
                      <span className="text-sm font-medium">{formatCurrency(cat.revenue)} ({pct}%)</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-green-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

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
                  <th className="p-3 font-medium text-right">Units Sold</th>
                  <th className="p-3 font-medium text-right">Revenue</th>
                  <th className="p-3 font-medium">Trend</th>
                </tr>
              </thead>
              <tbody>
                {data.monthlyTrend.map((m: any, i: number) => {
                  const prev = i > 0 ? data.monthlyTrend[i - 1] : null;
                  const growth = prev && prev.revenue > 0
                    ? Math.round(((m.revenue - prev.revenue) / prev.revenue) * 100)
                    : null;
                  return (
                    <tr key={`${m.year}-${m.month}`} className="border-b">
                      <td className="p-3 font-medium">{monthNames[m.month]} {m.year}</td>
                      <td className="p-3 text-right">{m.units.toLocaleString()}</td>
                      <td className="p-3 text-right font-medium">{formatCurrency(m.revenue)}</td>
                      <td className="p-3">
                        {growth !== null && (
                          <span className={growth >= 0 ? "text-green-600" : "text-red-600"}>
                            {growth >= 0 ? "+" : ""}{growth}%
                          </span>
                        )}
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
          <CardTitle className="text-sm">Top Products - Offline</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left">
                  <th className="p-3 font-medium">#</th>
                  <th className="p-3 font-medium">Product</th>
                  <th className="p-3 font-medium">Category</th>
                  <th className="p-3 font-medium text-right">Units</th>
                  <th className="p-3 font-medium text-right">Revenue</th>
                  <th className="p-3 font-medium text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {data.topProducts.map((p: any, i: number) => (
                  <tr key={p.productId} className="border-b">
                    <td className="p-3 text-gray-400">{i + 1}</td>
                    <td className="p-3">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-gray-400">{p.sellerSku || p.sku}</div>
                    </td>
                    <td className="p-3"><Badge variant="secondary">{p.category}</Badge></td>
                    <td className="p-3 text-right">{p.units.toLocaleString()}</td>
                    <td className="p-3 text-right font-medium">{formatCurrency(p.revenue)}</td>
                    <td className="p-3 text-right">
                      <span className={p.margin >= 30 ? "text-green-600" : p.margin >= 15 ? "text-amber-600" : "text-red-600"}>
                        {p.margin}%
                      </span>
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
