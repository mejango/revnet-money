import {
  buildTransactionReviewPrompt,
  registerTransactionReviewHandler,
  requireContractTransactionReview,
  requireTransactionReview,
  transactionReviewJson,
  type ContractTransactionReviewCall,
  type TransactionReviewRequest,
} from "@/lib/transaction-review";
import { encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { TEST_ACCOUNT, TEST_BENEFICIARY } from "./fixtures/revnet";

const TOKEN: Address = "0x0000000000000000000000000000000000001000";
const VALUE = 123n;

function transferCall(): ContractTransactionReviewCall {
  return {
    chainId: 1,
    address: TOKEN,
    abi: erc20Abi,
    functionName: "transfer",
    args: [TEST_BENEFICIARY, VALUE],
    account: TEST_ACCOUNT,
  };
}

let unregister: (() => void) | undefined;

afterEach(() => {
  unregister?.();
  unregister = undefined;
});

describe("transaction review fail-closed boundary", () => {
  it("refuses a transaction when no review surface is registered", async () => {
    await expect(requireContractTransactionReview(transferCall())).rejects.toThrow(
      "Transaction review is unavailable",
    );
  });

  it("refuses an empty review and a review the user closes", async () => {
    unregister = registerTransactionReviewHandler(async () => false);

    await expect(requireTransactionReview({ calls: [] })).rejects.toThrow(
      "There is no transaction to review",
    );
    await expect(requireContractTransactionReview(transferCall())).rejects.toThrow(
      "Review closed. Nothing was sent.",
    );
  });

  it("shows the exact chain, target, sender, value, selector, and arguments", async () => {
    let reviewed: TransactionReviewRequest | undefined;
    unregister = registerTransactionReviewHandler(async (request) => {
      reviewed = request;
      return true;
    });

    await requireContractTransactionReview(transferCall(), {
      title: "Review transfer",
      label: "Transfer project token",
      contractName: "ERC20",
    });

    const expectedData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [TEST_BENEFICIARY, VALUE],
    });
    expect(expectedData.slice(0, 10)).toBe("0xa9059cbb");
    expect(reviewed).toMatchObject({ title: "Review transfer" });
    expect(reviewed?.calls).toEqual([
      expect.objectContaining({
        chainId: 1,
        to: TOKEN,
        from: TEST_ACCOUNT,
        value: undefined,
        data: expectedData,
        functionName: "transfer",
        args: [TEST_BENEFICIARY, VALUE],
        label: "Transfer project token",
        contractName: "ERC20",
      }),
    ]);
  });

  it("detects any calldata mutation which occurs while the review is open", async () => {
    const call = transferCall();
    unregister = registerTransactionReviewHandler(async () => {
      call.args = [TEST_BENEFICIARY, VALUE + 1n];
      return true;
    });

    await expect(requireContractTransactionReview(call)).rejects.toThrow(
      "Transaction data changed after review",
    );
  });
});

describe("portable transaction review payload", () => {
  const data = "0xa9059cbb00000000" as Hex;
  const request: TransactionReviewRequest = {
    kind: "authorization",
    authorization: { deadline: 123n },
    calls: [
      {
        chainId: 1,
        from: TEST_ACCOUNT,
        to: TOKEN,
        value: 15n,
        data,
      },
    ],
  };

  it("serializes bigints and a single resulting call without losing precision", () => {
    expect(JSON.parse(transactionReviewJson(request))).toEqual({
      authorization: { deadline: "123" },
      resultingCall: {
        chainId: 1,
        from: TEST_ACCOUNT,
        to: TOKEN,
        value: "0xf",
        data,
      },
    });
  });

  it("builds an audit prompt containing the exact payload and canonical source guidance", () => {
    const prompt = buildTransactionReviewPrompt(request);

    expect(prompt).toContain(transactionReviewJson(request));
    expect(prompt).toContain("https://github.com/Bananapus/version-6");
    expect(prompt).toContain(`https://etherscan.io/address/${TOKEN}`);
    expect(prompt).toContain("SAFE TO SIGN / DO NOT SIGN / NEEDS MORE INFO");
  });

  it("wraps multiple calls without changing their order", () => {
    const json = JSON.parse(
      transactionReviewJson({ calls: [request.calls[0], { ...request.calls[0], chainId: 10 }] }),
    );

    expect(json.transactions.map((call: { chainId: number }) => call.chainId)).toEqual([1, 10]);
  });
});
