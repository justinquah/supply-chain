// ---------------------------------------------------------------------------
// Bank facility limits + utilisation.
//
// Source of truth: bank_credit_limits (limit per bank) x financing_obligations
// (BA / Invoice Financing). Only OUTSTANDING obligations (due_date > today in
// Asia/KL) consume a facility — once an obligation's due date passes it is
// settled and the limit is freed up again.
// ---------------------------------------------------------------------------

/** A row of bank_credit_limits as fetched by the Finance page. */
export type BankCreditLimitRow = {
  bank: string;
  short_name: string | null;
  limit_amount: number;
  currency: string;
  notes: string | null;
};

/** Computed per-bank facility utilisation, built server-side on the page. */
export type BankFacility = {
  bank: string;
  shortName: string;
  limit: number;
  outstanding: number;
  available: number;
  /** outstanding / limit x 100. 0 when the limit is 0 (avoids /0). */
  utilisationPct: number;
  currency: string;
  notes: string | null;
};

function money(n: number, cur: string): string {
  const prefix = cur && cur !== "MYR" ? `${cur} ` : "RM ";
  return (
    prefix +
    Number(n).toLocaleString("en-MY", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** green < 75% · amber 75–99% · red >= 100% (at / over limit). */
function utilisationTextCls(pct: number): string {
  if (pct >= 100) return "text-red-700";
  if (pct >= 75) return "text-amber-700";
  return "text-emerald-700";
}

function utilisationBarCls(pct: number): string {
  if (pct >= 100) return "bg-red-500";
  if (pct >= 75) return "bg-amber-400";
  return "bg-emerald-500";
}

type Props = {
  facilities: BankFacility[];
};

export function BankFacilities({ facilities }: Props) {
  if (facilities.length === 0) {
    return (
      <p className="text-sm text-gray-500">No bank facility limits configured.</p>
    );
  }

  return (
    <div className="space-y-5">
      {facilities.map((f) => {
        const overLimit = f.available < 0;
        // Bar is capped at 100% width — the "over limit" flag carries the excess.
        const barWidth = Math.min(100, Math.max(0, f.utilisationPct));

        return (
          <div key={f.bank} className="space-y-1.5">
            {/* Header: bank + % utilised */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">{f.shortName}</span>
                {overLimit && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">
                    Over limit
                  </span>
                )}
              </div>
              <span
                className={
                  "text-sm font-semibold tabular-nums " +
                  utilisationTextCls(f.utilisationPct)
                }
              >
                {f.utilisationPct.toFixed(0)}% utilised
              </span>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 bg-gray-100 rounded overflow-hidden">
              <div
                className={"h-full rounded " + utilisationBarCls(f.utilisationPct)}
                style={{ width: `${barWidth}%` }}
              />
            </div>

            {/* Limit / outstanding / available */}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs tabular-nums pt-0.5">
              <span>
                <span className="text-gray-500">Limit: </span>
                <span className="text-gray-800">{money(f.limit, f.currency)}</span>
              </span>
              <span>
                <span className="text-gray-500">Outstanding: </span>
                <span className="text-indigo-700 font-medium">
                  {money(f.outstanding, f.currency)}
                </span>
              </span>
              <span>
                <span className="text-gray-500">Available: </span>
                <span
                  className={
                    "font-medium " +
                    (overLimit ? "text-red-700" : "text-emerald-700")
                  }
                >
                  {money(f.available, f.currency)}
                </span>
              </span>
            </div>

            {f.notes && (
              <p className="text-[11px] text-gray-400">{f.notes}</p>
            )}
          </div>
        );
      })}

      <p className="text-[11px] text-gray-400 pt-1">
        Outstanding = BA / Invoice Financing not yet due (due date after today).
        Obligations settle automatically on their due date and free up the limit.
      </p>
    </div>
  );
}
