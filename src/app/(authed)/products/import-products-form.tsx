"use client";

import { useRef, useState } from "react";
import { importProducts, type ImportProductsResult } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ImportProductsForm() {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportProductsResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setResult({ ok: false, error: "Choose a .xlsx, .xls, or .csv file to upload" });
      return;
    }

    const fd = new FormData();
    fd.set("file", file);

    setUploading(true);
    setResult(null);
    const res = await importProducts(fd);
    setUploading(false);
    setResult(res);
    if (res.ok && fileRef.current) fileRef.current.value = "";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk upload products (Excel/CSV)</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-gray-500">
            Upload an inventory export (e.g. &quot;Commodity code&quot; + &quot;Product
            name&quot;) to register any SKUs not yet tracked. Existing SKUs are left
            untouched — only missing ones are added.
          </p>
          <div className="flex flex-wrap items-end gap-3">
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
                  Inserted {result.inserted} new product{result.inserted === 1 ? "" : "s"}
                  {result.skippedExisting ? `, skipped ${result.skippedExisting} existing` : ""}.
                </p>
                {result.errors && result.errors.length > 0 && (
                  <div className="border border-amber-200 bg-amber-50 rounded-md p-3">
                    <p className="font-medium text-amber-800">Errors:</p>
                    <ul className="mt-1 space-y-0.5 text-amber-700">
                      {result.errors.map((err, i) => (
                        <li key={i}>{err}</li>
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
