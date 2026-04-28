"use client";

import Link from "next/link";

import { CurrencySelector } from "@/components/currency-selector";
import { useData } from "@/components/data-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { convert } from "@/lib/fx";
import { formatMoney } from "@/lib/utils";
import { currentAllocationBreakdown } from "@/lib/projections";

export default function HomePage() {
  const { data, loadDemo, loading, displayCurrency } = useData();

  const stocksCount = data.stocks.length;
  const propertiesCount = data.properties.length;
  const scenariosCount = data.scenarios.length;
  const projectsCount = data.projects.length;

  const allocation = currentAllocationBreakdown({
    holdings: data.stocks,
    properties: data.properties,
    settings: data.settings,
  });
  // currentAllocationBreakdown returns values in primary_currency; convert for display
  const todayPrimary = Object.values(allocation).reduce((s, v) => s + v, 0);
  const today = convert(todayPrimary, data.settings.primary_currency, displayCurrency, data.settings);

  const showWelcome = !loading && stocksCount === 0 && propertiesCount === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Investor</h1>
          <p className="text-sm text-muted-foreground">
            Personal investment tracker · scenario projections · project evaluation
          </p>
        </div>
        <CurrencySelector />
      </section>

      {showWelcome ? (
        <Card>
          <CardHeader>
            <CardTitle>Get started</CardTitle>
            <CardDescription>
              Try the demo to explore the app, or add your own data — it&apos;ll be saved in your browser.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button onClick={loadDemo}>Try with demo data</Button>
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
              Liquid + vested-but-pre-trigger equity + property equity, in {displayCurrency}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">
              {formatMoney(today, displayCurrency)}
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
            <b>Projections</b> → net worth over time (line + stacked-area &quot;sand&quot; chart) and allocation pies.
          </p>
          <p>
            <b>Projects</b> → model investment projects (e.g. buy a house). The app figures out whether your chosen funding sources cover the cost net of tax in a given scenario.
          </p>
          <p className="pt-2 text-xs text-muted-foreground">
            Data is stored locally in your browser (localStorage). Drive sync coming next.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
