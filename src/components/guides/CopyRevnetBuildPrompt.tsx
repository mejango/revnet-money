"use client";

import { useState } from "react";

const REVNET_BUILD_PROMPT = `My product: [describe the users, the value they exchange, and the experience I want].

Help me design and build the smallest product that achieves this outcome. Start with a short brief: users, success criteria, money and token flows, required networks, operator cash needs, and unresolved decisions. Preserve explicit constraints such as Base-only. Ask only questions that change the design; label unknowns instead of inventing defaults.

Start at https://github.com/mejango/juicebox-skills/blob/main/README.md and load only the skills and source references relevant to the brief. For commerce or offchain revenue, start with revnet-commerce. If a Juicebox MCP connection is available, discover its current capabilities and use relevant reads; otherwise use the documented source and SDK paths. Do not assume tools are connected or available. Use current V6 evidence, verify deployments and distinguish documented, implemented and live behavior.

Evaluate operator token splits as an operating model: operators and players can hold the same token, backed by contributed revenue in a shared treasury under its cash out rules. Explain when this may align interests and how operators can realize value through token sales, cash outs or loans, including liquidity, dilution, costs, collateral and effects on shared backing. Split percentages describe token issuance, not guaranteed cash amounts; revenue remittance and reserved token percentages are independent. Compare a configurable Juicebox project if the business instead requires ordinary treasury expense payouts.

Explain relevant issuance schedules, rate cuts, reserved tokens, fixed allocations, accepted assets, cash out rules and remaining operator powers in plain language. Keep these token economics and separately funded rewards distinct from company ownership, dividends or automatic cash distributions. Clarify what proposed staking or market pairs mean; do not assume a staking adapter or cross-chain bridge.

Propose the smallest end-to-end flow, identifying existing support, custom integration and blocking decisions. Map each chosen user action to V6 reads and transactions. For every write, identify contract, function, arguments, units, chain, permissions, approvals, slippage or minimum-output protection, and state to re-read immediately before signing. Use current V6 SDK builders where supported; encode then decode each request and review the exact transaction before requesting explicit authorization and a wallet signature.

Verify receipts and expected state after execution. Reconcile uncertain submissions before retrying. Keep a concise handoff with decisions, evidence and freshness, unresolved questions, transaction identifiers and the next safe step so another agent can continue without repeating discovery.`;

export function CopyRevnetBuildPrompt() {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");

  const copy = async () => {
    setStatus("copying");
    try {
      await navigator.clipboard.writeText(REVNET_BUILD_PROMPT);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={copy}
        disabled={status === "copying"}
        className="min-h-11 border border-melon-700 bg-white px-4 py-2 text-left font-semibold text-melon-900 hover:bg-melon-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-melon-800"
      >
        {status === "copying" ? "Copying…" : "Copy the Revnet build prompt"}
      </button>
      <p role="status" aria-atomic="true" className="mt-2 text-sm leading-relaxed text-zinc-700">
        {status === "copied"
          ? "Prompt copied. Paste it into your assistant and describe your product."
          : status === "failed"
            ? "Copy was blocked by your browser. Select and copy the prompt below."
            : ""}
      </p>
      <details className="mt-2" open={status === "failed" ? true : undefined}>
        <summary className="min-h-11 cursor-pointer py-3 text-melon-900 underline underline-offset-4">
          Read or manually copy the prompt
        </summary>
        <label htmlFor="revnet-build-prompt" className="mb-2 block font-semibold text-zinc-900">
          Revnet build prompt
        </label>
        <textarea
          id="revnet-build-prompt"
          readOnly
          value={REVNET_BUILD_PROMPT}
          rows={10}
          spellCheck={false}
          className="block w-full border border-melon-700 bg-white p-3 text-sm leading-relaxed text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-melon-800"
        />
      </details>
    </div>
  );
}
