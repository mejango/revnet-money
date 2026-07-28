import {
  getJBContractAddress,
  JBCoreContracts,
  RevnetCoreContracts,
} from "@bananapus/nana-sdk-core";
import { ContractFunctionRevertedError, HttpRequestError, zeroAddress } from "viem";
import { sepolia } from "viem/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryBendystraw: vi.fn(),
  readContract: vi.fn(),
}));

vi.mock("@/lib/bendystraw/query.server", () => ({
  queryBendystraw: mocks.queryBendystraw,
}));
vi.mock("@/lib/wagmiTransports", () => ({
  getViemPublicClient: () => ({ readContract: mocks.readContract }),
}));

import { getProjectWithFallback } from "@/app/[slug]/getProjectFallback";

const CHAIN_ID = sepolia.id;
const PROJECT_ID = 123;

const REV_DEPLOYER = getJBContractAddress(RevnetCoreContracts.REVDeployer, 6, CHAIN_ID);
const JB_PROJECTS = getJBContractAddress(JBCoreContracts.JBProjects, 6, CHAIN_ID).toLowerCase();
const JB_DIRECTORY = getJBContractAddress(JBCoreContracts.JBDirectory, 6, CHAIN_ID).toLowerCase();
const JB_TOKENS = getJBContractAddress(JBCoreContracts.JBTokens, 6, CHAIN_ID).toLowerCase();

const CONTROLLER = "0x00000000000000000000000000000000000000c0";
const PROJECT_TOKEN = "0x000000000000000000000000000000000000700c";
const METADATA_URI = "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3nuy5v7pnpubszuztzlyh7uqa";

const indexedRow = () => ({
  projectId: PROJECT_ID,
  metadataUri: METADATA_URI,
  handle: null,
  createdAt: 1_750_000_000,
  suckerGroupId: "group-1",
  logoUri: "ipfs://bafy-logo",
  name: "Indexed Revnet",
  version: 6,
  token: PROJECT_TOKEN,
  decimals: 18,
  currency: "1",
  tokenSymbol: "IDX",
  isRevnet: true,
});

/** Answers on-chain reads for a project that exists on-chain. */
function mockOnchainProject({ owner = REV_DEPLOYER, token = PROJECT_TOKEN, uri = "" } = {}) {
  mocks.readContract.mockImplementation(
    async ({ address, functionName }: { address: string; functionName: string }) => {
      const at = address.toLowerCase();
      if (at === JB_PROJECTS && functionName === "ownerOf") return owner;
      if (at === JB_DIRECTORY && functionName === "controllerOf") return CONTROLLER;
      if (at === JB_TOKENS && functionName === "tokenOf") return token;
      if (at === CONTROLLER.toLowerCase() && functionName === "uriOf") return uri;
      if (at === token.toLowerCase() && functionName === "symbol") return "FRESH";
      if (at === token.toLowerCase() && functionName === "decimals") return 18;
      throw new Error(`Unexpected read ${functionName} on ${address}`);
    },
  );
}

const nonexistentTokenError = () =>
  new ContractFunctionRevertedError({
    abi: [],
    functionName: "ownerOf",
    message: "execution reverted",
  });

describe("getProjectWithFallback", () => {
  beforeEach(() => {
    mocks.queryBendystraw.mockReset();
    mocks.readContract.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("returns the indexed row without touching the chain when bendystraw is healthy", async () => {
    mocks.queryBendystraw.mockResolvedValue({ project: indexedRow() });

    const result = await getProjectWithFallback(PROJECT_ID, CHAIN_ID);

    expect(result).toEqual({ project: indexedRow(), degraded: false });
    expect(mocks.readContract).not.toHaveBeenCalled();
  });

  it("builds a degraded on-chain shell when bendystraw throws (indexer outage)", async () => {
    mocks.queryBendystraw.mockRejectedValue(new Error("bendystraw down"));
    mockOnchainProject();

    const result = await getProjectWithFallback(PROJECT_ID, CHAIN_ID);

    expect(result?.degraded).toBe(true);
    expect(result?.project).toMatchObject({
      projectId: PROJECT_ID,
      version: 6,
      token: PROJECT_TOKEN,
      tokenSymbol: "FRESH",
      decimals: 18,
      isRevnet: true,
    });
  });

  it("builds a degraded shell when bendystraw has no row yet (indexing window)", async () => {
    mocks.queryBendystraw.mockResolvedValue({ project: null });
    mockOnchainProject();

    const result = await getProjectWithFallback(PROJECT_ID, CHAIN_ID);

    expect(result?.degraded).toBe(true);
    expect(result?.project.projectId).toBe(PROJECT_ID);
    expect(result?.project.token).toBe(PROJECT_TOKEN);
  });

  it("resolves name and logo from IPFS metadata via the controller uri", async () => {
    mocks.queryBendystraw.mockResolvedValue({ project: null });
    mockOnchainProject({ uri: METADATA_URI });
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ name: "Fresh Revnet", logoUri: "ipfs://bafy-fresh-logo" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await getProjectWithFallback(PROJECT_ID, CHAIN_ID);

      expect(result?.project.name).toBe("Fresh Revnet");
      expect(result?.project.logoUri).toBe("ipfs://bafy-fresh-logo");
      expect(result?.project.metadataUri).toBe(METADATA_URI);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("marks non-revnet projects so the layout can adapt", async () => {
    mocks.queryBendystraw.mockResolvedValue({ project: null });
    mockOnchainProject({ owner: "0x000000000000000000000000000000000000bEEF" });

    const result = await getProjectWithFallback(PROJECT_ID, CHAIN_ID);

    expect(result?.project.isRevnet).toBe(false);
  });

  it("still renders a shell when the project has no ERC-20 yet", async () => {
    mocks.queryBendystraw.mockResolvedValue({ project: null });
    mockOnchainProject({ token: zeroAddress });

    const result = await getProjectWithFallback(PROJECT_ID, CHAIN_ID);

    expect(result?.degraded).toBe(true);
    expect(result?.project.token).toBeNull();
  });

  it("returns null (⇒ 404) when the project does not exist on-chain", async () => {
    mocks.queryBendystraw.mockResolvedValue({ project: null });
    mocks.readContract.mockRejectedValue(nonexistentTokenError());

    await expect(getProjectWithFallback(PROJECT_ID, CHAIN_ID)).resolves.toBeNull();
  });

  it("surfaces an RPC outage instead of turning it into a 404", async () => {
    mocks.queryBendystraw.mockRejectedValue(new Error("bendystraw down"));
    mocks.readContract.mockRejectedValue(
      new HttpRequestError({ url: "https://rpc.example", details: "fetch failed" }),
    );

    await expect(getProjectWithFallback(PROJECT_ID, CHAIN_ID)).rejects.toThrow();
  });

  it("completes an indexed row that is missing its token with on-chain data", async () => {
    mocks.queryBendystraw.mockResolvedValue({
      project: { ...indexedRow(), token: null, tokenSymbol: null, decimals: null },
    });
    mockOnchainProject();

    const result = await getProjectWithFallback(PROJECT_ID, CHAIN_ID);

    expect(result?.degraded).toBe(true);
    // Indexed fields win where present; on-chain fills the gaps.
    expect(result?.project.name).toBe("Indexed Revnet");
    expect(result?.project.suckerGroupId).toBe("group-1");
    expect(result?.project.token).toBe(PROJECT_TOKEN);
    expect(result?.project.tokenSymbol).toBe("FRESH");
  });
});
