import { isCredible, isCredibleSource } from "../collectors/search";
import { RUBRIC, scored, type Rule, insufficient } from "./context";

const SIGNAL_HINTS: Record<string, RegExp> = {
  trade_program: /(trade\s+(programme|program|scheme|offer)|distributor\s+(scheme|program)|retailer\s+(margin|scheme|program))/i,
  sampling_campaign: /(sampling\s+(campaign|program|initiative)|free\s+samples?\s+(campaign|program)|trial\s+sizes?\s+(campaign|at|across))/i,
  retail_media_campaign: /(retail\s*media|on-ground\s+activation|retail\s+activation\s+(campaign|program))/i,
  ad_library_spend: /(ad\s+library|advertising\s+spend|ad\s+spend|media\s+spend)/i,
  in_store_promotion: /(in-store\s+(promotion|activation|display|merchandising)|shop\s*window|offline\s+activation)/i,
};

/** R11: willingness to pay for visibility needs DOCUMENTED trade/retail-media evidence, not just ad tags. */
export const visibility: Rule = ({ facts }) => {
  const cfg = RUBRIC.R11_visibility_investment;
  const hits: { signal: string; title: string; url: string }[] = [];
  let rejected = 0;
  for (const h of [...facts.search.news, ...facts.search.web]) {
    const text = `${h.title} ${h.snippet ?? ""}`;
    for (const [signal, re] of Object.entries(SIGNAL_HINTS)) {
      if (!re.test(text)) continue;
      // a headline only counts when the publisher is on the allow-list
      const trusted = facts.search.web.includes(h) ? isCredible(h.url) : isCredibleSource(h.source);
      if (!trusted) { rejected++; continue; }
      hits.push({ signal, title: h.title, url: h.url });
    }
  }
  const unique = [...new Map(hits.map(h => [h.signal, h])).values()];

  if (!unique.length) {
    const marketingSignals = facts.marketing.signals;
    const adTags = marketingSignals.filter(s => ["meta_pixel", "google_tag", "klaviyo", "google_ads_link", "meta_ad_library_link"].includes(s));
    return insufficient(
      "No documented trade-marketing, sampling, retail-media or ad-spend evidence found. " +
      (adTags.length
        ? `The site does load ${adTags.join(", ")}, but running ad tech is not evidence of willingness to pay for in-store visibility, so nothing is scored.`
        : "No ad-tech or trade-marketing evidence at all.") +
      (rejected ? ` ${rejected} matching headline(s) were ignored because the publisher is not on the credible allow-list.` : "") +
      " This criterion normally needs analyst input from a trade programme or retailer conversation.",
    );
  }
  const score = unique.length >= cfg.band.minSignals ? cfg.band.score : cfg.singleSignalScore;
  return scored(
    score,
    "Evidence-based assessment",
    `${unique.length} documented visibility-investment signal(s): ${unique.map(h => `${h.signal} ("${h.title.slice(0, 120)}")`).join("; ")}.`,
    unique[0].url,
    [
      "Snippet-level evidence from a headline; analyst should verify the underlying campaign before relying on it.",
      rejected ? `${rejected} headline(s) from non-allow-listed publishers were ignored.` : "",
    ].filter(Boolean).join(" "),
  );
};
