"use client";

import { useRef, useState } from "react";
import { importPoLines, type ImportPoLinesResult } from "../import-actions";
import { Button } from "@/components/ui/button";

export function ImportPoLinesForm() {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportPoLinesResult | null>(null);
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
    const res = await importPoLines(fd);
    setUploading(false);
    setResult(res);
    if (res.ok && fileRef.current) fileRef.current.value = "";
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="space-y-4">
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
            {uploading ? "Importing…" : "Import"}
          </Button>
        </div>
      </form>

      {result && (
        <div className="mt-4 text-sm">
          {result.ok ? (
            <div className="space-y-3">
              <p className="text-emerald-700">
                POs created {result.posCreated ?? 0} · POs attached{" "}
                {result.posAttached ?? 0} · Lines created {result.linesCreated ?? 0}{" "}
                · Skipped {result.skipped?.length ?? 0}.
              </p>
              {result.skipped && result.skipped.length > 0 && (
                <div className="border border-amber-200 bg-amber-50 rounded-md p-3">
                  <p className="font-medium text-amber-800">Skipped rows:</p>
                  <ul className="mt-1 space-y-0.5 text-amber-700">
                    {result.skipped.map((s, i) => (
                      <li key={i}>
                        Row {s.row}
                        {s.po_number ? ` (${s.po_number})` : ""}: {s.reason}
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
    </div>
  );
}
