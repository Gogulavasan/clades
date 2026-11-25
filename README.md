# CLADES

**Do these accounts look *too* good?** CLADES is a Bloomberg-terminal-style web app that reads a company's
financial report in your browser, runs a fixed library of published forensic-accounting checks, and shows which
patterns are worth a closer look, with the evidence and the innocent explanation for each.

Live: https://gogulavasan.github.io/clades/

> A flag means look closer, not fraud. Not investment advice.

## Status

| Build | Scope | State |
| --- | --- | --- |
| 1 | Terminal shell, CI, GitHub Pages deploy | Done |
| 2 | Schema, Excel/CSV ingest, confirm screen, integrity gate | Done |
| 3 | Beneish M-score with hand-calculated tests | Done |
| 4 | Other rule batteries, Fraud Triangle scoring, case file | Done |
| 5 | Company dashboard and portfolio monitor | Done |
| 6 | Manual entry and PDF extraction | Next |
| 7 | Honest-profit estimator and text/governance rules | Planned |
| 8 | Offline sector benchmarks and back-test | Planned |

Not built yet, and labelled as such in the app: manual entry, PDF reading, governance text flags, the honest-profit
waterfall, the price/volume chart, real sector benchmarks, the back-test, and the Families panel.

## How it works

```
upload -> parse sheet -> map columns -> CONFIRM (you review every figure) -> integrity gate
       -> standardised schema (INR crore) -> models + rule library -> Fraud Triangle score -> case file -> screens
```

- **Static site only.** Vite + strict TypeScript on GitHub Pages. No server, database, API key or LLM call.
- **Private by construction.** Files are analysed in the browser tab. A Content-Security-Policy in `index.html`
  blocks the page from contacting any other origin. Results are kept in `localStorage`; Export / Import JSON on the
  Portfolio screen is the backup.
- **Nothing is invented.** A missing figure stays missing and every check that needs it reports NO DATA.
- **One case file.** After scoring, a single object (scores, inputs, formulas, sources, confidence, data-quality
  notes) is built; every screen and export renders from it.

### Data formats

1. **Screener.in "Export to Excel"** (`Data Sheet`): read as it is, in INR crore.
2. **Any spreadsheet or CSV** with line items down the first column and years across the top. Labels are matched by
   the alias table in `config/mapping.json`; anything unmatched is left unmapped and can be mapped by hand on the
   confirm screen.

Screener exports do not split current from non-current items and do not report long-term debt separately. Three
stand-ins are used and tagged **PROXY** everywhere (Other Assets for current assets, Other Liabilities for current
liabilities, total Borrowings for long-term debt). They lower the confidence level and can be switched off, in which
case AQI and LVGI are missing and no M-score is produced.

### Methodology

- **Beneish M-score** (Beneish 1999): all eight ratios, `M = -4.84 + 0.920 DSRI + 0.528 GMI + 0.404 AQI + 0.892 SGI
  + 0.115 DEPI - 0.172 SGAI + 4.679 TATA - 0.327 LVGI`. Two-key verdict: Clean needs M below -1.78 **and** at most
  two red ratios; strict mode needs every traffic-lighted ratio green. SGAI is shown as information only because its
  reference means barely differ and its weight is negative.
- **Other models:** Sloan accruals, Altman Z'' (emerging markets), Piotroski F. Dechow F-score is deliberately left
  out until its coefficients are verified against the source paper.
- **Rule library:** 28 rules across earnings quality, revenue quality, cost and asset games, balance-sheet logic,
  too-good-to-be-true, cross-statement consistency and an India pack. Each rule in `config/rules.json` carries its
  formula, thresholds, weight, plain-English meaning, innocent explanation and next step. The formula language
  (`src/rules/formula.ts`) means rules can be added, tuned or disabled without touching code.
- **Fraud Triangle:** every rule feeds Pressure, Opportunity or Rationalisation (0-100 each). Combination rules raise
  the score when several weak signals appear together. Tiers: Clean below 30, Watch 30-69, Suspicious 70+.
- **Confidence:** lowered for few years of data, proxies, low-confidence figures, integrity warnings, low rule
  coverage and placeholder benchmarks. A Suspicious score on low confidence is shown as **unconfirmed**.

## Run it

```bash
npm ci
npm run dev     # local dev server
npm test        # unit tests
npm run lint    # eslint + type check
npm run build   # production build into dist/
```

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`: install, lint, test, build, deploy to Pages. A failing test
stops the deploy.

The site sub-path is one variable, `BASE_PATH` in `vite.config.ts` (default `/clades/`). To deploy under another
repo name or a custom domain, change it there or set `CLADES_BASE` at build time. In the repository settings, Pages
source must be "GitHub Actions".

## Keyboard

`F1`-`F5` company tabs, `F6` portfolio, `F7` export PDF (the browser's print dialog; `Alt+1`-`Alt+7` do the same),
`/` focuses the command line. Commands: `SMPL4 <EQUITY> CLADES <GO>`, `SMPL4 BENEISH`, `PORT`, `VAL`, `PRIV`, `HELP`.

## What could be wrong with this

- **A flag is not proof.** Every pattern here also has ordinary business explanations, shown beside each flag.
- **Weights and cut-offs are judgment.** The rule weights, amber/red thresholds, leg saturation and combination
  rules are the author's choices. They have not been back-tested, so the 30 and 70 tier lines carry no measured
  hit rate or false-alarm rate yet.
- **US-calibrated references.** Beneish (1999) was fitted on US companies from the 1980s and 1990s. Its reference
  means and thresholds are not recalibrated on Indian data.
- **Correlated signals.** The M-score, its eight ratios and the accruals rules overlap, so one underlying issue can
  score several times.
- **Proxies.** With Screener data, AQI, LVGI and Altman Z'' rest on stand-in figures.
- **Placeholder benchmarks.** Sector comparisons use round illustrative values, not measured medians.
- **The demo set is synthetic.** Sample companies were designed to span the tiers, so their scores say nothing
  about how the rules perform on real companies.
- **Benford's law does not suit this data.** A company's line items over several years are highly correlated; the
  test raised a false alarm on the synthetic clean company, so it is displayed but carries no weight.
- **Small sample of known cases.** There are few well-documented Indian restatement cases, so any hit rate will have
  a wide error band.
- **Survivorship and look-ahead bias.** Known blow-ups are chosen with hindsight, and data providers show restated
  figures, which can leak the answer into a back-test.
- **Ind AS transition.** Accounts before and after the move to Ind AS (FY2017-FY2018) are not directly comparable.
- **Extraction errors.** Figures read from a spreadsheet can be wrong; the confirm step exists so a person checks
  them before anything is scored.

## Licence

MIT. See `LICENSE`.
