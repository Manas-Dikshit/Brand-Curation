import { median, round } from "../util/text";
import { allPrices, band, insufficient, RUBRIC, scored, type Rule } from "./context";

/** R01: share of products priced inside the rubric's target range. */
export const priceFit: Rule = ({ facts }) => {
  const cfg = RUBRIC.priceRange;
  const prices = allPrices(facts);
  if (!prices.length) {
    return insufficient(
      facts.site.status === "unresolved"
        ? "Official site unresolved, so no product feed could be read. Supply the website column."
        : "No variant prices found in Shopify /products.json or Product JSON-LD. No price means Insufficient Data, not 0.",
    );
  }
  const inRange = prices.filter(p => p.value >= cfg.min && p.value <= cfg.max);
  const pct = (inRange.length / prices.length) * 100;
  const med = median(prices.map(p => p.value));
  const b = band(RUBRIC.R01_price_fit.bands, pct, "minPct");
  const evidence =
    `${inRange.length}/${prices.length} prices (${round(pct, 1)}%) fall in ${cfg.currency} ${cfg.min}-${cfg.max}; ` +
    `median price ${cfg.currency} ${round(med ?? 0, 0)}, range ${cfg.currency} ${round(Math.min(...prices.map(p => p.value)), 0)}-${round(Math.max(...prices.map(p => p.value)), 0)}. ` +
    `Sample: ${prices.slice(0, 5).map(p => `${p.value} (${p.source})`).join(", ")}.`;
  return scored(b?.score ?? 0, "Verified", evidence, prices[0].url);
};
