"use client";

import { EthereumAddress, ensAvatarUrlForAddress } from "@/components/EthereumAddress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEnsAddress } from "@/hooks/ens/useEnsAddress";
import { useEnsName } from "@/hooks/ens/useEnsName";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { isAddress, type Address } from "viem";
import { mainnet } from "viem/chains";

export function AccountHeader({
  address,
  ensName,
  isSelf,
}: {
  address: Address;
  ensName?: string;
  isSelf: boolean;
}) {
  const router = useRouter();
  const { data: reverseName } = useEnsName(address, { enabled: !ensName });
  const displayName = ensName ?? reverseName ?? undefined;

  const [viewAs, setViewAs] = useState("");
  const trimmed = viewAs.trim();
  const typedAddress = isAddress(trimmed) ? trimmed : undefined;
  const looksLikeEns = !typedAddress && trimmed.includes(".");
  const { data: resolvedAddress, isLoading: resolving } = useEnsAddress(
    looksLikeEns ? trimmed : undefined,
    { enabled: looksLikeEns },
  );
  const target = typedAddress ?? (looksLikeEns ? (resolvedAddress ?? undefined) : undefined);

  const view = () => {
    if (!target) return;
    setViewAs("");
    router.push(`/account/${target}`);
  };

  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-center gap-3">
        <Image
          src={ensAvatarUrlForAddress(address, { size: 96 })}
          alt={displayName ?? address}
          width={48}
          height={48}
          className="h-12 w-12 rounded-full"
        />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-zinc-800">
            {displayName ?? `${address.slice(0, 6)}…${address.slice(-4)}`}
          </h1>
          <div className="break-all font-mono text-xs text-zinc-500">
            <EthereumAddress address={address} withEnsName={false} chain={mainnet} />
          </div>
          {isSelf ? (
            <span className="mt-1 inline-block rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">
              This is you
            </span>
          ) : null}
        </div>
      </div>
      <form
        className="flex w-full max-w-sm items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          view();
        }}
      >
        <Input
          value={viewAs}
          onChange={(event) => setViewAs(event.target.value)}
          placeholder="View as address or ENS"
          aria-label="View another account"
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="min-h-10"
          disabled={!target}
          loading={looksLikeEns && resolving}
        >
          View
        </Button>
      </form>
    </header>
  );
}
