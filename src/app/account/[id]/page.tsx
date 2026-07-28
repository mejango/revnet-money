import { Nav } from "@/components/layout/Nav";
import { getDwellirRpcUrl } from "@/lib/dwellir";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createPublicClient, getAddress, http, isAddress, type Address } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import { AccountView } from "./components/AccountView";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Account | Revnet" };
}

/** Resolve the route param — a 0x address or an ENS name — to an address. */
async function resolveAccount(
  id: string,
): Promise<{ address: Address; ensName?: string } | null> {
  const raw = decodeURIComponent(id).trim();
  if (isAddress(raw)) return { address: getAddress(raw) };

  let name: string;
  try {
    name = normalize(raw);
  } catch {
    return null;
  }
  if (!name.includes(".")) return null;

  // Forward-resolve on the configured mainnet transport, mirroring
  // useEnsName's onchain-only policy.
  const rpcUrl = getDwellirRpcUrl(mainnet.id);
  const client = createPublicClient({
    chain: mainnet,
    transport: rpcUrl ? http(rpcUrl) : http(),
  });
  const address = await client.getEnsAddress({ name }).catch(() => null);
  return address ? { address, ensName: name } : null;
}

export default async function AccountPage(props: Props) {
  const { id } = await props.params;
  const account = await resolveAccount(id);
  if (!account) notFound();

  return (
    <>
      <Nav />
      <div className="w-full px-4 pb-16 pt-6 sm:container">
        <AccountView address={account.address} ensName={account.ensName} />
      </div>
    </>
  );
}
