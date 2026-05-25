"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function SalesImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [defaultChannel, setDefaultChannel] = useState("MANUAL");
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
    formData.append("defaultChannel", defaultChannel);

    try {
      const res = await fetch("/api/inventory/sales/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setResult(data);
      } else {
        setError(data.error || "Upload failed");
        if (data.availableColumns) {
          setError(
            `${data.error}\n\nColumns found in your file: ${data.availableColumns.join(", ")}`
          );
        }
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
          <h1 className="text-2xl font-bold">Import Sales Data</h1>
          <p className="text-sm text-gray-500">
            Bulk upload monthly sales from Excel or CSV
          </p>
        </div>
        <Link href="/inventory">
          <Button variant="outline">Back to Inventory</Button>
        </Link>
      </div>

      {/* File Format Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Expected File Format</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600 mb-3">
            The system accepts Excel (.xlsx) or CSV files with flexible column names.
            Required columns:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-left border">Column (any of these names)</th>
                  <th className="p-2 text-left border">Description</th>
                  <th className="p-2 text-left border">Example</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border">
                  <td className="p-2 border font-mono">SKU, Seller SKU, Item Code, Barcode</td>
                  <td className="p-2 border">Product identifier</td>
                  <td className="p-2 border">BC-PF-CAN-TUNA-85G</td>
                </tr>
                <tr className="border">
                  <td className="p-2 border font-mono">Year + Month OR Date</td>
                  <td className="p-2 border">Period</td>
                  <td className="p-2 border">2026, 4 OR 2026-04</td>
                </tr>
                <tr className="border">
                  <td className="p-2 border font-mono">Channel, Platform (optional)</td>
                  <td className="p-2 border">SHOPEE, LAZADA, TIKTOK, AUTOCOUNT</td>
                  <td className="p-2 border">SHOPEE</td>
                </tr>
                <tr className="border">
                  <td className="p-2 border font-mono">Units Sold, Quantity, Qty</td>
                  <td className="p-2 border">Units sold</td>
                  <td className="p-2 border">150</td>
                </tr>
                <tr className="border">
                  <td className="p-2 border font-mono">Revenue, Amount, Total (optional)</td>
                  <td className="p-2 border">Revenue in MYR</td>
                  <td className="p-2 border">885.00</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            💡 Tip: Multiple rows with the same product/month/channel will be summed together.
          </p>
        </CardContent>
      </Card>

      {/* Upload Form */}
      <Card>
        <CardHeader>
          <CardTitle>Upload File</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Default Channel (if not in file)</Label>
            <select
              className="w-full border rounded-md px-3 py-2 text-sm"
              value={defaultChannel}
              onChange={(e) => setDefaultChannel(e.target.value)}
            >
              <option value="MANUAL">Manual Entry</option>
              <option value="SHOPEE">Shopee</option>
              <option value="LAZADA">Lazada</option>
              <option value="TIKTOK">TikTok</option>
              <option value="AUTOCOUNT">Offline (AutoCount)</option>
            </select>
            <p className="text-xs text-gray-500">
              Used if Channel column is not in the file
            </p>
          </div>

          <div className="space-y-2">
            <Label>Excel / CSV File</Label>
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>

          <Button onClick={handleUpload} disabled={!file || uploading}>
            {uploading ? "Uploading..." : "Upload & Import"}
          </Button>

          {error && (
            <div className="bg-red-50 p-4 rounded-lg text-sm text-red-600 whitespace-pre-wrap">
              {error}
            </div>
          )}

          {result && (
            <div className="bg-green-50 p-4 rounded-lg text-sm space-y-2">
              <p className="font-medium text-green-700">Import Complete!</p>
              <p>Total rows in file: {result.totalRows}</p>
              <p>Sales records created/updated: {result.imported}</p>
              {result.skipped > 0 && (
                <p className="text-amber-600">Rows skipped: {result.skipped}</p>
              )}
              {result.columnsDetected && (
                <div className="text-xs text-gray-500 mt-2 space-y-1">
                  <p className="font-medium">Columns detected:</p>
                  {Object.entries(result.columnsDetected).map(([k, v]: any) => (
                    <p key={k}>
                      {k}: <Badge variant="secondary">{v}</Badge>
                    </p>
                  ))}
                </div>
              )}
              {result.errors?.length > 0 && (
                <div className="text-xs text-amber-600 mt-2">
                  <p className="font-medium">Warnings:</p>
                  {result.errors.map((e: string, i: number) => (
                    <p key={i}>• {e}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
