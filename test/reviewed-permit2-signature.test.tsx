import { useReviewedPermit2Signature } from "@/hooks/useReviewedPermit2Signature";
import type { Permit2SignatureAuthorization } from "@/lib/directPaySwap";
import { clearViewAs, setViewAs } from "@/lib/view-as";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: { id: "permit2-signature-config" },
  account: {
    address: "0x1111111111111111111111111111111111111111" as Address | undefined,
    chainId: 1 as number | undefined,
    connector: { id: "injected", name: "Injected" } as { id: string; name: string } | undefined,
  },
  getAccount: vi.fn(),
  switchChain: vi.fn(),
  signTypedData: vi.fn(),
}));

vi.mock("@wagmi/core", () => ({
  getAccount: mocks.getAccount,
}));

vi.mock("wagmi/actions", () => ({
  getAccount: mocks.getAccount,
}));

vi.mock("wagmi", () => ({
  useConfig: () => mocks.config,
  useSignTypedData: () => ({ signTypedDataAsync: mocks.signTypedData }),
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChain }),
}));

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const TOKEN = "0x2222222222222222222222222222222222222222" as Address;
const ROUTER = "0x3333333333333333333333333333333333333333" as Address;
const OTHER_ACCOUNT = "0x4444444444444444444444444444444444444444" as Address;
const SIGNATURE = `0x${"12".repeat(65)}` as Hex;
const authorization: Permit2SignatureAuthorization = {
  chainId: 8453,
  token: TOKEN,
  spender: ROUTER,
  amount: 25_000_000n,
  expiration: 1_800_000_000,
  nonce: 7,
  sigDeadline: 1_800_000_000n,
};

beforeEach(() => {
  window.localStorage.clear();
  clearViewAs();
  mocks.account = {
    address: ACCOUNT,
    chainId: 1,
    connector: { id: "injected", name: "Injected" },
  };
  mocks.getAccount.mockImplementation(() => mocks.account);
  mocks.switchChain.mockImplementation(async ({ chainId }: { chainId: number }) => {
    mocks.account = { ...mocks.account, chainId };
  });
  mocks.signTypedData.mockResolvedValue(SIGNATURE);
});

describe("reviewed Permit2 signature boundary", () => {
  it("reviews and signs the exact short-lived PermitSingle payload", async () => {
    const order: string[] = [];
    const review = await import("@/lib/transaction-review");
    const dispose = review.registerTransactionReviewHandler(async (request) => {
      order.push("review");
      expect(request).toMatchObject({
        kind: "authorization",
        calls: [],
        authorization: {
          domain: {
            name: "Permit2",
            chainId: 8453,
          },
          primaryType: "PermitSingle",
          message: {
            details: { token: TOKEN, amount: 25_000_000n, nonce: 7 },
            spender: ROUTER,
          },
        },
      });
      return true;
    });
    mocks.signTypedData.mockImplementation(async () => {
      order.push("sign");
      return SIGNATURE;
    });

    const { result } = renderHook(() => useReviewedPermit2Signature());
    let signature: Hex | undefined;
    await act(async () => {
      signature = await result.current.signPermit2Async({
        expectedAccount: ACCOUNT,
        authorization,
      });
    });

    expect(signature).toBe(SIGNATURE);
    expect(order).toEqual(["review", "sign"]);
    expect(mocks.switchChain).toHaveBeenCalledWith({ chainId: 8453 });
    expect(mocks.signTypedData).toHaveBeenCalledWith(
      expect.objectContaining({
        account: ACCOUNT,
        primaryType: "PermitSingle",
        message: expect.objectContaining({ spender: ROUTER }),
      }),
    );
    dispose();
  });

  it("fails closed if the connected account changes after signing", async () => {
    mocks.account = { ...mocks.account, address: ACCOUNT, chainId: 8453 };
    mocks.signTypedData.mockImplementation(async () => {
      mocks.account = { ...mocks.account, address: OTHER_ACCOUNT, chainId: 8453 };
      return SIGNATURE;
    });
    const { result } = renderHook(() => useReviewedPermit2Signature({ reviewedInParent: true }));

    await expect(
      result.current.signPermit2Async({ expectedAccount: ACCOUNT, authorization }),
    ).rejects.toThrow(/changed after signing/i);
  });

  for (const stage of ["review", "switch", "parent-reviewed switch", "signature"] as const) {
    const changes = [
      [
        "account",
        () => {
          mocks.account.address = OTHER_ACCOUNT;
        },
      ],
      [
        "disconnected account",
        () => {
          mocks.account.address = undefined;
        },
      ],
      [
        "chain",
        () => {
          mocks.account.chainId = 10;
        },
      ],
      [
        "another connection of the same wallet type",
        () => {
          mocks.account.connector = { id: "injected", name: "Injected" };
        },
      ],
      [
        "Safe wallet mode",
        () => {
          mocks.account.connector!.id = "safe";
        },
      ],
      [
        "view-as mode",
        () => {
          setViewAs(OTHER_ACCOUNT);
        },
      ],
    ] as const;
    it.each(changes.filter(([name]) => stage !== "review" || name !== "chain"))(
      `refuses changed %s after awaiting ${stage}`,
      async (_name, change) => {
        let resume!: () => void;
        let entered = false;
        const pending = new Promise<void>((resolve) => {
          resume = resolve;
        });
        const pause = async () => {
          entered = true;
          await pending;
        };
        const review = await import("@/lib/transaction-review");
        const reviewer = vi.fn(async () => {
          if (stage === "review") await pause();
          return true;
        });
        const dispose = review.registerTransactionReviewHandler(reviewer);
        mocks.switchChain.mockImplementation(async ({ chainId }: { chainId: number }) => {
          mocks.account.chainId = chainId;
          if (stage === "switch" || stage === "parent-reviewed switch") await pause();
        });
        mocks.signTypedData.mockImplementation(async () => {
          if (stage === "signature") await pause();
          return SIGNATURE;
        });
        const { result } = renderHook(() =>
          useReviewedPermit2Signature({
            reviewedInParent: stage === "parent-reviewed switch",
          }),
        );
        const signing = result.current.signPermit2Async({
          expectedAccount: ACCOUNT,
          authorization,
        });
        const refused = expect(signing).rejects.toThrow(/changed|Exit View as/i);

        await waitFor(() => expect(entered).toBe(true));
        change();
        resume();
        await refused;

        expect(mocks.signTypedData).toHaveBeenCalledTimes(stage === "signature" ? 1 : 0);
        if (stage === "review") expect(mocks.switchChain).not.toHaveBeenCalled();
        if (stage === "parent-reviewed switch") expect(reviewer).not.toHaveBeenCalled();
        dispose();
      },
    );
  }
});
