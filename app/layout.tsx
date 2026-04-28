import type { Metadata, Viewport } from "next";
import "./globals.css";

import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/providers";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { GOOGLE_AUTH_ENABLED } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Investor",
  description: "Personal investment tracker, scenario projections, project evaluation",
  manifest: "/manifest.json",
  applicationName: "Investor",
  appleWebApp: {
    capable: true,
    title: "Investor",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body>
        <Providers config={{ googleAuthEnabled: GOOGLE_AUTH_ENABLED }}>
          <AppShell>{children}</AppShell>
        </Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
