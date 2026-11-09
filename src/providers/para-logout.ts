"use client";

import { markParaSession } from "./ParaAuthContext";

type ParaModule = typeof import("./para-config");
type ParaLoader = () => Promise<ParaModule>;

const loadPara: ParaLoader = () => import("./para-config");

type LogoutParaSessionOptions = {
  disconnect: () => Promise<unknown>;
  load?: ParaLoader;
  markSession?: (active: boolean) => void;
};

export class ParaSessionLogoutError extends Error {
  constructor() {
    super("Para did not confirm logout");
    this.name = "ParaSessionLogoutError";
  }
}

export class ParaLocalDisconnectError extends Error {
  constructor() {
    super("Para logged out but Wagmi did not disconnect");
    this.name = "ParaLocalDisconnectError";
  }
}

let signingOut: Promise<void> | null = null;
let signOuts = 0;

/** One sign-out at a time, app-wide: a second call joins the one under way. */
export function signOutOnce(run: () => Promise<unknown>): Promise<void> {
  if (signingOut) return signingOut;
  signOuts += 1;
  signingOut = run()
    .then(() => undefined)
    .finally(() => {
      signingOut = null;
    });
  return signingOut;
}

/** Changes whenever a sign-out starts; a session check that saw another value is stale. */
export function signOutGeneration() {
  return signingOut ? -1 : signOuts;
}

/**
 * End Para's authoritative session before disconnecting Wagmi.
 *
 * The local reconnect marker is cleared only after Para confirms logout. This
 * prevents the UI from claiming a completed sign-out while the embedded
 * wallet session is still live.
 */
export async function logoutParaSession({
  disconnect,
  load = loadPara,
  markSession = markParaSession,
}: LogoutParaSessionOptions): Promise<void> {
  const { getParaClient } = await load();
  try {
    await getParaClient().logout();
  } catch {
    throw new ParaSessionLogoutError();
  }
  markSession(false);
  try {
    await disconnect();
  } catch {
    throw new ParaLocalDisconnectError();
  }
}
