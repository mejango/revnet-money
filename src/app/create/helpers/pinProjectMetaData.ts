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

/** Pin item media through this app's own redundant pinning route. */
export async function pinMediaFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/ipfs/pinMedia", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) throw new Error(`Media pinning failed (${response.status})`);
  const { Hash } = (await response.json()) as { Hash?: unknown };
  if (!isIpfsCid(Hash)) throw new Error("Media pinning returned an invalid CID");

  return Hash;
}
