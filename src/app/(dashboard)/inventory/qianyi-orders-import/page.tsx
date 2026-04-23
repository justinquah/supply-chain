"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function QianyiOrdersImportPage() {
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
      const res = await fetch("/api/inventory/qianyi-orders-import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setResult(data);
      } else {
        setError(data.error || "Upload failed");
      }
    } catch (e: any) {
      setError(e.message || "Network error");
    }

    setUploading(false);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Import Qianyi Orders (所有订单)</h1>
          <p className="text-sm text-gray-500">
            Upload Qianyi ERP &quot;All Orders&quot; export to sync Shopee, Lazada, TikTok sales
          </p>
        </div>
        <Link href="/inventory">
          <Button variant="outline">Back to Inventory</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">How it works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-gray-600">
          <p>1. Export &quot;所有订单&quot; (All Orders) from Qianyi ERP</p>
          <p>2. Upload the Excel file below</p>
          <p>
            3. System will:
          </p>
          <ul className="list-disc ml-6 space-y-1">
            <li>Filter out <Badge variant="secondary">CANCELLED</Badge>,
              <Badge variant="secondary" className="ml-1">TO_RETURN</Badge>,
              <Badge variant="secondary" className="ml-1">REFUNDED</Badge> orders
            </li>
            <li>Match products by System Product Code, Online SKU ID, or Barcode</li>
            <li>Aggregate by product + month + platform (Shopee/Lazada/TikTok)</li>
            <li>Upsert monthly sales records (overwrites existing data for the same period)</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upload File</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Qianyi &quot;All Orders&quot; Export (.xlsx)</Label>
            <Input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>

          <Button onClick={handleUpload} disabled={!file || uploading}>
            {uploading ? "Processing (this may take a minute for large files)..." : "Upload & Import"}
          </Button>

          {error && (
            <div className="bg-red-50 p-4 rounded-lg text-sm text-red-600 whitespace-pre-wrap">
              {error}
            </div>
          )}

          {result && (
            <div className="bg-green-50 p-4 rounded-lg text-sm space-y-2">
              <p className="font-medium text-green-700">Import Complete!</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>Total rows: <b>{result.totalRows}</b></div>
                <div className="text-amber-600">Cancelled filtered: <b>{result.cancelled}</b></div>
                <div>Missing SKU: {result.missingSku}</div>
                <div>Missing date: {result.missingDate}</div>
                <div>Unknown platform: {result.unknownPlatform}</div>
                <div className="text-green-700">Matched: <b>{result.matched}</b></div>
                <div className="text-amber-600">Unmatched: <b>{result.unmatched}</b></div>
                <div className="col-span-2 border-t pt-2">
                  <b>Monthly sales records updated: {result.salesRecordsUpdated}</b>
                </div>
              </div>

              {result.unmatchedSkus?.length > 0 && (
                <div className="text-xs text-amber-600 mt-2">
                  <p className="font-medium">Unmatched SKUs (add these products or SKU mappings):</p>
                  <ul className="ml-4 mt-1">
                    {result.unmatchedSkus.map((sku: string) => (
                      <li key={sku}>• {sku}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
