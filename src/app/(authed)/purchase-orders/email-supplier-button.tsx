"use client";

// "Email supplier" — opens a PRE-FILLED DRAFT in the user's own mail client via
// a mailto: link. The app never sends the mail; the human reviews the draft,
// attaches the document, and presses Send.

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildMailto, type SupplierRecipients } from "@/lib/supplier-email";

type Size = "xs" | "sm" | "default";

export function EmailSupplierButton({
  recipients,
  subject,
  body,
  label,
  attachmentHint,
  disabledReason,
  size = "sm",
  className,
}: {
  recipients: SupplierRecipients;
  subject: string;
  body: string;
  label: string;
  /** Shown as a muted note — a mailto draft CANNOT carry an attachment. */
  attachmentHint?: string;
  /** When set, the button is disabled and this explains why. */
  disabledReason?: string | null;
  size?: Size;
  className?: string;
}) {
  const href = buildMailto(recipients, subject, body);
  // No contact address on file => nothing to draft to.
  const reason =
    disabledReason ||
    (href === "" ? "No supplier contact email on file" : null);

  const classes = cn(buttonVariants({ variant: "outline", size }), className);
  const hintSize = size === "xs" ? "text-[10px]" : "text-[11px]";

  return (
    <div className="inline-flex flex-col items-start gap-1">
      {reason ? (
        <span title={reason} className="inline-flex">
          <button type="button" disabled className={classes}>
            {label}
          </button>
        </span>
      ) : (
        <a href={href} className={classes}>
          {label}
        </a>
      )}

      {reason ? (
        <span className={cn(hintSize, "text-gray-400")}>{reason}</span>
      ) : attachmentHint ? (
        <span className={cn(hintSize, "text-amber-700")}>
          ⚠ {attachmentHint}
        </span>
      ) : null}
    </div>
  );
}
