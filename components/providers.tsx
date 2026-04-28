"use client";

import { DataProvider } from "@/components/data-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return <DataProvider>{children}</DataProvider>;
}
