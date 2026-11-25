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
| 2 | Schema, Excel/CSV ingest, confirm screen | Next |
| 3 | Beneish M-score with hand-checked tests | Planned |
| 4 | Other rule batteries, Fraud Triangle scoring, case file | Planned |
| 5 | Company dashboard and portfolio monitor | Planned |
| 6 | Manual entry and PDF extraction | Planned |
| 7 | Honest-profit estimator and text rules | Planned |
| 8 | Offline sector benchmarks and back-test | Planned |

Build 1 is an empty shell: every screen and panel exists, none shows a number, because no analysis is built yet.

## How it is built

- **Static site only.** Vite + strict TypeScript, deployed to GitHub Pages. No server, database, API key or LLM call.
- **Private by construction.** Files are analysed in the browser tab. A Content-Security-Policy in `index.html`
  blocks the page from contacting any other origin.
- **Config-driven.** Rules, thresholds and explanations live in `config/rules.json`.
- **Scope.** Indian listed non-financial companies (NSE/BSE, Ind AS). Banks, NBFCs and insurers are reported as
  "Not assessable".

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

`F1`-`F5` company tabs, `F6` portfolio, `F7` export PDF (`Alt+1`-`Alt+7` do the same), `/` focuses the command
line. Commands: `INFY <EQUITY> CLADES <GO>`, `PORT`, `VAL`, `PRIV`, `HELP`.

## What could be wrong with this

- **A flag is not proof.** Every pattern here also has ordinary business explanations.
- **US-calibrated references.** Beneish (1999) was fitted on US companies from the 1980s and 1990s. Its reference
  values and thresholds are not recalibrated on Indian data.
- **Small sample of known cases.** There are few well-documented Indian restatement cases, so any hit rate will have
  a wide error band.
- **Survivorship and look-ahead bias.** Known blow-ups are chosen with hindsight, and restated figures can leak the
  answer into a back-test.
- **Ind AS transition.** Accounts before and after the move to Ind AS (2016 to 2018) are not directly comparable.
- **Extraction errors.** Figures read from a spreadsheet or PDF can be wrong; the confirm step exists so a person
  checks them before anything is scored.

## Licence

MIT. See `LICENSE`.
