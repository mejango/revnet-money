import { cidV0ToCidV1, isIpfsCid, isIpfsUri } from "./ipfs-cid";

export { isIpfsCid, isIpfsUri } from "./ipfs-cid";

const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._~-]{1,128}$/u;

// This is an open gateway. It exposes any IPFS content, not just content we
// pin. It is the last fallback after the media cache and Pinata.
export const OPEN_IPFS_GATEWAY_HOSTNAME = "ipfs.io";

// Independent fallback for cold/unpinned content on the configured gateway.
const PUBLIC_IPFS_GATEWAY_HOSTNAME = "gateway.pinata.cloud";
const IPFS_MEDIA_CACHE_HOSTNAME = "eth.sucks";

/**
 * Return a URL to our open IPFS gateway for the given cid USING INFURA.
 *
 * The 'open' gateway returns any content that is available on IPFS,
 * not just the content we have pinned.
 */
export const ipfsGatewayUrl = (cid: string | undefined): string => {
  if (!cid || !isSafeIpfsPath(cid)) throw new Error("Invalid IPFS CID or path");
  return `https://${OPEN_IPFS_GATEWAY_HOSTNAME}/ipfs/${cid}`;
};

/**
 * Return a URL to a public IPFS gateway for the given cid
 */
export const ipfsPublicGatewayUrl = (cid: string | undefined): string => {
  if (!cid || !isSafeIpfsPath(cid)) throw new Error("Invalid IPFS CID or path");
  return `https://${PUBLIC_IPFS_GATEWAY_HOSTNAME}/ipfs/${cid}`;
};

/**
 * Return an IPFS URI using the IPFS URI scheme.
 */
export function ipfsUri(cid: string, path?: string) {
  const suffix = `${cid}${path ?? ""}`;
  if (!isSafeIpfsPath(suffix)) throw new Error("Invalid IPFS CID or path");
  return `ipfs://${suffix}`;
}

/**
 * Return the IPFS CID from a given [url].
 *
 * Assumes that the last path segment is the CID.
 * @todo this isn't a great assumption. We should make this more robust, perhaps using a regex.
 */
export const cidFromUrl = (url: string) => {
  const candidate = url.split("/").pop();
  return isIpfsCid(candidate) ? candidate : undefined;
};

export const cidFromIpfsUri = (uri: string) =>
  isIpfsUri(uri) ? uri.slice("ipfs://".length) : undefined;

/**
 * Returns a native IPFS link (`ipfs://`) as a https link.
 */
export function ipfsUriToGatewayUrl(ipfsUri: string): string | undefined {
  // Project metadata is untrusted. Only content-addressed images may pass
  // through the server-side Next image optimizer; arbitrary HTTPS URLs would
  // turn it into a public fetch proxy.
  if (!ipfsUri.startsWith("ipfs://")) return undefined;
  const suffix = ipfsUri.slice("ipfs://".length);
  if (!isSafeIpfsPath(suffix)) return undefined;
  return suffix ? ipfsGatewayUrl(suffix) : undefined;
}

/**
 * Returns a same-origin URL for an untrusted, content-addressed IPFS URI.
 *
 * The route validates the CID/path, media type, and response size before
 * serving bytes. Keeping this separate from Next's image optimizer prevents a
 * slow public gateway from tying up `/_next/image` requests.
 */
export function ipfsUriToAppUrl(ipfsUri: unknown): string | undefined {
  if (typeof ipfsUri !== "string" || !ipfsUri.startsWith("ipfs://")) return undefined;
  const suffix = ipfsUri.slice("ipfs://".length);
  if (!isSafeIpfsPath(suffix)) return undefined;
  return `/api/ipfs/${suffix}`;
}

/**
 * Trusted read candidates for immutable media. The CID subdomain cache is
 * preferred; path gateways are sequential fallbacks. CIDv0 is converted to
 * the equivalent DAG-PB CIDv1 so it is safe to place in DNS.
 */
export function ipfsMediaGatewayUrls(ipfsUri: unknown): string[] {
  if (typeof ipfsUri !== "string" || !ipfsUri.startsWith("ipfs://")) return [];
  const suffix = ipfsUri.slice("ipfs://".length);
  if (!isSafeIpfsPath(suffix)) return [];

  const [cid, ...pathSegments] = suffix.split("/");
  const dnsCid = cidV0ToCidV1(cid) ?? (cid.startsWith("b") ? cid : undefined);
  const path = pathSegments.length ? `/${pathSegments.join("/")}` : "/";
  const urls = [
    dnsCid ? `https://${dnsCid}.${IPFS_MEDIA_CACHE_HOSTNAME}${path}` : undefined,
    `https://${PUBLIC_IPFS_GATEWAY_HOSTNAME}/ipfs/${suffix}`,
    `https://${OPEN_IPFS_GATEWAY_HOSTNAME}/ipfs/${suffix}`,
  ];
  return [...new Set(urls.filter((url): url is string => Boolean(url)))];
}

function isSafeIpfsPath(value: string): boolean {
  const segments = value.split("/");
  if (segments.length < 1 || segments.length > 8 || !isIpfsCid(segments[0])) return false;
  if (
    segments
      .slice(1)
      .some((segment) => segment === "." || segment === ".." || !SAFE_PATH_SEGMENT.test(segment))
  ) {
    return false;
  }
  return value.length <= 512;
}
