// ============================================================
// Supplier email drafts (mailto:)
// ============================================================
// This app NEVER sends mail itself. There is no email API and none is to be
// added. Every "Email supplier" button builds a `mailto:` URL that opens a
// PRE-FILLED DRAFT in the user's own mail client — the human reads it, attaches
// whatever document is needed, and presses Send.
//
// Deliberately NOT a "use client" module: both Server Components (which read
// the recipients out of Supabase) and Client Components (the button) import it.
// ============================================================

/**
 * Where a supplier draft is addressed.
 *
 * IMPORTANT: `to` comes from `profiles.supplier_contact_emails` and `cc` from
 * `profiles.supplier_cc_emails`. `profiles.email` is the supplier's LOGIN
 * address (a placeholder like `dalian@suppliers.placeholder`) and must NEVER be
 * used as a mail recipient.
 */
export type SupplierRecipients = { to: string[]; cc: string[] };

/** A ready-to-open draft: what goes in the subject line and the body. */
export type EmailDraft = { subject: string; body: string };

// ---------------------------------------------------------------------------
// mailto builder
// ---------------------------------------------------------------------------

/**
 * Build a `mailto:` URL for a pre-filled draft.
 *
 * Returns "" when there is no recipient, so callers can render the button
 * disabled instead of opening an empty draft.
 *
 * Newlines in `body` are plain "\n"; percent-encoded they become %0A, which
 * every mail client renders as a line break.
 */
/**
 * Internal recipients copied on EVERY supplier email, on top of the supplier's
 * own CC list (their agent/broker). Kept here rather than on each supplier row
 * so it stays one place to edit.
 */
export const INTERNAL_CC = [
  "justinquah@blossom-commerce.com",
  "woanjinq@13media.co",
];

export function buildMailto(
  r: SupplierRecipients,
  subject: string,
  body: string
): string {
  const to = (r?.to ?? []).map((a) => String(a).trim()).filter(Boolean);
  if (to.length === 0) return "";
  const supplierCc = (r?.cc ?? []).map((a) => String(a).trim()).filter(Boolean);
  // De-duplicate case-insensitively so an address listed on the supplier and
  // internally is not copied twice.
  const seen = new Set<string>();
  const cc = [...supplierCc, ...INTERNAL_CC].filter((a) => {
    const k = a.toLowerCase();
    if (seen.has(k) || to.some((t) => t.toLowerCase() === k)) return false;
    seen.add(k);
    return true;
  });

  const params: string[] = [];
  if (cc.length > 0) params.push(`cc=${cc.map(encodeAddress).join(",")}`);
  params.push(`subject=${encodeURIComponent(subject)}`);
  params.push(`body=${encodeURIComponent(body)}`);

  return `mailto:${to.map(encodeAddress).join(",")}?${params.join("&")}`;
}

/**
 * Percent-encode one address. `encodeURIComponent` also escapes "@" as %40;
 * RFC 6068 allows a literal "@" in a mailto addr-spec and a few desktop clients
 * mis-parse the escaped form, so it is restored after encoding.
 */
function encodeAddress(address: string): string {
  return encodeURIComponent(address).replace(/%40/g, "@");
}

// ---------------------------------------------------------------------------
// Formatting — mirrors how the rest of the app renders dates and money
// ---------------------------------------------------------------------------

/** "2026-08-19" -> "19 Aug 2026". Returns null for empty/invalid input. */
export function formatEmailDate(d: string | null | undefined): string | null {
  if (!d) return null;
  // Date-only strings are anchored to UTC so they never shift a day.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(d);
  const parsed = new Date(dateOnly ? `${d}T00:00:00Z` : d);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: dateOnly ? "UTC" : "Asia/Kuala_Lumpur",
  });
}

