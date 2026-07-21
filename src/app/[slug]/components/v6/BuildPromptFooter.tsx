"use client";

import { COMPONENT_SPECS } from "@/lib/v6/componentSpecs";
import { useState } from "react";

/**
 * Ported from website/'s componentReproPrompt: assembles the LLM build prompt for a
 * component concept from its COMPONENT_SPECS entry, capturing the current URL at
 * click time.
 */
export function buildComponentPrompt(title: string, concept: string, fileHint?: string): string {
  const s = COMPONENT_SPECS[concept];
  const file = fileHint || s?.file;
  return (
    `Reproduce the Juicebox V6 "${title || concept}" component from this open-source explorer.\n` +
    (s?.fn ? `It builds a ${s.fn} transaction.\n` : "") +
    (s?.desc ? `\nWhat it does, and the gotchas that make it correct + safe:\n${s.desc}\n` : "") +
    "\nReference implementation (vanilla JS, client-only, no backend): https://github.com/mejango/juicebox-v6-website" +
    (file
      ? ` — read src/${file}. Transactions are built in-browser; the README maps every action to its contract function.`
      : ".") +
    "\n" +
    "V6 contracts (Juicebox version 6): https://github.com/Bananapus/version-6.\n" +
    "Build it COMPLETELY — handle the loading, empty, error, multi-chain, and permission-preflight states, not just the happy path. Before trusting this summary, READ the builder function named above and its round-trip/encoding test in the reference repo: the builder is the source of truth for arg order, decimals, currency ids, and any hardcoded value. Cross-check every arg against the onchain ABI in the V6 contracts repo and match the tuple order, integer widths, and 4-byte selector EXACTLY (a uint32-vs-uint256 swap or a reordered tuple changes the selector and reverts every tx).\n" +
    "SAFELY: match token decimals and the currency id per the gotchas (they often differ from 18 / from the standard ETH=1/USD=2 id); validate every address; and treat any multi-step preflight as a labeled step (ERC-20 approval, a one-off setPermissionsFor grant, or claiming credits into the ERC-20 before the action). Note which calls are permissionless vs permission-gated and do not add or drop access control. Preserve every live-quote minimum and fail-closed preflight from the reference. A zero minimum is valid only where the documented contract route carries its real floor elsewhere or the verified expected output is exactly zero; never turn a failed preview into an unprotected write.\n" +
    "If you might miss a gotcha, surface it.\n" +
    `Live reference: ${typeof window === "undefined" ? "" : window.location.href}`
  );
}

/** The "[copy build prompt]" footer row every v6 card carries. */
export function BuildPromptFooter({
  title,
  concept,
  fileHint,
}: {
  title: string;
  concept: string;
  fileHint?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex justify-end mt-2">
      <button
        type="button"
        title="Copy an LLM prompt to build this"
        className="text-xs text-zinc-400 hover:text-zinc-600 font-mono"
        onClick={() => {
          navigator.clipboard
            .writeText(buildComponentPrompt(title, concept, fileHint))
            .finally(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            });
        }}
      >
        {copied ? "[copied]" : "[copy build prompt]"}
      </button>
    </div>
  );
}
