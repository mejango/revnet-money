import {
  batchStorageKey,
  buildStep,
  checkBatchOrder,
  composeBatch,
  decodeMultiSend,
  describeQueuedBatch,
  encodeMultiSend,
  mirrorBatch,
  moveStep,
  MULTI_SEND_CALL_ONLY,
  readBatch,
  removeStep,
  stepFromWrite,
  stepKey,
  upsertStep,
  writeBatch,
  type BatchStep,
} from "@/lib/safe-batch";
import { jbBuybackHookRegistryAbi, NATIVE_TOKEN } from "@bananapus/nana-sdk-core";
import { getAddress, toFunctionSelector, type Address } from "viem";
import { beforeEach, describe, expect, it } from "vitest";

// wallet-action:safe-batch

const HOOK = "0xB222Da5A71e8FB89a5A38b7c920EaB5DfbC74B91" as Address;
const TERMINAL = "0x4a56AEf5b6A5b9742AbB02cA67C5a85ba183D901" as Address;
const REGISTRY = "0x72F55a54CD53410a5Ff175508a5A384227081788" as Address;
const ROUTER_REGISTRY = "0xe0427F250fdb0379c8E98e884Ee4570521208CbC" as Address;
const CHAIN = 8453;
const PROJECT = 2;

/** The three artifact calls for project 2 (native pool, fee 10000, tick spacing 200, TWAP 1800). */
const REFERENCE = {
  setHookFor:
    "0x779b02900000000000000000000000000000000000000000000000000000000000000002000000000000000000000000b222da5a71e8fb89a5a38b7c920eab5dfbc74b91",
  setPoolFor:
    "0x345c42130000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000c80000000000000000000000000000000000000000000000000000000000000708000000000000000000000000000000000000000000000000000000000000eeee",
  setTerminalFor:
    "0xf3e37d0100000000000000000000000000000000000000000000000000000000000000020000000000000000000000004a56aef5b6a5b9742abb02ca67c5a85ba183d901",
} as const;

const hookStep = () =>
  buildStep({ kind: "setHookFor", chainId: CHAIN, projectId: PROJECT, values: { hook: HOOK } });
const poolStep = () =>
  buildStep({
    kind: "setPoolFor",
    chainId: CHAIN,
    projectId: PROJECT,
    values: { fee: 10_000n, tickSpacing: 200n, twapWindow: 1_800n, terminalToken: NATIVE_TOKEN },
  });
const terminalStep = () =>
  buildStep({
    kind: "setTerminalFor",
    chainId: CHAIN,
    projectId: PROJECT,
    values: { terminal: TERMINAL },
  });

describe("batch steps", () => {
  it("builds the reference calldata for each step kind from its values", () => {
    expect(hookStep()).toMatchObject({
      to: REGISTRY,
      functionName: "setHookFor",
      contractName: "JBBuybackHookRegistry",
      data: REFERENCE.setHookFor,
      value: 0n,
    });
    expect(poolStep().data).toBe(REFERENCE.setPoolFor);
    expect(poolStep().data.slice(0, 10)).toBe("0x345c4213");
    expect(terminalStep()).toMatchObject({ to: ROUTER_REGISTRY, data: REFERENCE.setTerminalFor });
  });

  it("refuses a chain where the step's contract is not deployed", () => {
    expect(() =>
      buildStep({ kind: "setHookFor", chainId: 999, projectId: 1, values: { hook: HOOK } }),
    ).toThrow(/not deployed/);
  });

  it("turns an operator card write into the same step, keeping its target", () => {
    const write = {
      chainId: CHAIN,
      address: REGISTRY,
      abi: jbBuybackHookRegistryAbi,
      functionName: "setHookFor",
      args: [BigInt(PROJECT), HOOK],
    };
    expect(stepFromWrite(write)).toEqual(hookStep());
    // The TWAP window targets the project's resolved hook, not a registry.
    const twap = stepFromWrite({
      chainId: CHAIN,
      address: HOOK,
      functionName: "setTwapWindowOf",
      args: [BigInt(PROJECT), NATIVE_TOKEN, 900n],
    });
    expect(twap).toMatchObject({ kind: "setTwapWindowOf", to: HOOK });
    expect(twap.values).toEqual({ terminalToken: NATIVE_TOKEN, twapWindow: 900n });
    expect(() =>
      stepFromWrite({ chainId: CHAIN, address: HOOK, functionName: "pay", args: [] }),
    ).toThrow(/cannot be batched/);
  });
});

