import { Criterion, CriterionResult } from "./criteria";
export function summarize(criteria: Criterion[], results: CriterionResult[]) {
  let points = 0, assessed = 0;
  for (const c of criteria) {
    const r = results.find(x => x.name === c.name);
    if (r && r.score !== null) { points += (r.score / 5) * c.weight; assessed += c.weight; }
  }
  const total = criteria.reduce((s, c) => s + c.weight, 0);
  const status = assessed === 0 ? "Not assessed" : Math.abs(assessed - total) < 1e-9 ? "Complete" : `Partial (${assessed}/${total} weight scored)`;
  // Total Weighted Score (%) = points out of 100; unscored criteria add 0 and are flagged via status, never treated as verified zeros.
  return { totalPct: Math.round(points * 10) / 10, assessedWeight: assessed, status };
}
