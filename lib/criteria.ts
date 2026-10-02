// Structure only (ids, pillars, rubric hints). WEIGHTS are never stored here: they are read from the reference workbook.
export type Pillar = "Product & Market Fit" | "Revenue & Financial Performance" | "Brand Presence & Marketing" | "Distribution Channels";
export const META: Record<string, { id: string; pillar: Pillar; hint?: string }> = {
  "Product price fit": { id: "price", pillar: "Product & Market Fit", hint: "Typical price within ₹150–₹800" },
  "Digital PMF": { id: "pmf", pillar: "Product & Market Fit" },
  "In-demand category": { id: "category", pillar: "Product & Market Fit" },
  "Retailer demand fit": { id: "retailer", pillar: "Product & Market Fit" },
  "High-margin products": { id: "margin", pillar: "Revenue & Financial Performance" },
  "Repeat customers": { id: "repeat", pillar: "Revenue & Financial Performance" },
  "Revenue-generating brand": { id: "revenue", pillar: "Revenue & Financial Performance" },
  "Proven sell-through": { id: "sellthrough", pillar: "Revenue & Financial Performance" },
  "Active marketing": { id: "marketing", pillar: "Brand Presence & Marketing" },
  "Social media presence": { id: "social", pillar: "Brand Presence & Marketing" },
  "Distinctive packaging": { id: "packaging", pillar: "Brand Presence & Marketing" },
  "Customer reviews": { id: "reviews", pillar: "Brand Presence & Marketing" },
  "Willingness to pay for visibility": { id: "visibility", pillar: "Brand Presence & Marketing" },
  "Quick-commerce presence": { id: "qcommerce", pillar: "Distribution Channels" },
  "Offline distribution whitespace": { id: "whitespace", pillar: "Distribution Channels", hint: "Higher = LESS existing offline presence (whitespace for Newtail)" },
};
export type Criterion = { name: string; what: string; weight: number; id: string; pillar: Pillar; hint?: string };
export type Verification = "Verified" | "Evidence-based assessment" | "Insufficient Data";
export type CriterionResult = { name: string; score: number | null; evidence: string; sourceUrl: string; verification: Verification; missing: string };
