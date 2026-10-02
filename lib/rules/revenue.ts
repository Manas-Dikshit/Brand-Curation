import { round } from "../util/text";
import { band, insufficient, RUBRIC, scored, type Rule } from "./context";

const NOW = new Date().getFullYear();

/** R04: only a cited revenue/funding figure with a year. A Wikipedia article alone is not proof of sales. */
export const revenue: Rule = ({ facts, press }) => {
  const cfg = RUBRIC.R04_revenue_track_record;
  const candidates: { value: number; year: number | null; text: string; url: string; origin: string; currency: string }[] = [];

  if (facts.wiki.revenue) {
    candidates.push({
      value: facts.wiki.revenue.value,
      year: facts.wiki.revenue.year,
      text: facts.wiki.revenue.statement,
      url: facts.wiki.url ?? "",
      origin: `Wikipedia (${facts.wiki.title ?? "article"})`,
      currency: facts.wiki.revenue.currency,
    });
  }
  for (const s of press.statements) {
    candidates.push({ value: s.value, year: s.year, text: s.text, url: s.url, origin: "Credible press", currency: s.currency });
  }

  if (!candidates.length) {
    return insufficient(
      facts.wiki.found
        ? `Wikipedia article "${facts.wiki.title}" exists but states no revenue figure, and no allow-listed press source stated one. Presence on Wikipedia is not proof of sales.`
        : "No Wikipedia article and no cited revenue/funding figure found. Listings, followers and reviews are not evidence of revenue.",
    );
  }

  // bands are in rupees; a USD/EUR/GBP figure is not convertible here, so it is not scored
  const inr = candidates.filter(c => c.currency === "INR");
  const foreign = candidates.filter(c => c.currency !== "INR");
  if (!inr.length) {
    return insufficient(
      `Figure(s) found but stated in ${foreign.map(c => c.currency).filter((v, i, a) => a.indexOf(v) === i).join("/")}, and the rubric bands are in INR: ${foreign.map(c => `"${c.text.slice(0, 160)}" (${c.origin})`).join("; ")}. Not converted, not scored.`,
      foreign[0]?.text ?? "", foreign[0]?.url ?? "",
    );
  }

  const fresh = inr.filter(c => c.year === null || NOW - c.year <= cfg.maxAgeYears);
  const stale = inr.filter(c => c.year !== null && NOW - c.year > cfg.maxAgeYears);
  const usable = fresh.length ? fresh : [];
  if (!usable.length) {
    return insufficient(
      `Only stale figures found (${stale.map(c => `${c.year}: ${c.origin}`).join(", ")}), older than ${cfg.maxAgeYears} years. Not scored.`,
      stale[0]?.text ?? "", stale[0]?.url ?? "",
    );
  }

  const best = usable.sort((a, b) => b.value - a.value)[0];
  const b = band(cfg.bands, best.value, "min");
  const label = (cfg.bands.find(x => x.min === b?.min)?.label ?? "") || "below the smallest band";
  return scored(
    b?.score ?? 1,
    "Evidence-based assessment",
    `${best.origin} states ${best.year ? `${best.year}: ` : ""}${round(best.value, 0)} (${label}). Quoted: "${best.text.slice(0, 300)}"`,
    best.url,
    [
      "Reported figure, not audited.",
      stale.length ? `Also found but ignored as older than ${cfg.maxAgeYears} years: ${stale.map(c => c.year).join(", ")}.` : "",
      foreign.length ? `Ignored: figure(s) stated in ${foreign.map(c => c.currency).join("/")} cannot be compared to INR bands.` : "",
    ].filter(Boolean).join(" "),
  );
};
