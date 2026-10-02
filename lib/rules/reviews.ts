import { bestRating, band, insufficient, RUBRIC, scored, type Rule } from "./context";

/** R10: AggregateRating value AND count. A small sample caps the score. Sentiment text is out of scope. */
export const reviews: Rule = ({ facts }) => {
  const cfg = RUBRIC.R10_reviews;
  const rating = bestRating(facts);
  if (!rating || rating.count <= 0) {
    return insufficient(
      "No AggregateRating (ratingValue with ratingCount) in JSON-LD or static review markup. Absence of reviews is NOT zero satisfaction; no sentiment analysis is attempted.",
    );
  }
  const vBand = band(cfg.valueBands, rating.value, "min");
  let score = vBand?.score ?? 1;
  const capBand = cfg.countCap.find(c => rating.count >= c.minCount);
  const cap = capBand?.score ?? cfg.smallSampleCap;
  const wasCapped = score > cap;
  score = Math.min(score, cap);
  return scored(
    score,
    "Verified",
    `AggregateRating ${rating.value}/5 from ${rating.count} reviews, read from structured markup on the brand's own site.` +
    (wasCapped ? ` Rating band would be ${vBand?.score} but the sample of ${rating.count} reviews caps it at ${cap}.` : ""),
    rating.url || facts.site.url || "",
    rating.count < 20 ? `Small sample (${rating.count} reviews): low confidence, capped at ${cfg.smallSampleCap}.` : "",
  );
};
