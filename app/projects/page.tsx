"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { useData } from "@/components/data-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import {
  FundingSource,
  InvestmentProject,
  InvestmentProjectSchema,
  newId,
  ProjectItem,
  Scenario,
  ScenarioSchema,
  SUPPORTED_CURRENCIES,
} from "@/lib/models";
import { evaluateProject } from "@/lib/projects-engine";
import { formatMoney } from "@/lib/utils";

function blank(primary: string): InvestmentProject {
  return InvestmentProjectSchema.parse({
    id: newId(),
    name: "",
    description: "",
    target_date: null,
    currency: primary,
    items: [],
    funding: [],
    scenario_id: null,
  });
}

function fallbackScenario(): Scenario {
  return ScenarioSchema.parse({
    id: "fallback",
    name: "Default base case",
    horizon_years: 10,
    default_stock_growth_pct: 8,
    default_property_growth_pct: 4,
  });
}

export default function ProjectsPage() {
  const { data, setProjects } = useData();
  const [editing, setEditing] = useState<InvestmentProject | null>(null);
  const scenarios = data.scenarios.length ? data.scenarios : [fallbackScenario()];

  const save = async (p: InvestmentProject) => {
    const i = data.projects.findIndex((x) => x.id === p.id);
    const next = [...data.projects];
    if (i >= 0) next[i] = p;
    else next.push(p);
    await setProjects(next);
    setEditing(null);
  };

  const remove = async (id: string) => setProjects(data.projects.filter((p) => p.id !== id));

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Projects</h1>
        <Button onClick={() => setEditing(blank(data.settings.primary_currency))}>
          <Plus className="h-4 w-4" /> Add project
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Model a project (e.g. buy a house + furniture + car), pick funding sources, and see if it works after tax.
      </p>

      <div className="grid gap-3">
        {data.projects.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No projects yet.
            </CardContent>
          </Card>
        ) : (
          data.projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              scenarios={scenarios}
              onEdit={() => setEditing({ ...p })}
              onDelete={() => remove(p.id)}
            />
          ))
        )}
      </div>

      {editing ? (
        <ProjectForm draft={editing} scenarios={scenarios} onCancel={() => setEditing(null)} onSave={save} />
      ) : null}
    </div>
  );
}

