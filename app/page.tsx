"use client";

import Link from "next/link";
import { signIn, useSession } from "next-auth/react";

import { useData } from "@/components/data-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import { currentAllocationBreakdown } from "@/lib/projections";
import { usePublicConfig } from "@/lib/public-config";

export default function HomePage() {
  const { status } = useSession();
  const { data, isDemo, loadDemo, loading } = useData();
  const { googleAuthEnabled } = usePublicConfig();

  const stocksCount = data.stocks.length;
  const propertiesCount = data.properties.length;
  const scenariosCount = data.scenarios.length;
  const projectsCount = data.projects.length;

  const allocation = currentAllocationBreakdown({
    holdings: data.stocks,
    properties: data.properties,
    settings: data.settings,
  });
  const today = Object.values(allocation).reduce((s, v) => s + v, 0);

  const showWelcome = !loading && stocksCount === 0 && propertiesCount === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Investor</h1>
        <p className="text-sm text-muted-foreground">
          Personal investment tracker · scenario projections · project evaluation
        </p>
      </section>

      {showWelcome ? (
        <Card>
          <CardHeader>
            <CardTitle>Get started</CardTitle>
            <CardDescription>
              {status === "authenticated"
                ? "Your Drive is empty. Add your first holding or load demo data to explore."
                : googleAuthEnabled
                  ? "Sign in with Google to save your data to your Drive, or try the demo."
                  : "Try the demo to explore the app, or add your own data — it'll be saved in your browser."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {status !== "authenticated" && googleAuthEnabled ? (
              <Button onClick={() => signIn("google")}>Sign in with Google</Button>
            ) : null}
            <Button variant={googleAuthEnabled ? "outline" : "default"} onClick={loadDemo}>
              Try with demo data
            </Button>
            <Link href="/investments">
              <Button variant="ghost">Add manually</Button>
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Stocks</CardDescription>
            <CardTitle className="text-2xl">{stocksCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Properties</CardDescription>
            <CardTitle className="text-2xl">{propertiesCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Scenarios</CardDescription>
            <CardTitle className="text-2xl">{scenariosCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Projects</CardDescription>
            <CardTitle className="text-2xl">{projectsCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {today > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Vested net worth today</CardTitle>
            <CardDescription>
              Liquid + vested-but-pre-trigger equity + property equity in {data.settings.primary_currency}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">
              {formatMoney(today, data.settings.primary_currency)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              See <Link href="/projections" className="underline">Projections</Link> for the full picture.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>How it works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <b>Investments</b> → add stocks (with vesting + second-trigger date for double-trigger RSUs) and properties.
          </p>
          <p>
            <b>Scenarios</b> → save bear/base/bull cases with per-asset growth and IPO-date overrides.
          </p>
          <p>
            <b>Projections</b> → net worth over time (line + stacked-area "sand" chart) and allocation pies.
          </p>
          <p>
            <b>Projects</b> → model investment projects (e.g. buy a house). The app figures out whether your chosen funding sources cover the cost net of tax in a given scenario.
          </p>
          <p className="pt-2 text-xs text-muted-foreground">
            {isDemo
              ? googleAuthEnabled
                ? "Demo data is stored locally in your browser. Sign in with Google to save to your Drive."
                : "Data is stored locally in your browser. Google sign-in is not configured on this deployment, so syncing to Drive is unavailable."
              : "Your data is stored in your own Google Drive (Investor App folder)."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
