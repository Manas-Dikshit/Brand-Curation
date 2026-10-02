import { emptyFacts, type BrandFacts, type MarketplaceProbe, type ShopifyProduct } from "@/lib/collectors/types";
import type { Criterion } from "@/lib/criteria";
import type { BrandInput } from "@/lib/types";
import type { RuleContext, RuleOutput } from "@/lib/rules/context";

export function brand(website: string | null = "https://brand.example", extra: Partial<BrandFacts> = {}): BrandFacts {
  const f = emptyFacts({ brand: "Brand" });
  if (website) {
    f.site = { status: "resolved", url: website, origin: new URL(website).origin, siteName: "Brand", matchScore: 0.95, source: "analyst", candidatesTried: [], reason: null };
  }
  return { ...f, ...extra };
}

export function product(over: Partial<ShopifyProduct> = {}): ShopifyProduct {
  return {
    title: "Product", productType: "", tags: [], images: 1,
    prices: [{ price: 299, compareAt: null, available: true }],
    url: "https://brand.example/products/p", ...over,
  };
}

export function shopify(products: ShopifyProduct[]): Partial<BrandFacts> {
  return { shopify: { available: products.length > 0, products, pagesFetched: 1, reason: null } };
}

export function probe(p: Partial<MarketplaceProbe>): MarketplaceProbe {
  return { platform: "X", url: "https://x.example", qc: false, status: "absent", matchedTitle: null, ...p };
}

/** Runs one rule against a fixture. Criteria list is only used for the criterion's own id. */
export function run(
  rule: (c: RuleContext) => RuleOutput,
  facts: BrandFacts,
  criterion: Criterion,
  press: RuleContext["press"] = { statements: [] },
): RuleOutput {
  return rule({ brand: { brand: facts.brand.brand }, facts, press, criteria: [criterion] });
}
