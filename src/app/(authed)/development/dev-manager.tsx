"use client";

import { useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createDevItem, updateDevItem, deleteDevItem } from "./actions";
import {
  DEV_STATUS_LABELS,
  DEV_STATUS_BADGE,
  DEV_STATUS_ORDER,
} from "./constants";

type Product = {
  id: string;
  sku: string;
  name: string;
  product_family: string | null;
  variation: string | null;
};

export type DevItem = {
  id: string;
  name: string;
  product_family: string | null;
  variation: string | null;
  planned_launch_date: string | null;
  status: string;
  linked_product_id: string | null;
  notes: string | null;
  products?: Product | null;
};

function productLabel(p: Product | null | undefined) {
  if (!p) return "—";
  const parts = [p.product_family, p.variation].filter(Boolean);
  const label = parts.length > 0 ? parts.join(" · ") : p.name;
  return `${label} (${p.sku})`;
}

// Format a YYYY-MM-DD DATE as e.g. "12 Aug 2026". Uses UTC to avoid TZ shift of
// a bare calendar date.
function formatDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00Z");
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-block text-xs font-medium px-2 py-0.5 rounded-full",
        DEV_STATUS_BADGE[status] ?? "bg-gray-100 text-gray-500 border border-gray-200"
      )}
    >
      {DEV_STATUS_LABELS[status] ?? status}
    </span>
  );
}

const inputCls =
  "border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";

function ItemFields({
  item,
  products,
}: {
  item?: DevItem;
  products: Product[];
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <div className="flex flex-col">
        <label className="text-[10px] text-gray-500 mb-1">Name *</label>
        <input
          name="name"
          required
          defaultValue={item?.name ?? ""}
          placeholder="Product / project name"
          className={inputCls}
        />
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] text-gray-500 mb-1">Range / family</label>
        <input
          name="product_family"
          defaultValue={item?.product_family ?? ""}
          className={inputCls}
        />
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] text-gray-500 mb-1">Variation</label>
        <input
          name="variation"
          defaultValue={item?.variation ?? ""}
          className={inputCls}
        />
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] text-gray-500 mb-1">Planned launch</label>
        <input
          type="date"
          name="planned_launch_date"
          defaultValue={item?.planned_launch_date ?? ""}
          className={inputCls}
        />
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] text-gray-500 mb-1">Status</label>
        <select
          name="status"
          defaultValue={item?.status ?? "PLANNED"}
          className={inputCls}
        >
          {DEV_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {DEV_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] text-gray-500 mb-1">
          Link to launched product
        </label>
        <select
          name="linked_product_id"
          defaultValue={item?.linked_product_id ?? ""}
          className={inputCls}
        >
          <option value="">— none —</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {productLabel(p)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col sm:col-span-2 lg:col-span-3">
        <label className="text-[10px] text-gray-500 mb-1">Notes</label>
        <textarea
          name="notes"
          rows={2}
          defaultValue={item?.notes ?? ""}
          className={inputCls}
        />
      </div>
    </div>
  );
}

function AddForm({ products }: { products: Product[] }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    startTransition(async () => {
      const res = await createDevItem(fd);
      if (res.ok) {
        setMsg({ ok: true, text: "Item added" });
        form.reset();
        setOpen(false);
      } else {
        setMsg({ ok: false, text: res.error ?? "Failed to add" });
      }
    });
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={() => setOpen(true)}>
          + Add item
        </Button>
        {msg && (
          <span className={cn("text-xs", msg.ok ? "text-emerald-600" : "text-red-600")}>
            {msg.text}
          </span>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            New development item
          </div>
          <ItemFields products={products} />
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Saving…" : "Save item"}
            </Button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-gray-500 hover:underline"
            >
              Cancel
            </button>
            {msg && (
              <span
                className={cn("text-xs", msg.ok ? "text-emerald-600" : "text-red-600")}
              >
                {msg.text}
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ItemRow({
  item,
  products,
}: {
  item: DevItem;
  products: Product[];
}) {
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateDevItem(item.id, fd);
      if (res.ok) {
        setEditing(false);
      } else {
        setMsg({ ok: false, text: res.error ?? "Failed to save" });
      }
    });
  }

  function handleDelete() {
    if (!confirm(`Delete "${item.name}"?`)) return;
    startTransition(async () => {
      await deleteDevItem(item.id);
    });
  }

  if (editing) {
    return (
      <tr className="border-b border-gray-100 bg-gray-50/60">
        <td colSpan={7} className="p-3">
          <form onSubmit={handleSave} className="space-y-3">
            <ItemFields item={item} products={products} />
            <div className="flex items-center gap-3">
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? "Saving…" : "Save"}
              </Button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-xs text-gray-500 hover:underline"
              >
                Cancel
              </button>
              {msg && (
                <span
                  className={cn(
                    "text-xs",
                    msg.ok ? "text-emerald-600" : "text-red-600"
                  )}
                >
                  {msg.text}
                </span>
              )}
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-gray-50 last:border-0 align-top">
      <td className="py-2 pl-3 pr-2">
        <div className="text-gray-900 font-medium">{item.name}</div>
      </td>
      <td className="py-2 px-2 text-gray-600">{item.product_family || "—"}</td>
      <td className="py-2 px-2 text-gray-600">{item.variation || "—"}</td>
      <td className="py-2 px-2 text-gray-600 whitespace-nowrap">
        {formatDate(item.planned_launch_date)}
      </td>
      <td className="py-2 px-2">
        <StatusBadge status={item.status} />
      </td>
      <td className="py-2 px-2 text-gray-600">
        {item.linked_product_id ? productLabel(item.products) : "—"}
      </td>
      <td className="py-2 px-2">
        <div className="text-gray-600 max-w-xs whitespace-pre-wrap">
          {item.notes || "—"}
        </div>
      </td>
      <td className="py-2 pr-3 pl-2 text-right whitespace-nowrap">
        <button
          onClick={() => setEditing(true)}
          disabled={isPending}
          className="text-xs text-blue-600 hover:underline disabled:opacity-50 mr-3"
        >
          Edit
        </button>
        <button
          onClick={handleDelete}
          disabled={isPending}
          className="text-xs text-red-600 hover:underline disabled:opacity-50"
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

export function DevManager({
  items,
  products,
}: {
  items: DevItem[];
  products: Product[];
}) {
  return (
    <div className="space-y-4">
      <AddForm products={products} />

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-gray-400">
            No development items yet. Add the first upcoming launch above.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50/60">
                  <th className="py-2 pl-3 pr-2 font-medium">Name</th>
                  <th className="py-2 px-2 font-medium">Range</th>
                  <th className="py-2 px-2 font-medium">Variation</th>
                  <th className="py-2 px-2 font-medium">Planned launch</th>
                  <th className="py-2 px-2 font-medium">Status</th>
                  <th className="py-2 px-2 font-medium">Linked product</th>
                  <th className="py-2 px-2 font-medium">Notes</th>
                  <th className="py-2 pr-3 pl-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <ItemRow key={item.id} item={item} products={products} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
