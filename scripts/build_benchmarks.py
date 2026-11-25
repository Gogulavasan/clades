"""Builds config/benchmarks.json (sector medians) from user-supplied public data. Offline; standard library only.

Input CSV, one row per company for ONE financial year (any consistent unit):
    company, sector, fy, revenue, prior_revenue, net_income, avg_equity, cfo

  * `sector` must use the app's sector names (see "sectors" in config/mapping.json), otherwise the app
    cannot match a company to its benchmark and falls back to the all-company median.
  * Rows with a blank needed figure are left out of that metric only. Nothing is filled in.
  * A sector needs at least --min-companies rows for a metric, otherwise that sector/metric is omitted.
  * Never commit the raw input file: keep it under data/raw/ (git-ignored).

    python scripts/build_benchmarks.py --input data/raw/fundamentals.csv --as-of 2025-03-31 \
        --source "Company annual reports FY2025, compiled by hand"
"""
from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def num(text):
    s = (text or "").strip().replace(",", "")
    try:
        return float(s) if s else None
    except ValueError:
        return None


def metrics(row: dict) -> dict:
    rev, prior, ni, eq, cfo = (num(row.get(k)) for k in ("revenue", "prior_revenue", "net_income", "avg_equity", "cfo"))
    return {
        "revenueGrowth": rev / prior - 1 if rev is not None and prior and prior > 0 else None,
        "roe": ni / eq if ni is not None and eq and eq > 0 else None,
        # CFO/PAT is only meaningful for profitable companies.
        "cfoToPat": cfo / ni if cfo is not None and ni and ni > 0 else None,
    }


def medians(rows: list[dict], min_n: int) -> dict:
    out = {}
    for key in ("revenueGrowth", "roe", "cfoToPat"):
        vals = [r[key] for r in rows if r[key] is not None]
        if len(vals) >= min_n:
            out[key] = round(statistics.median(vals), 4)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--input", type=Path, required=True)
    ap.add_argument("--out", type=Path, default=ROOT / "config" / "benchmarks.json")
    ap.add_argument("--as-of", required=True, help="date the data refers to, e.g. 2025-03-31")
    ap.add_argument("--source", required=True, help="where the figures came from, shown in the app")
    ap.add_argument("--min-companies", type=int, default=5)
    a = ap.parse_args()

    with a.input.open(newline="", encoding="utf-8-sig") as fh:
        raw = [r for r in csv.DictReader(fh) if (r.get("company") or "").strip()]
    if not raw:
        sys.exit("No rows found. Nothing written.")
    allowed = set(json.loads((ROOT / "config" / "mapping.json").read_text(encoding="utf-8"))["sectors"])
    rows = [{"sector": (r.get("sector") or "").strip(), **metrics(r)} for r in raw]
    unknown = sorted({r["sector"] for r in rows} - allowed)
    if unknown:
        print("warning: sector names not used by the app (rows count only toward the all-company median):", ", ".join(unknown))

    default = medians(rows, a.min_companies)
    if len(default) < 3:
        sys.exit(f"Fewer than {a.min_companies} usable companies for at least one metric. Nothing written; the placeholder file stays.")
    sectors = {}
    for name in sorted(allowed & {r["sector"] for r in rows}):
        m = medians([r for r in rows if r["sector"] == name], a.min_companies)
        if m:
            sectors[name] = m
    fys = sorted({(r.get("fy") or "").strip() for r in raw if (r.get("fy") or "").strip()})
    result = {
        "placeholder": False,
        "asOf": a.as_of,
        "source": a.source,
        "coverage": f"{len(rows)} companies, {len(sectors)} sectors with at least {a.min_companies} companies, FY {', '.join(fys) or 'not stated'}. Medians.",
        "default": default,
        "sectors": sectors,
    }
    a.out.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {a.out}: {result['coverage']}")


if __name__ == "__main__":
    main()
