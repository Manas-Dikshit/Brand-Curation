import { insufficient, RUBRIC, scored, type Rule } from "./context";

/** R15: only a cited bestseller rank with a number. A listing is not sell-through. */
export const sellThrough: Rule = ({ facts }) => {
  const cfg = RUBRIC.R15_sell_through;
  const ranks = facts.marketplaces.ranks.filter(r => r.rank > 0 && r.url);
  if (!ranks.length) {
    const listed = facts.marketplaces.present;
    return insufficient(
      listed.length
        ? `Listed on ${listed.join(", ")}, but no bestseller rank with a number was parseable from the public page. A listing is not sell-through; use evidence.xlsx to import a retailer bestseller list.`
        : "No verifiable marketplace listing and no cited sell-through report. Sell-through is never inferred from listings.",
    );
  }
  const best = ranks.reduce((a, b) => (a.rank <= b.rank ? a : b));
  const b = cfg.rankBands.find(x => best.rank <= x.maxRank);
  const score = b?.score ?? 1;
  return scored(
    score,
    "Evidence-based assessment",
    `Marketplace bestseller badge: "${best.label}" on ${best.platform}.`,
    best.url,
    `Rank read from a public search page; the page carries no capture date so freshness beyond ${cfg.maxAgeDays} days cannot be confirmed. Corroborate with a retailer report before acting.`,
  );
};
