import {
  PO_WORKFLOW_STATES,
  PO_WORKFLOW_LABELS,
  stateIndex,
} from "@/lib/po-workflow";

// Horizontal stepper of the 5 lifecycle states. The current state is highlighted;
// earlier states show as complete, later states muted. CANCELLED (not in the linear
// flow) renders a single red marker.
export function Stepper({ status }: { status: string }) {
  if (status === "CANCELLED") {
    return (
      <div className="text-sm font-medium text-red-600">
        This PO was cancelled.
      </div>
    );
  }

  const current = stateIndex(status);

  return (
    <ol className="flex flex-wrap items-center gap-y-3">
      {PO_WORKFLOW_STATES.map((s, i) => {
        const done = current > i;
        const isCurrent = current === i;
        return (
          <li key={s} className="flex items-center">
            <div className="flex items-center gap-2">
              <span
                className={
                  "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold " +
                  (isCurrent
                    ? "bg-brand text-white"
                    : done
                    ? "bg-emerald-500 text-white"
                    : "bg-gray-200 text-gray-500")
                }
              >
                {done ? "✓" : i + 1}
              </span>
              <span
                className={
                  "text-xs font-medium " +
                  (isCurrent
                    ? "text-gray-900"
                    : done
                    ? "text-gray-700"
                    : "text-gray-400")
                }
              >
                {PO_WORKFLOW_LABELS[s]}
              </span>
            </div>
            {i < PO_WORKFLOW_STATES.length - 1 && (
              <span
                className={
                  "mx-3 h-px w-8 " + (done ? "bg-emerald-400" : "bg-gray-200")
                }
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
