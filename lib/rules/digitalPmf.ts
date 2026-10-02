import { bestRating, band, insufficient, RUBRIC, scored, type Rule } from "./context";

/** R05: product feed + review volume + verifiable listings. Needs >=2 evidence types to score 4+. */
export const digitalPmf: Rule = ({ facts }) => {
  const cfg = RUBRIC.R05_digital_pmf;
  const types: string[] = [];
  const parts: string[] = [];
  let sum = 0;

  const feedKey = facts.shopify.available
    ? "shopify_json"
    : facts.jsonld.products.length ? "jsonld_products"
    : facts.jsonld.pagesParsed ? "sitemap_only" : "none";
  const feedScore = cfg.feedScores[feedKey as keyof typeof cfg.feedScores] ?? 0;
  if (feedScore > 0) { types.push("product feed"); }
  parts.push(`product feed "${feedKey}" -> ${feedScore}`);
  sum += feedScore * cfg.weights.feed;

  const rating = bestRating(facts);
  const rBand = rating ? band(cfg.reviewBands, rating.count, "minCount") : null;
  const reviewScore = rBand?.score ?? 0;
  if (reviewScore > 0) types.push("review volume");
  parts.push(rating ? `AggregateRating ${rating.value} from ${rating.count} reviews -> ${reviewScore}` : "no AggregateRating found -> 0");
  sum += reviewScore * cfg.weights.reviews;

  const listed = facts.marketplaces.present.length;
  const mBand = band(cfg.marketplaceBands, listed, "minCount");
  const mScore = mBand?.score ?? 0;
  if (mScore > 0) types.push("marketplace listings");
  parts.push(`${listed} verifiable marketplace listing(s)${facts.marketplaces.blocked.length ? `, ${facts.marketplaces.blocked.length} unverifiable (excluded)` : ""} -> ${mScore}`);
  sum += mScore * cfg.weights.marketplaces;

  const totalW = cfg.weights.feed + cfg.weights.reviews + cfg.weights.marketplaces;
  let score = Math.round((sum / totalW) * 10) / 10;
  const capped = types.length < cfg.minEvidenceTypesForScore4 && score >= 4;
  if (capped) score = 3;
  if (!types.length) {
    return insufficient("No digital PMF evidence at all: no product feed, no review count, no verifiable marketplace listing.", parts.join("; "));
  }
  return scored(
    score,
    types.includes("product feed") || types.includes("review volume") ? "Verified" : "Evidence-based assessment",
    `Weighted digital PMF: ${parts.join("; ")}. Evidence types present: ${types.join(", ")}.` +
    (capped ? ` Capped to 3: a score of 4+ needs at least ${cfg.minEvidenceTypesForScore4} independent evidence types.` : ""),
    facts.site.url ?? rating?.url ?? facts.marketplaces.probes.find(p => p.status === "present")?.url ?? "",
    facts.marketplaces.blocked.length ? `Unverifiable platforms excluded from the read: ${facts.marketplaces.blocked.join(", ")}.` : "",
  );
};
