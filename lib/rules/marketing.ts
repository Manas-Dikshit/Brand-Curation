import { withinDays } from "../util/text";
import { band, insufficient, RUBRIC, scored, type Rule } from "./context";

/** R07: count of verified on-site marketing signals + recent news/blog activity. */
export const marketing: Rule = ({ facts }) => {
  const cfg = RUBRIC.R07_marketing_activity;
  const found = facts.marketing.signals.filter(s => s in cfg.signalPoints) as (keyof typeof cfg.signalPoints)[];
  if (!found.length && !facts.search.news.length) {
    return insufficient(
      facts.site.status === "unresolved"
        ? "Site unresolved, so marketing activity could not be scanned."
        : "No marketing activity signals in the static HTML and no news items. A JS-only marketing stack shows nothing here; this is not proof of no marketing.",
    );
  }
  const n = found.length;
  const b = band(cfg.signalBands, n, "minSignals");
  let score = b?.score ?? 1;
  const recent = facts.search.news.filter(h => withinDays(h.date, cfg.recencyBump.recentDays));
  let bumped = false;
  if (recent.length && score < cfg.recencyBump.maxScore) { score = Math.min(cfg.recencyBump.maxScore, score + cfg.recencyBump.bump); bumped = true; }
  const recent90 = facts.search.news.filter(h => withinDays(h.date, 90));
  return scored(
    Math.min(cfg.maxScore, score),
    "Evidence-based assessment",
    `${n} on-site marketing signal(s): ${found.join(", ") || "none"}.` +
    (bumped ? ` Bumped for ${recent.length} news item(s) inside ${cfg.recencyBump.recentDays} days.` : "") +
    (recent90.length ? ` ${recent90.length} news item(s) in the last 90 days (latest: "${recent90[0].title.slice(0, 140)}").` : " No news inside 90 days."),
    found.length ? facts.site.url ?? "" : facts.search.news[0]?.url ?? "",
    "Signals show marketing ACTIVITY only. They do not prove spend, trade-marketing budget or willingness to buy visibility (see R11).",
  );
};
