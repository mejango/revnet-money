import { ChainLogo } from "@/components/ChainLogo";
import { useFormContext } from "@/lib/forms";
import { sortChains } from "@/lib/utils";
import { JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import { useEffect, useRef } from "react";
import { PERMANENTLY_DISABLED_OPERATOR } from "../constants";
import { RevnetFormData } from "../types";

const inputClassName =
  "flex h-9 w-full border-2 border-melon-300 bg-melon-25 px-3 py-1.5 text-md placeholder:text-zinc-500 hover:border-melon-400 focus-visible:border-melon-600 focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Per-chain operator inputs, rendered and bound BY CHAIN ID: each row reads
 * and writes the `operator` entry whose chainId matches the chain named
 * beside it, so selection order can never cross-wire an address onto another
 * chain's deployment. Entries are created only when the user types (never
 * seeded empty, which would dead-end validation once this section unmounts),
 * and entries left empty are removed on unmount.
 */
export function ChainOperator({ disabled = false }: { disabled?: boolean }) {
  const { values, setFieldValue } = useFormContext<RevnetFormData>();
  const operators = values.operator;

  const latestRef = useRef({ operators, setFieldValue });
  latestRef.current = { operators, setFieldValue };
  useEffect(
    () => () => {
      const latest = latestRef.current;
      const kept = latest.operators.filter((entry) => entry.address.trim() !== "");
      if (kept.length !== latest.operators.length) latest.setFieldValue("operator", kept);
    },
    [],
  );

  const entryFor = (chainId: JBChainId) =>
    operators.find((entry) => Number(entry.chainId) === Number(chainId));

  const setAddress = (chainId: JBChainId, address: string) => {
    const index = operators.findIndex((entry) => Number(entry.chainId) === Number(chainId));
    if (index === -1) {
      setFieldValue("operator", [...operators, { chainId: String(chainId), address }]);
    } else {
      setFieldValue(`operator.${index}.address`, address);
    }
  };

  const sortedChains = sortChains(values.chainIds);
  const controlsEnabled = !(
    sortedChains.length > 0 &&
    sortedChains.every(
      (chainId) =>
        entryFor(chainId)?.address.trim().toLowerCase() === PERMANENTLY_DISABLED_OPERATOR,
    )
  );

  const setControlsEnabled = (enabled: boolean) => {
    setFieldValue(
      "operator",
      enabled
        ? []
        : sortedChains.map((chainId) => ({
            chainId: String(chainId),
            address: PERMANENTLY_DISABLED_OPERATOR,
          })),
    );
  };

  return (
    <>
      <h2 className="text-left text-black-500 mb-4 font-semibold">Revnet operator</h2>
      <div className="mb-8">
        <label className="flex cursor-pointer items-start gap-3 border border-melon-300 bg-melon-25 p-4">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-green-600"
            checked={controlsEnabled}
            disabled={disabled}
            onChange={(event) => setControlsEnabled(event.target.checked)}
          />
          <span>
            <span className="block text-md font-semibold text-zinc-800">
              Enable limited operator controls
            </span>
            <span className="mt-1 block text-sm leading-relaxed text-zinc-500">
              An operator can update the revnet&apos;s name, logo, and description; redirect only
              the precommitted split share; manage shop items only where those permissions were
              enabled; and add matching chains when the original deployer is the operator. It
              cannot rewrite staged issuance or cash-out rules.
            </span>
          </span>
        </label>
        {controlsEnabled ? (
          <div className="mt-4">
            <div className="mb-2 text-sm text-zinc-500">
              Confirm the revnet operator&apos;s address for each chain.
            </div>
            <div className="flex mb-2 text-sm font-semibold text-zinc-500">
              <div className="w-48">Chain</div>
              <div>Address</div>
            </div>
            {sortedChains.map((chain) => (
              <div key={chain} className="flex items-center text-md text-zinc-600 mt-4">
                <div className="flex gap-2 items-center w-48 text-sm">
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
                  <p className="mt-1 text-xs text-zinc-500">
                    Currently set to {entryFor(chain)?.address.trim() || "no operator yet"}.
                  </p>
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
