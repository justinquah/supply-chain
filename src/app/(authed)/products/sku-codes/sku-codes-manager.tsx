"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSkuMapping, updateSkuMapping, deleteSkuMapping } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Product = {
  id: string;
  sku: string;
  name: string | null;
  product_family: string | null;
  is_active: boolean;
};

type Mapping = {
  id: string;
  variant_sku: string;
  variant_name: string | null;
  main_product_id: string;
  units_per_variant: number;
  notes: string | null;
  // Supabase embeds the joined main product either as an object or a 1-element array
  // depending on the relationship inference — normalize with an `any` cast (codebase pattern).
  products: { sku: string; name: string | null } | { sku: string; name: string | null }[] | null;
};

// units_per_variant is stored to full precision but shown compactly.
function fmtFactor(n: number): string {
  if (!Number.isFinite(n)) return "—";
  // Trim trailing zeros; show up to 4 dp for fractional factors.
  return String(Number(n.toFixed(4)));
}

// Plain-language ratio for a stored factor.
//   factor >= 1 → "1 of this = N main"
//   factor  < 1 → "M of this = 1 main"  (M = round(1/factor))
function ratioText(factor: number): string {
  if (!Number.isFinite(factor) || factor <= 0) return "—";
  if (factor >= 1) {
    return `1 of this = ${fmtFactor(factor)} main`;
  }
  const per = Math.round(1 / factor);
  return `${per} of this = 1 main`;
}

function mainOf(m: Mapping): { sku: string; name: string | null } | null {
  const p = m.products as any;
  if (!p) return null;
  return Array.isArray(p) ? (p[0] ?? null) : p;
}

function productLabel(p: Product): string {
  return `${p.sku} — ${p.name || p.product_family || "Unnamed"}`;
}

