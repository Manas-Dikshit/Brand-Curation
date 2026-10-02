import { collectAll, type PressFacts } from "./collectors";
import type { BrandFacts } from "./collectors/types";
import { brandKey, FACTS_SCHEMA_VERSION, readCache, writeCache } from "./util/cache";
import { loadReference } from "./reference";
import { applyRules } from "./rules";
import { enforceEvidenceRule, summarize } from "./scoring";
import type { Criterion } from "./criteria";
import type { BrandInput, CriterionResult, Evaluation } from "./types";

export type EngineProgress = (step: string, detail?: string) => void;

/**
 * Cached collection per brand. The cache is keyed on the brand name and the schema
 * version, so a code change to collectors invalidates every brand automatically.
 */
export async function collectCached(input: BrandInput, onProgress?: EngineProgress): Promise<{ facts: BrandFacts; press: PressFacts }> {
  // the supplied website/handle are part of the key: a corrected URL must not reuse stale facts
  const key = brandKey([input.brand, input.website ?? "", input.instagram ?? ""].join("|"));
  const hit = readCache<{ facts: BrandFacts; press: PressFacts }>("facts", key);
  if (hit?.facts) {
    onProgress?.("cache", "facts reused");
    return hit;
  }
  onProgress?.("cache", "collecting");
  const res = await collectAll(input, onProgress);
  writeCache("facts", key, res);
  return res;
}

export async function evaluateBrand(
  input: BrandInput,
  criteria: Criterion[],
  onProgress?: EngineProgress,
): Promise<Evaluation> {
  const t0 = Date.now();
  const { facts, press } = await collectCached(input, onProgress);
  onProgress?.("rules", `${criteria.length} criteria`);

  const outputs = applyRules({ brand: input, facts, press, criteria });
  const results: CriterionResult[] = criteria.map(c => {
    const o = outputs.get(c.name);
    return {
      name: c.name,
      score: o?.score ?? null,
      verification: o?.score === null ? "Insufficient Data" : (o?.verification ?? "Insufficient Data"),
      evidence: o?.evidence ?? "",
      sourceUrl: o?.sourceUrl ?? "",
      missing: o?.missing ?? "",
      ruleId: o?.ruleId ?? null,
      source: "auto",
      attempted: o?.attempted ?? false,
    };
  });

  const enforced = enforceEvidenceRule(results);
  const summary = summarize(criteria, enforced);
  onProgress?.("done", `${summary.totalPct}%`);

  return {
    brand: input.brand,
    website: input.website ?? null,
    instagram: input.instagram ?? null,
    results: enforced,
    auto: results,
    blockedPlatforms: facts.marketplaces.blocked,
    ...summary,
    durationMs: Date.now() - t0,
  };
}

/** Validates the reference before any work starts; scoring is blocked when it fails. */
export async function ensureReference() {
  const ref = await loadReference();
  if (!ref.ok) {
    const err = new Error("Reference validation failed: " + ref.issues.join("; ")) as Error & { issues?: string[] };
    err.issues = ref.issues;
    throw err;
  }
  return ref;
}

export { FACTS_SCHEMA_VERSION };
