"use client";

import { lazyParaConnector } from "@/providers/lazy-para-connector";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors/injected";
import { safe } from "wagmi/connectors/safe";
import { IS_DETERMINISTIC_BROWSER, PARA_EMBEDDED_WALLET_ENABLED } from "./browserEnvironment";
import { SUPPORTED_CHAINS, transports } from "./wagmiTransports";

export const wagmiConfig = createConfig({
  chains: SUPPORTED_CHAINS,
  // EIP-6963 discovers installed browser wallets without loading vendor SDKs.
  // The generic injected connector remains as a fallback for older providers.
  // Para's stable connector delegates to its SDK only after explicit sign-in
  // or when an authoritative marked session is being restored.
  connectors: IS_DETERMINISTIC_BROWSER
    ? []
    : PARA_EMBEDDED_WALLET_ENABLED
      ? [safe(), injected({ shimDisconnect: true }), lazyParaConnector()]
      : [safe(), injected({ shimDisconnect: true })],
  multiInjectedProviderDiscovery: !IS_DETERMINISTIC_BROWSER,
  ssr: true,
  transports,
});
