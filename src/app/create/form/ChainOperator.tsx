import { ChainLogo } from "@/components/ChainLogo";
import { useFormContext } from "@/lib/forms";
import { sortChains } from "@/lib/utils";
import { JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import { useEffect, useRef } from "react";
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

  return (
    <>
      <h2 className="text-left text-black-500 mb-4 font-semibold">Project operator</h2>
      <div className="mb-8">
        <div className="text-sm text-zinc-500">
          Confirm the project operator's address for each chain.
        </div>
        <div className="text-sm text-zinc-500">
          Project operators can re-route splits within the split limit of each stage and edit the
          name, logo, and description of the revnet.
        </div>
        <div className="text-sm text-zinc-500 mb-4">
          If the project operator is the same address that initially deploys the revnet now, it can
          deploy the revnet to new chains later on.
        </div>
        <div className="flex mb-2 text-sm font-semibold text-zinc-500">
          <div className="w-48">Chain</div>
          <div>Address</div>
        </div>
        {sortChains(values.chainIds).map((chain) => (
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
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
