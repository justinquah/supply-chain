import { EXPIRY_SOON_DAYS } from "./constants";

export type ExpiryState = "none" | "expired" | "soon" | "valid";

export type ExpiryInfo = {
  state: ExpiryState;
  days: number | null; // days until expiry (negative if already expired)
  label: string;
};

// Today's date in Asia/Kuala_Lumpur as YYYY-MM-DD.
export function todayKL(): string {
  const nowKL = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" })
  );
  const y = nowKL.getFullYear();
  const m = String(nowKL.getMonth() + 1).padStart(2, "0");
  const d = String(nowKL.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Whole-day difference between two YYYY-MM-DD calendar dates (b - a).
function dayDiff(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.round((db - da) / 86_400_000);
}

/**
 * Classify a permit's expiry relative to today (Asia/Kuala_Lumpur).
 * - no expiry set        -> "none"  ("No expiry")
 * - expiry < today       -> "expired" ("Expired")
 * - within 60 days       -> "soon"  ("Expiring (Nd)")
 * - otherwise            -> "valid" ("Valid")
 *
 * `today` is injectable so the same computation can run on server and client
 * against a single Asia/Kuala_Lumpur reference date.
 */
export function classifyExpiry(
  expiry: string | null,
  today: string = todayKL()
): ExpiryInfo {
  if (!expiry) return { state: "none", days: null, label: "No expiry" };

  const days = dayDiff(today, expiry);
  if (days < 0) return { state: "expired", days, label: "Expired" };
  if (days <= EXPIRY_SOON_DAYS)
    return { state: "soon", days, label: `Expiring (${days}d)` };
  return { state: "valid", days, label: "Valid" };
}
