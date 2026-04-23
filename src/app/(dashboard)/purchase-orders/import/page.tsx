"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function POImportPage() {
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
      const res = await fetch("/api/purchase-orders/import", {
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
          <h1 className="text-2xl font-bold">Import Purchase Orders</h1>
          <p className="text-sm text-gray-500">
            Bulk upload existing POs from Excel or CSV
          </p>
        </div>
        <Link href="/purchase-orders">
          <Button variant="outline">Back to POs</Button>
        </Link>
      </div>

      {/* Format Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Expected File Format</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600 mb-3">
            Multiple rows with the same PO Number will be combined as line items in one PO.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-left border">Column</th>
                  <th className="p-2 text-left border">Required</th>
                  <th className="p-2 text-left border">Example</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border">
                  <td className="p-2 border font-mono">PO Number</td>
                  <td className="p-2 border text-gray-500">Optional (auto-generated)</td>
                  <td className="p-2 border">BC-PO-2601-001</td>
                </tr>
                <tr className="border">
                  <td className="p-2 border font-mono">Supplier</td>
                  <td className="p-2 border text-red-600">Required</td>
                  <td className="p-2 border">DALIAN JIU ZHOU YUAN</td>
                </tr>
                <tr className="border">
                  <td className="p-2 border font-mono">SKU / Seller SKU / Barcode</td>
                  <td className="p-2 border text-red-600">Required</td>
                  <td className="p-2 border">BC-CL-TOFU-6L</td>
                </tr>
                <tr className="border">
                  <td className="p-2 border font-mono">Quantity</td>
                  <td className="p-2 border text-red-600">Required</td>
                  <td className="p-2 border">5000</td>
                </tr>
                <tr className="border">
                  <td className="p-2 border font-mono">Unit Cost</td>
                  <td className="p-2 border text-red-600">Required</td>
                  <td className="p-2 border">5.20</td>
                </tr>
                <tr className="border">
                  <td className="p-2 border font-mono">Currency</td>
                  <td className="p-2 border text-gray-500">Optional (default RMB)</td>
                  <td className="p-2 border">RMB</td>
                </tr>
                <tr className="border">
                  <td className="p-2 border font-mono">Container Type</td>
                  <td className="p-2 border text-gray-500">Optional</td>
                  <td className="p-2 border">40FT</td>
                </tr>
                <tr className="border">
                  <td className="p-2 border font-mono">Deposit Percent</td>
                  <td className="p-2 border text-gray-500">Optional (default 30)</td>
                  <td className="p-2 border">30</td>
                </tr>
                <tr className="border">
                  <td className="p-2 border font-mono">Balance Due Days</td>
                  <td className="p-2 border text-gray-500">Optional (default 45)</td>
                  <td className="p-2 border">45</td>
                </tr>
                <tr className="border">
                  <td className="p-2 border font-mono">Notes</td>
                  <td className="p-2 border text-gray-500">Optional</td>
                  <td className="p-2 border">Rush order</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            💡 All imported POs will be created in DRAFT status - you can send them
            to suppliers for approval after import.
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
              <p>Total PO groups in file: {result.totalGroups}</p>
              <p>POs created: {result.posCreated}</p>

              {result.pos?.length > 0 && (
                <div className="mt-3 space-y-1">
                  <p className="font-medium text-sm">Created POs:</p>
                  {result.pos.slice(0, 10).map((po: any) => (
                    <div key={po.id} className="text-xs border-l-2 border-green-300 pl-2">
                      <Link href={`/purchase-orders/${po.id}`} className="text-blue-600 hover:underline">
                        {po.poNumber}
                      </Link>{" "}
                      - {po.supplier} ({po.lineItems} items, RMB {po.totalAmount.toFixed(2)})
                    </div>
                  ))}
                </div>
              )}

              {result.errors?.length > 0 && (
                <div className="text-xs text-amber-600 mt-2">
                  <p className="font-medium">Errors:</p>
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
