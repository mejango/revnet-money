import { ProjectOperation, SuckerGroupOperation, useBendystrawQuery } from "@/lib/bendystraw";
import { useJBChainId, useJBContractContext } from "@/lib/nana/project";
import { isNativeToken, Token } from "@/lib/token";
import { getTokenSymbolFromAddress } from "@/lib/tokenUtils";
import { JBChainId, NATIVE_TOKEN_DECIMALS } from "@bananapus/nana-sdk-core";
import { useMemo } from "react";

type ReturnData = Token & {
  tokenMap: Record<JBChainId, Token>;
  /** Accounting-context currency id for the project's base token. */
  currency: number;
};

function resolveBaseToken(project: {
  token?: string | null;
  tokenSymbol?: string | null;
  decimals?: number | null;
  currency?: number | string | null;
}): Token & { currency: number } {
  const address = project.token as `0x${string}`;
  const fromAddress = getTokenSymbolFromAddress(address);
  // Prefer ETH/USDC labels for known reserve assets over the project ticker, and pin
  // USDC to 6 decimals (the indexer reports the project token's 18).
  const symbol = fromAddress === "TOKEN" ? project.tokenSymbol || "TOKEN" : fromAddress;
  const decimals = fromAddress === "USDC" ? 6 : project.decimals || NATIVE_TOKEN_DECIMALS;
  const isNative = isNativeToken(project.token ?? null);

  return {
    address,
    symbol,
    isNative,
    decimals,
    currency: Number(project.currency ?? (isNative ? 1 : 0)),
  };
}

export function useProjectBaseToken(): ReturnData | undefined {
  const { projectId } = useJBContractContext();
  const chainId = useJBChainId();

  const { data } = useBendystrawQuery(
    ProjectOperation,
    { chainId: Number(chainId), projectId: Number(projectId), version: 6 },
    { enabled: !!chainId && !!projectId, pollInterval: 30000 },
  );

  const { data: suckerGroupData } = useBendystrawQuery(
    SuckerGroupOperation,
    { id: data?.project?.suckerGroupId ?? "" },
    { enabled: !!data?.project?.suckerGroupId, pollInterval: 30000, chainId: Number(chainId) },
  );

  // Memoized so consumers can use the result in effect deps without looping.
  return useMemo(() => {
    if (!data?.project) return undefined;

    const tokenMap =
      suckerGroupData?.suckerGroup?.projects?.items?.reduce(
        (acc, project) => {
          if (project.token) {
            const { currency: _currency, ...token } = resolveBaseToken(project);
            acc[Number(project.chainId) as JBChainId] = token;
          }
          return acc;
        },
        {} as Record<JBChainId, Token>,
      ) || ({} as Record<JBChainId, Token>);

    return { ...resolveBaseToken(data.project), tokenMap };
  }, [data?.project, suckerGroupData?.suckerGroup?.projects?.items]);
}
