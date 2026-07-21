import { JB_CHAIN_SLUGS, JBChainId } from "@bananapus/nana-sdk-core";

export function parseSlug(slug: string) {
  const parts = decodeURIComponent(slug.trim()).split(":");
  if (parts.length !== 2) throw new Error("Invalid project route");

  const [chainSlug, rawProjectId] = parts;
  const chain = JB_CHAIN_SLUGS[chainSlug.trim()];

  let projectId: bigint;
  try {
    projectId = BigInt(rawProjectId);
  } catch {
    throw new Error("Invalid project route");
  }

  if (!chain || projectId <= 0n) throw new Error("Invalid project route");

  return {
    chainId: chain.chain.id as JBChainId,
    projectId,
  };
}
