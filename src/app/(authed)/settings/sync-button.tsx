"use client";

import { useState } from "react";
import { syncShopeeStock } from "./actions";
import { Button } from "@/components/ui/button";

export function SyncButton({ disabled }: { disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    const res = await syncShopeeStock();
    setBusy(false);
    setMsg(
      res.ok
        ? `Synced ${res.total} items · ${res.matched} matched to products · ${res.unmatched} unmatched.`
        : `Error: ${res.error}`
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Button onClick={run} disabled={busy || disabled}>
        {busy ? "Syncing…" : "Sync stock now"}
      </Button>
      {msg && (
        <span
          className={
            "text-sm " + (msg.startsWith("Error") ? "text-red-600" : "text-emerald-700")
          }
        >
          {msg}
        </span>
      )}
    </div>
  );
}
