import { round } from "../util/text";
import { categoriesOf, insufficient, medianPrice, PROFILES, RUBRIC, scored, type Rule } from "./context";

/** R13: rule-based match of the brand's categories and price band against retailer category needs. */
export const retailerFit: Rule = ({ facts }) => {
  const cfg = RUBRIC.R13_retailer_fit;
  const cats = categoriesOf(facts).map(c => c.key);
  if (!cats.length) {
    return insufficient("Brand categories unknown (no product types/tags mapped), so retailer category fit cannot be computed.");
  }
  const price = medianPrice(facts);
  if (cfg.requirePriceInBand && price === null) {
    return insufficient("Brand price band unknown (no variant prices), so the retailer's price slot could not be tested.");
  }
  const matches: string[] = [];
  for (const p of PROFILES.profiles) {
    const catHit = p.categories.filter(c => cats.includes(c));
    if (!catHit.length) continue;
    const priceHit = price === null || !cfg.requirePriceInBand || (price >= p.priceMin && price <= p.priceMax);
    if (priceHit) matches.push(`${p.name} (${catHit.join("/")}, median Rs ${round(price ?? 0, 0)} in ${p.priceMin}-${p.priceMax})`);
  }
  if (!matches.length) {
    const near = PROFILES.profiles.filter(p => p.categories.some(c => cats.includes(c)));
    return insufficient(
      `No retailer profile matches on category AND price together. Category matches exist (${near.map(p => `${p.name} wants ${p.categories.filter(c => cats.includes(c)).join("/")} at Rs ${p.priceMin}-${p.priceMax}`).join("; ")}) but the brand's median price Rs ${round(price ?? 0, 0)} sits outside those slots.`,
    );
  }
  const b = cfg.bands.find(x => matches.length >= x.minMatches);
  return scored(
    b?.score ?? 2,
    "Evidence-based assessment",
    `Brand categories [${cats.join(", ")}] with median price Rs ${round(price ?? 0, 0)} fit ${matches.length} retailer profile(s): ${matches.join("; ")}.`,
    facts.shopify.products[0]?.url ?? facts.site.url ?? "",
    "Category and price fit only. It says nothing about whether the retailer has asked for the brand (that needs a real order or a retailer conversation).",
  );
};
