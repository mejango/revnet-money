"use client";

/**
 * Where the SDK's write journal keeps its holds: browser storage, or this
 * tab's memory when the browser refuses it, so a wallet never opens without a
 * hold. A removal that storage refuses leaves a marker in memory, so a stale
 * stored record never comes back in this tab.
 */
const memory = new Map<string, string | null>();

function local(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export const writeHoldStorage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
  getItem(key) {
    if (memory.has(key)) return memory.get(key) ?? null;
    try {
      return local()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      const store = local();
      if (store) {
        store.setItem(key, value);
        if (store.getItem(key) === value) {
          memory.delete(key);
          return;
        }
      }
    } catch {
      // Refused: the hold stays in this tab.
    }
    memory.set(key, value);
  },
  removeItem(key) {
    try {
      const store = local();
      store?.removeItem(key);
      if (!store || store.getItem(key) === null) {
        memory.delete(key);
        return;
      }
    } catch {
      // Refused: the marker below hides the stored copy in this tab.
    }
    memory.set(key, null);
  },
};

const PROBE = "revnet:write-hold-probe";

/** Whether this browser keeps holds across reloads. False when storage refuses a write. */
export function browserRemembersHolds(): boolean {
  try {
    const store = local();
    if (!store) return false;
    store.setItem(PROBE, "1");
    const kept = store.getItem(PROBE) === "1";
    store.removeItem(PROBE);
    return kept;
  } catch {
    return false;
  }
}

/** The review's line when holds live only in this tab. */
export const FORGETFUL_BROWSER_LINE =
  "This browser can't remember pending transactions. Check your wallet before repeating one.";
