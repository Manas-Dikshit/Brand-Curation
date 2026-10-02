import { round } from "../util/text";
import { band, insufficient, RUBRIC, scored, type Rule } from "./context";

const MARGIN_RE = /(?:gross\s+)?margin\s*(?:of|is|:)?\s*(\d{1,2}(?:\.\d+)?)\s*%/i;

/** R02: MRP/discount gap is a proxy for margin depth. Never presented as margin. */
export const margin: Rule = ({ facts }) => {
  const stated: { pct: number; text: string; url: string }[] = [];
  const snippets = [
    ...facts.search.web.map(h => ({ text: `${h.title} ${h.snippet ?? ""}`, url: h.url })),
    ...facts.search.news.map(h => ({ text: h.title, url: h.url })),
  ];
  for (const s of snippets) {
    const m = s.text.match(MARGIN_RE);
    if (m) stated.push({ pct: parseFloat(m[1]), text: s.text.slice(0, 300), url: s.url });
  }
  if (stated.length) {
    const best = stated.sort((a, b) => b.pct - a.pct)[0];
    const b = band(RUBRIC.R02_high_margin.statedMarginBands, best.pct, "minPct");
    return scored(
      b?.score ?? 1,
      "Evidence-based assessment",
      `A source states gross margin at ${best.pct}%: "${best.text}". Stated margin from a cited source, not a discount proxy.`,
      best.url,
      "Reported by the source; not audited.",
    );
  }

  const gaps: { pct: number; title: string; url: string; mrp: number; price: number }[] = [];
  for (const p of facts.shopify.products) {
    for (const v of p.prices) {
      if (!v.compareAt || v.compareAt <= v.price) continue;
      gaps.push({ pct: ((v.compareAt - v.price) / v.compareAt) * 100, title: p.title, url: p.url, mrp: v.compareAt, price: v.price });
    }
  }
  if (gaps.length < RUBRIC.R02_high_margin.minGapSampleSize) {
    return insufficient(
      gaps.length
        ? `Only ${gaps.length} variant(s) carry a compare_at_price/MRP, below the ${RUBRIC.R02_high_margin.minGapSampleSize} needed for a discount-gap read. No stated gross margin in search results either.`
        : "No compare_at_price/MRP gaps in the product feed and no stated gross margin in search results. Discount gap is a proxy, not margin, so nothing is scored.",
      gaps.length ? gaps.map(g => `${g.title}: Rs ${g.price} vs MRP Rs ${g.mrp}`).join("; ") : "",
    );
  }
  const avg = gaps.reduce((s, g) => s + g.pct, 0) / gaps.length;
  const b = band(RUBRIC.R02_high_margin.gapBands, avg, "minGapPct");
  return scored(
    b?.score ?? 0,
    "Evidence-based assessment",
    `Average MRP-to-price gap across ${gaps.length} variants is ${round(avg, 1)}% (median ${round(gaps.map(g => g.pct).sort((x, y) => x - y)[gaps.length >> 1], 1)}%). ` +
    `PROXY ONLY: a discount gap suggests room for promotional pricing, it is not a gross margin. Examples: ${gaps.slice(0, 3).map(g => `${g.title} Rs ${g.price} vs MRP Rs ${g.mrp}`).join("; ")}.`,
    gaps[0].url,
    "Discount gap is a proxy, not margin. Analyst should override with real margin data if available.",
  );
};
