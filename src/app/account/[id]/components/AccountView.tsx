"use client";

import type { Address } from "viem";
import { useAccount } from "wagmi";
import { AccountActivity } from "./AccountActivity";
import { AccountHeader } from "./AccountHeader";
import { OperatedProjects } from "./OperatedProjects";
import { OwnedProjects } from "./OwnedProjects";

export function AccountView({ address, ensName }: { address: Address; ensName?: string }) {
  const { address: connected } = useAccount();
  const isSelf = !!connected && connected.toLowerCase() === address.toLowerCase();

  return (
    <div className="flex flex-col gap-8">
      <AccountHeader address={address} ensName={ensName} isSelf={isSelf} />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="flex flex-col gap-8">
          <OwnedProjects address={address} />
          <OperatedProjects address={address} />
        </div>
        <AccountActivity address={address} isSelf={isSelf} />
      </div>
    </div>
  );
}
