import rubric from "../config/rubric.json";
import type { Pillar } from "./types";

/**
 * Structure only (pillar + rule key). WEIGHTS are never stored here: they are read
 * from reference/Newtail_Brand_Curation_Matrix.xlsx at runtime.
 * Names must match the reference sheet exactly.
 */
export const META: Record<string, { key: keyof typeof rubric.ruleIds; pillar: Pillar; hint?: string }> = {
  "Product price fit": { key: "price", pillar: "Product & Market Fit", hint: "Typical price within the rubric's target range" },
  "High-margin products": { key: "margin", pillar: "Revenue & Financial Performance", hint: "MRP/discount gap is a proxy, not margin" },
  "Repeat customers": { key: "repeat", pillar: "Revenue & Financial Performance", hint: "Subscription, auto-replenish or loyalty evidence" },
  "Revenue-generating brand": { key: "revenue", pillar: "Revenue & Financial Performance", hint: "Only a cited revenue/funding figure counts" },
  "Digital PMF": { key: "pmf", pillar: "Product & Market Fit", hint: "Product feed + review volume + marketplace listings" },
  "In-demand category": { key: "category", pillar: "Product & Market Fit", hint: "Mapped to a curated demand-ranked category" },
  "Active marketing": { key: "marketing", pillar: "Brand Presence & Marketing", hint: "On-site marketing activity signals" },
  "Social media presence": { key: "social", pillar: "Brand Presence & Marketing", hint: "Followers/post count from public markup only" },
  "Distinctive packaging": { key: "packaging", pillar: "Brand Presence & Marketing", hint: "Objective imaging signals only; analyst judgement needed" },
  "Customer reviews": { key: "reviews", pillar: "Brand Presence & Marketing", hint: "AggregateRating value and count" },
  "Willingness to pay for visibility": { key: "visibility", pillar: "Brand Presence & Marketing", hint: "Needs documented trade/retail-media evidence" },
  "Quick-commerce presence": { key: "qcommerce", pillar: "Distribution Channels", hint: "Blocked platforms are excluded, not counted as absent" },
  "Offline distribution whitespace": { key: "whitespace", pillar: "Distribution Channels", hint: "Higher = LESS existing offline presence" },
  "Retailer demand fit": { key: "retailer", pillar: "Distribution Channels", hint: "Match against retailer category + price needs" },
  "Proven sell-through": { key: "sellthrough", pillar: "Distribution Channels", hint: "Cited bestseller rank or analyst feedback only" },
};

export const CRITERION_NAMES = Object.keys(META);
export const PILLARS: Pillar[] = [
  "Product & Market Fit",
  "Revenue & Financial Performance",
  "Brand Presence & Marketing",
  "Distribution Channels",
];

export type Criterion = {
  name: string;
  what: string;
  weight: number;
  key: keyof typeof rubric.ruleIds;
  ruleId: string;
  pillar: Pillar;
  hint?: string;
};

export type RefReport = {
  sheet: string;
  criteria: Criterion[];
  totalWeight: number;
  issues: string[];
  ok: boolean;
  /** Non-blocking notes surfaced in the UI and Excel. */
  notes: string[];
};
