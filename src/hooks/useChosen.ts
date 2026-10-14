"use client";

import { useCallback, useMemo, useState } from "react";

/**
 * Where a key input came from: `typed` (the user edited it), `policy:<name>`
 * (the user picked an option, such as Max, Fit or keep current) or `auto` (the
 * app seeded or adjusted it).
 */
export type Provenance = "typed" | "auto" | `policy:${string}`;

/**
 * A form value and its provenance. A write intent keys it by `key(typed)`:
 * the typed value, the policy's name, or `auto:<field>` for an untouched seed,
 * never a number the app filled in. So a retry after a balance, price or
 * holding moves is still the same action.
 */
export function useChosen<T>(initial: T, field: string) {
  const [state, setState] = useState<{ value: T; from: Provenance }>({
    value: initial,
    from: "auto",
  });
  /** Set it, keeping the same state when nothing changed, so an effect that sets it can't loop. */
  const update = useCallback(
    (next: (current: { value: T; from: Provenance }) => { value: T; from: Provenance }) =>
      setState((current) => {
        const to = next(current);
        return Object.is(to.value, current.value) && to.from === current.from ? current : to;
      }),
    [],
  );
  /** The user edited it. */
  const set = useCallback((value: T) => update(() => ({ value, from: "typed" })), [update]);
  /** The user picked an option that fills it. */
  const choose = useCallback(
    (policy: string, value: T) => update(() => ({ value, from: `policy:${policy}` })),
    [update],
  );
  /** The app adjusted it: a policy stays the user's, a typed value no longer is. */
  const fill = useCallback(
    (value: T) =>
      update((current) => ({ value, from: current.from === "typed" ? "auto" : current.from })),
    [update],
  );
  /** The app seeded it afresh (a reset, a new position). */
  const seed = useCallback((value: T) => update(() => ({ value, from: "auto" })), [update]);
  const { value, from } = state;
  const key = useCallback(
    <K>(typed: K): K | string =>
      from === "typed" ? typed : from === "auto" ? `auto:${field}` : from,
    [from, field],
  );
  return useMemo(
    () => ({ value, from, set, choose, fill, seed, key }),
    [value, from, set, choose, fill, seed, key],
  );
}
