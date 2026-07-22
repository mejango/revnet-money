"use client";

import { EthereumAddress } from "@/components/EthereumAddress";
import { Participant } from "@/generated/graphql";
import { formatPortion } from "@/lib/utils";
import { JBChainId, JBProjectToken } from "@bananapus/nana-sdk-core";
import { useMemo, useState } from "react";
import { Address } from "viem";
import { UseTokenReturnType } from "wagmi";

const OWNER_COLOR = "#EE6F3A"; // peel-400
const OWNER_HOVER_COLOR = "#BD4513"; // peel-600

const OwnerTooltip = ({
  item,
  totalSupply,
}: {
  item: { address: Address; balance: JBProjectToken };
  totalSupply: bigint;
}) => {
  const portion = formatPortion(item.balance.value, totalSupply);

  return (
    <>
      <EthereumAddress address={item.address} short />
      <div className="text-zinc-500">
        {item.balance.format()} tokens ({portion}%)
      </div>
    </>
  );
};

export function ParticipantsPieChart({
  totalSupply,
  participants,
  showOwnerCount = false,
}: {
  token: UseTokenReturnType["data"] | null;
  totalSupply: bigint;
  participants: (Participant & { chains: JBChainId[] })[];
  showOwnerCount?: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  // TODO maybe can remove this when balance=0 bug fixed in subgraph
  const totalBalance = useMemo(
    () => participants?.reduce((acc, participant) => acc + BigInt(participant?.balance), BigInt(0)),
    [participants],
  );

  const pieChartData = useMemo(() => {
    let offset = 0;
    return participants?.map((participant) => {
      const balance = new JBProjectToken(BigInt(participant?.balance));
      const share =
        totalBalance === 0n ? 0 : Number((balance.value * 1_000_000n) / totalBalance) / 10_000;
      const segment = {
        address: participant?.address as Address,
        balance,
        offset,
        share,
      };
      offset += share;
      return {
        ...segment,
        visibleShare: Math.max(0, share - Math.min(0.25, share / 2)),
      };
    });
  }, [participants, totalBalance]);

  if (totalBalance === 0n) return null;

  const activeItem = activeIndex === null ? null : pieChartData[activeIndex];

  return (
    <div className="relative h-[240px] w-full sm:h-[360px]">
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label={`Distribution of ${participants.length} owners`}
        className="h-full w-full -rotate-90"
      >
        <circle cx="50" cy="50" r="35" fill="none" stroke="#C6EDD5" strokeWidth="30" />
        {pieChartData.map((item, index) => (
          <circle
            key={item.address}
            cx="50"
            cy="50"
            r="35"
            pathLength="100"
            fill="none"
            stroke={index === activeIndex ? OWNER_HOVER_COLOR : OWNER_COLOR}
            strokeWidth="30"
            strokeDasharray={`${item.visibleShare} ${100 - item.visibleShare}`}
            strokeDashoffset={-item.offset}
            className="cursor-default transition-colors duration-150"
            onMouseEnter={() => setActiveIndex(index)}
            onMouseLeave={() => setActiveIndex(null)}
          />
        ))}
      </svg>
      {activeItem ? (
        <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 border border-zinc-200 bg-white px-5 py-3 text-sm shadow-md">
          <OwnerTooltip item={activeItem} totalSupply={totalSupply} />
        </div>
      ) : null}
      {showOwnerCount ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-semibold leading-none text-black tabular-nums">
            {participants.length}
          </span>
          <span className="mt-2 text-sm uppercase text-melon-700">owners</span>
        </div>
      ) : null}
    </div>
  );
}
