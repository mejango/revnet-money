import type { Hex, PublicClient } from "viem";

/** Keep tracking a broadcast transaction when a load-balanced RPC drops the
 * subscription-style receipt watch. Successful writes must not leave the UI
 * stuck merely because the first backend queried was behind. */
export async function waitForReceiptWithRetry(client: PublicClient, hash: Hex) {
  try {
    return await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  } catch {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      try {
        return await client.getTransactionReceipt({ hash });
      } catch {
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      }
    }
    return null;
  }
}
