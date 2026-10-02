# Brand Curation & Evaluation (Next.js)
1. `cp .env.example .env.local`, set ANTHROPIC_API_KEY. 2. `npm i && npm run dev`.
Weights are read at runtime from `reference/Newtail_Brand_Curation_Matrix.xlsx` (sheet = REF_SHEET); never hardcoded.
Flow: validate reference -> upload brand list -> per-brand web research (Claude + web_search) -> score only with a source URL, else "Insufficient Data" -> Excel export with live formulas.
Open items: offline whitespace vs footprint wording; the 70 SELECTED threshold is not applied (the original matrix could only reach 80); partial scores are intentionally not normalized.
