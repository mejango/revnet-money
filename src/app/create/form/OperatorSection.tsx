import { ChainLogo } from "@/components/ChainLogo";
import { useFormContext } from "@/lib/forms";
import { sortChains } from "@/lib/utils";
import { JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import { useEffect, useRef } from "react";
import { PERMANENTLY_DISABLED_OPERATOR } from "../constants";
import { RevnetFormData } from "../types";

const inputClassName =
  "flex h-9 w-full border-2 border-melon-300 bg-melon-25 px-3 py-1.5 text-md placeholder:text-zinc-500 hover:border-melon-400 focus-visible:border-melon-600 focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50";

/** Whether an address means "nobody holds these controls". */
const isDisabled = (address?: string) =>
  (address ?? "").trim().toLowerCase() === PERMANENTLY_DISABLED_OPERATOR;

/**
 * Who, if anyone, holds the revnet's limited operator controls.
 *
 * Its own section rather than a field inside stage 1's dialog: the operator is a single
 * revnet-wide choice (per chain, never per stage), so burying it in the first stage's terms
 * both hid it and implied it could change stage to stage.
 *
 * Addresses are bound BY CHAIN ID: each row reads and writes the `operator` entry whose chainId
 * matches the chain named beside it, so selection order can never cross-wire an address onto
 * another chain's deployment.
 */
export function OperatorSection({ disabled = false }: { disabled?: boolean }) {
  const { values, setFieldValue } = useFormContext<RevnetFormData>();
  const operators = values.operator;
  const sortedChains = sortChains(values.chainIds);

  // Drafts written before this section existed carry the operator on stage 1. Reading it here
  // keeps an imported `.jb` showing the operator it was saved with.
  const fromStage = values.stages[0]?.initialOperator?.trim() ?? "";
  const controlsEnabled =
    operators.length > 0
      ? !operators.every((entry) => isDisabled(entry.address))
      : fromStage !== "" && !isDisabled(fromStage);

  const entryFor = (chainId: JBChainId) =>
    operators.find((entry) => Number(entry.chainId) === Number(chainId));

  // Entries for chains that are no longer selected are a validation error the reader cannot
  // see, since this section only renders rows for selected chains. Prune them where they are
  // made rather than leaving them to fail at submit.
  const latestRef = useRef({ operators, sortedChains, setFieldValue, fromStage });
  latestRef.current = { operators, sortedChains, setFieldValue, fromStage };
  useEffect(() => {
    const latest = latestRef.current;
    // An operator carried on stage 1 by an older draft, with no per-chain entries of its own:
    // fill the rows in so the reader sees the address they are about to deploy with.
    if (latest.operators.length === 0 && latest.fromStage !== "" && !isDisabled(latest.fromStage)) {
      latest.setFieldValue(
        "operator",
        latest.sortedChains.map((chainId) => ({
          chainId: String(chainId),
          address: latest.fromStage,
        })),
      );
      return;
    }
    const kept = latest.operators.filter((entry) =>
      latest.sortedChains.some((chainId) => Number(chainId) === Number(entry.chainId)),
    );
    if (kept.length !== latest.operators.length) latest.setFieldValue("operator", kept);
  }, [values.chainIds, operators.length]);

  const setAddress = (chainId: JBChainId, address: string) => {
    const index = operators.findIndex((entry) => Number(entry.chainId) === Number(chainId));
    if (index === -1) {
      setFieldValue("operator", [...operators, { chainId: String(chainId), address }]);
    } else {
      setFieldValue(`operator.${index}.address`, address);
    }
  };

  const setControlsEnabled = (enabled: boolean) => {
    // An entry per selected chain either way: an empty list would fall back to stage 1's
    // address, which is the sentinel by default — silently deploying with no operator while
    // the box reads as checked.
    setFieldValue(
      "operator",
      sortedChains.map((chainId) => ({
        chainId: String(chainId),
        address: enabled ? (isDisabled(fromStage) ? "" : fromStage) : PERMANENTLY_DISABLED_OPERATOR,
      })),
    );
    if (values.stages.length > 0 && !enabled) {
      setFieldValue("stages.0.initialOperator", PERMANENTLY_DISABLED_OPERATOR);
    }
  };

  return (
    <>
      <div className="md:col-span-1">
        <h2 className="mb-4 text-lg font-bold md:mb-2">4. Operator</h2>
        <p className="text-lg text-zinc-600">
          An optional address holding limited controls over the revnet once it&apos;s deployed.
        </p>
        <p className="mt-2 text-lg text-zinc-600">
          Whoever you name here can be changed later only by the operator itself.
        </p>
      </div>
      <div className="mt-6 md:col-span-2 md:mt-0">
        <label className="flex cursor-pointer items-start gap-3 border border-melon-300 bg-melon-25 p-4">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-green-600"
            checked={controlsEnabled}
            disabled={disabled || sortedChains.length === 0}
            onChange={(event) => setControlsEnabled(event.target.checked)}
          />
          <span>
            <span className="block text-md font-semibold text-zinc-800">
              Enable limited operator controls
            </span>
            <span className="mt-1 block text-sm leading-relaxed text-zinc-500">
              An operator can update the revnet&apos;s name, logo, and description; redirect only
              the precommitted split limit; manage shop inventory; and extend the revnet to new
              approved chains. It cannot rewrite staged issuance, cash out rules, or sequencing.
            </span>
          </span>
        </label>
        {sortedChains.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            Select the chains you&apos;re deploying on first.
          </p>
        ) : controlsEnabled ? (
          <div className="mt-4">
            <div className="mb-2 text-sm text-zinc-500">
              Confirm the revnet operator&apos;s address for each chain.
            </div>
            <div className="mb-2 flex text-sm font-semibold text-zinc-500">
              <div className="w-48">Chain</div>
              <div>Address</div>
            </div>
            {sortedChains.map((chain) => (
              <div key={chain} className="mt-4 flex items-center text-md text-zinc-600">
                <div className="flex w-48 items-center gap-2 text-sm">
                  <ChainLogo chainId={chain} width={25} height={25} />
                  <div className="text-zinc-400">{JB_CHAINS[chain].name}</div>
                </div>
                <div className="w-3/5">
                  <input
                    aria-label={`${JB_CHAINS[chain].name} operator address`}
                    className={inputClassName}
                    placeholder="0x"
                    disabled={disabled}
                    required
                    value={entryFor(chain)?.address ?? ""}
                    onChange={(event) => setAddress(chain, event.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-zinc-500">
            No operator address will retain these limited controls.
          </p>
        )}
      </div>
    </>
  );
}
