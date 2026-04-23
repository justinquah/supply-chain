"use client";

import { useEffect, useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatCurrency } from "@/lib/constants";

type Product = {
  id: string;
  sku: string;
  sellerSku: string | null;
  barcode: string | null;
  name: string;
  brand: string | null;
  categoryId: string;
  seriesId: string | null;
  variationName: string | null;
  supplierId: string;
  unitCost: number;
  sellingPrice: number | null;
  weightPerUnit: number;
  volumePerUnit: number;
  unitsPerCarton: number;
  minOrderQty: number;
  currentStock: number;
  reorderPoint: number;
  targetTurnover: number | null;
  isActive: boolean;
  category: { id: string; name: string };
  series: { id: string; name: string; packSize: string | null } | null;
  supplier: { id: string; name: string; companyName: string | null };
};

type Category = { id: string; name: string; _count: { products: number } };
type Supplier = { id: string; name: string; companyName: string | null };
type Series = { id: string; name: string; packSize: string | null; _count: { products: number } };

const emptyForm = {
  sku: "",
  sellerSku: "",
  barcode: "",
  name: "",
  brand: "JJANGX3",
  categoryId: "",
  seriesId: "",
  variationName: "",
  supplierId: "",
  unitCost: "",
  sellingPrice: "",
  weightPerUnit: "",
  volumePerUnit: "",
  unitsPerCarton: "1",
  minOrderQty: "1",
  reorderPoint: "0",
  targetTurnover: "",
};

