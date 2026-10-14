import type { JBChainId } from "@/lib/nana/types";
import { heldLineOf } from "@/lib/write-hold";
import { JB_CHAINS } from "@bananapus/nana-sdk-core";
import {
  checkedItLabel,
  HELD_EXIT_LABEL,
  SAVED_ATTEMPT_CONTINUE_ANYWAY_LABEL,
  SAVED_ATTEMPT_UNREADABLE_LINE,
  type HeldWriteViewController,
  type SavedAttemptCheck,
  type WriteHeldState,
} from "@bananapus/nana-sdk-core/review";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const NOTICE = "grid gap-2 border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700";

/** A saved launch the chain shows already happened: where to find it, so nothing is sent again. */
export function LaunchedNotice({ chainId, revnetId }: { chainId: number; revnetId: bigint }) {
  const chain = JB_CHAINS[chainId as JBChainId]?.slug;
  return (
    <p className="border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
      This revnet is already launched.{" "}
      <Link className="underline" href={`/${chain}:${revnetId}`}>
        Open it
      </Link>
    </p>
  );
}

/**
 * A saved launch the SDK's recovery can't show the result of: nothing is sent until the user
 * checks it. Its one action, and only it, retires that launch and reopens the form; only after it
 * was refused over saved transactions that can't be read is the warned exit offered.
 */
export function LaunchCheckNotice({
  outcome,
  unreadable,
  onChecked,
  onContinueAnyway,
}: {
  outcome: SavedAttemptCheck;
  unreadable: boolean;
  onChecked: () => void;
  onContinueAnyway: () => void;
}) {
  return (
    <div role="status" className={NOTICE}>
      <p>{outcome.line}</p>
      <p>{outcome.warning}</p>
      <button type="button" className="w-fit underline" onClick={onChecked}>
        {checkedItLabel("Launch again")}
      </button>
      {unreadable ? (
        <>
          <p>{SAVED_ATTEMPT_UNREADABLE_LINE}</p>
          <button type="button" className="w-fit underline" onClick={onContinueAnyway}>
            {SAVED_ATTEMPT_CONTINUE_ANYWAY_LABEL}
          </button>
        </>
      ) : null}
    </div>
  );
}

/**
 * A saved launch the hold still holds: the SDK view's own line, and its exit when the hold offers
 * one. Once released (`onReleased`) or ended (`onEnded`), the page recovers it again.
 */
export function LaunchHeldNotice({
  view,
  state,
  onReleased,
  onEnded,
}: {
  view: HeldWriteViewController;
  /** What the hold showed recovery, until the view reads it again. */
  state: WriteHeldState;
  onReleased: () => void;
  onEnded: () => void;
}) {
  const shown = useSyncExternalStore(view.subscribe, view.get, view.get);
  const [busy, setBusy] = useState(false);
  const ending = useRef(onEnded);
  useEffect(() => {
    ending.current = onEnded;
  });
  useEffect(() => view.start(), [view]);
  // Settled, or let go by another window: recovered again, once.
  const ended =
    !!shown.state &&
    (shown.phase === "settled" ||
      shown.phase === "clear" ||
      (shown.phase === "released" && shown.releasedBy === "other-tab"));
  useEffect(() => {
    if (ended) ending.current();
  }, [ended]);
  const line = heldLineOf(shown.state ? shown : state);
  return (
    <div role="status" className={NOTICE}>
      <p>{line}</p>
      {shown.warning ? <p>{shown.warning}</p> : null}
      {shown.exit ? (
        <button
          type="button"
          className="w-fit underline"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void view
              .exit()
              .then((released) => (released ? onReleased() : undefined))
              .finally(() => setBusy(false));
          }}
        >
          {HELD_EXIT_LABEL}
        </button>
      ) : null}
    </div>
  );
}

/**
 * A saved launch that went through but whose revnet can't be read yet: it is only looked at again,
 * never discarded or sent a second time.
 */
export function LaunchConfirmingNotice({ onCheckAgain }: { onCheckAgain: () => void }) {
  return (
    <div role="status" className={NOTICE}>
      <p>Your launch went through. Its revnet is still confirming.</p>
      <button type="button" className="w-fit underline" onClick={onCheckAgain}>
        Check again
      </button>
    </div>
  );
}
