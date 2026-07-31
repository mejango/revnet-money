import { isIpfsCid } from "@/lib/ipfs-cid";
import { JBProjectMetadata } from "@bananapus/nana-sdk-core";

export async function pinProjectMetadata(metadata: JBProjectMetadata) {
  return pinJsonMetadata(metadata as unknown as Record<string, unknown>);
}

/** Pin bounded metadata JSON through the app's redundant IPFS pinning route. */
export async function pinJsonMetadata(metadata: Record<string, unknown>) {
  const response = await fetch("/api/ipfs/pinJson", {
    method: "post",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });
  if (!response.ok) throw new Error(`Metadata pinning failed (${response.status})`);
  const { Hash } = (await response.json()) as { Hash?: unknown };
  if (!isIpfsCid(Hash)) throw new Error("Metadata pinning returned an invalid CID");

  return Hash;
}
