import { JOURNAL_DISCARD_ACTION, JOURNAL_UNREADABLE_WARNING } from "@/lib/write-hold";

/**
 * The warned way past a saved record this browser can't read, shown only after an action just
 * failed on it: discarding it reopens the flow, which starts afresh.
 */
export function UnreadableJournalExit({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="grid gap-2 text-sm text-zinc-700">
      <p>{JOURNAL_UNREADABLE_WARNING}</p>
      <button type="button" className="w-fit underline" onClick={onContinue}>
        {JOURNAL_DISCARD_ACTION}
      </button>
    </div>
  );
}
