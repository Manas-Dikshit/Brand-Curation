import Anthropic from "@anthropic-ai/sdk";
import { Criterion, CriterionResult, Verification } from "./criteria";

const SYSTEM = `You are a brand-research analyst for Newtail (Indian offline retail). Evaluate ONE brand against the given criteria using web search of authentic public sources (official site, official social accounts, retailer/marketplace/quick-commerce listings, company disclosures, credible media).
Rules:
- Never fabricate, estimate or infer brand-specific facts. Every non-null score needs a real source URL you actually found.
- If evidence is unavailable or unverifiable, set score=null and verification="Insufficient Data" (never use 0 for missing data; 0 only when evidence verifies the criterion is NOT met).
- Platform presence is not proof of sales. Reviews/followers/engagement are not proof of revenue or repeat rate. Do not assume willingness to invest in visibility.
- verification: "Verified" = direct documented fact; "Evidence-based assessment" = reasoned from cited evidence; "Insufficient Data".
- Scale: 0 verified not met; 1 very limited; 2 limited; 3 moderate; 4 strong; 5 strong, well-supported.
Respond with ONLY a JSON array, one object per criterion, in order: {"name","score","evidence","sourceUrl","verification","missing"}.`;

export async function researchBrand(brand: string, criteria: Criterion[]): Promise<CriterionResult[]> {
  const client = new Anthropic();
  const list = criteria.map(c => `- ${c.name}: ${c.what}${c.hint ? " (" + c.hint + ")" : ""}`).join("\n");
  const msg = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 6000, system: SYSTEM,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 12 }],
    messages: [{ role: "user", content: `Brand: ${brand}\nCriteria:\n${list}` }],
  });
  const text = msg.content.map(b => (b.type === "text" ? b.text : "")).join("");
  const m = text.replace(/```json|```/g, "").match(/\[[\s\S]*\]/);
  let raw: any[] = [];
  try { raw = m ? JSON.parse(m[0]) : []; } catch { raw = []; }
  return criteria.map(c => {
    const r = raw.find(x => x?.name === c.name) || {};
    let score: number | null = typeof r.score === "number" ? Math.max(0, Math.min(5, Math.round(r.score))) : null;
    const url = String(r.sourceUrl || "");
    let verification: Verification = ["Verified", "Evidence-based assessment", "Insufficient Data"].includes(r.verification) ? r.verification : "Insufficient Data";
    let missing = String(r.missing || "");
    if (score !== null && !/^https?:\/\//.test(url)) {
      score = null; verification = "Insufficient Data"; missing = (missing + " Score withheld: no source URL.").trim();
    }
    if (score === null) verification = "Insufficient Data";
    return { name: c.name, score, evidence: String(r.evidence || ""), sourceUrl: url, verification, missing };
  });
}