describe("batch ordering and dependencies", () => {
  it("keeps the given order and flags a pool registered before its hook", () => {
    const wrong = [poolStep(), hookStep(), terminalStep()];
    const { calls, problems } = composeBatch(wrong);
    expect(calls.map((call) => call.to)).toEqual([REGISTRY, REGISTRY, ROUTER_REGISTRY]);
    expect(problems).toEqual([{ index: 0, message: expect.stringMatching(/before registering/) }]);
    expect(checkBatchOrder(wrong).ok).toBe(false);
  });

  it("applies the rule only when both kinds are present", () => {
    expect(checkBatchOrder([poolStep(), terminalStep()])).toEqual({ ok: true, problems: [] });
    expect(checkBatchOrder([hookStep()])).toEqual({ ok: true, problems: [] });
  });

  it("marks the dependent call so it is not simulated alone, once reordered", () => {
    const fixed = moveStep([poolStep(), hookStep(), terminalStep()], 1, 0);
    expect(fixed.map((step) => step.kind)).toEqual(["setHookFor", "setPoolFor", "setTerminalFor"]);
    const { calls, problems } = composeBatch(fixed);
    expect(problems).toEqual([]);
    expect(calls.map((call) => call.dependsOnPrior)).toEqual([false, true, false]);
  });

  it("moves and removes by index without touching the rest", () => {
    const steps = [hookStep(), poolStep(), terminalStep()];
    expect(moveStep(steps, 2, 0).map((step) => step.kind)).toEqual([
      "setTerminalFor",
      "setHookFor",
      "setPoolFor",
    ]);
    expect(moveStep(steps, 0, 5)).toEqual(steps);
    expect(removeStep(steps, 1).map((step) => step.kind)).toEqual(["setHookFor", "setTerminalFor"]);
  });

  it("replaces a step with the same key in place instead of duplicating it", () => {
    const steps = [hookStep(), terminalStep()];
    const replacement = buildStep({
      kind: "setHookFor",
      chainId: CHAIN,
      projectId: PROJECT,
      values: { hook: TERMINAL },
    });
    const next = upsertStep(steps, replacement);
    expect(next).toHaveLength(2);
    expect(next[0]!.values.hook).toBe(TERMINAL);
    expect(stepKey(next[0]!)).toBe(stepKey(hookStep()));
    expect(upsertStep(steps, poolStep())).toHaveLength(3);
  });
});

describe("mirroring to another chain", () => {
  it("keeps values, re-resolves addresses, and re-reads per-chain steps", async () => {
    const steps = [hookStep(), poolStep(), terminalStep()];
    const seen: { kind: string; chainId: number; projectId: number }[] = [];
    const result = await mirrorBatch(
      steps,
      CHAIN,
      { chainId: 10, projectId: 7 },
      async (step, chainId, projectId) => {
        seen.push({ kind: step.kind, chainId, projectId });
        return { values: { ...step.values, fee: 3_000n, tickSpacing: 60n } };
      },
    );
    expect(seen).toEqual([{ kind: "setPoolFor", chainId: 10, projectId: 7 }]);
    expect(result.skipped).toEqual([]);
    expect(result.steps.map((step) => [step.kind, step.chainId, step.projectId])).toEqual([
      ["setHookFor", 10, 7],
      ["setPoolFor", 10, 7],
      ["setTerminalFor", 10, 7],
    ]);
    expect(result.steps[0]!.values).toEqual({ hook: HOOK });
    expect(result.steps[1]!.values).toMatchObject({
      fee: 3_000n,
      tickSpacing: 60n,
      twapWindow: 1_800n,
    });
    expect(result.steps[1]!.args[0]).toBe(7n);
  });

  it("drops a per-chain step the resolver cannot rebuild, with the reason", async () => {
    const result = await mirrorBatch(
      [hookStep(), poolStep()],
      CHAIN,
      { chainId: 10, projectId: 7 },
      async () => null,
    );
    expect(result.steps.map((step) => step.kind)).toEqual(["setHookFor"]);
    expect(result.skipped).toEqual([
      { label: "Register buyback pool", reason: expect.stringMatching(/Optimism/) },
    ]);
  });
});

