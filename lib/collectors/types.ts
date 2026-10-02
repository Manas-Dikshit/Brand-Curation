import type { BrandInput } from "../types";

export type Evidence = { text: string; url: string; fetchedAt: string };

export type CollectorResult<T> = {
  name: string;
  status: "ok" | "partial" | "failed" | "skipped";
  facts: T;
  evidence: Evidence[];
  notes: string[];
};

/** What a collector returns; `safe()` fills in `name`. */
export type CollectorOutput<T> = Omit<CollectorResult<T>, "name">;

/** Collectors never throw: any failure becomes a status + note. */
export async function safe<T>(
  name: string,
  fn: () => Promise<CollectorOutput<T>>,
): Promise<CollectorResult<T>> {
  try {
    const r = await fn();
    return { ...r, name };
  } catch (e) {
    return {
      name,
      status: "failed",
      facts: {} as T,
      evidence: [],
      notes: [`Collector crashed: ${(e as Error).message}`],
    };
  }
}

export function ev(text: string, url: string, fetchedAt?: string): Evidence {
  return { text: text.slice(0, 2000), url, fetchedAt: fetchedAt ?? new Date().toISOString() };
}

export type SiteFacts = {
  status: "resolved" | "unresolved";
  url: string | null;
  origin: string | null;
  siteName: string | null;
  matchScore: number | null;
  source: "analyst" | "guess" | null;
  candidatesTried: string[];
  reason: string | null;
};

export type ShopifyProduct = {
  title: string;
  productType: string;
  tags: string[];
  images: number;
  prices: { price: number; compareAt: number | null; available: boolean }[];
  url: string;
};

export type ShopifyFacts = {
  available: boolean;
  products: ShopifyProduct[];
  pagesFetched: number;
  reason: string | null;
};

export type JsonLdFacts = {
  organization: { name: string | null; sameAs: string[]; url: string | null } | null;
  products: {
    url: string;
    name: string | null;
    price: number | null;
    currency: string | null;
    availability: string | null;
    rating: { value: number; count: number } | null;
    images: number;
  }[];
  rating: { value: number; count: number } | null;
  pagesParsed: number;
  reason: string | null;
};

export type SocialHandle = {
  platform: "instagram" | "facebook" | "youtube" | "x";
  url: string;
  handle: string | null;
  foundVia: string;
};

export type SocialFacts = {
  links: SocialHandle[];
  profiles: {
    platform: SocialHandle["platform"];
    url: string;
    followers: number | null;
    posts: number | null;
    likes: number | null;
    status: "parsed" | "login-walled" | "blocked" | "unreachable";
  }[];
};

export type MarketingSignal = string;

export type MarketingFacts = { signals: MarketingSignal[]; pages: string[] };

export type RetailStore = { name: string | null; city: string | null };

export type RetailFacts = {
  pagesFound: string[];
  stores: RetailStore[];
  retailerMatches: { retailer: string; url: string; matchedOn: string }[];
  storeCountDeclared: number | null;
};

export type MarketplaceProbe = {
  platform: string;
  url: string;
  /** true for quick-commerce; false for marketplaces. R08 counts only qc=true. */
  qc: boolean;
  status: "present" | "absent" | "unverifiable-blocked" | "unverifiable-empty";
  matchedTitle: string | null;
};

export type MarketplaceRank = { platform: string; rank: number; label: string; productTitle: string | null; url: string };

export type MarketplaceFacts = {
  probes: MarketplaceProbe[];
  present: string[];
  blocked: string[];
  absent: string[];
  /** "Best seller #N" style badges with a number — the only auto-sell-through evidence. */
  ranks: MarketplaceRank[];
};

export type WikiFacts = {
  found: boolean;
  title: string | null;
  description: string | null;
  url: string | null;
  founded: string | null;
  revenue: { value: number; year: number | null; statement: string; currency: string } | null;
};

export type SearchHit = { title: string; url: string; source: string | null; date: string | null; snippet: string | null };

export type SearchFacts = { web: SearchHit[]; news: SearchHit[] };

export type BrandFacts = {
  brand: BrandInput;
  site: SiteFacts;
  shopify: ShopifyFacts;
  jsonld: JsonLdFacts;
  social: SocialFacts;
  marketing: MarketingFacts;
  retail: RetailFacts;
  marketplaces: MarketplaceFacts;
  wiki: WikiFacts;
  search: SearchFacts;
  /** human-readable trace used by the UI + Excel Missing Information column */
  notes: string[];
};

export const emptyFacts = (brand: BrandInput): BrandFacts => ({
  brand,
  site: { status: "unresolved", url: null, origin: null, siteName: null, matchScore: null, source: null, candidatesTried: [], reason: null },
  shopify: { available: false, products: [], pagesFetched: 0, reason: "Not attempted" },
  jsonld: { organization: null, products: [], rating: null, pagesParsed: 0, reason: "Not attempted" },
  social: { links: [], profiles: [] },
  marketing: { signals: [], pages: [] },
  retail: { pagesFound: [], stores: [], retailerMatches: [], storeCountDeclared: null },
  marketplaces: { probes: [], present: [], blocked: [], absent: [], ranks: [] },
  wiki: { found: false, title: null, description: null, url: null, founded: null, revenue: null },
  search: { web: [], news: [] },
  notes: [],
});
