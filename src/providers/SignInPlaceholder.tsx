"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Before paint, so the click is acknowledged in the frame it happened in. */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Painted the instant sign-in is asked for, while Para's runtime downloads.
 *
 * That runtime is ~725 KiB gzipped and is deliberately not shipped to
 * anonymous visitors, so the first click has to fetch it — several seconds on
 * a slow connection. Rendering nothing until it lands makes the button feel
 * broken, so this stands in: the real sheet's opening, inert, in the same
 * frame, so the swap reads as filling in rather than as a jump.
 *
 * It owns a `showModal()` dialog for the same reason ParaModalHost does —
 * sign-in is reachable from inside other dialogs, and everything outside the
 * topmost one is inert.
 */
export function SignInPlaceholder() {
  const [host] = useState<HTMLDialogElement | null>(() =>
    typeof document === "undefined" ? null : document.createElement("dialog"),
  );

  useBeforePaint(() => {
    if (!host) return;
    host.className = "ui-modal-host";
    host.dataset.uiModalPortal = "";
    document.body.appendChild(host);
    host.showModal();
    return () => host.remove();
  }, [host]);

  if (!host) return null;

  return createPortal(
    <div className="flex h-full w-full items-center justify-center overflow-y-auto bg-black/80 p-6">
      <div className="w-full max-w-sm border border-zinc-200 bg-white p-6" aria-busy="true">
        <h2 className="text-lg font-medium text-zinc-900">Sign in</h2>
        <p className="mt-1 text-sm text-zinc-600">You will receive a code.</p>
        <div className="mt-5 h-11 w-full animate-pulse border-2 border-melon-300 bg-melon-25" />
        <div className="mt-3 flex justify-end">
          <div className="h-9 w-24 animate-pulse bg-melon-100" />
        </div>
        {/* Same blocks, same heights as the real sheet, so swapping one for
            the other does not resize the panel under the pointer. */}
        {[7, 4].map((count, row) => (
          <div key={row}>
            <div className="mb-2 mt-4 h-3 w-14 animate-pulse bg-zinc-100" />
            <div className="flex min-h-10 flex-wrap gap-1.5">
              {Array.from({ length: count }, (_, i) => (
                <div
                  key={i}
                  className="h-10 w-10 animate-pulse border border-melon-300 bg-melon-25"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>,
    host,
  );
}
