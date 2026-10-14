import { savedAttempts } from "@/lib/write-hold";
import {
  createHeldWriteView,
  type HeldWriteViewController,
  type SavedAttemptCheck,
  type WriteHeldState,
  type WriteHoldClient,
} from "@bananapus/nana-sdk-core/review";
import type { Hex, PublicClient } from "viem";
import {
  discardLaunch,
  journalLaunchSuccess,
  launchAttemptOf,
  savedLaunchAt,
  type LaunchAttempt,
} from "./launchIntent";

/** What the create page shows for a journaled launch; undefined when a new one may be prepared. */
export type LaunchShown =
  /** The chain shows it launched this revnet: nothing is sent again. */
  | { kind: "launched"; chainId: number; revnetId: bigint }
  /** It went through, but its revnet can't be read yet: only looked at again, never resent. */
  | { kind: "confirming"; attempt: LaunchAttempt; client: PublicClient }
  /** The hold still holds it: its own line, and its exit when due. */
  | {
      kind: "held";
      attempt: LaunchAttempt;
      client: PublicClient;
      view: HeldWriteViewController;
      /** What the hold showed recovery, until the view reads it again. */
      state: WriteHeldState;
    }
  /** What became of it can't be shown here: the user checks it. */
  | { kind: "check"; attempt: LaunchAttempt; client: PublicClient; outcome: SavedAttemptCheck };

/**
 * The SDK's one recovery of the launch journaled at `key`, run before anything else is prepared.
 * A success is journaled first and only followed; one shown as this launch, or the hold's final
 * revert, retires it as followed; anything the SDK can't show is a check. The journal goes only
 * once the SDK lets it.
 */
export async function recoverLaunchAt(
  key: string,
  account: Hex,
  client: PublicClient,
  namespaces?: readonly string[],
  forceUnreadable?: () => boolean,
): Promise<LaunchShown | undefined> {
  // No journal: nothing was handed to the wallet from here (the hold still holds any send). One
  // that won't read is still an attempt.
  try {
    if (!savedLaunchAt(key)) return undefined;
  } catch {
    // Unreadable: recovered below, as a check at most.
  }
  const attempt = launchAttemptOf(key, account, client, namespaces, forceUnreadable);
  const outcome = await savedAttempts.recover(attempt, client as unknown as WriteHoldClient);
  if (outcome.status === "none") {
    discardLaunch(attempt);
    return undefined;
  }
  if (outcome.status === "held")
    return {
      kind: "held",
      attempt,
      client,
      view: createHeldWriteView(outcome.handle, { client: client as unknown as WriteHoldClient }),
      state: outcome.state,
    };
  // A success the journal recorded is only followed: never a check, a discard or a send.
  if (outcome.status === "check" && attempt.saved?.hash)
    return { kind: "confirming", attempt, client };
  if (outcome.status === "check") return { kind: "check", attempt, client, outcome };
  if (outcome.result === "failed") {
    await savedAttempts.retire(attempt, { by: "settled", hash: outcome.hash });
    discardLaunch(attempt, outcome.hash);
    return undefined;
  }
  if (outcome.hash) journalLaunchSuccess(attempt, outcome.hash);
  if (!outcome.authenticated) return { kind: "confirming", attempt, client };
  await savedAttempts.retire(attempt, { by: "settled", hash: outcome.hash });
  discardLaunch(attempt, outcome.hash);
  return { kind: "launched", chainId: attempt.chainId, revnetId: outcome.value };
}
