"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Project } from "@/generated/graphql";
import { isUsd } from "@/lib/currency";
import { formatTokenAmount, getTokenFractionDigits, isNativeToken } from "@/lib/token";
import { DEFAULT_NATIVE_TOKEN_SYMBOL, JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { formatUnits } from "viem";

const PRICE_REFRESH_INTERVAL = 5 * 60_000;

interface Props {
  projects: Array<
    Pick<Project, "chainId" | "projectId" | "token" | "decimals" | "balance" | "tokenSymbol">
  >;
}

export function TvlDatum(props: Props) {
  const { projects } = props;

  const token = useMemo(() => {
    return {
      address: projects[0].token as `0x${string}`,
      symbol: projects[0].tokenSymbol || DEFAULT_NATIVE_TOKEN_SYMBOL,
      decimals: projects[0].decimals || 18,
      isNative: isNativeToken(projects[0].token),
    };
  }, [projects]);

  // Non-ETH projects do not need this external price. Keeping the query
  // disabled avoids unnecessary traffic, latency, and a needless failure
  // dependency for USDC-denominated project headers.
  const { data: ethPrice } = useQuery({
    queryKey: ["revnet", "etherPrice"],
    queryFn: async () => {
      const response = await fetch("https://juicebox.money/api/juicebox/prices/ethusd");
      if (!response.ok) throw new Error(`ETH price request failed (${response.status})`);
      const data = (await response.json()) as { price: number | string };
      const price = Number(data.price);
      if (!Number.isFinite(price) || price <= 0) throw new Error("ETH price response is invalid");
      return price;
    },
    enabled: token.symbol === "ETH",
    staleTime: PRICE_REFRESH_INTERVAL,
  });

  const total = useMemo(() => {
    const value = projects.reduce((acc, project) => acc + BigInt(project.balance), 0n);
    if (token.symbol === "ETH" && ethPrice) {
      const usdValue = Number(formatUnits(value, token.decimals)) * ethPrice;
      return `$${usdValue.toLocaleString("en-US", getTokenFractionDigits("USD"))}`;
    }
    if (isUsd(token.symbol)) {
      return `$${formatTokenAmount(value, token)}`;
    }
    return `${formatTokenAmount(value, token)} ${token.symbol}`;
  }, [projects, ethPrice, token]);

  return (
    <Tooltip>
      <TooltipTrigger className="min-h-11 sm:min-h-0">
        <span className="sm:text-xl text-lg">
          <span className="font-medium text-black">{total}</span>{" "}
          <span className="text-zinc-500">balance</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="w-64">
        {projects.map((project) => {
          const symbol = project.tokenSymbol || DEFAULT_NATIVE_TOKEN_SYMBOL;
          return (
            <div key={project.chainId} className="flex justify-between gap-2">
              {JB_CHAINS[project.chainId as JBChainId].name}
              <span className="font-medium">
                {formatTokenAmount(project.balance, { symbol, decimals: project.decimals || 18 })}{" "}
                {symbol}
              </span>
            </div>
          );
        })}
        <hr className="py-1" />
        <div className="flex justify-between gap-2">
          <span>[All chains]</span>
          <span className="font-medium">{total}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
