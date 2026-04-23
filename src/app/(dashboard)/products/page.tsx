"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
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
import { formatCurrency } from "@/lib/constants";

type Product = {
  id: string;
  sku: string;
  sellerSku: string | null;
  barcode: string | null;
  name: string;
  categoryId: string;
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
  supplier: { id: string; name: string; companyName: string | null };
};

type Category = { id: string; name: string; _count: { products: number } };
type Supplier = { id: string; name: string; companyName: string | null };

const emptyForm = {
  sku: "",
  sellerSku: "",
  barcode: "",
  name: "",
  categoryId: "",
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
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterSupplier, setFilterSupplier] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadData() {
    const [prodRes, catRes, supRes] = await Promise.all([
      fetch(`/api/products?search=${search}&categoryId=${filterCategory}&supplierId=${filterSupplier}`),
      fetch("/api/categories"),
      fetch("/api/suppliers"),
    ]);
    if (prodRes.ok) setProducts(await prodRes.json());
    if (catRes.ok) setCategories(await catRes.json());
    if (supRes.ok) setSuppliers(await supRes.json());
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, [search, filterCategory, filterSupplier]);

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
      categoryId: p.categoryId,
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
      categoryId: form.categoryId,
      supplierId: form.supplierId,
      unitCost: parseFloat(form.unitCost),
      sellingPrice: form.sellingPrice ? parseFloat(form.sellingPrice) : null,
      weightPerUnit: parseFloat(form.weightPerUnit),
      volumePerUnit: parseFloat(form.volumePerUnit),
      unitsPerCarton: parseInt(form.unitsPerCarton),
      minOrderQty: parseInt(form.minOrderQty),
      reorderPoint: parseInt(form.reorderPoint),
      targetTurnover: form.targetTurnover
        ? parseFloat(form.targetTurnover)
        : null,
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Products</h1>
          <p className="text-sm text-gray-500">
            {products.length} products in catalog
          </p>
        </div>
        {isAdmin && <Button onClick={openCreate}>Add Product</Button>}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Input
          placeholder="Search SKU, seller SKU, barcode, or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72"
        />
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
      </div>

      {/* Products Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-gray-500">Loading...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left">
                    <th className="p-3 font-medium">Seller SKU</th>
                    <th className="p-3 font-medium">SKU</th>
                    <th className="p-3 font-medium">Product Name</th>
                    <th className="p-3 font-medium">Category</th>
                    <th className="p-3 font-medium">Supplier</th>
                    <th className="p-3 font-medium text-right">Cost</th>
                    <th className="p-3 font-medium text-right">Price</th>
                    <th className="p-3 font-medium text-right">Stock</th>
                    <th className="p-3 font-medium text-right">Turnover Target</th>
                    {isAdmin && <th className="p-3 font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id} className="border-b hover:bg-gray-50">
                      <td className="p-3 font-mono text-xs">
                        {p.sellerSku || "-"}
                      </td>
                      <td className="p-3 font-mono text-xs">{p.sku}</td>
                      <td className="p-3">
                        <div>{p.name}</div>
                        {p.barcode && (
                          <div className="text-xs text-gray-400">
                            BC: {p.barcode}
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        <Badge variant="secondary">{p.category.name}</Badge>
                      </td>
                      <td className="p-3 text-gray-500">
                        {p.supplier.companyName || p.supplier.name}
                      </td>
                      <td className="p-3 text-right">
                        {formatCurrency(p.unitCost)}
                      </td>
                      <td className="p-3 text-right">
                        {p.sellingPrice
                          ? formatCurrency(p.sellingPrice)
                          : "-"}
                      </td>
                      <td className="p-3 text-right">
                        <span
                          className={
                            p.currentStock <= p.reorderPoint
                              ? "text-red-600 font-medium"
                              : ""
                          }
                        >
                          {p.currentStock.toLocaleString()}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        {p.targetTurnover
                          ? `${p.targetTurnover}x/yr`
                          : "-"}
                      </td>
                      {isAdmin && (
                        <td className="p-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(p)}
                          >
                            Edit
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {products.length === 0 && (
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
                <Label>Seller SKU</Label>
                <Input
                  value={form.sellerSku}
                  onChange={(e) =>
                    setForm({ ...form, sellerSku: e.target.value })
                  }
                  placeholder="BC-PF-CAN-TUNA-85G"
                />
              </div>
              <div className="space-y-2">
                <Label>SKU *</Label>
                <Input
                  value={form.sku}
                  onChange={(e) =>
                    setForm({ ...form, sku: e.target.value })
                  }
                  required
                  disabled={!!editingProduct}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Barcode</Label>
              <Input
                value={form.barcode}
                onChange={(e) =>
                  setForm({ ...form, barcode: e.target.value })
                }
                placeholder="8851234560001"
              />
            </div>

            <div className="space-y-2">
              <Label>Product Name *</Label>
              <Input
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value })
                }
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Category *</Label>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm"
                  value={form.categoryId}
                  onChange={(e) =>
                    setForm({ ...form, categoryId: e.target.value })
                  }
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
                  onChange={(e) =>
                    setForm({ ...form, supplierId: e.target.value })
                  }
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
                <Label>Unit Cost (RM) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.unitCost}
                  onChange={(e) =>
                    setForm({ ...form, unitCost: e.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Selling Price (RM)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.sellingPrice}
                  onChange={(e) =>
                    setForm({ ...form, sellingPrice: e.target.value })
                  }
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
                  onChange={(e) =>
                    setForm({ ...form, weightPerUnit: e.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Volume/Unit (CBM) *</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={form.volumePerUnit}
                  onChange={(e) =>
                    setForm({ ...form, volumePerUnit: e.target.value })
                  }
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
                  onChange={(e) =>
                    setForm({ ...form, unitsPerCarton: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Min Order Qty</Label>
                <Input
                  type="number"
                  value={form.minOrderQty}
                  onChange={(e) =>
                    setForm({ ...form, minOrderQty: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Reorder Point</Label>
                <Input
                  type="number"
                  value={form.reorderPoint}
                  onChange={(e) =>
                    setForm({ ...form, reorderPoint: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Target Turnover (x/year)</Label>
              <Input
                type="number"
                step="0.1"
                value={form.targetTurnover}
                onChange={(e) =>
                  setForm({ ...form, targetTurnover: e.target.value })
                }
                placeholder="Leave blank to use category default"
              />
            </div>

            <div className="flex gap-2 pt-4">
              <Button type="submit" disabled={saving}>
                {saving
                  ? "Saving..."
                  : editingProduct
                  ? "Update"
                  : "Create"}
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
