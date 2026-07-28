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

/** The route slug (e.g. "eth:3") for a project, or undefined for unknown chains. */
export function slugFor(chainId: number, projectId: number | bigint): string | undefined {
  const entry = Object.entries(JB_CHAIN_SLUGS).find(([, value]) => value.chain.id === chainId);
  return entry ? `${entry[0]}:${projectId}` : undefined;
}
