import {
  requireRawPayerCall,
  requireRawSafeExecution,
  verifyActionReceipt,
  verifyCallPreconditions,
  type ExpectedPayerDeployment,
} from "@/lib/multichain-guards";
import { SAFE_EXEC_ABI } from "@/lib/safe-queue";
import { JB_PROJECT_PAYER_DEPLOYER, jbProjectPayerDeployerAbi } from "@bananapus/nana-sdk-core/v6";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbi,
  parseAbiParameters,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { describe, expect, it, vi } from "vitest";
const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const PAYER = "0x2222222222222222222222222222222222222222" as Address;
const expected: ExpectedPayerDeployment = {
  kind: "project-payer",
  projectId: "4",
  beneficiary: OWNER,
  owner: OWNER,
  addToBalance: false,
  memo: "Payer",
  metadata: "0x1234",
  directory: OWNER,
};
const calldata = encodeFunctionData({
  abi: jbProjectPayerDeployerAbi,
  functionName: "deployProjectPayer",
  args: [4n, OWNER, "Payer", "0x1234", false, OWNER],
});
function receipt(owner = OWNER) {
  const topics = encodeEventTopics({
    abi: jbProjectPayerDeployerAbi,
    eventName: "DeployProjectPayer",
    args: { projectPayer: PAYER },
  });
  const data = encodeAbiParameters(
    parseAbiParameters("uint256,address,string,bytes,bool,address,address,address"),
    [4n, OWNER, "Payer", "0x1234", false, OWNER, owner, PAYER],
  );
  return {
    logs: [{ address: JB_PROJECT_PAYER_DEPLOYER, topics, data }],
  } as unknown as TransactionReceipt;
}
describe("multichain source and exact recipient-result guards", () => {
  it("detects reserved-hook underpull while allowing exactly reviewed intentional burns", async () => {
    const abi = parseAbi([
      "event SendReservedTokensToSplits(uint256 indexed rulesetId,uint256 indexed rulesetCycleNumber,uint256 indexed projectId,address owner,uint256 tokenCount,uint256 leftoverAmount,address caller)",
      "event Burn(address indexed holder,uint256 indexed projectId,uint256 count,uint256 creditBalance,uint256 tokenBalance,address caller)",
    ]);
    const summary = {
      address: OWNER,
      topics: encodeEventTopics({
        abi,
        eventName: "SendReservedTokensToSplits",
        args: { rulesetId: 1n, rulesetCycleNumber: 1n, projectId: 4n },
      }),
      data: encodeAbiParameters(parseAbiParameters("address,uint256,uint256,address"), [
        OWNER,
        100n,
        0n,
        OWNER,
      ]),
    };
    const burn = (amount: bigint) => ({
      address: PAYER,
      topics: encodeEventTopics({ abi, eventName: "Burn", args: { holder: OWNER, projectId: 4n } }),
      data: encodeAbiParameters(parseAbiParameters("uint256,uint256,uint256,address"), [
        amount,
        0n,
        0n,
        OWNER,
      ]),
    });
    const guard = {
      controller: OWNER,
      tokenRegistry: PAYER,
      projectId: "4",
      amount: "100",
      intentionalBurn: "10",
    };
    await expect(
      verifyActionReceipt(
        {} as PublicClient,
        { logs: [summary, burn(10n)] } as unknown as TransactionReceipt,
        OWNER,
        undefined,
        [],
        guard,
      ),
    ).resolves.toBeUndefined();
    await expect(
      verifyActionReceipt(
        {} as PublicClient,
        { logs: [summary, burn(11n)] } as unknown as TransactionReceipt,
        OWNER,
        undefined,
        [],
        guard,
      ),
    ).rejects.toThrow(/incomplete hook/);
    await expect(
      verifyActionReceipt(
        {} as PublicClient,
        { logs: [burn(10n)] } as unknown as TransactionReceipt,
        OWNER,
        undefined,
        [],
        guard,
      ),
    ).rejects.toThrow(/reviewed amount/);
  });
  it("rejects destination state drift before any wallet action", async () => {
    const call = vi.fn().mockResolvedValue({ data: "0x02" });
    await expect(
      verifyCallPreconditions({ call } as unknown as PublicClient, [
        { address: OWNER, data: "0x1234", expected: "0x01" },
      ]),
    ).rejects.toThrow(/reviewed state changed/);
    expect(call).toHaveBeenCalledWith({ to: OWNER, data: "0x1234" });
  });
  it("restricts raw Relayr to the exact caller-independent canonical payer factory call", () => {
    expect(() =>
      requireRawPayerCall(JB_PROJECT_PAYER_DEPLOYER, calldata, 0n, expected),
    ).not.toThrow();
    expect(() => requireRawPayerCall(PAYER, calldata, 0n, expected)).toThrow(/canonical/);
    expect(() => requireRawPayerCall(JB_PROJECT_PAYER_DEPLOYER, "0x1234", 0n, expected)).toThrow(
      /settings/,
    );
    expect(() => requireRawPayerCall(JB_PROJECT_PAYER_DEPLOYER, calldata, 1n, expected)).toThrow(
      /canonical/,
    );
  });
  it("requires a single matching payer event and deployed code, allowing the raw relayer sender", async () => {
    const getCode = vi.fn().mockResolvedValue("0x6000");
    await expect(
      verifyActionReceipt(
        { getCode } as unknown as PublicClient,
        receipt(),
        JB_PROJECT_PAYER_DEPLOYER,
        expected,
      ),
    ).resolves.toBeUndefined();
    expect(getCode).toHaveBeenCalledWith({ address: PAYER });
    await expect(
      verifyActionReceipt(
        { getCode } as unknown as PublicClient,
        receipt(PAYER),
        JB_PROJECT_PAYER_DEPLOYER,
        expected,
      ),
    ).rejects.toThrow(/frozen review/);
    const duplicate = receipt();
    duplicate.logs.push(duplicate.logs[0]);
    await expect(
      verifyActionReceipt(
        { getCode } as unknown as PublicClient,
        duplicate,
        JB_PROJECT_PAYER_DEPLOYER,
        expected,
      ),
    ).rejects.toThrow(/exactly one/);
    getCode.mockResolvedValue("0x");
    await expect(
      verifyActionReceipt(
        { getCode } as unknown as PublicClient,
        receipt(),
        JB_PROJECT_PAYER_DEPLOYER,
        expected,
      ),
    ).rejects.toThrow(/no deployed code/);
  });
  it("does not accept a successful receipt containing a rejected payout event", async () => {
    const topic = `0x${"ab".repeat(32)}` as Hex;
    const result = {
      logs: [{ address: OWNER, topics: [topic], data: "0x" }],
    } as unknown as TransactionReceipt;
    await expect(
      verifyActionReceipt({} as PublicClient, result, OWNER, undefined, [
        { topic, address: OWNER },
      ]),
    ).rejects.toThrow(/incomplete recipient/);
  });
});

