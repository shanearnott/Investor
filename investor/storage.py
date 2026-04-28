"""JSON-backed storage for investments, scenarios, projects, and settings.

Each collection is a separate JSON file under data/. Reads are lazy; writes
are atomic (write to .tmp, fsync, rename).
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from .models import (
    InvestmentProject,
    Property,
    Scenario,
    Settings,
    StockHolding,
)


DATA_DIR = Path(os.environ.get("INVESTOR_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

STOCKS_FILE = DATA_DIR / "stocks.json"
PROPERTIES_FILE = DATA_DIR / "properties.json"
SCENARIOS_FILE = DATA_DIR / "scenarios.json"
PROJECTS_FILE = DATA_DIR / "projects.json"
SETTINGS_FILE = DATA_DIR / "settings.json"


def _atomic_write(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return default


# ---------- Stocks ----------

def load_stocks() -> list[StockHolding]:
    raw = _read_json(STOCKS_FILE, [])
    return [StockHolding.from_dict(d) for d in raw]


def save_stocks(stocks: list[StockHolding]) -> None:
    _atomic_write(STOCKS_FILE, [s.to_dict() for s in stocks])


def upsert_stock(holding: StockHolding) -> None:
    stocks = load_stocks()
    for i, s in enumerate(stocks):
        if s.id == holding.id:
            stocks[i] = holding
            save_stocks(stocks)
            return
    stocks.append(holding)
    save_stocks(stocks)


def delete_stock(holding_id: str) -> None:
    save_stocks([s for s in load_stocks() if s.id != holding_id])


# ---------- Properties ----------

def load_properties() -> list[Property]:
    raw = _read_json(PROPERTIES_FILE, [])
    return [Property.from_dict(d) for d in raw]


def save_properties(props: list[Property]) -> None:
    _atomic_write(PROPERTIES_FILE, [p.to_dict() for p in props])


def upsert_property(prop: Property) -> None:
    props = load_properties()
    for i, p in enumerate(props):
        if p.id == prop.id:
            props[i] = prop
            save_properties(props)
            return
    props.append(prop)
    save_properties(props)


def delete_property(prop_id: str) -> None:
    save_properties([p for p in load_properties() if p.id != prop_id])


# ---------- Scenarios ----------

def load_scenarios() -> list[Scenario]:
    raw = _read_json(SCENARIOS_FILE, [])
    return [Scenario.from_dict(d) for d in raw]


def save_scenarios(scenarios: list[Scenario]) -> None:
    _atomic_write(SCENARIOS_FILE, [s.to_dict() for s in scenarios])


def upsert_scenario(scenario: Scenario) -> None:
    scenarios = load_scenarios()
    for i, s in enumerate(scenarios):
        if s.id == scenario.id:
            scenarios[i] = scenario
            save_scenarios(scenarios)
            return
    scenarios.append(scenario)
    save_scenarios(scenarios)


def delete_scenario(scenario_id: str) -> None:
    save_scenarios([s for s in load_scenarios() if s.id != scenario_id])


def get_scenario(scenario_id: str) -> Scenario | None:
    for s in load_scenarios():
        if s.id == scenario_id:
            return s
    return None


# ---------- Projects ----------

def load_projects() -> list[InvestmentProject]:
    raw = _read_json(PROJECTS_FILE, [])
    return [InvestmentProject.from_dict(d) for d in raw]


def save_projects(projects: list[InvestmentProject]) -> None:
    _atomic_write(PROJECTS_FILE, [p.to_dict() for p in projects])


def upsert_project(project: InvestmentProject) -> None:
    projects = load_projects()
    for i, p in enumerate(projects):
        if p.id == project.id:
            projects[i] = project
            save_projects(projects)
            return
    projects.append(project)
    save_projects(projects)


def delete_project(project_id: str) -> None:
    save_projects([p for p in load_projects() if p.id != project_id])


# ---------- Settings ----------

def load_settings() -> Settings:
    raw = _read_json(SETTINGS_FILE, None)
    if raw is None:
        s = Settings()
        save_settings(s)
        return s
    try:
        return Settings.from_dict(raw)
    except TypeError:
        # Schema drift: drop unknown keys
        s = Settings()
        for k, v in raw.items():
            if hasattr(s, k):
                setattr(s, k, v)
        return s


def save_settings(settings: Settings) -> None:
    _atomic_write(SETTINGS_FILE, settings.to_dict())
