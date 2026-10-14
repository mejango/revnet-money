import type { JBChainId } from "@/lib/nana/types";
import { JB_CHAINS } from "@bananapus/nana-sdk-core";
import Link from "next/link";

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
 * A saved launch the chain can't show the result of: nothing is sent until the user checks it.
 * Its one action, and only it, retires that launch and reopens the form.
 */
export function LaunchCheckNotice({
  onChecked,
  refused,
}: {
  onChecked: () => void;
  /** Why the last check couldn't release it: shown, and the action stays. */
  refused?: string;
}) {
  return (
    <div
      role="status"
      className="grid gap-2 border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
    >
      <p>
        An earlier launch of this revnet may have gone through. Check your wallet's activity before
        launching again.
      </p>
      <button type="button" className="w-fit underline" onClick={onChecked}>
        I checked it. Launch again
      </button>
      {refused ? <p>{refused}</p> : null}
    </div>
  );
}

/**
 * A saved launch that went through but whose revnet can't be read yet: it is only looked at again,
 * never discarded or sent a second time.
 */
export function LaunchConfirmingNotice({ onCheckAgain }: { onCheckAgain: () => void }) {
  return (
    <div
      role="status"
      className="grid gap-2 border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
    >
      <p>Your launch went through. Its revnet is still confirming.</p>
      <button type="button" className="w-fit underline" onClick={onCheckAgain}>
        Check again
      </button>
    </div>
  );
}
