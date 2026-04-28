"use client";

import { SessionProvider } from "next-auth/react";
import { DataProvider } from "@/components/data-provider";
import { PublicConfig, PublicConfigContext } from "@/lib/public-config";

export function Providers({
  children,
  config,
}: {
  children: React.ReactNode;
  config: PublicConfig;
}) {
  return (
    <PublicConfigContext.Provider value={config}>
      <SessionProvider>
        <DataProvider>{children}</DataProvider>
      </SessionProvider>
    </PublicConfigContext.Provider>
  );
}
