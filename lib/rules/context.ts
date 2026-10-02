import categoryDemand from "../../config/category-demand.json";
import retailersConfig from "../../config/retailers.json";
import retailerProfiles from "../../config/retailer-profiles.json";
import rubric from "../../config/rubric.json";
import type { BrandFacts } from "../collectors/types";
import type { PressFacts } from "../collectors";
import type { Criterion } from "../criteria";
import type { Verification } from "../types";

export type RuleContext = {
  brand: { brand: string; website?: string | null; instagram?: string | null };
  facts: BrandFacts;
  press: PressFacts;
  criteria: Criterion[];
};

export type RuleOutput = {
  score: number | null;
  verification: Verification;
  evidence: string;
  sourceUrl: string;
  missing: string;
};

export type Rule = (ctx: RuleContext) => RuleOutput;

export const RUBRIC = rubric;
export const CATEGORIES = categoryDemand;
export const RETAILERS = retailersConfig;
export const PROFILES = retailerProfiles;

/** Score withheld: no usable evidence. Never 0. */
export function insufficient(missing: string, evidence = "", sourceUrl = ""): RuleOutput {
  return { score: null, verification: "Insufficient Data", evidence, sourceUrl, missing };
}

export function scored(score: number, verification: Verification, evidence: string, sourceUrl: string, missing = ""): RuleOutput {
  return { score: Math.max(0, Math.min(5, Math.round(score))), verification, evidence, sourceUrl, missing };
}

/** First band whose min threshold is met. Bands must be ordered high -> low. */
export function band<T extends Record<string, unknown>>(
  bands: readonly T[], value: number, key: keyof T,
): T | null {
  for (const b of bands) {
    const t = b[key];
    if (typeof t === "number" && value >= t) return b;
  }
  return null;
}

/** All variant prices across the Shopify feed and JSON-LD product offers. */
export function allPrices(facts: BrandFacts): { value: number; url: string; source: string }[] {
  const out: { value: number; url: string; source: string }[] = [];
  for (const p of facts.shopify.products) {
    for (const v of p.prices) if (v.price > 0) out.push({ value: v.price, url: p.url, source: "Shopify /products.json" });
  }
  for (const p of facts.jsonld.products) {
    if (p.price && p.price > 0) out.push({ value: p.price, url: p.url, source: "Product JSON-LD Offer" });
  }
  return out;
}

/** Best (most reviews) AggregateRating seen anywhere. */
export function bestRating(facts: BrandFacts): { value: number; count: number; url: string } | null {
  let best: { value: number; count: number; url: string } | null = null;
  if (facts.jsonld.rating) best = { ...facts.jsonld.rating, url: facts.site.url ?? "" };
  for (const p of facts.jsonld.products) {
    if (!p.rating) continue;
    if (!best || p.rating.count > best.count) best = { ...p.rating, url: p.url };
  }
  return best;
}

/** Distinct category keys implied by the product feed's types and tags. */
export function categoriesOf(facts: BrandFacts): { key: string; rank: number; sourceUrl: string; term: string }[] {
  const hay: string[] = [];
  for (const p of facts.shopify.products) {
    if (p.productType) hay.push(p.productType);
    hay.push(...p.tags);
  }
  const blob = hay.join(" | ").toLowerCase();
  if (!blob.trim()) return [];
  const found = new Map<string, { key: string; rank: number; sourceUrl: string; term: string }>();
  for (const c of CATEGORIES.categories) {
    for (const term of c.terms) {
      if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(blob)) {
        const prev = found.get(c.key);
        if (!prev || c.rank < prev.rank) found.set(c.key, { key: c.key, rank: c.rank, sourceUrl: c.sourceUrl, term });
        break;
      }
    }
  }
  return [...found.values()].sort((a, b) => a.rank - b.rank);
}

export function medianPrice(facts: BrandFacts): number | null {
  const xs = allPrices(facts).map(p => p.value);
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
