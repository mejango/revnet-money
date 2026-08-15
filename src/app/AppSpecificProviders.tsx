"use client";

import { installQueryPersistence } from "@/lib/query-persist";
import { TransactionReviewProvider } from "@/components/TransactionReviewProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IS_DETERMINISTIC_BROWSER, PARA_EMBEDDED_WALLET_ENABLED } from "@/lib/browserEnvironment";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { connectParaSession } from "@/providers/para-bridge";
import { verifyMarkedParaSession } from "@/providers/para-session";
import { ParaAuthContext } from "@/providers/ParaAuthContext";
import { ParaConnectionNotice } from "@/providers/ParaConnectionNotice";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { useAccount, useConnect, useConnectors, WagmiProvider } from "wagmi";

const ParaModalHost = React.lazy(() => import("@/providers/ParaModalHost"));

function createQueryClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
  // Synchronous, so the first paint already has last session's values for every
  // query tagged in @/lib/query-persist. It no-ops without a `window`.
  installQueryPersistence(client);
  return client;
}

export function ParaConnectionBridge({
  modalOpen,
  onConnected,
  onError,
  sessionVersion,
}: {
  modalOpen: boolean;
  onConnected: () => void;
  onError: () => void;
  sessionVersion: number;
}) {
  const { isConnected } = useAccount();
  const connectors = useConnectors();
  const { connectAsync } = useConnect();
  const bridging = React.useRef(false);

  React.useEffect(() => {
    if (IS_DETERMINISTIC_BROWSER || sessionVersion === 0) return;
    if (modalOpen || isConnected || bridging.current) return;
    bridging.current = true;
    void connectParaSession({
      connectors,
      connect: (connector) => connectAsync({ connector }),
    })
      .then((connected) => {
        if (connected) onConnected();
      })
      .catch(onError)
      .finally(() => {
        bridging.current = false;
      });
  }, [connectAsync, connectors, isConnected, modalOpen, onConnected, onError, sessionVersion]);

  return null;
}

export function AppSpecificProviders({ children }: { children: React.ReactNode }) {
  // Per render tree, never module scope: on the server one shared client would
  // hand one visitor's fetched data to the next request.
  const [queryClient] = React.useState(createQueryClient);
  const [paraHostLoaded, setParaHostLoaded] = React.useState(false);
  const [paraRequestId, setParaRequestId] = React.useState(0);
  const [paraModalOpen, setParaModalOpen] = React.useState(false);
  const [paraSessionVersion, setParaSessionVersion] = React.useState(0);
  const [paraConnectionError, setParaConnectionError] = React.useState(false);

  // Preserve embedded-wallet sessions without penalizing anonymous visitors.
  // Para's own session is authoritative; transient verification failures keep
  // the local marker intact so a later page load can recover.
  React.useEffect(() => {
    if (PARA_EMBEDDED_WALLET_ENABLED) void verifyMarkedParaSession();
  }, []);

  const requestSignIn = React.useCallback(() => {
    if (!PARA_EMBEDDED_WALLET_ENABLED) return;
    setParaConnectionError(false);
    setParaHostLoaded(true);
    setParaRequestId((current) => current + 1);
  }, []);
  const markParaSettled = React.useCallback(
    () => setParaSessionVersion((current) => current + 1),
    [],
  );
  const clearParaConnectionError = React.useCallback(() => setParaConnectionError(false), []);
  const showParaConnectionError = React.useCallback(() => setParaConnectionError(true), []);
  const retryParaConnection = React.useCallback(() => {
    setParaConnectionError(false);
    setParaSessionVersion((current) => current + 1);
  }, []);
  const paraAuth = React.useMemo(
    () => ({
      enabled: PARA_EMBEDDED_WALLET_ENABLED,
      modalOpen: paraModalOpen,
      sessionVersion: paraSessionVersion,
      requestSignIn,
    }),
    [paraModalOpen, paraSessionVersion, requestSignIn],
  );

  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount>
      <QueryClientProvider client={queryClient}>
        <ParaAuthContext.Provider value={paraAuth}>
          <ParaConnectionBridge
            modalOpen={paraModalOpen}
            onConnected={clearParaConnectionError}
            onError={showParaConnectionError}
            sessionVersion={paraSessionVersion}
          />
          <TooltipProvider delayDuration={200} skipDelayDuration={100}>
            <TransactionReviewProvider>{children}</TransactionReviewProvider>
          </TooltipProvider>
          {paraConnectionError ? (
            <ParaConnectionNotice
              onDismiss={clearParaConnectionError}
              onRetry={retryParaConnection}
            />
          ) : null}
          {paraHostLoaded ? (
            <React.Suspense fallback={null}>
              <ParaModalHost
                requestId={paraRequestId}
                onOpenChange={setParaModalOpen}
                onSettled={markParaSettled}
              />
            </React.Suspense>
          ) : null}
        </ParaAuthContext.Provider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
