import { fetchCompleteLoans } from "@/hooks/useCompleteBendystrawLists";
import { queryBendystrawFromBrowser } from "@/lib/bendystraw/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/bendystraw/client", () => ({
  queryBendystrawFromBrowser: vi.fn(),
}));

const query = vi.mocked(queryBendystrawFromBrowser);

describe("fetchCompleteLoans", () => {
  beforeEach(() => query.mockReset());

  it("uses exact project refs instead of independent id and chain lists", async () => {
    query.mockResolvedValue({
      loans: {
        totalCount: 2,
        items: [
          {
            id: "base",
            borrowAmount: "1",
            collateral: "2",
            beneficiary: "0x0000000000000000000000000000000000000001",
            owner: "0x0000000000000000000000000000000000000001",
            createdAt: 2,
            chainId: 8453,
            projectId: 6,
            version: 6,
          },
          {
            id: "op",
            borrowAmount: "1",
            collateral: "2",
            beneficiary: "0x0000000000000000000000000000000000000001",
            owner: "0x0000000000000000000000000000000000000001",
            createdAt: 1,
            chainId: 10,
            projectId: 42,
            version: 6,
          },
        ],
      },
    } as never);

    await fetchCompleteLoans([
      { chainId: 8453, projectId: 6, version: 6 },
      { chainId: 10, projectId: 42, version: 6 },
    ]);

    expect(query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        where: {
          OR: [
            { AND: [{ chainId: 8453 }, { projectId: 6 }, { version: 6 }] },
            { AND: [{ chainId: 10 }, { projectId: 42 }, { version: 6 }] },
          ],
        },
      }),
    );
  });

  it("fails closed when Bendystraw returns a cross-product match", async () => {
    query.mockResolvedValue({
      loans: {
        totalCount: 1,
        items: [
          {
            id: "wrong",
            borrowAmount: "1",
            collateral: "2",
            beneficiary: "0x0000000000000000000000000000000000000001",
            owner: "0x0000000000000000000000000000000000000001",
            createdAt: 1,
            chainId: 10,
            projectId: 6,
            version: 6,
          },
        ],
      },
    } as never);

    await expect(
      fetchCompleteLoans([
        { chainId: 8453, projectId: 6, version: 6 },
        { chainId: 10, projectId: 42, version: 6 },
      ]),
    ).rejects.toThrow("wrong deployment");
  });
});
