# CLADES: interview notes

## 30-second pitch

"CLADES asks one question of a company's accounts: do they look *too* good? You load a spreadsheet or annual report,
it runs a fixed library of published forensic checks in your browser, and it shows which patterns are worth a closer
look, with the evidence, the innocent explanation and the next thing to check for each. It is deliberately honest
about its limits: nothing is estimated when data is missing, proxies are labelled, and the validation page stays
empty until a real back-test has been run."

## 90-second version for a non-finance person

A company reports a profit. Profit is partly an opinion: it includes sales not yet paid for and costs spread over
future years. Cash is a fact. When profit keeps growing but cash does not, when customers take longer and longer to
pay, or when costs quietly move onto the balance sheet, the accounts start to look better than the business. Those
patterns have historically shown up before companies had to restate their numbers. CLADES measures about forty of
them, groups them into three questions (was there pressure, was there opportunity, were the accounts stretched) and
gives a score from 0 to 100. A high score means "look closer", never "guilty".

## 3-minute walkthrough

1. **Home.** Three ways in: Excel/CSV, PDF annual report, or typing figures by hand. A banner says the demo companies
   are synthetic.
2. **Confirm screen.** Every extracted figure is shown with a tag: HIGH, MED, LOW, PROXY, CALC, EDIT or MISS. Anything
   can be corrected. The **integrity gate** checks that the balance sheet balances and subtotals add up; if not,
   scoring is blocked and the exact mismatch is named. This is the step I would defend hardest: no score on numbers
   nobody checked.
3. **Verdict (F1).** Tier, score, how many independent models agree, three Fraud Triangle bars, reported versus
   stress-tested profit, and a one-paragraph summary written from templates.
4. **Beneish (F3).** The eight ratios against their reference points, each ratio's contribution to the M-score, and
   the two-key rule: Clean needs the M-score below -1.78 *and* at most two red ratios.
5. **Any flag opens.** Formula, every input with its source row or page and confidence, the innocent explanation and
   the next step. For PDF reports, text flags show the quoted sentence and page number.
6. **Earnings (F2).** The honest-profit bridge with sliders: what happens to profit if part of the receivables
   build-up is written off, part of the capitalised costs is expensed, depreciation goes back to last year's rate and
   other income is haircut.
7. **Portfolio (F6).** Heatmap of everything scanned, a quarantine list with status and notes, and a prediction
   ledger that records each flag so outcomes can be marked later, showing hit rate **and** false alarms.
8. **Validation.** Empty, on purpose, until the back-test is run on hand-entered annual-report data.

Architecture in one breath: static site on GitHub Pages, strict TypeScript, no server, no API keys, no LLM. Rules live
in JSON and are evaluated by a small formula parser, so a rule can be added or tuned without code. One case-file object
is built per company and every screen renders from it. 100+ unit tests gate the deploy.

## Ten tough questions

**1. Does it detect fraud?**
No. It detects accounting patterns that have historically appeared before restatements. Each has ordinary
explanations, which is why every flag carries one. The app never uses the word except in the framework name and the
disclaimer.

**2. The Beneish model was fitted on US companies in the 1980s and 90s. Why should it work in India today?**
It may not, and I say so in the app. The coefficients and reference means are the published ones, unchanged. The
back-test tooling exists to find out; until it is run on Indian data I make no performance claim. What I can defend is
that each ratio has an accounting logic that does not depend on geography: receivables outrunning sales means the same
thing in Mumbai as in Chicago.

**3. Where do your weights and the 30/70 cut-offs come from?**
Judgment. They are not calibrated. Each rule's weight reflects how directly it bears on cash versus reported profit,
and the cut-offs were set so that a company needs several independent signals to reach Suspicious. They live in
`config/rules.json`, so they can be changed and re-tested without touching code. The back-test currently covers only
the Beneish score, not my composite.

**4. Your sample companies score exactly as you would hope. Isn't that suspicious?**
Yes, and it means nothing: they are synthetic and were designed to span the tiers. I tuned the sample profiles, never
the thresholds. One useful thing did come out of it: the Benford test flagged the *clean* synthetic company, because a
company's line items over several years are highly correlated. So I set its weight to zero and show it as information
only.

**5. What is the false-positive rate?**
Unknown until measured, and I expect it to be high. Problems are rare. With a 2% base rate, a 70% hit rate and a 15%
false-positive rate, fewer than one flag in ten is a real problem. That is why the prediction ledger shows false
alarms beside hits and the notebook includes a base-rate table.

**6. Screener data does not give current assets, current liabilities or long-term debt. How do you compute AQI and LVGI?**
With labelled stand-ins: Other Assets, Other Liabilities and total Borrowings. They are tagged PROXY everywhere, they
lower the confidence level, and a switch turns them off, in which case those ratios are missing and no M-score is
produced. The PDF and manual routes use the real lines.

**7. How do you know the PDF extraction is right?**
I do not assume it is. It is rule-based: find the statement pages by headings, require a table, take the last two
numbers on each line as current and prior year. Every PDF figure is tagged MED or LOW and goes through the confirm
screen and the integrity gate. If the PDF is scanned it says so and falls back to manual entry. I have tested it on a
synthetic report, not yet on a range of real ones, so I expect layouts it misreads.

**8. Several of your rules measure the same thing. Aren't you double counting?**
Partly. The M-score, its ratios, TATA and the accruals rules overlap, so one underlying issue can score several
times. I kept the ratio weights low (1 each against 3 for the M-score) and documented it. The honest fix is to estimate
weights jointly on real data, which needs more Indian cases than exist.

**9. What biases would a back-test suffer from?**
Survivorship and hindsight (the case list is companies we already know failed), look-ahead (vendors show restated
figures, so the script only accepts as-filed numbers and only counts years strictly before the event), a hand-picked
control group, a tiny sample, and the Ind AS transition making years non-comparable. The notebook ends with a
checklist to run before believing any strong result.

**10. Why no machine learning or LLM?**
Three reasons. Privacy: everything runs in the browser, so uploads never leave the device. Explainability: every
number can be traced to a formula and a source line, which matters more than a point of accuracy when the output is
an accusation-shaped signal. And sample size: there are perhaps a few dozen well-documented Indian cases, far too few
to train anything without memorising them.

## What I would do next

1. Fill `notebooks/cases.csv` from original annual reports and publish the first real validation numbers.
2. Replace placeholder benchmarks with sector medians from public data.
3. Test the PDF route on twenty real annual reports and record where it fails.
4. Verify the Dechow F-score coefficients against the paper before adding it as a fifth model.
5. Cluster flagged companies by shared patterns (the "Families" panel).
