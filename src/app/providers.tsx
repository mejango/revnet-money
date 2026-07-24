"use client";

import { AppLoadingSkeleton } from "@/components/loading/LoadingSkeletons";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import React from "react";

function DynamicProviderFallback() {
  const pathname = usePathname();
  return <AppLoadingSkeleton pathname={pathname} />;
}

const DynamicAppSpecificProviders = dynamic(
  () => import("./AppSpecificProviders").then((mod) => mod.AppSpecificProviders),
  {
    ssr: false,
    loading: () => <DynamicProviderFallback />,
  },
);

export function Providers({ children }: { children: React.ReactNode }) {
  return <DynamicAppSpecificProviders>{children}</DynamicAppSpecificProviders>;
}
