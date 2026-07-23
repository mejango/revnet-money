import type { Project } from "@/lib/bendystraw/types";
import { ratioOfScaledIntegers } from "@/lib/fixedPoint";
import {
  getProjectTerminalStore,
  JB_TOKEN_DECIMALS,
  JBChainId,
  jbTerminalStoreAbi,
  NATIVE_TOKEN_DECIMALS,
} from "@bananapus/nana-sdk-core";
import { getContract, parseUnits } from "viem";
import { toBaseCurrencyId } from "./currency";
import { applyNanaFee, applyRevFee } from "./feeHelpers";
import { getViemPublicClient } from "./wagmiConfig";

export async function getReclaimableSurplus(
  chainId: JBChainId,
  projectId: number,
  tokenAmountWei: bigint,
  decimals: number,
  currencyId: 1 | 2 | 3,
) {
  try {
    const contract = getContract({
      address: getProjectTerminalStore(chainId, 6),
      abi: jbTerminalStoreAbi,
      client: getViemPublicClient(chainId),
    });

    const userReclaimable = await contract.read.currentReclaimableSurplusOf([
      BigInt(projectId),
      applyRevFee(tokenAmountWei),
      [],
      [],
      BigInt(decimals),
      BigInt(currencyId),
    ]);

    return applyNanaFee(userReclaimable).toString();
  } catch (error) {
    console.debug({ chainId, projectId, tokenAmountWei, decimals, currencyId });
    console.error(error);
    return "0";
  }
}

export async function getProjectsReclaimableSurplus(
  projects: Array<Pick<Project, "chainId" | "projectId" | "tokenSupply" | "decimals" | "currency">>,
) {
  return await Promise.all(
    projects.map(async (project) => {
      const { chainId, projectId, tokenSupply, currency, decimals } = project;
      const currencyId = toBaseCurrencyId(currency ?? 2);
      const tokenDecimals = JB_TOKEN_DECIMALS;

      const value = await getReclaimableSurplus(
        chainId as JBChainId,
        projectId,
        BigInt(tokenSupply),
        tokenDecimals,
        currencyId,
      );

      return {
        projectId: project.projectId,
        value,
        currencyId,
        decimals: decimals || NATIVE_TOKEN_DECIMALS,
        chainId,
        tokenDecimals,
      };
    }),
  );
}

export type Surplus = Awaited<ReturnType<typeof getProjectsReclaimableSurplus>>[number];

export function getUnitValue(
  surplus: Pick<Surplus, "value" | "decimals"> | null,
  supply: { value: string; decimals: number },
) {
  if (!surplus || supply.value === "0") return 0;

  const scaledSurplus = parseUnits(surplus.value, surplus.decimals);
  const scaledSupply = parseUnits(supply.value, supply.decimals);
  return ratioOfScaledIntegers(
    scaledSurplus * 10n ** BigInt(supply.decimals),
    scaledSupply * 10n ** BigInt(surplus.decimals),
  );
}
