"""Back-test of the Beneish M-score on hand-entered Indian cases. Offline only; standard library only.

Input : notebooks/cases.csv  (copy notebooks/cases_template.csv and fill it from ORIGINAL annual reports)
Output: config/validation.json (static file the app's Validation page reads)

Rules this script enforces:
  * It never fills, interpolates or guesses a figure. A company-year with a blank input gets no M-score
    and is reported as skipped.
  * A case company's statements count as "positive" only for the `lookback` financial years strictly
    BEFORE its event year, so post-event restated accounts cannot leak the answer.
  * The tuned threshold is chosen on FY <= split_fy only and then applied, unchanged, to later years.
  * Both the hit rate and the false-positive rate are always reported, with the raw counts.

    python scripts/backtest.py --selftest
    python scripts/backtest.py --cases notebooks/cases.csv --split-fy 2014 --source "Annual reports, entered by hand"
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Beneish (1999). Must match config/rules.json; `--selftest` checks the same hand example as the TypeScript tests.
INTERCEPT = -4.84
COEF = {"DSRI": 0.920, "GMI": 0.528, "AQI": 0.404, "SGI": 0.892, "DEPI": 0.115, "SGAI": -0.172, "TATA": 4.679, "LVGI": -0.327}
PUBLISHED_THRESHOLD = -1.78
INPUTS = ["sales", "cogs", "receivables", "current_assets", "ppe", "total_assets", "depreciation", "sga",
          "current_liabilities", "long_term_debt", "net_income", "cfo"]
PREVALENCES = [0.01, 0.02, 0.05, 0.10]


def div(a, b):
    return None if a is None or b is None or b == 0 else a / b


def _sub(a, b):
    return None if a is None or b is None else a - b


def _add(a, b):
    return None if a is None or b is None else a + b


def _pos(v):
    return v if v is not None and v > 0 else None


def ratios(t: dict, p: dict) -> dict:
    """The eight Beneish ratios for year t against prior year p. Any missing input -> that ratio is None."""
    gm = lambda y: div(_sub(y["sales"], y["cogs"]), y["sales"])
    soft = lambda y: _sub(1, div(_add(y["current_assets"], y["ppe"]), y["total_assets"]))
    dep = lambda y: div(y["depreciation"], _add(y["depreciation"], y["ppe"]))
    lev = lambda y: div(_add(y["current_liabilities"], y["long_term_debt"]), y["total_assets"])
    return {
        "DSRI": div(div(t["receivables"], _pos(t["sales"])), div(p["receivables"], _pos(p["sales"]))),
        "GMI": div(_pos(gm(p)), _pos(gm(t))),
        "AQI": div(soft(t), soft(p)),
        "SGI": div(t["sales"], _pos(p["sales"])),
        "DEPI": div(dep(p), dep(t)),
        "SGAI": div(div(t["sga"], _pos(t["sales"])), div(p["sga"], _pos(p["sales"]))),
        "TATA": div(_sub(t["net_income"], t["cfo"]), t["total_assets"]),
        "LVGI": div(lev(t), lev(p)),
    }


def m_score(r: dict):
    if any(r[k] is None for k in COEF):
        return None
    return INTERCEPT + sum(COEF[k] * r[k] for k in COEF)


def _num(text: str, where: str):
    s = (text or "").strip().replace(",", "")
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        raise SystemExit(f"{where}: '{text}' is not a number. Fix the CSV; nothing is guessed.")


def load_cases(path: Path) -> list[dict]:
    """Reads the hand-filled CSV. Rows with no figures at all (the untouched template) are ignored."""
    rows = []
    with path.open(newline="", encoding="utf-8-sig") as fh:
        for n, raw in enumerate(csv.DictReader(fh), start=2):
            company = (raw.get("company") or "").strip()
            if not company or company.startswith("#"):
                continue
            where = f"{path.name} line {n} ({company})"
            figures = {k: _num(raw.get(k, ""), f"{where}, {k}") for k in INPUTS}
            fy = _num(raw.get("fy", ""), f"{where}, fy")
            if fy is None or all(v is None for v in figures.values()):
                continue
            group = (raw.get("group") or "").strip().lower()
            if group not in ("case", "control"):
                raise SystemExit(f"{where}: group must be 'case' or 'control'.")
            event = _num(raw.get("event_fy", ""), f"{where}, event_fy")
            if group == "case" and event is None:
                raise SystemExit(f"{where}: a case needs event_fy (the financial year the problem became public).")
            rows.append({"company": company, "group": group, "fy": int(fy), "event_fy": int(event) if event is not None else None, **figures})
    return rows


def score(rows: list[dict]) -> tuple[list[dict], list[str]]:
    """One M-score per company-year that has a complete prior year. Returns (scored, skipped reasons)."""
    scored, skipped = [], []
    by_company: dict[str, list[dict]] = {}
    for r in rows:
        by_company.setdefault(r["company"], []).append(r)
    for company, ys in by_company.items():
        ys.sort(key=lambda r: r["fy"])
        for prev, cur in zip(ys, ys[1:]):
            if cur["fy"] - prev["fy"] != 1:
                skipped.append(f"{company} FY{cur['fy']}: prior year FY{cur['fy'] - 1} not entered")
                continue
            r = ratios(cur, prev)
            m = m_score(r)
            if m is None:
                missing = [k for k in COEF if r[k] is None]
                skipped.append(f"{company} FY{cur['fy']}: no M-score, {', '.join(missing)} could not be computed")
                continue
            scored.append({"company": company, "group": cur["group"], "fy": cur["fy"], "event_fy": cur["event_fy"], "m": m, "ratios": r})
    return scored, skipped


def label(s: dict, lookback: int):
    """True = positive (case, within `lookback` years before the event), False = negative (control), None = excluded."""
    if s["group"] == "control":
        return False
    return True if s["event_fy"] - lookback <= s["fy"] < s["event_fy"] else None


def auc(pos: list[float], neg: list[float]):
    """Probability that a random positive scores above a random negative (ties count half)."""
    if not pos or not neg:
        return None
    wins = sum(1.0 if p > n else 0.5 if p == n else 0.0 for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def confusion(points: list[tuple[float, bool]], threshold: float, name: str) -> dict:
    tp = sum(1 for m, y in points if y and m >= threshold)
    fn = sum(1 for m, y in points if y and m < threshold)
    fp = sum(1 for m, y in points if not y and m >= threshold)
    tn = sum(1 for m, y in points if not y and m < threshold)
    ratio = lambda a, b: (a / b) if b else None
    return {"name": name, "n": len(points), "tp": tp, "fp": fp, "fn": fn, "tn": tn,
            "hitRate": ratio(tp, tp + fn), "falsePositiveRate": ratio(fp, fp + tn), "precision": ratio(tp, tp + fp),
            "auc": auc([m for m, y in points if y], [m for m, y in points if not y])}


def tune(points: list[tuple[float, bool]]):
    """Threshold maximising Youden's J (hit rate - false-positive rate) on the given points only."""
    if not any(y for _, y in points) or not any(not y for _, y in points):
        return None
    best, best_j = None, -2.0
    for thr in sorted({m for m, _ in points}):
        c = confusion(points, thr, "")
        j = c["hitRate"] - c["falsePositiveRate"]
        if j >= best_j:
            best, best_j = thr, j
    return best


