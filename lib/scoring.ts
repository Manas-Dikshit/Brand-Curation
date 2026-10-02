import type { CriterionResult, Pillar } from "./types";
import { PILLARS, type Criterion } from "./criteria";

export type Summary = {
  totalPct: number;
  assessedWeight: number;
  status: string;
  pillarSubtotals: Record<Pillar, number>;
};

/**
 * Score = Σ(score/5 × weight) out of 100. Unscored criteria add nothing but are
 * reported through assessedWeight, so partial totals are never silently normalised.
 */
export function summarize(criteria: Criterion[], results: CriterionResult[]): Summary {
  let points = 0;
  let assessed = 0;
  const pillarSubtotals = Object.fromEntries(PILLARS.map(p => [p, 0])) as Record<Pillar, number>;

  for (const c of criteria) {
    const r = results.find(x => x.name === c.name);
    if (r && r.score !== null) {
      const contribution = (r.score / 5) * c.weight;
      points += contribution;
      assessed += c.weight;
      pillarSubtotals[c.pillar] = Math.round((pillarSubtotals[c.pillar] + contribution) * 10) / 10;
    }
  }

  const total = criteria.reduce((s, c) => s + c.weight, 0);
  const status =
    assessed === 0 ? "Not assessed"
    : Math.abs(assessed - total) < 1e-9 ? "Complete"
    : `Partial (${round1(assessed)}/${round1(total)} weight scored)`;

  return { totalPct: round1(points), assessedWeight: round1(assessed), status, pillarSubtotals };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Analyst overrides win over auto scores; the auto result is retained for audit. */
export function mergeOverride(auto: CriterionResult[], overrides: CriterionResult[]): CriterionResult[] {
  const byName = new Map(auto.map(r => [r.name, r]));
  for (const o of overrides) {
    const prev = byName.get(o.name);
    byName.set(o.name, {
      name: o.name,
      score: o.score,
      verification: o.verification,
      evidence: o.evidence || prev?.evidence || "",
      sourceUrl: o.sourceUrl,
      missing: o.missing ?? "",
      ruleId: null,
      source: "analyst",
    });
  }
  return [...byName.values()];
}

/** Rule 3: a numeric score without a source URL or a rule id is withheld. */
export function enforceEvidenceRule(results: CriterionResult[]): CriterionResult[] {
  return results.map(r => {
    if (r.score === null) return { ...r, verification: "Insufficient Data", ruleId: null };
    if (!/^https?:\/\//i.test(r.sourceUrl)) {
      return {
        ...r,
        score: null,
        verification: "Insufficient Data",
        ruleId: null,
        missing: `${r.missing ? r.missing + " " : ""}Score withheld: a numeric score needs a source URL.`.trim(),
      };
    }
    // Analyst rows are a human vouched for number, so only the URL is required.
    if (!r.ruleId && r.source !== "analyst") {
      return {
        ...r,
        score: null,
        verification: "Insufficient Data",
        ruleId: null,
        missing: `${r.missing ? r.missing + " " : ""}Score withheld: no rule id produced it.`.trim(),
      };
    }
    return r;
  });
}

/** QC: rows claiming a score without backing evidence. */
export function unsupportedClaims(results: CriterionResult[]): string[] {
  return results
    .filter(r => r.score !== null && (!/^https?:\/\//i.test(r.sourceUrl) || (!r.ruleId && r.source !== "analyst")))
    .map(r => `${r.name}: score ${r.score} without a source URL or rule id`);
}
