import { expect, test } from "vitest";
import { loadReference } from "@/lib/reference";
import { summarize, mergeOverride, enforceEvidenceRule, unsupportedClaims } from "@/lib/scoring";
import { applyRules } from "@/lib/rules";
import { emptyFacts } from "@/lib/collectors/types";
import type { Criterion } from "@/lib/criteria";
import type { CriterionResult } from "@/lib/types";

/** Offline: builds the criteria list straight from the real reference workbook. */
async function criteria(): Promise<Criterion[]> {
  const ref = await loadReference();
  expect(ref.ok, "reference validation must pass: " + ref.issues.join("; ")).toBe(true);
  expect(ref.criteria.length).toBe(15);
  expect(ref.totalWeight).toBe(100);
  return ref.criteria;
}

const ctx = (cs: Criterion[]) => ({ brand: { brand: "Test" }, facts: emptyFacts({ brand: "Test" }), press: { statements: [] }, criteria: cs });

test("reference workbook validates: 15 criteria, weights total 100", async () => {
  const cs = await criteria();
  expect(new Set(cs.map(c => c.name)).size).toBe(15);
  for (const c of cs) {
    expect(c.weight).toBeGreaterThan(0);
    expect(c.ruleId).toMatch(/^R\d{2}-/);
    expect(c.pillar).toBeTruthy();
  }
});

test("every registered rule emits only its own ruleId", async () => {
  const cs = await criteria();
  const out = applyRules(ctx(cs));
  for (const c of cs) {
    const r = out.get(c.name)!;
    if (r.score !== null) expect(r.ruleId, `${c.name} scored without a rule id`).toBe(c.ruleId);
    if (r.score === null) expect(r.verification).toBe("Insufficient Data");
  }
});

test("empty facts produce Insufficient Data everywhere, never 0", async () => {
  const cs = await criteria();
  const out = applyRules(ctx(cs));
  for (const c of cs) {
    const r = out.get(c.name)!;
    expect(r.score, `${c.name} fabricated a score from no evidence`).toBeNull();
    expect(r.missing.length).toBeGreaterThan(0);
  }
});

test("score math is Σ(score/5 × weight) out of 100 and partial totals are not normalised", async () => {
  const cs = await criteria();
  const results: CriterionResult[] = cs.map(c => ({
    name: c.name, score: c.name === "Product price fit" ? 5 : null, verification: "Verified",
    evidence: "x", sourceUrl: "https://example.com/a", missing: "", ruleId: c.ruleId, source: "auto",
  }));
  const s = summarize(cs, results);
  const expected = (5 / 5) * cs.find(c => c.name === "Product price fit")!.weight;
  expect(s.totalPct).toBe(Math.round(expected * 10) / 10);
  expect(s.assessedWeight).toBe(cs.find(c => c.name === "Product price fit")!.weight);
  expect(s.status).toMatch(/^Partial/);

  const full = summarize(cs, cs.map(c => ({ ...results[0], name: c.name, score: 5 } as CriterionResult)));
  expect(full.status).toBe("Complete");
  expect(full.totalPct).toBe(100);
});

test("a numeric score with no source URL or no rule id is withheld", () => {
  const mk = (patch: Partial<CriterionResult>): CriterionResult => ({
    name: "X", score: 4, verification: "Verified", evidence: "e", sourceUrl: "", missing: "", ruleId: "R01-price-fit", source: "auto", ...patch,
  });
  expect(enforceEvidenceRule([mk({})])[0].score).toBeNull();
  expect(enforceEvidenceRule([mk({})])[0].verification).toBe("Insufficient Data");
  expect(enforceEvidenceRule([mk({ sourceUrl: "https://example.com", ruleId: null })])[0].score).toBeNull();
  expect(enforceEvidenceRule([mk({ sourceUrl: "https://example.com" })])[0].score).toBe(4);
  expect(unsupportedClaims([mk({})])).toHaveLength(1);
});

test("analyst overrides win over auto scores and are retained for audit", async () => {
  const cs = await criteria();
  const auto: CriterionResult[] = cs.map(c => ({
    name: c.name, score: 2, verification: "Evidence-based assessment", evidence: "auto",
    sourceUrl: "https://example.com/auto", missing: "", ruleId: c.ruleId, source: "auto",
  }));
  const target = cs[0];
  const merged = mergeOverride(auto, [{
    name: target.name, score: 5, verification: "Verified", evidence: "retailer sheet",
    sourceUrl: "https://example.com/pdf", missing: "", ruleId: "analyst", source: "analyst",
  }]);
  const m = merged.find(r => r.name === target.name)!;
  expect(m.score).toBe(5);
  expect(m.source).toBe("analyst");
  // an analyst number carries no rule id; `source` is what marks it human
  expect(m.ruleId).toBeNull();
  expect(merged.find(r => r.name === cs[1].name)!.source).toBe("auto");
  expect(summarize(cs, merged).totalPct).toBeGreaterThan(summarize(cs, auto).totalPct);
});

test("evidence gate withholds scores missing a URL, and exempts analyst rows from rule ids", () => {
  const noUrl = enforceEvidenceRule([{
    name: "Price competitiveness", score: 4, verification: "Evidence-based assessment",
    evidence: "seen on a page", sourceUrl: "", missing: "", ruleId: "R01-price-fit", source: "auto",
  }]);
  expect(noUrl[0].score).toBeNull();
  expect(noUrl[0].verification).toBe("Insufficient Data");
  expect(noUrl[0].missing).toMatch(/source URL/);

  const analyst = enforceEvidenceRule([{
    name: "Price competitiveness", score: 4, verification: "Verified", evidence: "analyst sheet",
    sourceUrl: "https://example.com/pdf", missing: "", ruleId: null, source: "analyst",
  }]);
  expect(analyst[0].score).toBe(4);
  expect(unsupportedClaims(analyst)).toEqual([]);
});