export default function ProductsPage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const isAdmin = user?.role === "ADMIN";

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterSupplier, setFilterSupplier] = useState("");
  const [filterSeries, setFilterSeries] = useState("");
  const [filterBrand, setFilterBrand] = useState("");
  const [groupBySeries, setGroupBySeries] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadData() {
    const [prodRes, catRes, supRes, seriesRes] = await Promise.all([
      fetch(`/api/products?search=${search}&categoryId=${filterCategory}&supplierId=${filterSupplier}`),
      fetch("/api/categories"),
      fetch("/api/suppliers"),
      fetch("/api/series"),
    ]);
    if (prodRes.ok) setProducts(await prodRes.json());
    if (catRes.ok) setCategories(await catRes.json());
    if (supRes.ok) setSuppliers(await supRes.json());
    if (seriesRes.ok) setSeries(await seriesRes.json());
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, [search, filterCategory, filterSupplier]);

  // Filter products client-side by series + brand
  const filteredProducts = useMemo(() => {
    let list = products;
    if (filterSeries) list = list.filter((p) => p.seriesId === filterSeries);
    if (filterBrand) list = list.filter((p) => p.brand === filterBrand);
    return list;
  }, [products, filterSeries, filterBrand]);

  // Group by series for display
  const grouped = useMemo(() => {
    if (!groupBySeries) return null;
    const groups = new Map<string, { seriesName: string; packSize: string | null; products: Product[] }>();
    const noSeriesGroup: Product[] = [];
    for (const p of filteredProducts) {
      if (p.series) {
        const key = p.seriesId!;
        if (!groups.has(key)) {
          groups.set(key, {
            seriesName: p.series.name,
            packSize: p.series.packSize,
            products: [],
          });
        }
        groups.get(key)!.products.push(p);
      } else {
        noSeriesGroup.push(p);
      }
    }
    const groupedArray = [...groups.entries()].sort((a, b) =>
      a[1].seriesName.localeCompare(b[1].seriesName)
    );
    if (noSeriesGroup.length > 0) {
      groupedArray.push([
        "__no_series__",
        {
          seriesName: "Ungrouped",
          packSize: null,
          products: noSeriesGroup,
        },
      ]);
    }
    return groupedArray;
  }, [filteredProducts, groupBySeries]);

  // Unique brands for filter
  const brands = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.brand) set.add(p.brand);
    return [...set].sort();
  }, [products]);

  function openCreate() {
    setEditingProduct(null);
    setForm(emptyForm);
    setError("");
    setShowForm(true);
  }

  function openEdit(p: Product) {
    setEditingProduct(p);
    setForm({
      sku: p.sku,
      sellerSku: p.sellerSku || "",
      barcode: p.barcode || "",
      name: p.name,
      brand: p.brand || "JJANGX3",
      categoryId: p.categoryId,
      seriesId: p.seriesId || "",
      variationName: p.variationName || "",
      supplierId: p.supplierId,
      unitCost: String(p.unitCost),
      sellingPrice: p.sellingPrice ? String(p.sellingPrice) : "",
      weightPerUnit: String(p.weightPerUnit),
      volumePerUnit: String(p.volumePerUnit),
      unitsPerCarton: String(p.unitsPerCarton),
      minOrderQty: String(p.minOrderQty),
      reorderPoint: String(p.reorderPoint),
      targetTurnover: p.targetTurnover ? String(p.targetTurnover) : "",
    });
    setError("");
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const body: any = {
      sku: form.sku,
      sellerSku: form.sellerSku || null,
      barcode: form.barcode || null,
      name: form.name,
      brand: form.brand || "JJANGX3",
      categoryId: form.categoryId,
      seriesId: form.seriesId || null,
      variationName: form.variationName || null,
      supplierId: form.supplierId,
      unitCost: parseFloat(form.unitCost),
      sellingPrice: form.sellingPrice ? parseFloat(form.sellingPrice) : null,
      weightPerUnit: parseFloat(form.weightPerUnit),
      volumePerUnit: parseFloat(form.volumePerUnit),
      unitsPerCarton: parseInt(form.unitsPerCarton),
      minOrderQty: parseInt(form.minOrderQty),
      reorderPoint: parseInt(form.reorderPoint),
      targetTurnover: form.targetTurnover ? parseFloat(form.targetTurnover) : null,
    };

    const url = editingProduct
      ? `/api/products/${editingProduct.id}`
      : "/api/products";
    const method = editingProduct ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Failed to save product");
      setSaving(false);
      return;
    }

    setShowForm(false);
    setSaving(false);
    loadData();
  }

  function renderProductRow(p: Product) {
    return (
      <tr key={p.id} className="border-b hover:bg-gray-50">
        <td className="p-3">
          <div className="font-medium">{p.variationName || p.name}</div>
          {!p.variationName && p.name && (
            <div className="text-xs text-gray-400">{p.name}</div>
          )}
        </td>
        <td className="p-3 font-mono text-xs">{p.sku}</td>
        <td className="p-3 font-mono text-xs text-gray-500">{p.barcode || "-"}</td>
        <td className="p-3">
          {p.brand && <Badge variant="secondary">{p.brand}</Badge>}
        </td>
        {!groupBySeries && (
          <td className="p-3 text-gray-500 text-xs">
            {p.series?.name || "-"}
          </td>
        )}
        <td className="p-3">
          <Badge variant="secondary">{p.category.name}</Badge>
        </td>
        <td className="p-3 text-right">{formatCurrency(p.unitCost)}</td>
        <td className="p-3 text-right">
          {p.sellingPrice ? formatCurrency(p.sellingPrice) : "-"}
        </td>
        <td className="p-3 text-right">
          <span
            className={
              p.currentStock <= p.reorderPoint ? "text-red-600 font-medium" : ""
            }
          >
            {p.currentStock.toLocaleString()}
          </span>
        </td>
        {isAdmin && (
          <td className="p-3">
            <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
              Edit
            </Button>
          </td>
        )}
      </tr>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Products</h1>
          <p className="text-sm text-gray-500">
            {filteredProducts.length} products
            {filterSeries || filterBrand || filterCategory ? ` (filtered from ${products.length})` : ""}
            {" "}• {series.length} series
          </p>
        </div>
        {isAdmin && <Button onClick={openCreate}>Add Product</Button>}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-end">
        <Input
          placeholder="Search SKU, seller SKU, barcode, or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72"
        />
        <select
          className="border rounded-md px-3 py-2 text-sm"
          value={filterSeries}
          onChange={(e) => setFilterSeries(e.target.value)}
        >
          <option value="">All Series</option>
          {series.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s._count.products})
            </option>
          ))}
        </select>
        <select
          className="border rounded-md px-3 py-2 text-sm"
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c._count.products})
            </option>
          ))}
        </select>
        {brands.length > 1 && (
          <select
            className="border rounded-md px-3 py-2 text-sm"
            value={filterBrand}
            onChange={(e) => setFilterBrand(e.target.value)}
          >
            <option value="">All Brands</option>
            {brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        )}
        {isAdmin && (
          <select
            className="border rounded-md px-3 py-2 text-sm"
            value={filterSupplier}
            onChange={(e) => setFilterSupplier(e.target.value)}
          >
            <option value="">All Suppliers</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.companyName || s.name}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-2 text-sm ml-auto">
          <input
            type="checkbox"
            checked={groupBySeries}
            onChange={(e) => setGroupBySeries(e.target.checked)}
          />
          Group by Series
        </label>
      </div>

      {/* Products Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-gray-500">Loading...</p>
          ) : groupBySeries && grouped ? (
            <div className="overflow-x-auto">
              {grouped.map(([key, group]) => (
                <div key={key}>
                  <div className="sticky top-0 z-10 bg-gray-100 border-b px-4 py-2 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-sm">
                        {group.seriesName}
                      </span>
                      {group.packSize && (
                        <span className="text-xs text-gray-500 ml-2">
                          {group.packSize}
                        </span>
                      )}
                    </div>
                    <Badge variant="secondary">
                      {group.products.length} variations
                    </Badge>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50 text-left">
                        <th className="p-3 font-medium">Variation</th>
                        <th className="p-3 font-medium">SKU</th>
                        <th className="p-3 font-medium">Barcode</th>
                        <th className="p-3 font-medium">Brand</th>
                        <th className="p-3 font-medium">Category</th>
                        <th className="p-3 font-medium text-right">Wholesale</th>
                        <th className="p-3 font-medium text-right">Retail</th>
                        <th className="p-3 font-medium text-right">Stock</th>
                        {isAdmin && <th className="p-3 font-medium">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {group.products.map((p) => renderProductRow(p))}
                    </tbody>
                  </table>
                </div>
              ))}
              {grouped.length === 0 && (
                <p className="p-6 text-center text-gray-500">
                  No products found
                </p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left">
                    <th className="p-3 font-medium">Product Name</th>
                    <th className="p-3 font-medium">SKU</th>
                    <th className="p-3 font-medium">Barcode</th>
                    <th className="p-3 font-medium">Brand</th>
                    <th className="p-3 font-medium">Series</th>
                    <th className="p-3 font-medium">Category</th>
                    <th className="p-3 font-medium text-right">Wholesale</th>
                    <th className="p-3 font-medium text-right">Retail</th>
                    <th className="p-3 font-medium text-right">Stock</th>
                    {isAdmin && <th className="p-3 font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((p) => renderProductRow(p))}
                  {filteredProducts.length === 0 && (
                    <tr>
                      <td
                        colSpan={isAdmin ? 10 : 9}
                        className="p-6 text-center text-gray-500"
                      >
                        No products found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Product Form Sheet */}
      <Sheet open={showForm} onOpenChange={setShowForm}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {editingProduct ? "Edit Product" : "Add Product"}
            </SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-6">
            {error && (
              <div className="bg-red-50 text-red-600 text-sm p-3 rounded-md border border-red-200">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>SKU (ERP Code) *</Label>
                <Input
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  placeholder="BC-PF-CAN-TUNA-400G"
                  required
                  disabled={!!editingProduct}
                />
              </div>
              <div className="space-y-2">
                <Label>Seller SKU</Label>
                <Input
                  value={form.sellerSku}
                  onChange={(e) => setForm({ ...form, sellerSku: e.target.value })}
                  placeholder="alt SKU (optional)"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Barcode</Label>
                <Input
                  value={form.barcode}
                  onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                  placeholder="9551010080793"
                />
              </div>
              <div className="space-y-2">
                <Label>Brand</Label>
                <Input
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                  placeholder="JJANGX3"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Full Product Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Series</Label>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm"
                  value={form.seriesId}
                  onChange={(e) => setForm({ ...form, seriesId: e.target.value })}
                >
                  <option value="">No series</option>
                  {series.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Variation Name</Label>
                <Input
                  value={form.variationName}
                  onChange={(e) => setForm({ ...form, variationName: e.target.value })}
                  placeholder="Fresh Tuna, Coffee, etc."
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Category *</Label>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm"
                  value={form.categoryId}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                  required
                >
                  <option value="">Select category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Supplier *</Label>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm"
                  value={form.supplierId}
                  onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                  required
                >
                  <option value="">Select supplier</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.companyName || s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Wholesale Price (RM) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.unitCost}
                  onChange={(e) => setForm({ ...form, unitCost: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Retail Price (RM)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.sellingPrice}
                  onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Weight/Unit (kg) *</Label>
                <Input
                  type="number"
                  step="0.001"
                  value={form.weightPerUnit}
                  onChange={(e) => setForm({ ...form, weightPerUnit: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Volume/Unit (CBM) *</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={form.volumePerUnit}
                  onChange={(e) => setForm({ ...form, volumePerUnit: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Units/Carton</Label>
                <Input
                  type="number"
                  value={form.unitsPerCarton}
                  onChange={(e) => setForm({ ...form, unitsPerCarton: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Min Order Qty</Label>
                <Input
                  type="number"
                  value={form.minOrderQty}
                  onChange={(e) => setForm({ ...form, minOrderQty: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Reorder Point</Label>
                <Input
                  type="number"
                  value={form.reorderPoint}
                  onChange={(e) => setForm({ ...form, reorderPoint: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Target Turnover (x/year)</Label>
              <Input
                type="number"
                step="0.1"
                value={form.targetTurnover}
                onChange={(e) => setForm({ ...form, targetTurnover: e.target.value })}
                placeholder="Leave blank for category default"
              />
            </div>

            <div className="flex gap-2 pt-4">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : editingProduct ? "Update" : "Create"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
