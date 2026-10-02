import { categoriesOf, insufficient, RUBRIC, scored, type Rule } from "./context";

/** R06: product type/tags must map to a curated, sourced category. Unknown category stays null. */
export const category: Rule = ({ facts }) => {
  if (!facts.shopify.available && !facts.jsonld.products.length) {
    return insufficient(
      facts.site.status === "unresolved"
        ? "Site unresolved: no product types or tags to classify."
        : "No product types or tags available (no product feed), so the brand cannot be mapped to a demand category.",
    );
  }
  const cats = categoriesOf(facts);
  if (!cats.length) {
    const types = [...new Set(facts.shopify.products.map(p => p.productType).filter(Boolean))].slice(0, 8);
    return insufficient(
      `Product types/tags do not match any category in config/category-demand.json${types.length ? ` (saw: ${types.join(", ")})` : ""}. Add the category to the config rather than guessing demand.`,
    );
  }
  const best = cats[0];
  const b = RUBRIC.R06_category_demand.demandBands.find(x => best.rank <= x.minRank);
  const urls = facts.shopify.products[0]?.url ?? facts.site.url ?? "";
  return scored(
    b?.score ?? 1,
    "Evidence-based assessment",
    `Mapped to curated category "${best.key}" (demand rank ${best.rank}) via product type/tag "${best.term}".` +
    (cats.length > 1 ? ` Other matches: ${cats.slice(1).map(c => `${c.key} (rank ${c.rank})`).join(", ")}.` : ""),
    urls,
    `Category ranking source: ${best.sourceUrl} (config/category-demand.json). Ranking is market-level, not brand-level.`,
  );
};
