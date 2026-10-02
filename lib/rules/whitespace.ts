import { band, insufficient, RUBRIC, scored, type Rule } from "./context";

/** R12: DIRECTION PER THE REFERENCE SHEET — higher score = LESS existing offline presence (whitespace). */
export const whitespace: Rule = ({ facts }) => {
  const cfg = RUBRIC.R12_offline_whitespace;
  const dirNote = "Scored per the reference sheet: HIGHER = LESS existing offline presence (more whitespace for Newtail).";
  if (facts.site.status === "unresolved") {
    return insufficient(`Official site unresolved, so the brand's own offline listing could not be read. Offline footprint is unknown, not zero. ${dirNote}`);
  }
  const declared = facts.retail.storeCountDeclared;
  const observed = facts.retail.stores.length;
  const retailers = facts.retail.retailerMatches.length;
  const best = Math.max(declared ?? 0, observed, retailers);
  const sourceUrl = facts.retail.pagesFound[0] ?? facts.site.url ?? "";

  if (!facts.retail.pagesFound.length && best === 0) {
    return scored(
      cfg.noPresenceScore,
      "Evidence-based assessment",
      `No store-locator, where-to-buy or stockist page found on the brand's own site (${dirNote}) Reading: the brand publishes no documented offline footprint.`,
      facts.site.url ?? "",
      `Derived from absence of documentation, not from an observed audit. ${dirNote}`,
    );
  }

  if (best === 0) {
    return insufficient(`A locator page exists (${facts.retail.pagesFound.join(", ")}) but no store or stockist could be parsed from it.`);
  }

  const b = band(cfg.presenceBands, best, "minStores");
  const score = b?.score ?? 1;
  return scored(
    score,
    "Evidence-based assessment",
    `Documented offline footprint: ${declared ? `brand declares ${declared} store(s)/outlets` : ""}${declared && (observed || retailers) ? "; " : ""}` +
    `${observed ? `${observed} city/locations parsed` : ""}${observed && retailers ? "; " : ""}` +
    `${retailers ? `${retailers} configured retail partner(s) named on the brand's page (${facts.retail.retailerMatches.map(r => r.retailer).join(", ")})` : ""}. ` +
    `${dirNote} Presence is presence only, not sell-through.`,
    sourceUrl,
    `Only listings the brand itself publishes are counted; third-party directory presence is not included. ${dirNote}`,
  );
};
