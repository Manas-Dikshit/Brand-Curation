import rubric from "../../config/rubric.json";
import { category } from "./category";
import { digitalPmf } from "./digitalPmf";
import { insufficient, scored, type Rule, type RuleContext, type RuleOutput } from "./context";
import { margin } from "./margin";
import { marketing } from "./marketing";
import { packaging } from "./packaging";
import { priceFit } from "./priceFit";
import { quickCommerce } from "./quickCommerce";
import { repeat } from "./repeat";
import { retailerFit } from "./retailerFit";
import { revenue } from "./revenue";
import { reviews } from "./reviews";
import { sellThrough } from "./sellThrough";
import { social } from "./social";
import { visibility } from "./visibility";
import { whitespace } from "./whitespace";

export const RULES: Record<string, Rule> = {
  price: priceFit,
  margin,
  repeat,
  revenue,
  pmf: digitalPmf,
  category,
  marketing,
  qcommerce: quickCommerce,
  packaging,
  reviews,
  visibility,
  whitespace,
  retailer: retailerFit,
  social,
  sellthrough: sellThrough,
};

/**
 * Runs every rule. A rule that throws is downgraded to Insufficient Data rather than
 * failing the brand, and a rule that emits a foreign ruleId has it corrected.
 */
export function applyRules(ctx: RuleContext): Map<string, RuleOutput & { ruleId: string | null; attempted: boolean }> {
  const out = new Map<string, RuleOutput & { ruleId: string | null; attempted: boolean }>();
  for (const c of ctx.criteria) {
    const rule = RULES[c.key];
    let res: RuleOutput;
    let attempted = true;
    if (!rule) {
      res = insufficient(`No rule registered for criterion key "${c.key}".`);
      attempted = false;
    } else {
      try {
        res = rule(ctx);
      } catch (e) {
        res = insufficient(`Rule failed: ${(e as Error).message}`);
      }
    }
    out.set(c.name, { ...res, ruleId: res.score === null ? null : c.ruleId ?? null, attempted });
  }
  return out;
}

export function rubricVersion() {
  return rubric.version;
}

export { scored, insufficient };
