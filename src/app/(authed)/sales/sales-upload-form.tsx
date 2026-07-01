"use client";

import { useRef, useState } from "react";
import { importSales, type ImportSalesResult } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const MONTHS = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function currentYear() {
  return new Date().getFullYear();
}

export function SalesUploadForm() {
  const now = new Date();
  const [year, setYear] = useState(String(currentYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [channel, setChannel] = useState<"ONLINE" | "OFFLINE">("ONLINE");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportSalesResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setResult({ ok: false, error: "Choose a .xlsx file to upload" });
      return;
    }

    const fd = new FormData();
    fd.set("year", year);
    fd.set("month", month);
    fd.set("channel", channel);
    fd.set("file", file);

    setUploading(true);
    setResult(null);
    const res = await importSales(fd);
    setUploading(false);
    setResult(res);
    if (res.ok && fileRef.current) fileRef.current.value = "";
  }

  const yearOptions = [currentYear() - 1, currentYear(), currentYear() + 1];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload monthly sales</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-gray-500">
            Upload one file per month per channel — the ONLINE export from
            Qianyi (shipped orders) or the OFFLINE &quot;From Autocount&quot;
            export. Re-uploading a period replaces its existing rows.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">Year</span>
              <select
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 bg-white"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">Month</span>
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 bg-white"
              >
                {MONTHS.slice(1).map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">Channel</span>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as "ONLINE" | "OFFLINE")}
                className="border border-gray-300 rounded-md px-2 py-1.5 bg-white"
              >
                <option value="ONLINE">Online (Qianyi)</option>
                <option value="OFFLINE">Offline (AutoCount)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">File (.xlsx)</span>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx"
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
                  Imported {result.imported} row{result.imported === 1 ? "" : "s"} (
                  {result.knownUnits?.toLocaleString("en-MY")} units) for{" "}
                  {MONTHS[result.month || 0]} {result.year} {result.channel}.
                </p>
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
