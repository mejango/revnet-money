"use client";

import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { useState } from "react";

/** A standalone confirm taller than a phone screen, for the browser layout check. */
export default function ConfirmProofPage() {
  const [pressed, setPressed] = useState("");

  return (
    <div data-confirm-proof-pressed={pressed}>
      <TxConfirmDialog
        open
        onClose={() => setPressed("cancel")}
        title="Confirm a long plan"
        steps={[{ title: "Send the plan" }]}
        activeIndex={-1}
        action="Send"
        onConfirm={() => setPressed("send")}
      >
        {Array.from({ length: 40 }, (_, index) => (
          <SummaryRow key={index} label={`Row ${index + 1}`}>
            Value {index + 1}
          </SummaryRow>
        ))}
      </TxConfirmDialog>
    </div>
  );
}
