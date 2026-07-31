"use client";

import { REVNET_AUDIT_PROMPT } from "@/lib/audit-prompt";
import { useEffect, useRef, useState } from "react";

export function AuditPromptLink({ className }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <p className={className}>
      100% open source,{" "}
      <button
        type="button"
        className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-zinc-900"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(REVNET_AUDIT_PROMPT);
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "AI prompt copied to clipboard" : "audit or create with your AI"}
      </button>
      .
    </p>
  );
}