describe("MultiSend encoding", () => {
  const calls = [hookStep(), poolStep(), terminalStep()].map((step) => ({
    to: step.to,
    data: step.data,
    value: 0n,
  }));

  it("packs op ‖ to ‖ value ‖ length ‖ data for each call behind multiSend(bytes)", () => {
    const encoded = encodeMultiSend(calls);
    expect(encoded.slice(0, 10)).toBe("0x8d80ff0a");
    expect(toFunctionSelector("function multiSend(bytes)")).toBe("0x8d80ff0a");
    // The ABI head: offset (32) then length (32), then the packed bytes.
    const body = encoded.slice(10);
    expect(body.slice(0, 64)).toBe("0".repeat(62) + "20");
    let packed = body.slice(128);
    for (const call of calls) {
      const length = (call.data.length - 2) / 2;
      expect(packed.slice(0, 2)).toBe("00");
      expect(packed.slice(2, 42)).toBe(call.to.slice(2).toLowerCase());
      expect(packed.slice(42, 106)).toBe("0".repeat(64));
      expect(BigInt(`0x${packed.slice(106, 170)}`)).toBe(BigInt(length));
      expect(packed.slice(170, 170 + length * 2)).toBe(call.data.slice(2));
      packed = packed.slice(170 + length * 2);
    }
    expect(packed.replace(/0/g, "")).toBe("");
  });

  it("round-trips through decodeMultiSend and labels a queued batch", () => {
    const encoded = encodeMultiSend(calls);
    expect(decodeMultiSend(encoded)).toEqual(
      calls.map((call) => ({ operation: 0, to: getAddress(call.to), value: 0n, data: call.data })),
    );
    expect(decodeMultiSend("0x779b0290")).toBeNull();
    expect(decodeMultiSend(`0x8d80ff0a${"00".repeat(64)}`)).toBeNull();
    expect(describeQueuedBatch({ to: MULTI_SEND_CALL_ONLY, data: encoded, operation: 1 })).toBe(
      "Batch (3 calls)",
    );
    expect(
      describeQueuedBatch({ to: MULTI_SEND_CALL_ONLY, data: encoded, operation: 0 }),
    ).toBeNull();
    expect(describeQueuedBatch({ to: REGISTRY, data: encoded, operation: 1 })).toBeNull();
  });

  it("pins the canonical MultiSendCallOnly address", () => {
    expect(MULTI_SEND_CALL_ONLY).toBe("0x40A2aCCbd92BCA938b02010E17A5b8929b49130D");
  });
});

describe("tray storage", () => {
  beforeEach(() => window.localStorage.clear());

  it("persists steps bigint-safe and rehydrates them with their ABIs", () => {
    writeBatch(CHAIN, PROJECT, [hookStep(), poolStep()]);
    const raw = window.localStorage.getItem(batchStorageKey(CHAIN, PROJECT))!;
    expect(raw).toContain('"$batchBigInt":"10000"');
    expect(raw).not.toContain('"abi"');
    const steps = readBatch(CHAIN, PROJECT);
    expect(steps).toEqual([hookStep(), poolStep()]);
    expect(steps[1]!.abi).toBe(jbBuybackHookRegistryAbi);
    expect(readBatch(10, PROJECT)).toEqual([]);
  });

  it("discards anything malformed or inconsistent instead of repairing it", () => {
    const key = batchStorageKey(CHAIN, PROJECT);
    expect(key).toBe(`revnet:safe-batch:v1:${CHAIN}:${PROJECT}`);
    window.localStorage.setItem(key, "{not json");
    expect(readBatch(CHAIN, PROJECT)).toEqual([]);
    window.localStorage.setItem(key, JSON.stringify([{ kind: "pay", chainId: CHAIN }]));
    expect(readBatch(CHAIN, PROJECT)).toEqual([]);
    // Saved calldata that no longer matches the rebuilt call means drift: start over.
    writeBatch(CHAIN, PROJECT, [hookStep()]);
    const tampered = window.localStorage.getItem(key)!.replace(REFERENCE.setHookFor, "0x00");
    window.localStorage.setItem(key, tampered);
    expect(readBatch(CHAIN, PROJECT)).toEqual([]);
  });

  it("removes the key when the batch empties", () => {
    writeBatch(CHAIN, PROJECT, [hookStep()]);
    writeBatch(CHAIN, PROJECT, [] as BatchStep[]);
    expect(window.localStorage.getItem(batchStorageKey(CHAIN, PROJECT))).toBeNull();
  });
});
