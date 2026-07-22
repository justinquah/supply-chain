// ============================================================
// Structured payment terms — the deposit / balance RULE
// ============================================================
// A PO's payment plan is expressed as three RULE fields:
//
//   deposit_percent          0 or NULL  → no deposit is payable
//   deposit_lead_months      NULL       → no rule, deposit date stays manual
//   balance_days_after_eta   NULL       → no rule, balance date stays manual
//
// The DERIVED dates (purchase_orders.deposit_due_date / .balance_due_date) are
// owned by the DB trigger `trg_po_payment_terms`. It recomputes them from the
// effective ETA — COALESCE(actual_eta, logistics_eta, supplier_eta, targeted_eta)
// — whenever an ETA column or one of the rule fields changes.
//
// >>> APP CODE MUST NEVER WRITE deposit_due_date OR balance_due_date. <<<
// Write the rule; read the dates back from the DB.
//
// This module holds the shared shapes, validation and the plain-English
// wording used by the Suppliers page, the PO form/detail page and Finance.
// ============================================================

/** The three rule columns, as they come back from Supabase (NUMERIC → string|number). */
export type PaymentRuleFields = {
  deposit_percent?: number | string | null;
  deposit_lead_months?: number | string | null;
  balance_days_after_eta?: number | string | null;
};

/** The same rule as it lives on a supplier profile (the per-PO defaults). */
export type SupplierPaymentDefaults = {
  supplier_deposit_percent?: number | string | null;
  supplier_deposit_lead_months?: number | string | null;
  supplier_balance_days_after_eta?: number | string | null;
};

/** A rule normalised to numbers (or null for "no rule"). */
export type PaymentRule = {
  depositPercent: number | null;
  depositLeadMonths: number | null;
  balanceDaysAfterEta: number | null;
};

export const EMPTY_RULE: PaymentRule = {
  depositPercent: null,
  depositLeadMonths: null,
  balanceDaysAfterEta: null,
};

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Normalise a PO row's rule columns. */
export function readRule(r: PaymentRuleFields | null | undefined): PaymentRule {
  return {
    depositPercent: num(r?.deposit_percent),
    depositLeadMonths: num(r?.deposit_lead_months),
    balanceDaysAfterEta: num(r?.balance_days_after_eta),
  };
}

/** Normalise a supplier profile's default rule columns. */
export function readSupplierDefaults(
  s: SupplierPaymentDefaults | null | undefined
): PaymentRule {
  return {
    depositPercent: num(s?.supplier_deposit_percent),
    depositLeadMonths: num(s?.supplier_deposit_lead_months),
    balanceDaysAfterEta: num(s?.supplier_balance_days_after_eta),
  };
}

/** True when ANY rule field is set — i.e. someone has defined a payment plan. */
export function hasPaymentRule(rule: PaymentRule): boolean {
  return (
    rule.depositPercent != null ||
    rule.depositLeadMonths != null ||
    rule.balanceDaysAfterEta != null
  );
}

/**
 * True when the rule makes the DB trigger own at least one due date — i.e. the
 * due dates move when the ETA moves. Used for the "changing the ETA moves the
 * payment due dates" note.
 */
export function ruleDrivesDates(rule: PaymentRule): boolean {
  const depositDriven =
    rule.depositLeadMonths != null &&
    rule.depositPercent != null &&
    rule.depositPercent > 0;
  return depositDriven || rule.balanceDaysAfterEta != null;
}

/** True when a deposit is actually payable (0 / NULL means none). */
export function hasDeposit(rule: PaymentRule): boolean {
  return rule.depositPercent != null && rule.depositPercent > 0;
}

/**
 * Effective ETA — mirrors the DB trigger's
 * COALESCE(actual_eta, logistics_eta, supplier_eta, targeted_eta).
 * Read-only: used for wording, never to compute a due date.
 */
export type EtaFields = {
  actual_eta?: string | null;
  logistics_eta?: string | null;
  supplier_eta?: string | null;
  targeted_eta?: string | null;
};