def evaluate(scored: list[dict], skipped: list[str], split_fy: int, lookback: int, source: str) -> dict:
    labelled = [(s, label(s, lookback)) for s in scored]
    points = [(s["m"], y, s["fy"]) for s, y in labelled if y is not None]
    pos = sum(1 for _, y, _ in points if y)
    neg = len(points) - pos
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if pos == 0 or neg == 0:
        return {"status": "insufficient_data", "generatedAt": now,
                "note": f"Back-test not possible yet: {pos} positive and {neg} negative company-years with a complete M-score. "
                        "It needs at least one case company (two consecutive years before its event) and one control company."}
    train = [(m, y) for m, y, fy in points if fy <= split_fy]
    test = [(m, y) for m, y, fy in points if fy > split_fy]
    everything = [(m, y) for m, y, _ in points]
    tuned = tune(train)
    sets = [confusion(everything, PUBLISHED_THRESHOLD, f"All years, published threshold {PUBLISHED_THRESHOLD}")]
    if train:
        sets.append(confusion(train, PUBLISHED_THRESHOLD, f"Earlier period (FY <= {split_fy}), published threshold"))
    if test:
        sets.append(confusion(test, PUBLISHED_THRESHOLD, f"Later period (FY > {split_fy}), published threshold"))
        if tuned is not None:
            sets.append(confusion(test, tuned, f"Later period, threshold {tuned:.2f} tuned on the earlier period only"))

    early = []
    for company in sorted({s["company"] for s in scored if s["group"] == "case"}):
        ys = [s for s in scored if s["company"] == company]
        event = ys[0]["event_fy"]
        flags = sorted(s["fy"] for s in ys if s["fy"] < event and s["m"] >= PUBLISHED_THRESHOLD)
        early.append({"company": company, "eventFy": event, "firstFlagFy": flags[0] if flags else None, "yearsEarly": event - flags[0] if flags else None})

    ref = sets[2] if test and len(sets) > 2 else sets[0]
    hit, fpr = ref["hitRate"], ref["falsePositiveRate"]
    base = []
    for p in PREVALENCES:
        denom = (hit or 0) * p + (fpr or 0) * (1 - p)
        base.append({"prevalence": p, "precision": ((hit or 0) * p / denom) if hit is not None and fpr is not None and denom > 0 else None})

    companies = lambda g: len({s["company"] for s in scored if s["group"] == g})
    caveats = [
        f"Small sample: {pos} positive and {neg} negative company-years. Every percentage here has a wide error band.",
        "Survivorship and hindsight: the case list was chosen because these companies are known to have failed or restated.",
        "The control group is hand-picked; if it was chosen after looking at scores, the false-positive rate is understated.",
        "Figures come from annual reports as filed; later restatements are not used, but data-entry errors are possible.",
        "Years before and after the Ind AS transition (FY2017-FY2018) are mixed and are not strictly comparable.",
        "Only the Beneish M-score is back-tested. The Fraud Triangle score, its weights and the 30/70 tier cut-offs are not.",
        "The base-rate table uses the " + ref["name"].lower() + " row.",
    ]
    if skipped:
        caveats.append(f"{len(skipped)} company-year(s) were skipped because an input was blank; nothing was filled in.")
    if not test:
        caveats.append(f"No company-years after FY{split_fy}: there is no out-of-period test, only in-sample figures.")
    return {
        "status": "ok", "generatedAt": now, "source": source,
        "sample": {"caseCompanies": companies("case"), "controlCompanies": companies("control"), "companyYears": len(points), "positives": pos, "negatives": neg},
        "split": {"trainUpToFy": split_fy, "publishedThreshold": PUBLISHED_THRESHOLD, "tunedThreshold": round(tuned, 2) if tuned is not None else None, "lookbackYears": lookback},
        "sets": sets, "earlyWarning": early, "baseRates": base, "caveats": caveats, "skipped": skipped,
    }