export function SkuCodesManager({
  products,
  mappings,
}: {
  products: Product[];
  mappings: Mapping[];
}) {
  const router = useRouter();

  const productById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of products) map.set(p.id, p);
    return map;
  }, [products]);

  // Group mappings by their main product for display.
  const grouped = useMemo(() => {
    const groups = new Map<string, { main: Product | null; rows: Mapping[] }>();
    for (const m of mappings) {
      const key = m.main_product_id;
      if (!groups.has(key)) {
        groups.set(key, { main: productById.get(key) ?? null, rows: [] });
      }
      groups.get(key)!.rows.push(m);
    }
    return [...groups.entries()].sort((a, b) => {
      const sa = a[1].main?.sku || "";
      const sb = b[1].main?.sku || "";
      return sa.localeCompare(sb);
    });
  }, [mappings, productById]);

  return (
    <div className="space-y-6">
      <AddSkuCodeForm products={products} onSaved={() => router.refresh()} />

      {grouped.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-gray-500">
            No SKU codes mapped yet. Add one above to start converting file codes into
            main-SKU units on import.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(([mainId, group]) => {
            const main = group.main;
            const fallbackMain = mainOf(group.rows[0]);
            const mainSku = main?.sku || fallbackMain?.sku || "(unknown product)";
            const mainName = main?.name || fallbackMain?.name || "";
            return (
              <Card key={mainId}>
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60 rounded-t-lg">
                  <div className="font-semibold text-gray-900">{mainSku}</div>
                  <div className="text-xs text-gray-500">{mainName || "—"}</div>
                </div>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 border-b border-gray-100">
                        <th className="py-2 pl-4 pr-3 font-medium">SKU code</th>
                        <th className="py-2 px-3 font-medium text-right">Factor</th>
                        <th className="py-2 px-3 font-medium">Ratio</th>
                        <th className="py-2 pr-4 pl-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((m) => (
                        <SkuCodeRow
                          key={m.id}
                          mapping={m}
                          products={products}
                          onChanged={() => router.refresh()}
                        />
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

const inputClass = "border border-gray-300 rounded-md px-2 py-1.5 bg-white";

function AddSkuCodeForm({
  products,
  onSaved,
}: {
  products: Product[];
  onSaved: () => void;
}) {
  const [mainProductId, setMainProductId] = useState("");
  const [variantSku, setVariantSku] = useState("");
  const [x, setX] = useState("1"); // this many of the code
  const [y, setY] = useState("1"); // equal this many main units
  const [variantName, setVariantName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const xNum = Number(x);
  const yNum = Number(y);
  const factor =
    Number.isFinite(xNum) && Number.isFinite(yNum) && xNum > 0 ? yNum / xNum : NaN;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const res = await createSkuMapping({
      variant_sku: variantSku,
      main_product_id: mainProductId,
      units_per_variant: factor,
      variant_name: variantName || null,
      notes: notes || null,
    });
    setSaving(false);
    if (res.ok) {
      setMsg({ ok: true, text: `Mapped ${variantSku.trim().toUpperCase()}` });
      setVariantSku("");
      setX("1");
      setY("1");
      setVariantName("");
      setNotes("");
      onSaved();
    } else {
      setMsg({ ok: false, text: res.error ?? "Failed to add SKU code" });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add SKU code</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">Main product *</span>
              <select
                required
                value={mainProductId}
                onChange={(e) => setMainProductId(e.target.value)}
                className={inputClass}
              >
                <option value="">Select a main product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {productLabel(p)}
                    {!p.is_active ? " (inactive)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">SKU code (from your files) *</span>
              <input
                required
                value={variantSku}
                onChange={(e) => setVariantSku(e.target.value)}
                placeholder="e.g. CATLITTER-70G"
                className={inputClass + " uppercase"}
              />
            </label>
          </div>

          <div className="rounded-md border border-gray-200 bg-gray-50/60 p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
              <input
                type="number"
                step="any"
                min="0"
                required
                value={x}
                onChange={(e) => setX(e.target.value)}
                className={inputClass + " w-20 tabular-nums"}
                aria-label="Quantity of this code"
              />
              <span>of this code</span>
              <span className="font-semibold">=</span>
              <input
                type="number"
                step="any"
                min="0"
                required
                value={y}
                onChange={(e) => setY(e.target.value)}
                className={inputClass + " w-20 tabular-nums"}
                aria-label="Equivalent main units"
              />
              <span>main unit{yNum === 1 ? "" : "s"}</span>
              <span className="ml-2 text-gray-500">
                {Number.isFinite(factor) && factor > 0
                  ? `→ factor ${fmtFactor(factor)}`
                  : "→ enter a valid ratio"}
              </span>
            </div>
            <p className="mt-2 text-xs text-gray-400">
              The factor is stored as Y ÷ X — how many main-SKU units one of this code equals.
              It may be fractional (e.g. a single 70g piece = 1/6 of a 70g×6 pack → factor 0.1667).
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">Variant name (optional)</span>
              <input
                value={variantName}
                onChange={(e) => setVariantName(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">Notes (optional)</span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add SKU code"}
            </Button>
            {msg && (
              <span className={"text-sm " + (msg.ok ? "text-emerald-600" : "text-red-600")}>
                {msg.text}
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SkuCodeRow({
  mapping,
  products,
  onChanged,
}: {
  mapping: Mapping;
  products: Product[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit state — seed the ratio as [1] of this = [factor] main.
  const [mainProductId, setMainProductId] = useState(mapping.main_product_id);
  const [variantSku, setVariantSku] = useState(mapping.variant_sku);
  const [x, setX] = useState("1");
  const [y, setY] = useState(String(mapping.units_per_variant));
  const [variantName, setVariantName] = useState(mapping.variant_name ?? "");
  const [notes, setNotes] = useState(mapping.notes ?? "");

  const xNum = Number(x);
  const yNum = Number(y);
  const factor =
    Number.isFinite(xNum) && Number.isFinite(yNum) && xNum > 0 ? yNum / xNum : NaN;

  function resetEdit() {
    setMainProductId(mapping.main_product_id);
    setVariantSku(mapping.variant_sku);
    setX("1");
    setY(String(mapping.units_per_variant));
    setVariantName(mapping.variant_name ?? "");
    setNotes(mapping.notes ?? "");
    setError(null);
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    const res = await updateSkuMapping({
      id: mapping.id,
      variant_sku: variantSku,
      main_product_id: mainProductId,
      units_per_variant: factor,
      variant_name: variantName || null,
      notes: notes || null,
    });
    setBusy(false);
    if (res.ok) {
      setEditing(false);
      onChanged();
    } else {
      setError(res.error ?? "Failed to save");
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete SKU code "${mapping.variant_sku}"?`)) return;
    setBusy(true);
    setError(null);
    const res = await deleteSkuMapping(mapping.id);
    setBusy(false);
    if (res.ok) {
      onChanged();
    } else {
      setError(res.error ?? "Failed to delete");
    }
  }

  if (editing) {
    return (
      <tr className="border-b border-gray-50 last:border-0 align-top">
        <td colSpan={4} className="py-3 px-4">
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-gray-600">Main product</span>
                <select
                  value={mainProductId}
                  onChange={(e) => setMainProductId(e.target.value)}
                  className={inputClass}
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {productLabel(p)}
                      {!p.is_active ? " (inactive)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-gray-600">SKU code</span>
                <input
                  value={variantSku}
                  onChange={(e) => setVariantSku(e.target.value)}
                  className={inputClass + " uppercase"}
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
              <input
                type="number"
                step="any"
                min="0"
                value={x}
                onChange={(e) => setX(e.target.value)}
                className={inputClass + " w-20 tabular-nums"}
                aria-label="Quantity of this code"
              />
              <span>of this code</span>
              <span className="font-semibold">=</span>
              <input
                type="number"
                step="any"
                min="0"
                value={y}
                onChange={(e) => setY(e.target.value)}
                className={inputClass + " w-20 tabular-nums"}
                aria-label="Equivalent main units"
              />
              <span>main unit{yNum === 1 ? "" : "s"}</span>
              <span className="ml-2 text-gray-500">
                {Number.isFinite(factor) && factor > 0
                  ? `→ factor ${fmtFactor(factor)}`
                  : "→ enter a valid ratio"}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-gray-600">Variant name (optional)</span>
                <input
                  value={variantName}
                  onChange={(e) => setVariantName(e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-gray-600">Notes (optional)</span>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className={inputClass}
                />
              </label>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSave} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  resetEdit();
                  setEditing(false);
                }}
                disabled={busy}
              >
                Cancel
              </Button>
              {error && <span className="text-sm text-red-600">{error}</span>}
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-gray-50 last:border-0">
      <td className="py-2 pl-4 pr-3">
        <span className="text-gray-900 font-mono text-xs">{mapping.variant_sku}</span>
        {mapping.variant_name && (
          <div className="text-xs text-gray-400">{mapping.variant_name}</div>
        )}
      </td>
      <td className="py-2 px-3 text-right tabular-nums text-gray-700">
        {fmtFactor(mapping.units_per_variant)}
      </td>
      <td className="py-2 px-3 text-gray-500 text-xs">{ratioText(mapping.units_per_variant)}</td>
      <td className="py-2 pr-4 pl-3">
        <div className="flex items-center justify-end gap-2">
          <Button size="xs" variant="outline" onClick={() => setEditing(true)} disabled={busy}>
            Edit
          </Button>
          <Button size="xs" variant="outline" onClick={handleDelete} disabled={busy}>
            Delete
          </Button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      </td>
    </tr>
  );
}
