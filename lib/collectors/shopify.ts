import { fetchPage } from "../util/fetch";
import { parsePrice } from "../util/text";
import { ev, safe, type CollectorOutput, type CollectorResult, type ShopifyFacts, type ShopifyProduct } from "./types";

const PAGE = 250;
const MAX_PAGES = 4;

/** Public Shopify product feed. Best keyless source for price fit and MRP gaps. */
export async function collectShopify(origin: string | null): Promise<CollectorResult<ShopifyFacts>> {
  return safe<ShopifyFacts>("shopify", async (): Promise<CollectorOutput<ShopifyFacts>> => {
    if (!origin) {
      return { status: "skipped", facts: { available: false, products: [], pagesFetched: 0, reason: "Site unresolved" },
        evidence: [], notes: ["Shopify probe skipped: official site unresolved."] };
    }
    const products: ShopifyProduct[] = [];
    const evidence: { text: string; url: string; fetchedAt: string }[] = [];
    let pages = 0;
    let reason: string | null = null;

    for (let p = 0; p < MAX_PAGES; p++) {
      const url = `${origin}/products.json?limit=${PAGE}&page=${p + 1}`;
      const r = await fetchPage(url);
      if (!r.ok) { reason = r.error ?? r.blocked ?? "fetch failed"; break; }
      let data: any;
      try { data = JSON.parse(r.body); } catch { reason = "products.json was not JSON"; break; }
      const batch: any[] = Array.isArray(data?.products) ? data.products : [];
      if (!batch.length) { reason = pages === 0 ? "No products in /products.json" : "Pagination exhausted"; break; }
      for (const raw of batch) {
        const variants = Array.isArray(raw.variants) ? raw.variants : [];
        products.push({
          title: String(raw.title ?? ""),
          productType: String(raw.product_type ?? ""),
          tags: Array.isArray(raw.tags) ? raw.tags.map(String) : typeof raw.tags === "string" ? raw.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : [],
          images: Array.isArray(raw.images) ? raw.images.length : 0,
          prices: variants.map((v: any) => ({
            price: parsePrice(v.price) ?? 0,
            compareAt: parsePrice(v.compare_at_price),
            available: v.available !== false,
          })).filter((v: any) => v.price > 0),
          url: String(raw.handle ? `${origin}/products/${raw.handle}` : origin),
        });
      }
      pages++;
      evidence.push(ev(`products.json page ${p + 1}: ${batch.length} products`, url, r.fetchedAt));
      if (batch.length < PAGE) break;
    }

    return {
      status: products.length ? "ok" : "partial",
      facts: { available: products.length > 0, products, pagesFetched: pages, reason },
      evidence,
      notes: products.length ? [] : [`No Shopify product feed: ${reason}`],
    };
  });
}
