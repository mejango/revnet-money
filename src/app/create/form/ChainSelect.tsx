import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  sepolia,
} from "@/lib/chains";
import { FormField } from "@/lib/forms";
import { JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import { useEffect, useState } from "react";
import {
  pruneDeselectedChain,
  pruneHiddenEnvironmentChains,
} from "../helpers/pruneDeselectedChain";
import { useCreateForm } from "./useCreateForm";

const TESTNETS: JBChainId[] = [sepolia.id, arbitrumSepolia.id, optimismSepolia.id, baseSepolia.id];

const MAINNETS: JBChainId[] = [mainnet.id, optimism.id, base.id, arbitrum.id];

export function ChainSelect({ disabled = false }: { disabled?: boolean }) {
  const [environment, setEnvironment] = useState("production");

  const { values, setFieldValue } = useCreateForm();

  const handleChainSelect = (chainId: JBChainId, checked: boolean) => {
    setFieldValue(
      "chainIds",
      checked ? [...values.chainIds, chainId] : values.chainIds.filter((id) => id !== chainId),
    );

    // If removed, drop that chain's per-chain overrides so nothing is orphaned.
    if (!checked) {
      const pruned = pruneDeselectedChain(values, chainId);
      setFieldValue("operator", pruned.operator);
      setFieldValue("stages", pruned.stages);
    }
  };

  // If only one chain is selected, set the chainId for auto issuance to the selected chain
  useEffect(() => {
    if (values.chainIds.length > 1) return;

    const chainId = values.chainIds[0];
    if (!chainId) return;

    values.stages.forEach((stage, stageIndex) => {
      stage.autoIssuance.forEach((issuance, index) => {
        if (issuance.chainId !== chainId && issuance.amount && issuance.beneficiary) {
          console.debug(
            `Setting chainId for auto issuance (${stageIndex + 1}.${index + 1}) to ${chainId}`,
          );

          setFieldValue(`stages.${stageIndex}.autoIssuance.${index}.chainId`, chainId);
        }
      });
    });
  }, [values.chainIds, values.stages, setFieldValue]);

  return (
    <div className="flex flex-col gap-4">
      <div className="text-black-500 text-left font-semibold">Choose your chains</div>
      <div className="max-w-56">
        <Select
          onValueChange={(v) => {
            setEnvironment(v);
            // The other environment's chains are no longer visible; drop
            // their selections and per-chain rows so nothing hidden stays
            // part of the deployment.
            const pruned = pruneHiddenEnvironmentChains(
              values,
              v === "production" ? MAINNETS : TESTNETS,
            );
            setFieldValue("chainIds", pruned.chainIds);
            setFieldValue("operator", pruned.operator);
            setFieldValue("stages", pruned.stages);
          }}
          defaultValue="production"
          disabled={disabled}
        >
          <SelectTrigger
            aria-label="Deployment environment"
            className="col-span-1 border-2 border-melon-300 bg-melon-25 hover:border-melon-400 focus:border-melon-600 focus:ring-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="production" key="production">
              Production
            </SelectItem>
            <SelectItem value="testing" key="testing">
              Testnets
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="mt-4 flex flex-wrap gap-6">
        {Object.values(JB_CHAINS)
          .filter(({ chain }) =>
            (environment === "production" ? MAINNETS : TESTNETS).includes(chain.id as JBChainId),
          )
          .map(({ chain, name }) => (
            <label key={chain.id} className="flex items-center gap-2">
              <FormField
                type="checkbox"
                name="chainIds"
                value={chain.id}
                disabled={disabled}
                className="disabled:opacity-50"
                checked={values.chainIds.includes(Number(chain.id) as JBChainId)}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  handleChainSelect(chain.id as JBChainId, e.target.checked);
                }}
              />
              {name}
            </label>
          ))}
      </div>
    </div>
  );
}
