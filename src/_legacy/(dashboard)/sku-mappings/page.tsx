"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type Product = {
  id: string;
  sku: string;
  sellerSku: string | null;
  name: string;
};

type Component = {
  id?: string;
  productId: string;
  quantity: number;
  product?: { id: string; sku: string; name: string };
};

type Mapping = {
  id: string;
  marketplaceSku: string;
  description: string | null;
  source: string;
  isActive: boolean;
  components: Component[];
};

export default function SkuMappingsPage() {
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Mapping | null>(null);
  const [form, setForm] = useState<{
    marketplaceSku: string;
    description: string;
    components: { productId: string; quantity: string }[];
  }>({
    marketplaceSku: "",
    description: "",
    components: [{ productId: "", quantity: "1" }],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Test sku
  const [testSku, setTestSku] = useState("");
  const [testResult, setTestResult] = useState<any>(null);

  async function loadData() {
    const [mapRes, prodRes] = await Promise.all([
      fetch(`/api/sku-mappings?search=${search}`),
      fetch("/api/products"),
    ]);
    if (mapRes.ok) setMappings(await mapRes.json());
    if (prodRes.ok) setProducts(await prodRes.json());
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, [search]);

  function openCreate() {
    setEditing(null);
    setForm({
      marketplaceSku: "",
      description: "",
      components: [{ productId: "", quantity: "1" }],
    });
    setError("");
    setShowForm(true);
  }

  function openEdit(m: Mapping) {
    setEditing(m);
    setForm({
      marketplaceSku: m.marketplaceSku,
      description: m.description || "",
      components: m.components.map((c) => ({
        productId: c.productId,
        quantity: String(c.quantity),
      })),
    });
    setError("");
    setShowForm(true);
  }

  function addComponent() {
    setForm({
      ...form,
      components: [...form.components, { productId: "", quantity: "1" }],
    });
  }

  function removeComponent(idx: number) {
    setForm({
      ...form,
      components: form.components.filter((_, i) => i !== idx),
    });
  }

  function updateComponent(idx: number, field: "productId" | "quantity", value: string) {
    const components = [...form.components];
    components[idx] = { ...components[idx], [field]: value };
    setForm({ ...form, components });
  }

  async function handleSave() {
    setSaving(true);
    setError("");

    const validComponents = form.components.filter(
      (c) => c.productId && parseFloat(c.quantity) > 0
    );

    if (!form.marketplaceSku || validComponents.length === 0) {
      setError("Marketplace SKU and at least one component required");
      setSaving(false);
      return;
    }

    const url = editing
      ? `/api/sku-mappings/${editing.id}`
      : "/api/sku-mappings";
    const method = editing ? "PATCH" : "POST";

    const body: any = {
      marketplaceSku: form.marketplaceSku,
      description: form.description,
      components: validComponents.map((c) => ({
        productId: c.productId,
        quantity: parseFloat(c.quantity),
      })),
    };

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Failed to save");
    } else {
      setShowForm(false);
      loadData();
    }

    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this mapping?")) return;
    await fetch(`/api/sku-mappings/${id}`, { method: "DELETE" });
    loadData();
  }

  async function handleAutoSuggest() {
    if (!form.marketplaceSku) return;
    const res = await fetch("/api/sku-mappings/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ singleSku: form.marketplaceSku }),
    });
    const data = await res.json();
    if (data.suggestion) {
      setForm({
        ...form,
        components: data.suggestion.map((c: any) => ({
          productId: c.productId,
          quantity: String(c.units),
        })),
      });
    } else {
      setError("Could not auto-parse this SKU. Please add components manually.");
    }
  }

  async function handleTest() {
    if (!testSku) return;
    const res = await fetch("/api/sku-mappings/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ singleSku: testSku }),
    });
    const data = await res.json();
    setTestResult(data);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">SKU Mapping Rules</h1>
          <p className="text-sm text-gray-500">
            Map bundle/variant SKUs to base products so sales are recorded correctly
          </p>
        </div>
        <Button onClick={openCreate}>Add Mapping Rule</Button>
      </div>

      {/* Explainer */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">How this works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-gray-600 space-y-2">
          <p>Some marketplace SKUs are bundles or multi-packs. Use these rules to decompose them into base products:</p>
          <ul className="list-disc ml-5 space-y-1 text-xs">
            <li><code className="bg-gray-100 px-1">ABCX6</code> → 6× ABC (one bundle sold = 6 units of ABC)</li>
            <li><code className="bg-gray-100 px-1">ABC+CDE</code> → 1× ABC + 1× CDE (combo pack)</li>
            <li><code className="bg-gray-100 px-1">EFJ</code> → 12× OPQ (custom SKU name)</li>
          </ul>
          <p className="text-xs text-gray-500 mt-2">
            ✨ Patterns like "X6" or "+" can be auto-detected. Custom mappings must be defined manually.
          </p>
        </CardContent>
      </Card>

      {/* Quick Test */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Test a SKU</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 items-end">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Marketplace SKU</Label>
              <Input
                value={testSku}
                onChange={(e) => setTestSku(e.target.value)}
                placeholder="e.g. ABCX6, ABC+CDE, EFJ"
              />
            </div>
            <Button onClick={handleTest} variant="outline">Test</Button>
          </div>
          {testResult && (
            <div className="mt-3 p-3 rounded bg-gray-50 text-sm">
              <p className="font-medium">"{testResult.marketplaceSku}" →</p>
              {testResult.suggestion?.length > 0 ? (
                testResult.suggestion.map((c: any, i: number) => (
                  <p key={i} className="text-gray-700">
                    • {c.units}× {c.productSku} ({c.productName})
                  </p>
                ))
              ) : (
                <p className="text-red-600">No match - need to create mapping manually</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Search */}
      <Input
        placeholder="Search mappings..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-72"
      />

      {/* Mappings Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-gray-500">Loading...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left">
                    <th className="p-3 font-medium">Marketplace SKU</th>
                    <th className="p-3 font-medium">Decomposes To</th>
                    <th className="p-3 font-medium">Description</th>
                    <th className="p-3 font-medium">Source</th>
                    <th className="p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((m) => (
                    <tr key={m.id} className="border-b">
                      <td className="p-3 font-mono font-medium">
                        {m.marketplaceSku}
                      </td>
                      <td className="p-3">
                        {m.components.map((c) => (
                          <div key={c.product!.id} className="text-xs">
                            <span className="font-medium">{c.quantity}×</span>{" "}
                            <span className="text-gray-500">{c.product!.sku}</span>{" "}
                            <span className="text-gray-400">({c.product!.name})</span>
                          </div>
                        ))}
                      </td>
                      <td className="p-3 text-gray-500 text-xs">
                        {m.description || "-"}
                      </td>
                      <td className="p-3">
                        <Badge variant="secondary">{m.source}</Badge>
                      </td>
                      <td className="p-3 space-x-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(m)}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(m.id)}>
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {mappings.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-gray-500">
                        No mappings yet. Most SKUs will be matched directly to products - only add mappings for bundles/variants.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mapping Form Sheet */}
      <Sheet open={showForm} onOpenChange={setShowForm}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? "Edit Mapping" : "Add Mapping Rule"}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            {error && (
              <div className="bg-red-50 p-3 rounded text-sm text-red-600">{error}</div>
            )}

            <div className="space-y-2">
              <Label>Marketplace SKU *</Label>
              <div className="flex gap-2">
                <Input
                  value={form.marketplaceSku}
                  onChange={(e) => setForm({ ...form, marketplaceSku: e.target.value })}
                  placeholder="e.g. ABCX6, ABC+CDE, EFJ"
                  disabled={!!editing}
                />
                {!editing && (
                  <Button variant="outline" onClick={handleAutoSuggest} size="sm">
                    Auto-detect
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="e.g. 6-pack bundle"
              />
            </div>

            <div className="space-y-2">
              <Label>Base Product Components</Label>
              <div className="space-y-2">
                {form.components.map((c, idx) => (
                  <div key={idx} className="flex gap-2 items-start">
                    <div className="flex-1">
                      <select
                        className="w-full border rounded-md px-3 py-2 text-sm"
                        value={c.productId}
                        onChange={(e) => updateComponent(idx, "productId", e.target.value)}
                      >
                        <option value="">Select base product...</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.sku} - {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Input
                      type="number"
                      step="0.1"
                      className="w-20"
                      value={c.quantity}
                      onChange={(e) => updateComponent(idx, "quantity", e.target.value)}
                      placeholder="Qty"
                    />
                    {form.components.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeComponent(idx)}
                      >
                        ×
                      </Button>
                    )}
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addComponent}>
                  + Add Component
                </Button>
              </div>
              <p className="text-xs text-gray-500">
                Each row = one base product + quantity. E.g. for "ABCX6", select ABC with quantity 6.
              </p>
            </div>

            <div className="flex gap-2 pt-4">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : editing ? "Update" : "Create Mapping"}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
