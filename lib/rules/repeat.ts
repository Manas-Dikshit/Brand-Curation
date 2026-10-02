import { RUBRIC, band, insufficient, scored, type Rule } from "./context";

const RATE_RE = /(\d{1,2}(?:\.\d+)?)\s*%\s*(?:of\s+)?(?:our\s+)?(?:customers\s+)?(?:repeat|purchase\s+again|reorder|come\s+back)/i;

/** R03: repeat purchase needs subscription/loyalty evidence; caps at 3 without a stated rate. */
export const repeat: Rule = ({ facts }) => {
  const cfg = RUBRIC.R03_repeat_retention;
  const signals = facts.marketing.signals;

  const stated = [...facts.search.web, ...facts.search.news].find(h => RATE_RE.test(`${h.title} ${h.snippet ?? ""}`));
  const statedRate = stated ? stated.title.match(RATE_RE) : null;
  if (statedRate) {
    const pct = parseFloat(statedRate[1]);
    const s = band(cfg.statedRepeatRateBands, pct, "minPct")?.score ?? 1;
    return scored(s, "Evidence-based assessment",
      `A source states a repeat rate: "${stated!.title.slice(0, 240)}".`,
      stated!.url, "Self-reported rate from a cited source.");
  }

  const found = signals.filter(s => cfg.signalScores[s as keyof typeof cfg.signalScores] !== undefined && cfg.signalScores[s as keyof typeof cfg.signalScores] !== null);
  if (!found.length) {
    return insufficient(
      facts.site.status === "unresolved"
        ? "Site unresolved, so subscription/loyalty evidence could not be checked."
        : "No subscription, auto-replenish or loyalty signal on the brand's site, and no cited repeat rate. Repeat purchase cannot be inferred from social followers or review counts.",
    );
  }
  const top = Math.max(...found.map(s => cfg.signalScores[s as keyof typeof cfg.signalScores] as number));
  return scored(
    Math.min(cfg.capWithoutStatedRate, top),
    "Evidence-based assessment",
    `Retention signals present on the brand's own site: ${found.join(", ")}. A subscription or loyalty programme shows intent to retain, not a measured repeat rate, so the score is capped at ${cfg.capWithoutStatedRate}.`,
    facts.site.url ?? "",
    "No cited repeat rate; capped at " + cfg.capWithoutStatedRate + " pending analyst input.",
  );
};
