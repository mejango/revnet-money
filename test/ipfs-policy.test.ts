import {
  ipfsMediaGatewayUrls,
  ipfsUriToAppUrl,
  ipfsUriToGatewayUrl,
  OPEN_IPFS_GATEWAY_HOSTNAME,
} from "@/lib/ipfs";
import { cidV0ToCidV1, isIpfsCid, isIpfsUri } from "@/lib/ipfs-cid";
import { describe, expect, it } from "vitest";

const CID_V1 = "bafkreihz5xk2crdko5mllpxbfa443m2o6pmzcmbg5b3uvif6ho4x45z674";
const CID_V0 = "QmYwAPJzv5CZsnAzt8auVZRnA3iE3m6XJqFqQ5h6XqFQwP";

describe("project image policy", () => {
  it("routes content-addressed project images through the configured gateway", () => {
    expect(ipfsUriToGatewayUrl(`ipfs://${CID_V1}/path/logo.png`)).toBe(
      `https://${OPEN_IPFS_GATEWAY_HOSTNAME}/ipfs/${CID_V1}/path/logo.png`,
    );
  });

  it("rejects arbitrary project-controlled optimizer targets", () => {
    expect(ipfsUriToGatewayUrl("https://attacker.example/tracker.png")).toBeUndefined();
    expect(ipfsUriToGatewayUrl("data:image/svg+xml,<svg/>")).toBeUndefined();
    expect(ipfsUriToGatewayUrl("ipfs://bafy-nope/logo.png")).toBeUndefined();
    expect(ipfsUriToGatewayUrl(`ipfs://${CID_V1}/../logo.png`)).toBeUndefined();
    expect(ipfsUriToGatewayUrl(`ipfs://${CID_V1}/logo%2Fescape.png`)).toBeUndefined();
  });

  it("routes only safe IPFS URIs through the bounded application media route", () => {
    expect(ipfsUriToAppUrl(`ipfs://${CID_V1}/path/logo.png`)).toBe(
      `/api/ipfs/${CID_V1}/path/logo.png`,
    );
    expect(ipfsUriToAppUrl("https://attacker.example/tracker.png")).toBeUndefined();
    expect(ipfsUriToAppUrl(`ipfs://${CID_V1}/../logo.png`)).toBeUndefined();
    expect(ipfsUriToAppUrl(`ipfs://${CID_V1}/logo%2Fescape.png`)).toBeUndefined();
  });

  it("prefers eth.sucks media URLs and converts CIDv0 to DNS-safe CIDv1", () => {
    const bannyCid = "QmWxEUm7YCv5oDP1sssMErUrh5AYTxU2hnLCraFEH6BqdQ";
    const bannyCidV1 = "bafybeid77ma6vjh4nseklbvgioi2cej2tmid2nkut37zf2vbyjwjnhptd4";

    expect(cidV0ToCidV1(bannyCid)).toBe(bannyCidV1);
    expect(ipfsMediaGatewayUrls(`ipfs://${bannyCid}`)[0]).toBe(`https://${bannyCidV1}.eth.sucks/`);
    expect(ipfsMediaGatewayUrls(`ipfs://${CID_V1}/image.png`)[0]).toBe(
      `https://${CID_V1}.eth.sucks/image.png`,
    );
  });
});

describe("IPFS CID policy", () => {
  it("accepts reviewed CIDv0 and CIDv1 forms and exact metadata URIs", () => {
    expect(isIpfsCid(CID_V0)).toBe(true);
    expect(isIpfsCid(CID_V1)).toBe(true);
    expect(isIpfsUri(`ipfs://${CID_V1}`)).toBe(true);
  });

  it.each([
    "",
    "bafy",
    "bafybeigdyrztabcdefghijklmnop",
    `${CID_V1}a`,
    "bafybeigdyrztabcdefghijklmnop!",
    `b${"a".repeat(121)}`,
    "Qm0wAPJzv5CZsnAzt8auVZRnA3iE3m6XJqFqQ5h6XqFQwP",
    `ipfs://${CID_V1}`,
  ])("rejects malformed or wrapped CID input %j", (value) => {
    expect(isIpfsCid(value)).toBe(false);
  });
});
