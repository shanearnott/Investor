"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Briefcase,
  Building2,
  Cloud,
  Home,
  LineChart,
  Settings,
} from "lucide-react";

import { useData } from "@/components/data-provider";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Home", icon: Home },
  { href: "/investments", label: "Investments", icon: Building2 },
  { href: "/scenarios", label: "Scenarios", icon: BarChart3 },
  { href: "/projections", label: "Projections", icon: LineChart },
  { href: "/projects", label: "Projects", icon: Briefcase },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { error, driveEmail, isDemo } = useData();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b bg-background/95 backdrop-blur px-3 py-2 sm:px-6 sm:py-3">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
          <span className="text-xl">📈</span>
          <span>Investor</span>
        </Link>
        {isDemo ? (
          <Link
            href="/settings"
            className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-200"
            title="Connect Google Drive in Settings to sync across devices"
          >
            Demo mode
          </Link>
        ) : (
          <Link
            href="/settings"
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-200 max-w-[60vw] sm:max-w-none"
            title={driveEmail ? `Synced to Google Drive · ${driveEmail}` : "Connected to Google Drive"}
          >
            <Cloud className="h-3 w-3 shrink-0" />
            <span className="truncate">{driveEmail ?? "Drive connected"}</span>
          </Link>
        )}
      </header>
      {error ? (
        <div className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>
      ) : null}
      <main className="flex-1 px-3 pb-24 pt-4 sm:px-6 sm:pb-24">{children}</main>
      <nav className="fixed bottom-0 left-0 right-0 z-20 border-t bg-background/95 backdrop-blur sm:hidden">
        <ul className="flex justify-around">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  className={cn(
                    "flex flex-col items-center gap-0.5 px-2 py-2 text-[10px] font-medium",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <nav className="fixed bottom-0 left-0 right-0 z-20 hidden border-t bg-background/95 backdrop-blur sm:block">
        <ul className="mx-auto flex max-w-5xl gap-2 px-6 py-2">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                    active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
