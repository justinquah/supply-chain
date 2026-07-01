"use client";

import { useState } from "react";
import { EditBaTermsForm } from "./record-payment-form";

type Props = {
  paymentId: string;
  currentTermDays: number | null;
  currentDueDate: string | null;
};

export function EditBaTermsFormWrapper({
  paymentId,
  currentTermDays,
  currentDueDate,
}: Props) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <EditBaTermsForm
        paymentId={paymentId}
        currentTermDays={currentTermDays}
        currentDueDate={currentDueDate}
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="ml-2 text-blue-600 hover:underline text-xs"
    >
      Edit terms
    </button>
  );
}
