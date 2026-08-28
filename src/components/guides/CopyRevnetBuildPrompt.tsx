"use client";

import { useState } from "react";

const REVNET_BUILD_PROMPT = `My product: [describe the users, the value they exchange, and the experience I want].

Act as my protocol engineer and product architect. If you are running in Claude Code, first install the Juicebox V6 skills library (https://github.com/mejango/juicebox-skills — run /plugin marketplace add mejango/juicebox-skills, then /plugin install juicebox-v6@juicebox) and lean on its revnet skills (jb-revnet-deploy, revnet-economics, revnet-modeler, jb-revloans, jb-suckers, jb-tx-safety) for addresses, ABIs, economics, and transaction safety. Then read https://revnet.money/learn and https://revnet.money/build, and inspect the current Revnet V6 implementation at https://github.com/rev-net/revnet-core-v6 and the Juicebox V6 contracts at https://github.com/Bananapus/version-6. Do not substitute an older protocol version.

Design the smallest safe product architecture that uses a revnet as its open financial backend. Explain which economics must be precommitted at launch: stages and start times, issuance and issuance cuts, cash-out tax, reserved splits, auto-issuance, accepted accounting tokens, chain topology, shop item transfer policy, and the operator's narrowly scoped permissions.

Map each user action to exact V6 reads and transactions, including payments, token issuance, cash outs, loans, buyback routing, shops, and multichain settlement where relevant. For every write, identify the contract, function, arguments, units, chain, permissions, approvals, slippage or minimum-output protection, and state that must be re-read immediately before signing. Prefer audited SDK builders and pure transaction builders that ABI round-trip. Keep signing explicit and wallet-bound.`;

export function CopyRevnetBuildPrompt() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(REVNET_BUILD_PROMPT);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="text-left font-semibold underline decoration-melon-400 underline-offset-4 hover:text-melon-700"
    >
      {copied ? "prompt copied" : "copy the Revnet build prompt"}
    </button>
  );
}