describe("raw Safe executions", () => {
  const SAFE = "0x0000000000000000000000000000000000005afe" as Address;
  const SAFE_TX_HASH = `0x${"ab".repeat(32)}` as Hex;
  const exec = encodeFunctionData({
    abi: SAFE_EXEC_ABI,
    functionName: "execTransaction",
    args: [SAFE, 0n, "0x1234", 0, 0n, 0n, 0n, zeroAddress, zeroAddress, "0x"],
  });
  const expected = { safe: SAFE, safeTxHash: SAFE_TX_HASH, nonce: 7 };

  it("pins execTransaction on that Safe to its live nonce and exact transaction hash", () => {
    const [nonce, hash] = requireRawSafeExecution(SAFE, exec, 0n, expected);
    expect(nonce).toEqual({
      address: SAFE,
      data: toFunctionSelector("function nonce()"),
      expected: encodeAbiParameters(parseAbiParameters("uint256"), [7n]),
    });
    expect(hash.address).toBe(SAFE);
    expect(hash.expected).toBe(SAFE_TX_HASH);
    expect(
      hash.data.startsWith(
        toFunctionSelector(
          "function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256)",
        ),
      ),
    ).toBe(true);
  });

  it("rejects another target, value, a missing review, or a call that is not execTransaction", () => {
    expect(() => requireRawSafeExecution(PAYER, exec, 0n, expected)).toThrow(/reviewed Safe/);
    expect(() => requireRawSafeExecution(SAFE, exec, 1n, expected)).toThrow(/reviewed Safe/);
    expect(() => requireRawSafeExecution(SAFE, exec, 0n)).toThrow(/reviewed Safe/);
    expect(() => requireRawSafeExecution(SAFE, "0x1234", 0n, expected)).toThrow(
      /not execTransaction/,
    );
  });
});
