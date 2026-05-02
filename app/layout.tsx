import type { Metadata, Viewport } from "next";
import "./globals.css";

import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/providers";
import { ServiceWorkerRegister } from "@/components/sw-register";

const basePath = process.env.GH_PAGES === "1" ? "/Investor" : "";

export const metadata: Metadata = {
  title: "Investor",
  description: "Personal investment tracker, scenario projections, project evaluation",
  manifest: `${basePath}/manifest.json`,
  applicationName: "Investor",
  appleWebApp: {
    capable: true,
    title: "Investor",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: `${basePath}/icon.svg`, type: "image/svg+xml" },
      { url: `${basePath}/icon-192.png`, sizes: "192x192", type: "image/png" },
      { url: `${basePath}/icon-512.png`, sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: `${basePath}/apple-touch-icon.png`, sizes: "180x180" }],
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
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
        <ServiceWorkerRegister basePath={basePath} />
      </body>
    </html>
  );
}