def selftest() -> None:
    """Same hand-calculated example as tests/beneish.test.ts: M must be -1.607563."""
    p = dict(sales=1000, cogs=600, receivables=100, current_assets=400, ppe=300, total_assets=1000, depreciation=30, sga=100, current_liabilities=200, long_term_debt=200, net_income=80, cfo=90)
    t = dict(sales=1300, cogs=806, receivables=182, current_assets=520, ppe=330, total_assets=1250, depreciation=30, sga=117, current_liabilities=250, long_term_debt=300, net_income=110, cfo=60)
    r = ratios(t, p)
    expect = {"DSRI": 1.4, "GMI": 1.052632, "AQI": 1.066667, "SGI": 1.3, "DEPI": 1.090909, "SGAI": 0.9, "TATA": 0.04, "LVGI": 1.1}
    for k, v in expect.items():
        assert abs(r[k] - v) < 1e-6, (k, r[k], v)
    assert abs(m_score(r) - (-1.607563)) < 1e-6, m_score(r)
    assert m_score({**r, "SGAI": None}) is None
    assert auc([3, 2], [1, 2]) == 0.875
    print("selftest ok: Python Beneish matches the hand-calculated example (M = -1.607563)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cases", type=Path, default=ROOT / "notebooks" / "cases.csv")
    ap.add_argument("--out", type=Path, default=ROOT / "config" / "validation.json")
    ap.add_argument("--split-fy", type=int, default=2014, help="thresholds are tuned on FY <= this and tested on later years")
    ap.add_argument("--lookback", type=int, default=3, help="years before the event that count as positive")
    ap.add_argument("--source", default="Annual reports, figures entered by hand")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not a.cases.exists():
        sys.exit(f"{a.cases} not found. Copy notebooks/cases_template.csv to notebooks/cases.csv and fill it from original annual reports.")
    scored, skipped = score(load_cases(a.cases))
    result = evaluate(scored, skipped, a.split_fy, a.lookback, a.source)
    a.out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"status: {result['status']}  ->  {a.out}")
    for s in result.get("sets", []):
        fmt = lambda v: "n/a" if v is None else f"{v:.2f}"
        print(f"  {s['name']}: n={s['n']} hit={fmt(s['hitRate'])} fpr={fmt(s['falsePositiveRate'])} precision={fmt(s['precision'])} auc={fmt(s['auc'])}")
    for line in skipped:
        print("  skipped:", line)


if __name__ == "__main__":
    main()
