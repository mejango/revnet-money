import { intent, type IntentValue } from "@bananapus/nana-sdk-core/review";
import { keccak256, stringToHex, type Hex } from "viem";

/** The user's launch config as stable text: object keys sorted, bigints in decimal. */
function canonical(config: unknown): string {
  return JSON.stringify(config, (_key, item: unknown) => {
    if (typeof item === "bigint") return item.toString();
    if (item && typeof item === "object" && !Array.isArray(item))
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
      );
    return item;
  });
}

/**
 * A single-chain launch's intent: a hash of the launch config the user filled in. What the page
 * generates for each attempt (the salt, the default stage start, the metadata pin) is left out;
 * the chain and account are the hold's own scope.
 */
export function launchIntent(config: unknown): [string, { [name: string]: IntentValue }] {
  return ["launch", { config: intent.hex(keccak256(stringToHex(canonical(config)))) }];
}

const saltKey = (account: string, chainId: number, config: unknown) =>
  `revnet:launch-salt:${account.toLowerCase()}:${chainId}:${keccak256(stringToHex(canonical(config)))}`;

/**
 * The salt for launching `config` from `account` on `chainId`: the one an earlier, unsettled
 * attempt used, kept across retries and reloads, else a new one. Deploying with the same salt
 * twice reverts, so a retry can never launch a second revnet.
 */
export function launchSalt(
  account: string,
  chainId: number,
  config: unknown,
  create: () => Hex,
): Hex {
  const key = saltKey(account, chainId, config);
  try {
    const saved = window.localStorage.getItem(key);
    if (saved && /^0x[0-9a-f]{64}$/i.test(saved)) return saved as Hex;
  } catch {
    // Storage refused: the write hold, in this tab's memory, still holds the attempt.
  }
  const salt = create();
  try {
    window.localStorage.setItem(key, salt);
  } catch {
    // As above.
  }
  return salt;
}

/** The launch confirmed: the next launch of the same config is a new one, with a new salt. */
export function settleLaunchSalt(account: string, chainId: number, config: unknown): void {
  try {
    window.localStorage.removeItem(saltKey(account, chainId, config));
  } catch {
    // Nothing kept.
  }
}
