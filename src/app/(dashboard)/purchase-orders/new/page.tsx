"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

type Supplier = { id: string; name: string; companyName: string | null };

type Suggestion = {
  productId: string;
  sku: string;
  sellerSku: string | null;
  name: string;
  unitCost: number;
  unitsPerCarton: number;
  currentStock: number;
  inTransitQty: number;
  threeMonthAvg: number;
  promoUplift: number;
  adjustedForecast: number;
  daysToOOS: number | null;
  stockStatus: string;
  suggestedQty: number;
  totalCost: number;
  weightSubtotal: number;
  volumeSubtotal: number;
};

type ContainerRec = {
  recommendedType: string;
  totalWeightKg: number;
  totalVolumeCbm: number;
  weightUtilization: number;
  volumeUtilization: number;
  fits: boolean;
  estimatedCost: number;
  details: string;
};

const statusColors: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-700",
  AT_RISK: "bg-amber-100 text-amber-700",
  OVERSTOCKED: "bg-blue-100 text-blue-700",
  HEALTHY: "bg-green-100 text-green-700",
};

export default function CreatePOPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [targetMonths, setTargetMonths] = useState(2);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [containerRec, setContainerRec] = useState<ContainerRec | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // PO form fields
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [containerType, setContainerType] = useState("");
  const [depositPercent, setDepositPercent] = useState("30");
  const [balanceDueDays, setBalanceDueDays] = useState("45");
  const [currency, setCurrency] = useState("RMB");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/suppliers")
      .then((r) => r.json())
      .then(setSuppliers);
  }, []);

  async function loadSuggestions() {
    if (!selectedSupplier) return;
    setLoadingSuggestions(true);

    const res = await fetch("/api/purchase-orders/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierId: selectedSupplier,
        targetMonths,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setSuggestions(data.suggestions);
      setContainerRec(data.containerRecommendation);
      setSummary(data.summary);

      // Pre-fill quantities with suggestions
      const qtys: Record<string, number> = {};
      for (const s of data.suggestions) {
        qtys[s.productId] = s.suggestedQty;
      }
      setQuantities(qtys);

      // Set recommended container type
      if (data.containerRecommendation?.recommendedType !== "MULTIPLE") {
        setContainerType(data.containerRecommendation?.recommendedType || "");
      }
    }

    setLoadingSuggestions(false);
  }

  useEffect(() => {
    if (selectedSupplier) loadSuggestions();
  }, [selectedSupplier, targetMonths]);

  function updateQuantity(productId: string, qty: number) {
    setQuantities((prev) => ({ ...prev, [productId]: Math.max(0, qty) }));
  }

  // Calculate live totals based on current quantities
  const activeItems = suggestions.filter(
    (s) => (quantities[s.productId] || 0) > 0
  );
  const liveTotalAmount = activeItems.reduce(
    (sum, s) => sum + (quantities[s.productId] || 0) * s.unitCost,
    0
  );
  const liveTotalWeight = activeItems.reduce(
    (sum, s) =>
      sum +
      (quantities[s.productId] || 0) *
        (s.weightSubtotal / (s.suggestedQty || 1)),
    0
  );
  const liveTotalVolume = activeItems.reduce(
    (sum, s) =>
      sum +
      (quantities[s.productId] || 0) *
        (s.volumeSubtotal / (s.suggestedQty || 1)),
    0
  );

  async function handleCreate() {
    setCreating(true);

    const lineItems = suggestions
      .filter((s) => (quantities[s.productId] || 0) > 0)
      .map((s) => ({
        productId: s.productId,
        quantity: quantities[s.productId],
        unitCost: s.unitCost,
        suggestedQty: s.suggestedQty,
      }));

    if (lineItems.length === 0) {
      alert("Please add at least one item with quantity > 0");
      setCreating(false);
      return;
    }

    const res = await fetch("/api/purchase-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierId: selectedSupplier,
        containerType: containerType || null,
        depositPercent: parseFloat(depositPercent),
        balanceDueDays: parseInt(balanceDueDays),
        currency,
        notes: notes || null,
        lineItems,
      }),
    });

    if (res.ok) {
      const po = await res.json();
      router.push(`/purchase-orders/${po.id}`);
    } else {
      const err = await res.json();
      alert(err.error || "Failed to create PO");
    }

    setCreating(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Create Purchase Order</h1>
        <p className="text-sm text-gray-500">
          System suggests quantities based on demand forecast and current stock
        </p>
      </div>

      {/* Step 1: Select Supplier */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">1. Select Supplier</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 items-end">
            <div className="space-y-2 flex-1">
              <Label>Supplier</Label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={selectedSupplier}
                onChange={(e) => setSelectedSupplier(e.target.value)}
              >
                <option value="">Select a supplier...</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.companyName || s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2 w-48">
              <Label>Coverage (months)</Label>
              <Input
                type="number"
                min={1}
                max={6}
                value={targetMonths}
                onChange={(e) => setTargetMonths(parseInt(e.target.value) || 2)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step 2: Review Suggestions */}
      {suggestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              2. Review & Adjust Quantities
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left">
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Product</th>
                    <th className="p-3 font-medium text-right">Stock</th>
                    <th className="p-3 font-medium text-right">In Transit</th>
                    <th className="p-3 font-medium text-right">3M Avg</th>
                    <th className="p-3 font-medium text-right">Days OOS</th>
                    <th className="p-3 font-medium text-right">Suggested</th>
                    <th className="p-3 font-medium text-right">Order Qty</th>
                    <th className="p-3 font-medium text-right">Unit Cost</th>
                    <th className="p-3 font-medium text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map((s) => {
                    const qty = quantities[s.productId] || 0;
                    const lineTotal = qty * s.unitCost;
                    return (
                      <tr key={s.productId} className="border-b">
                        <td className="p-3">
                          <Badge className={statusColors[s.stockStatus] || ""}>
                            {s.stockStatus}
                          </Badge>
                        </td>
                        <td className="p-3">
                          <div className="font-medium">{s.name}</div>
                          <div className="text-xs text-gray-400">
                            {s.sellerSku || s.sku}
                            {s.promoUplift > 0 && (
                              <span className="text-orange-500 ml-2">
                                +{s.promoUplift} promo
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-right">
                          {s.currentStock.toLocaleString()}
                        </td>
                        <td className="p-3 text-right text-purple-600">
                          {s.inTransitQty > 0 ? s.inTransitQty : "-"}
                        </td>
                        <td className="p-3 text-right">
                          {s.adjustedForecast}/mo
                        </td>
                        <td className="p-3 text-right">
                          <span
                            className={
                              s.daysToOOS !== null && s.daysToOOS <= 7
                                ? "text-red-600 font-bold"
                                : ""
                            }
                          >
                            {s.daysToOOS ?? "∞"}
                          </span>
                        </td>
                        <td className="p-3 text-right text-gray-400">
                          {s.suggestedQty.toLocaleString()}
                        </td>
                        <td className="p-3 text-right">
                          <Input
                            type="number"
                            className="w-24 text-right"
                            min={0}
                            step={s.unitsPerCarton}
                            value={qty}
                            onChange={(e) =>
                              updateQuantity(
                                s.productId,
                                parseInt(e.target.value) || 0
                              )
                            }
                          />
                        </td>
                        <td className="p-3 text-right">
                          {currency} {s.unitCost.toFixed(2)}
                        </td>
                        <td className="p-3 text-right font-medium">
                          {qty > 0
                            ? `${currency} ${lineTotal.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`
                            : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 font-medium">
                    <td colSpan={7} className="p-3 text-right">
                      Total ({activeItems.length} items)
                    </td>
                    <td className="p-3 text-right">
                      {activeItems.reduce(
                        (sum, s) => sum + (quantities[s.productId] || 0),
                        0
                      ).toLocaleString()}
                    </td>
                    <td className="p-3"></td>
                    <td className="p-3 text-right">
                      {currency}{" "}
                      {liveTotalAmount.toLocaleString("en-MY", {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Container & Terms */}
      {suggestions.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Container Recommendation */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                3. Container & Shipping
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {containerRec && (
                <div
                  className={`p-4 rounded-lg border ${
                    containerRec.fits
                      ? "bg-green-50 border-green-200"
                      : "bg-amber-50 border-amber-200"
                  }`}
                >
                  <div className="font-medium mb-1">
                    Recommended: {containerRec.recommendedType}
                  </div>
                  <div className="text-sm text-gray-600">
                    {containerRec.details}
                  </div>
                  <div className="mt-2 text-xs text-gray-500 space-y-1">
                    <div>Weight: {liveTotalWeight.toFixed(1)} kg</div>
                    <div>Volume: {liveTotalVolume.toFixed(4)} CBM</div>
                    {containerRec.weightUtilization > 0 && (
                      <>
                        <div>
                          Weight util: {containerRec.weightUtilization}%
                        </div>
                        <div>
                          Volume util: {containerRec.volumeUtilization}%
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Container Type</Label>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm"
                  value={containerType}
                  onChange={(e) => setContainerType(e.target.value)}
                >
                  <option value="">Select...</option>
                  <option value="20FT">20ft Container</option>
                  <option value="40FT">40ft Container</option>
                  <option value="LCL">LCL</option>
                </select>
              </div>
            </CardContent>
          </Card>

          {/* Payment Terms */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Payment Terms</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <select
                    className="w-full border rounded-md px-3 py-2 text-sm"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                  >
                    <option value="RMB">RMB</option>
                    <option value="USD">USD</option>
                    <option value="RM">RM (MYR)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Deposit %</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={depositPercent}
                    onChange={(e) => setDepositPercent(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Balance Due (days after ETA)</Label>
                <Input
                  type="number"
                  min={0}
                  value={balanceDueDays}
                  onChange={(e) => setBalanceDueDays(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional notes for this PO..."
                  rows={3}
                />
              </div>

              {/* Summary */}
              <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Total Amount</span>
                  <span className="font-bold">
                    {currency}{" "}
                    {liveTotalAmount.toLocaleString("en-MY", {
                      minimumFractionDigits: 2,
                    })}
                  </span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Deposit ({depositPercent}%)</span>
                  <span>
                    {currency}{" "}
                    {(
                      liveTotalAmount *
                      (parseFloat(depositPercent) / 100)
                    ).toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Balance (due {balanceDueDays}d after ETA)</span>
                  <span>
                    {currency}{" "}
                    {(
                      liveTotalAmount *
                      (1 - parseFloat(depositPercent) / 100)
                    ).toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Create Button */}
      {suggestions.length > 0 && (
        <div className="flex gap-3">
          <Button
            size="lg"
            onClick={handleCreate}
            disabled={creating || activeItems.length === 0}
          >
            {creating ? "Creating PO..." : `Create PO (${activeItems.length} items)`}
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => router.push("/purchase-orders")}
          >
            Cancel
          </Button>
        </div>
      )}

      {loadingSuggestions && (
        <div className="text-center py-8 text-gray-500">
          Calculating demand forecasts and suggestions...
        </div>
      )}
    </div>
  );
}
