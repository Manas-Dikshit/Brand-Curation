# Brand Curation & Evaluation

Local, keyless brand research and scoring. `npm i && npm run dev` — no API keys, no
paid services, no telemetry. Everything is public HTTP (robots-aware) plus deterministic rules.

## Run it

```bash
npm i
npm run dev      # http://localhost:3000
npm test         # 60 offline tests, no network
npm run build
```

Click **Load demo data (offline)** to see the whole pipeline run against the fixtures in
`tests/fixtures/` with the network stubbed out. Same code path as a real run.

## How a run works

1. **Validate reference.** `reference/Newtail_Brand_Curation_Matrix.xlsx`, sheet
   `Copy of Criteria & Weights`. All 15 criterion names must match exactly and the
   weights must total 100, otherwise the app refuses to run.
2. **Upload brand list.** `.xlsx` with `Brand`, optional `Website`, optional `Instagram`.
   Case/whitespace duplicates collapse and are reported.
3. **Collect** (`lib/collectors/`): site resolution (analyst URL first, identity gate
   ≥0.8), Shopify, JSON-LD, social, marketing signals, retail/store locator,
   marketplace probes, Wikipedia, and web/news search.
4. **Score** (`lib/rules/`, one file per criterion `R01`–`R15`).
5. **Review and export** (`lib/export.ts`): four sheets, live formulas, QC checks.

## Evidence rules (these are not negotiable)

- A numeric score requires **both** an `http(s)` source URL and the rule id that
  produced it. Otherwise it becomes `Insufficient Data` — **never a verified 0**.
- `Insufficient Data` adds no points and is never normalised away. A brand scored on
  62/100 weight reports `Partial`, and is not comparable with a `Complete` brand.
- Blocked, login-walled or unreadable platforms are `unverifiable`, never `absent`.
- Missing/unreadable data is recorded as `Insufficient Data`, not as a zero follower
  count or a zero store count.
- Analyst overrides win in totals, and the automatic score stays in the job file for
  audit. The export route re-applies the evidence gate server-side, so a hand-crafted
  client payload cannot smuggle an unbacked score into the workbook.
- Figures quoted in a foreign currency are never compared against INR bands (not
  converted, not scored).

## Offline whitespace direction

`R12 Offline whitespace` scores the **amount** of existing offline presence:
**higher score = more existing footprint = less whitespace for a new entrant.**
It never scores "absence" from a site that could not be read.

## Configuration

Weights come from the workbook at runtime and are never hardcoded. Everything else is
JSON in `config/` — edit without touching code:

| File | What it controls |
| --- | --- |
| `rubric.json` | thresholds and bands per criterion + rule id mapping |
| `category-demand.json` | per-category demand benchmarks (`R06`) |
| `retailers.json` | marketplace / quick-commerce target URLs |
| `retailer-profiles.json` | retailer category + price slots (`R13`) |
| `credible-domains.json` | allow-list of publishers that may be fetched or cited |

## Network etiquette

- `robots.txt` is honoured per origin before any fetch; a disallowed path is recorded
  as `robots`-blocked, not as "no data".
- Same-domain redirects only, 2 MB cap, 8 s timeout, 2 retries.
- 1 req/s per domain plus a global bucket (~10 req/s) in `lib/util/fetch.ts`.
- Responses cache to `.cache/http` for 7 days with ETag/Last-Modified revalidation;
  parsed facts cache to `.cache/facts` per schema version and brand.
- Optional JS rendering for pages that look like a bot wall: install `playwright`
  yourself and set `USE_PLAYWRIGHT=true`. Without it, nothing changes.

## Jobs and resume

Jobs persist to `.cache/jobs/<id>.json` including the upload inputs, so a reload or a
process restart resumes where it stopped (`?job=<id>` in the URL reconnects the live
feed). Progress streams over SSE; failed brands can be re-run on their own.

## Layout

```
app/            UI (single page) + API routes
lib/collectors/ evidence collectors, each returns {status, facts, evidence, notes}
lib/rules/      R01-R15, one pure function per criterion
lib/util/       fetch, cache, text parsing, workbook readers
config/         editable rubric/thresholds/allow-lists
tests/fixtures/ offline HTML/JSON/XML fixtures
```

## Tests

`npm test` covers the collectors against fixtures, all 15 rules (including the
withheld-score paths), the evidence gate, analyst override precedence, weight
validation, and an end-to-end offline run that asserts the generated workbook.