export function effectiveEta(po: EtaFields | null | undefined): string | null {
  return (
    po?.actual_eta ?? po?.logistics_eta ?? po?.supplier_eta ?? po?.targeted_eta ?? null
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "2026-08-01" → "1 Aug 2026". DATE columns are plain calendar dates, so
 *  format in UTC to stay off-by-one-safe. */
export function fmtTermDate(d: string | null | undefined): string {
  if (!d) return "—";
  const parsed = new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** 30 → "30", 30.5 → "30.5" (no trailing ".00"). */
export function fmtPercent(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${Math.abs(n) === 1 ? "" : "s"}`;
}

/** The balance share = 100 − deposit %. */
export function balancePercent(rule: PaymentRule): number {
  const pct = hasDeposit(rule) ? (rule.depositPercent as number) : 0;
  return Math.round((100 - pct) * 100) / 100;
}

/**
 * One-line, date-free summary of a rule — used for supplier defaults and the
 * Finance "Terms" column. e.g.
 *   "Deposit 30% due 2 months before ETA · balance 45 days after ETA"
 *   "No deposit · balance 45 days after ETA"
 *   "No payment rule set"
 */
export function describeRule(rule: PaymentRule): string {
  if (!hasPaymentRule(rule)) return "No payment rule set";

  const parts: string[] = [];

  if (!hasDeposit(rule)) {
    parts.push("No deposit");
  } else if (rule.depositLeadMonths != null) {
    parts.push(
      `Deposit ${fmtPercent(rule.depositPercent as number)}% due ${plural(
        rule.depositLeadMonths,
        "month"
      )} before ETA`
    );
  } else {
    parts.push(
      `Deposit ${fmtPercent(rule.depositPercent as number)}% (due date entered manually)`
    );
  }

  if (rule.balanceDaysAfterEta != null) {
    parts.push(`balance ${plural(rule.balanceDaysAfterEta, "day")} after ETA`);
  } else {
    parts.push("balance due date entered manually");
  }

  return parts.join(" · ");
}

/**
 * The deposit leg spelled out with its resulting date, e.g.
 *   "30% deposit — due 1 Aug 2026 (2 months before ETA 1 Oct 2026)"
 *   "No deposit required"
 */
export function describeDepositLeg(
  rule: PaymentRule,
  depositDueDate: string | null | undefined,
  eta: string | null | undefined
): string {
  if (!hasDeposit(rule)) return "No deposit required";

  const pct = fmtPercent(rule.depositPercent as number);

  if (rule.depositLeadMonths == null) {
    return depositDueDate
      ? `${pct}% deposit — due ${fmtTermDate(depositDueDate)} (date entered manually)`
      : `${pct}% deposit — no due date set (no rule; enter it manually)`;
  }

  const lead = plural(rule.depositLeadMonths, "month");
  if (!depositDueDate) {
    return `${pct}% deposit — ${lead} before ETA (no ETA set yet, so no date)`;
  }
  return eta
    ? `${pct}% deposit — due ${fmtTermDate(depositDueDate)} (${lead} before ETA ${fmtTermDate(eta)})`
    : `${pct}% deposit — due ${fmtTermDate(depositDueDate)} (${lead} before ETA)`;
}

/**
 * The balance leg spelled out with its resulting date, e.g.
 *   "Balance 70% — due 15 Nov 2026 (45 days after ETA)"
 */
export function describeBalanceLeg(
  rule: PaymentRule,
  balanceDueDate: string | null | undefined,
  eta: string | null | undefined
): string {
  const pct = fmtPercent(balancePercent(rule));

  if (rule.balanceDaysAfterEta == null) {
    return balanceDueDate
      ? `Balance ${pct}% — due ${fmtTermDate(balanceDueDate)} (date entered manually)`
      : `Balance ${pct}% — no due date set (no rule; enter it manually)`;
  }

  const after = plural(rule.balanceDaysAfterEta, "day");
  if (!balanceDueDate) {
    return `Balance ${pct}% — ${after} after ETA (no ETA set yet, so no date)`;
  }
  return eta
    ? `Balance ${pct}% — due ${fmtTermDate(balanceDueDate)} (${after} after ETA ${fmtTermDate(eta)})`
    : `Balance ${pct}% — due ${fmtTermDate(balanceDueDate)} (${after} after ETA)`;
}

/** Shown when nothing is configured at all. */
export const NO_RULE_MESSAGE = "No payment rule set — dates entered manually";

// ---------------------------------------------------------------------------
// Validation (shared by every server action that writes the rule)
// ---------------------------------------------------------------------------

export type RuleInput = {
  depositPercent?: number | string | null;
  depositLeadMonths?: number | string | null;
  balanceDaysAfterEta?: number | string | null;
};

export type RuleValidation =
  | { ok: true; value: PaymentRule }
  | { ok: false; error: string };

/**
 * Validate + normalise a submitted rule. Blank / null means "no rule" and is
 * always allowed; 0% deposit is allowed and means "no deposit payable".
 */
export function validateRuleInput(input: RuleInput): RuleValidation {
  const depositPercent = num(input.depositPercent);
  const depositLeadMonths = num(input.depositLeadMonths);
  const balanceDaysAfterEta = num(input.balanceDaysAfterEta);

  if (input.depositPercent != null && input.depositPercent !== "" && depositPercent == null)
    return { ok: false, error: "Deposit % must be a number" };
  if (depositPercent != null && (depositPercent < 0 || depositPercent > 100))
    return { ok: false, error: "Deposit % must be between 0 and 100" };

  if (
    input.depositLeadMonths != null &&
    input.depositLeadMonths !== "" &&
    depositLeadMonths == null
  )
    return { ok: false, error: "Deposit lead months must be a whole number" };
  if (
    depositLeadMonths != null &&
    (!Number.isInteger(depositLeadMonths) || depositLeadMonths < 0 || depositLeadMonths > 36)
  )
    return { ok: false, error: "Deposit lead months must be a whole number between 0 and 36" };

  if (
    input.balanceDaysAfterEta != null &&
    input.balanceDaysAfterEta !== "" &&
    balanceDaysAfterEta == null
  )
    return { ok: false, error: "Balance days after ETA must be a whole number" };
  if (
    balanceDaysAfterEta != null &&
    (!Number.isInteger(balanceDaysAfterEta) ||
      balanceDaysAfterEta < 0 ||
      balanceDaysAfterEta > 365)
  )
    return { ok: false, error: "Balance days after ETA must be a whole number between 0 and 365" };

  return { ok: true, value: { depositPercent, depositLeadMonths, balanceDaysAfterEta } };
}