function ProjectCard({
  project,
  scenarios,
  onEdit,
  onDelete,
}: {
  project: InvestmentProject;
  scenarios: Scenario[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { data } = useData();
  const [scenarioId, setScenarioId] = useState<string>(
    project.scenario_id || scenarios[0]?.id || "",
  );
  const scenario = scenarios.find((s) => s.id === scenarioId) ?? scenarios[0];

  const ev = evaluateProject({
    project,
    scenario,
    holdings: data.stocks,
    properties: data.properties,
    settings: data.settings,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">{project.name || "(unnamed)"}</CardTitle>
          <CardDescription>
            target {project.target_date || "—"} · {project.items.length} item(s) · {project.funding.length} funding source(s)
          </CardDescription>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={onEdit}>Edit</Button>
          <Button size="sm" variant="ghost" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Label className="text-xs">Evaluate against</Label>
          <Select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Total cost" value={formatMoney(ev.total_cost, ev.primary_currency)} />
          <Stat label="Gross funding" value={formatMoney(ev.total_gross, ev.primary_currency)} />
          <Stat label="Tax" value={formatMoney(ev.total_tax, ev.primary_currency)} />
          <Stat label="Net funding" value={formatMoney(ev.total_net_funding, ev.primary_currency)} />
        </div>

        {ev.is_funded ? (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            ✅ Funded with surplus of <b>{formatMoney(ev.surplus_or_shortfall, ev.primary_currency)}</b>.
          </p>
        ) : (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            ❌ Shortfall of <b>{formatMoney(Math.abs(ev.surplus_or_shortfall), ev.primary_currency)}</b>.
          </p>
        )}

        <details className="text-xs">
          <summary className="cursor-pointer font-medium">Funding lines</summary>
          <table className="mt-2 w-full text-left text-xs">
            <thead>
              <tr className="border-b">
                <th className="py-1 pr-2">Asset</th>
                <th className="py-1 pr-2">Gross</th>
                <th className="py-1 pr-2">Tax</th>
                <th className="py-1 pr-2">Net</th>
                <th className="py-1 pr-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {ev.funding_lines.map((l, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1 pr-2">{l.asset_label}</td>
                  <td className="py-1 pr-2 tabular-nums">{formatMoney(l.gross_proceeds, ev.primary_currency)}</td>
                  <td className="py-1 pr-2 tabular-nums">{formatMoney(l.tax, ev.primary_currency)}</td>
                  <td className="py-1 pr-2 tabular-nums">{formatMoney(l.net_proceeds, ev.primary_currency)}</td>
                  <td className="py-1 pr-2 text-amber-700">{(l.detail.warning as string) || (l.detail.error as string) || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>

        <details className="text-xs">
          <summary className="cursor-pointer font-medium">Cost items</summary>
          <table className="mt-2 w-full text-left text-xs">
            <thead>
              <tr className="border-b">
                <th className="py-1 pr-2">Item</th>
                <th className="py-1 pr-2">Cost</th>
              </tr>
            </thead>
            <tbody>
              {project.items.map((i, idx) => (
                <tr key={idx} className="border-b last:border-0">
                  <td className="py-1 pr-2">{i.name}</td>
                  <td className="py-1 pr-2 tabular-nums">{formatMoney(i.cost, i.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function ProjectForm({
  draft,
  scenarios,
  onCancel,
  onSave,
}: {
  draft: InvestmentProject;
  scenarios: Scenario[];
  onCancel: () => void;
  onSave: (p: InvestmentProject) => Promise<void>;
}) {
  const { data } = useData();
  const [d, setD] = useState<InvestmentProject>(draft);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof InvestmentProject>(k: K, v: InvestmentProject[K]) =>
    setD((p) => ({ ...p, [k]: v }));

  const updateItem = (idx: number, item: ProjectItem) =>
    setD((p) => {
      const next = [...p.items];
      next[idx] = item;
      return { ...p, items: next };
    });
  const addItem = () =>
    setD((p) => ({
      ...p,
      items: [...p.items, { name: "", cost: 0, currency: data.settings.primary_currency, notes: "" }],
    }));
  const removeItem = (idx: number) => setD((p) => ({ ...p, items: p.items.filter((_, i) => i !== idx) }));

  const updateFunding = (idx: number, fs: FundingSource) =>
    setD((p) => {
      const next = [...p.funding];
      next[idx] = fs;
      return { ...p, funding: next };
    });
  const addFunding = () =>
    setD((p) => ({
      ...p,
      funding: [...p.funding, { kind: "cash", asset_id: null, amount_or_shares: 0 }],
    }));
  const removeFunding = (idx: number) => setD((p) => ({ ...p, funding: p.funding.filter((_, i) => i !== idx) }));

  const submit = async () => {
    setError(null);
    const parsed = InvestmentProjectSchema.safeParse({
      ...d,
      target_date: d.target_date?.trim() || null,
      items: d.items.filter((i) => i.name.trim() && i.cost > 0),
      funding: d.funding.filter((f) => f.amount_or_shares > 0),
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return;
    }
    await onSave(parsed.data);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{draft.name ? `Edit "${draft.name}"` : "Add project"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Project name">
            <Input value={d.name} onChange={(e) => update("name", e.target.value)} />
          </Field>
          <Field label="Target date">
            <Input type="date" value={d.target_date ?? ""} onChange={(e) => update("target_date", e.target.value || null)} />
          </Field>
          <Field label="Currency">
            <Select value={d.currency} onChange={(e) => update("currency", e.target.value as InvestmentProject["currency"])}>
              {SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Default scenario">
            <Select
              value={d.scenario_id ?? scenarios[0]?.id ?? ""}
              onChange={(e) => update("scenario_id", e.target.value || null)}
            >
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Description">
          <Textarea value={d.description} onChange={(e) => update("description", e.target.value)} />
        </Field>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Cost items</Label>
            <Button size="sm" variant="outline" onClick={addItem}><Plus className="h-3 w-3" /> Add item</Button>
          </div>
          {d.items.map((item, idx) => (
            <div key={idx} className="grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
              <Input placeholder="Item" value={item.name} onChange={(e) => updateItem(idx, { ...item, name: e.target.value })} />
              <Input type="number" step="100" placeholder="Cost" value={item.cost} onChange={(e) => updateItem(idx, { ...item, cost: Number(e.target.value) })} />
              <Select value={item.currency} onChange={(e) => updateItem(idx, { ...item, currency: e.target.value as ProjectItem["currency"] })}>
                {SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </Select>
              <Button size="icon" variant="ghost" onClick={() => removeItem(idx)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Funding sources</Label>
            <Button size="sm" variant="outline" onClick={addFunding}><Plus className="h-3 w-3" /> Add source</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            stock: amount = shares to liquidate · property: amount = fraction sold (0..1) · cash: amount = primary-currency cash
          </p>
          {d.funding.map((fs, idx) => (
            <div key={idx} className="grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-[1fr_2fr_1fr_auto]">
              <Select
                value={fs.kind}
                onChange={(e) => {
                  const kind = e.target.value as FundingSource["kind"];
                  updateFunding(idx, { ...fs, kind, asset_id: null });
                }}
              >
                <option value="stock">stock</option>
                <option value="property">property</option>
                <option value="cash">cash</option>
              </Select>
              <Select
                value={fs.asset_id ?? ""}
                onChange={(e) => updateFunding(idx, { ...fs, asset_id: e.target.value || null })}
                disabled={fs.kind === "cash"}
              >
                <option value="">{fs.kind === "cash" ? "(primary currency)" : "(select asset)"}</option>
                {fs.kind === "stock"
                  ? data.stocks.map((h) => (
                      <option key={h.id} value={h.id}>{h.ticker || h.company_name}</option>
                    ))
                  : null}
                {fs.kind === "property"
                  ? data.properties.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))
                  : null}
              </Select>
              <Input
                type="number"
                step="1"
                placeholder={fs.kind === "property" ? "Fraction (0..1)" : "Amount/shares"}
                value={fs.amount_or_shares}
                onChange={(e) => updateFunding(idx, { ...fs, amount_or_shares: Number(e.target.value) })}
              />
              <Button size="icon" variant="ghost" onClick={() => removeFunding(idx)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
      <div className="flex justify-end gap-2 p-4 sm:p-6 pt-0">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={submit}>Save</Button>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
