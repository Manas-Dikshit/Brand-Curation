import { insufficient, RUBRIC, scored, type Rule } from "./context";

/** R09: objective imaging signals only. Packaging distinctiveness is not machine-judgeable. */
export const packaging: Rule = ({ facts }) => {
  const cfg = RUBRIC.R09_packaging;
  const products = facts.shopify.products;
  if (products.length < cfg.minProducts) {
    return insufficient(
      `Only ${products.length} product(s) available in the feed (need ${cfg.minProducts}) to judge imaging. Packaging quality itself is a human judgement.`,
    );
  }
  const withImages = products.filter(p => p.images > 0);
  const avg = withImages.length ? withImages.reduce((s, p) => s + p.images, 0) / withImages.length : 0;
  const packshots = withImages.filter(p => p.images >= 1).length;
  const b = cfg.bands.find(x => avg >= x.minImagesPerProduct && (!x.requirePackshot || packshots > 0));
  const score = Math.min(cfg.cap, b?.score ?? 0);
  if (!score) return insufficient("No product imagery in the feed, so there are no objective packaging signals.");
  return scored(
    score,
    "Evidence-based assessment",
    `Objective imaging signals across ${products.length} products: ${round2(avg)} images per product on average, ${packshots}/${products.length} have at least one image (packshot). ` +
    `This is a capped proxy (max ${cfg.cap}): image volume is not proof of distinctive packaging design.`,
    products[0].url,
    `Analyst must judge pack design, shelf impact and distinctiveness to score above ${cfg.cap}. Image dimensions/consistency are not available keylessly.`,
  );
};

const round2 = (n: number) => Math.round(n * 100) / 100;
