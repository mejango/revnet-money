import {
  assertLocksHeld,
  browserLocks,
  LockLostError,
  type LockHandle,
} from "@bananapus/nana-sdk-core/review/locks";

/** The cross-tab locks a piece of work runs under: each of its journal writes checks them first. */
export type TabLocks = readonly LockHandle[];

/**
 * A journal's `write` bound to the locks it runs under: it writes only once every one still reads
 * as held (`LockLostError` otherwise), so a tab whose lease passed to another tab never overwrites
 * that tab's journal.
 */
export const fence =
  <A extends unknown[], R>(locks: TabLocks, write: (...args: A) => R) =>
  async (...args: A): Promise<R> => {
    await assertLocksHeld(locks);
    return write(...args);
  };

/**
 * What the wallet already returned for work under a lock (a hash, a definite rejection), saved
 * under that lock. A lapsed lock never drops it: `save` keeps it, and `apply`, called once the
 * work's lock is released, takes `name`'s lock again and writes each kept outcome only while
 * `same()` still finds the same attempt saved. Writes made before the wallet stay `fence`d.
 */
export function keptOutcomes(name: string) {
  const kept: { same: () => boolean; write: () => void }[] = [];
  return {
    async save(locks: TabLocks, same: () => boolean, write: () => void): Promise<void> {
      try {
        await assertLocksHeld(locks);
      } catch (cause) {
        if (!(cause instanceof LockLostError)) throw cause;
        kept.push({ same, write });
        return;
      }
      write();
    },
    async apply(): Promise<void> {
      if (!kept.length) return;
      const pending = kept.splice(0);
      await browserLocks().request(name, async (lock) => {
        for (const outcome of pending) {
          await lock?.assertHeld();
          if (outcome.same()) outcome.write();
        }
      });
    },
  };
}
