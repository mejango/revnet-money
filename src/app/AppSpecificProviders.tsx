"use client";

import { AppLoadingSkeleton } from "@/components/loading/LoadingSkeletons";
import { TransactionReviewProvider } from "@/components/TransactionReviewProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import * as React from "react";
import { WagmiProvider } from "wagmi";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function AppSpecificProviders({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <AppLoadingSkeleton pathname={pathname} />;
  }

  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={200} skipDelayDuration={100}>
          <TransactionReviewProvider>{children}</TransactionReviewProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
