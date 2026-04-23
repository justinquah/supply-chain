"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function QianyiImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError("");
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/inventory/qianyi-import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) setResult(data);
      else setError(data.error || "Import failed");
    } catch (e: any) {
      setError(e.message || "Network error");
    }
    setUploading(false);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Import Inventory from Qianyi ERP</h1>
          <p className="text-sm text-gray-500">
            Upload Qianyi "Inventory Inquiry Export" to update current stock levels
          </p>
        </div>
        <Link href="/inventory">
          <Button variant="outline">Back to Inventory</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">What this does</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-gray-600 space-y-2">
          <p>Reads your Qianyi ERP "Inventory Inquiry Export" file and updates product stock levels.</p>
          <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs space-y-1">
            <p className="font-medium text-blue-700">Expected columns (from Qianyi export):</p>
            <ul className="list-disc ml-4 space-y-0.5">
              <li><code className="bg-white px-1">Commodity code</code> → matches to Product SKU</li>
              <li><code className="bg-white px-1">Available quantity</code> → updates currentStock</li>
              <li><code className="bg-white px-1">warehouse</code> → for reference (multi-warehouse auto-summed)</li>
            </ul>
          </div>
          <p className="text-xs text-gray-500">
            💡 The Qianyi file has section headers on row 1 (Product information, Inventory information, etc.) - the system auto-handles this format.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upload File</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Qianyi Export File (.xlsx)</Label>
            <Input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>

          <Button onClick={handleUpload} disabled={!file || uploading}>
            {uploading ? "Importing..." : "Import Inventory"}
          </Button>

          {error && (
            <div className="bg-red-50 p-4 rounded text-sm text-red-600">{error}</div>
          )}

          {result && (
            <div className="bg-green-50 p-4 rounded text-sm space-y-2">
              <p className="font-medium text-green-700">Import Complete!</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>Total rows: <span className="font-medium">{result.totalRows}</span></div>
                <div>Unique SKUs: <span className="font-medium">{result.uniqueSkus}</span></div>
                <div>Products updated: <span className="font-medium text-green-700">{result.productsUpdated}</span></div>
                <div>Not found: <span className="font-medium text-amber-700">{result.productsNotFound}</span></div>
              </div>

              {result.columnsDetected && (
                <div className="mt-2 text-xs text-gray-500">
                  <p className="font-medium">Columns detected:</p>
                  <ul className="list-disc ml-4">
                    {Object.entries(result.columnsDetected).map(([k, v]: any) => (
                      <li key={k}>{k}: <Badge variant="secondary" className="text-xs">{v}</Badge></li>
                    ))}
                  </ul>
                </div>
              )}

              {result.updates?.length > 0 && (
                <div className="mt-3 border-t pt-3 space-y-1">
                  <p className="font-medium text-sm">Stock Updates (showing 20):</p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left">
                        <th className="py-1">SKU</th>
                        <th className="py-1">Product</th>
                        <th className="py-1 text-right">Before</th>
                        <th className="py-1 text-right">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.updates.map((u: any) => (
                        <tr key={u.sku}>
                          <td className="py-0.5 font-mono">{u.sku}</td>
                          <td className="py-0.5 text-gray-500 truncate max-w-xs">{u.name}</td>
                          <td className="py-0.5 text-right">{u.oldStock}</td>
                          <td className="py-0.5 text-right font-medium">{u.newStock}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {result.notFoundSkus?.length > 0 && (
                <div className="mt-3 border-t pt-3">
                  <p className="font-medium text-sm text-amber-700">SKUs not found in app ({result.productsNotFound}):</p>
                  <p className="text-xs text-gray-500">Add these products first, or create SKU mapping rules:</p>
                  <div className="mt-1 max-h-40 overflow-y-auto text-xs font-mono">
                    {result.notFoundSkus.map((n: any) => (
                      <div key={n.sku} className="flex justify-between">
                        <span>{n.sku}</span>
                        <span className="text-gray-400">({n.qty} units)</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
