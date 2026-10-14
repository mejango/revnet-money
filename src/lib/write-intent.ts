import { encodeFunctionData, keccak256, stringToHex, type Abi, type Address } from "viem";

/**
 * A write's intent: what the user asked for, without the fields a retry stamps again (a deadline,
 * a Permit2 expiration, collected signatures, a quoted minimum). The write hold is keyed by it, so
 * a retry of the same action finds the attempt it may repeat and asks for that hold's exit; the
 * exact sent call stays in the hold's record.
 */
const INTENT = Symbol.for("revnet:write-intent");

/** `value` as stable text: bigints in decimal, addresses lowercased, object keys sorted. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "bigint") return item.toString();
    if (typeof item === "string" && /^0x[0-9a-fA-F]*$/.test(item)) return item.toLowerCase();
    if (item && typeof item === "object" && !Array.isArray(item))
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
      );
    return item;
  });
}

/** The hold namespace of `action` with the user's own `params`. */
function writeIntentNamespace(action: string, params: Record<string, unknown>): string {
  return `intent:${action}:${keccak256(stringToHex(stable(params))).slice(2, 42)}`;
}

/**
 * `write`, sending its variables named by the user's intent: `action` and the parameters the user
 * chose, with no field a retry stamps again.
 */
export function withWriteIntent<F extends (variables: never, ...rest: never[]) => unknown>(
  write: F,
  action: string,
  params: Record<string, unknown>,
): F {
  const namespace = writeIntentNamespace(action, params);
  return ((variables: object, ...rest: never[]) =>
    write({ ...variables, [INTENT]: namespace } as never, ...rest)) as unknown as F;
}

type Write = {
  address?: Address;
  functionName?: unknown;
  args?: readonly unknown[];
};

/**
 * The intent a write is held by: the one its caller named, or one these calls always carry, whose
 * calldata a retry stamps again. Undefined for a write held by its exact call.
 *
 * - Permit2 `approve(token, spender, amount, expiration)`: the expiration is stamped at send time.
 * - Uniswap v4 `modifyLiquidities(unlockData, deadline)`: the deadline is stamped at send time,
 *   and a reviewed plan's quoted limits change with a fresh review.
 * - Safe `execTransaction(…, signatures)`: the collected signatures grow between attempts.
 */
export function writeIntentOf(write: Write): string | undefined {
  const named = (write as Record<symbol, unknown>)[INTENT];
  if (typeof named === "string") return named;
  const to = write.address;
  const args = write.args ?? [];
  if (write.functionName === "approve" && args.length === 4)
    return writeIntentNamespace("permit2-approve", {
      to,
      token: args[0],
      spender: args[1],
      amount: args[2],
    });
  if (write.functionName === "modifyLiquidities") return writeIntentNamespace("lp", { to });
  if (write.functionName === "execTransaction" && args.length === 10)
    return writeIntentNamespace("safe-exec", { to, transaction: args.slice(0, 9) });
  return undefined;
}

/** The intent of a Safe batch: each call's own intent, or its exact call. */
export function batchIntentOf(calls: readonly (Write & { abi: Abi; value?: bigint })[]): string {
  return writeIntentNamespace(
    "batch",
    Object.fromEntries(
      calls.map((call, index) => [
        String(index),
        writeIntentOf(call) ??
          `${call.address}:${call.value ?? 0n}:${encodeFunctionData({
            abi: call.abi,
            functionName: call.functionName as string,
            args: call.args as unknown[],
          })}`,
      ]),
    ),
  );
}
