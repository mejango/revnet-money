"use client";

import type {
  WriteHoldClient,
  WriteHoldHandle,
  WriteHoldState,
} from "@bananapus/nana-sdk-core/review";
import { useCallback, useEffect, useRef } from "react";

/** How often a shown hold is asked again, so an exit that becomes due with time appears. */
const HOLD_RECHECK_MS = 60_000;

/**
 * Keep a shown write hold current: every state it reports (this tab's, another tab's, its own
 * follow's) reaches `onState`, and it is asked again every minute while `hold` is given, so an
 * exit that becomes due with time appears. `checkNow` also asks it once at once. `gated` is true
 * only for an answer of the hold's own `state()`, the one gate whose exit may be offered.
 * Returns a recheck for after a manual check.
 */
export function useWriteHoldWatch(
  hold: WriteHoldHandle | undefined,
  client: WriteHoldClient | undefined,
  onState: (state: WriteHoldState, gated: boolean) => void,
  { checkNow = false }: { checkNow?: boolean } = {},
): () => void {
  const onStateRef = useRef(onState);
  const clientRef = useRef(client);
  useEffect(() => {
    onStateRef.current = onState;
    clientRef.current = client;
  });
  const recheckRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!hold) return;
    const stop = hold.subscribe((state) => onStateRef.current(state, false));
    const check = () => {
      const current = clientRef.current;
      if (current)
        void hold.state(current).then(
          (state) => onStateRef.current(state, true),
          () => {},
        );
    };
    recheckRef.current = check;
    if (checkNow) check();
    const timer = setInterval(check, HOLD_RECHECK_MS);
    return () => {
      stop();
      clearInterval(timer);
      recheckRef.current = () => {};
    };
  }, [hold, checkNow]);
  return useCallback(() => recheckRef.current(), []);
}
