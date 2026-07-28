"use client";

import { ParaProvider, useModal } from "@getpara/react-sdk-lite";
import "@getpara/react-sdk-lite/styles.css";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getParaClient, PARA_APP } from "./para-config";

function ModalDriver({
  requestId,
  onOpenChange,
  onSettled,
}: {
  requestId: number;
  onOpenChange: (open: boolean) => void;
  onSettled: () => void;
}) {
  const { isOpen, openModal } = useModal();
  const handledRequest = useRef(0);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (requestId <= handledRequest.current) return;
    handledRequest.current = requestId;
    openModal();
  }, [requestId, openModal]);

  useEffect(() => {
    onOpenChange(isOpen);
    if (wasOpen.current && !isOpen) onSettled();
    wasOpen.current = isOpen;
  }, [isOpen, onOpenChange, onSettled]);

  return null;
}

/** Loaded only after a user requests embedded email/social authentication. */
export default function ParaModalHost({
  requestId,
  onOpenChange,
  onSettled,
}: {
  requestId: number;
  onOpenChange: (open: boolean) => void;
  onSettled: () => void;
}) {
  const paraClient = getParaClient();

  // The Para modal renders inline, so inside the app root it would inherit
  // the `inert` that an open ui/dialog places on pre-existing body children,
  // freezing the sign-in UI. Render it in a body-level portal that the
  // dialog's inert sweep explicitly skips (data-ui-modal-portal).
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const node = document.createElement("div");
    node.dataset.uiModalPortal = "";
    document.body.appendChild(node);
    setPortalNode(node);
    return () => node.remove();
  }, []);

  if (!portalNode) return null;

  return createPortal(
    <ParaProvider
      paraClientConfig={paraClient}
      config={{ appName: PARA_APP.appName }}
      paraModalConfig={{
        authLayout: ["AUTH:FULL"],
        oAuthMethods: ["GOOGLE", "TWITTER", "APPLE", "DISCORD", "FARCASTER"],
        theme: {
          mode: "light",
          backgroundColor: "#ffffff",
          foregroundColor: "#18181b",
          borderRadius: "md",
        },
      }}
      externalWalletConfig={{ wallets: [] }}
    >
      <ModalDriver requestId={requestId} onOpenChange={onOpenChange} onSettled={onSettled} />
    </ParaProvider>,
    portalNode,
  );
}
