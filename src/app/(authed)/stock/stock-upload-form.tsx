"use client";

import { useRef, useState } from "react";
import { importStock, type ImportStockResult } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Today's date in Asia/Kuala_Lumpur as YYYY-MM-DD, for the default snapshot date.
function todayKL(): string {
  const nowKL = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" })
  );
  const y = nowKL.getFullYear();
  const m = String(nowKL.getMonth() + 1).padStart(2, "0");
  const d = String(nowKL.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function StockUploadForm() {
  const [snapshotDate, setSnapshotDate] = useState(todayKL());
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportStockResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setResult({ ok: false, error: "Choose a .xlsx, .xls, or .csv file to upload" });
      return;
    }

    const fd = new FormData();
    fd.set("snapshotDate", snapshotDate);
    fd.set("file", file);

    setUploading(true);
    setResult(null);
    const res = await importStock(fd);
    setUploading(false);
    setResult(res);
    if (res.ok && fileRef.current) fileRef.current.value = "";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload stock (Excel/CSV)</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-gray-500">
            Expected columns: a SKU column (<code>sku</code>, <code>System Product Code</code>,
            or <code>Item Code</code>) and a quantity column (<code>quantity</code>,
            <code> qty</code>, or <code>stock</code>). Re-uploading the same snapshot
            date replaces its existing weekly-upload rows.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">Snapshot date</span>
              <input
                type="date"
                value={snapshotDate}
                onChange={(e) => setSnapshotDate(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 bg-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">File (.xlsx, .xls, .csv)</span>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-gray-100 file:text-gray-700 file:text-sm hover:file:bg-gray-200"
              />
            </label>
            <Button type="submit" disabled={uploading}>
              {uploading ? "Uploading..." : "Upload"}
            </Button>
          </div>
        </form>

        {result && (
          <div className="mt-4 text-sm">
            {result.ok ? (
              <div className="space-y-2">
                <p className="text-green-700">
                  Imported {result.imported} product{result.imported === 1 ? "" : "s"} (
                  {result.totalUnits?.toLocaleString("en-MY")} units) for snapshot date{" "}
                  {result.snapshotDate}.
                </p>
                {result.zeroFilled ? (
                  <p className="text-gray-600">
                    {result.zeroFilled} active product
                    {result.zeroFilled === 1 ? " was" : "s were"} not in the file and
                    recorded as <strong>0 (out of stock)</strong> for this week.
                  </p>
                ) : null}
                {result.unknownSkus && result.unknownSkus.length > 0 && (
                  <div className="border border-amber-200 bg-amber-50 rounded-md p-3">
                    <p className="font-medium text-amber-800">
                      Unknown SKUs ({result.unknownSkus.length}) — not imported,
                      need mapping:
                    </p>
                    <ul className="mt-1 space-y-0.5 text-amber-700">
                      {result.unknownSkus.map((u) => (
                        <li key={u.sku}>
                          {u.sku} — {u.qty.toLocaleString("en-MY")} units
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-red-600">Error: {result.error}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