/** 12500 + "USD" -> "USD 12,500.00". Returns null when the amount is missing. */
export function formatEmailAmount(
  amount: number | null | undefined,
  currency: string | null | undefined
): string | null {
  if (amount == null || !Number.isFinite(Number(amount))) return null;
  const money = Number(amount).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency || "MYR"} ${money}`;
}

const SIGN_OFF = "Thank you.\n\nJJANGX3 Supply Chain";

/**
 * How a PO is referred to in prose. This project's numbers already contain
 * "PO" (e.g. "BC-PO-2607-003"), so the word is only prefixed when it is not
 * already there — avoids sending suppliers "PO BC-PO-2607-003".
 */
function poRef(poNumber: string | null | undefined): string {
  const n = (poNumber ?? "").trim();
  if (!n) return "the purchase order";
  return /po/i.test(n) ? n : `PO ${n}`;
}

function greeting(supplierName: string | null | undefined): string {
  const name = (supplierName ?? "").trim();
  return name ? `Dear ${name},` : "Dear Sir or Madam,";
}

/** Join body blocks with a blank line, dropping any that resolved to null. */
function compose(blocks: (string | null)[]): string {
  return blocks.filter((b): b is string => b != null && b !== "").join("\n\n");
}

/**
 * A block of single-line "Label: value" facts. Lines whose value was null are
 * omitted entirely; the whole block collapses to null when nothing is known.
 */
function facts(lines: (string | null)[]): string | null {
  const kept = lines.filter((l): l is string => l != null && l !== "");
  return kept.length > 0 ? kept.join("\n") : null;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
// Plain, simple English — recipients are in China and Thailand. Bodies are kept
// short on purpose: some mail clients truncate long mailto: URLs.

/**
 * Finance tells a supplier a payment has been made for a PO.
 * The payment slip must be attached by hand — a mailto draft carries no files.
 */
export function paymentSlipEmail({
  poNumber,
  supplierName,
  amount,
  currency,
  paidOn,
}: {
  poNumber: string | null;
  supplierName: string | null;
  amount: number | null;
  currency: string | null;
  paidOn: string | null;
}): EmailDraft {
  const po = poRef(poNumber);
  const amountLine = formatEmailAmount(amount, currency);
  const paidLine = formatEmailDate(paidOn);

  return {
    subject: `Payment advice — ${po}`,
    body: compose([
      greeting(supplierName),
      `We have made a payment for ${po}.`,
      facts([
        amountLine ? `Amount: ${amountLine}` : null,
        paidLine ? `Payment date: ${paidLine}` : null,
      ]),
      "The payment slip is attached. Please confirm that you have received it.",
      SIGN_OFF,
    ]),
  };
}

/**
 * SCM tells a supplier a PO has been issued and asks them to confirm the ETA.
 * `lineSummary` is an optional one-line description of the order.
 */
export function poIssuedEmail({
  poNumber,
  supplierName,
  targetEta,
  lineSummary,
}: {
  poNumber: string | null;
  supplierName: string | null;
  targetEta: string | null;
  lineSummary?: string | null;
}): EmailDraft {
  const po = (poNumber ?? "").trim() || "(no PO number)";
  const eta = formatEmailDate(targetEta);

  return {
    subject: eta
      ? `Purchase Order ${po} — target ETA ${eta}`
      : `Purchase Order ${po}`,
    body: compose([
      greeting(supplierName),
      `We have issued Purchase Order ${po}.`,
      facts([
        eta ? `Target ETA: ${eta}` : null,
        lineSummary ? `Items: ${lineSummary}` : null,
      ]),
      eta
        ? "The purchase order is attached. Please confirm that you can meet this ETA."
        : "The purchase order is attached. Please confirm that you can accept this order.",
      SIGN_OFF,
    ]),
  };
}

/**
 * SCM asks a supplier to bring a shipment forward (EXPEDITE) or push it back
 * (DELAY), stating both the current and the requested ETA.
 */
export function poTimingEmail({
  poNumber,
  supplierName,
  kind,
  currentEta,
  requestedEta,
}: {
  poNumber: string | null;
  supplierName: string | null;
  kind: "EXPEDITE" | "DELAY";
  currentEta: string | null;
  requestedEta: string | null;
}): EmailDraft {
  const po = poRef(poNumber);
  const current = formatEmailDate(currentEta);
  const requested = formatEmailDate(requestedEta);
  const isExpedite = kind === "EXPEDITE";

  const action = isExpedite
    ? "bring forward the shipment"
    : "postpone the shipment";
  const subjectAction = isExpedite
    ? "request to bring forward shipment"
    : "request to postpone shipment";
  const followUp = isExpedite
    ? "Please confirm whether this is possible. If not, please tell us the earliest date you can ship."
    : "Please confirm whether this is possible. If not, please tell us the date that works for you.";

  return {
    subject: requested
      ? `${po} — ${subjectAction} to ${requested}`
      : `${po} — ${subjectAction}`,
    body: compose([
      greeting(supplierName),
      `We would like to ${action} for ${po}.`,
      facts([
        current ? `Current ETA: ${current}` : null,
        requested ? `Requested ETA: ${requested}` : null,
      ]),
      followUp,
      SIGN_OFF,
    ]),
  };
}
