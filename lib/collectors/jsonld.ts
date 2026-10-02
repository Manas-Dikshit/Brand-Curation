import * as cheerio from "cheerio";
import { fetchPage } from "../util/fetch";
import { parseCompact, parsePrice } from "../util/text";
import { ev, safe, type CollectorOutput, type CollectorResult, type JsonLdFacts } from "./types";

const MAX_PRODUCT_PAGES = 5;

function flatten(node: any): any[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (typeof node !== "object") return [];
  const out: any[] = [];
  if (node["@graph"]) out.push(...flatten(node["@graph"]));
  if (node["@type"]) out.push(node);
  if (node.mainEntity || node.itemListElement) out.push(...flatten(node.mainEntity), ...flatten(node.itemListElement));
  return out;
}

export function parseJsonLd(html: string): { nodes: any[]; errors: number } {
  const $ = cheerio.load(html);
  const nodes: any[] = [];
  let errors = 0;
  $("script[type='application/ld+json']").each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try { nodes.push(...flatten(JSON.parse(raw))); } catch { errors++; }
  });
  return { nodes, errors };
}

function firstOffer(p: any) {
  const offers = Array.isArray(p.offers) ? p.offers : p.offers ? [p.offers] : [];
  const agg = offers.find((o: any) => o.priceSpecification) ?? offers[0];
  const spec = agg?.priceSpecification;
  const price = parsePrice(agg?.price ?? agg?.lowPrice ?? spec?.price ?? spec?.minPrice ?? null);
  const currency = agg?.priceCurrency ?? spec?.priceCurrency ?? null;
  const availability = typeof agg?.availability === "string" ? agg.availability.split("/").pop() ?? null : null;
  return { price, currency, availability };
}

function readRating(p: any) {
  const a = Array.isArray(p.aggregateRating) ? p.aggregateRating[0] : p.aggregateRating;
  const value = a?.ratingValue ?? a?.averageRating;
  const count = parseCompact(a?.ratingCount ?? a?.reviewCount);
  if (typeof value !== "number" && typeof value !== "string") return null;
  const v = Number(value);
  if (!isFinite(v)) return null;
  return { value: v, count: typeof count === "number" ? count : 0 };
}

async function sitemapProductUrls(origin: string): Promise<{ urls: string[]; evidence: any[]; notes: string[] }> {
  const urls: string[] = [];
  const evidence: any[] = [];
  const notes: string[] = [];
  let queue = [`${origin}/sitemap.xml`];
  const seen = new Set<string>();

  while (queue.length && urls.length < MAX_PRODUCT_PAGES) {
    const smUrl = queue.shift()!;
    if (seen.has(smUrl)) continue;
    seen.add(smUrl);
    const r = await fetchPage(smUrl);
    if (!r.ok) { notes.push(`sitemap ${smUrl}: ${r.blocked ?? r.error}`); continue; }
    const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]);
    evidence.push(ev(`sitemap ${smUrl}: ${locs.length} URLs`, smUrl, r.fetchedAt));
    const productLocs = locs.filter(u => /\/products?\//i.test(u));
    for (const u of productLocs) {
      if (urls.length >= MAX_PRODUCT_PAGES) break;
      urls.push(u);
    }
    if (!productLocs.length) {
      const nested = locs.filter(u => /sitemap/i.test(u)).slice(0, 2);
      queue.push(...nested);
    }
  }
  return { urls, evidence, notes };
}

export async function collectJsonLd(origin: string | null): Promise<CollectorResult<JsonLdFacts>> {
  return safe<JsonLdFacts>("jsonld", async (): Promise<CollectorOutput<JsonLdFacts>> => {
    if (!origin) {
      return { status: "skipped", facts: { organization: null, products: [], rating: null, pagesParsed: 0, reason: "Site unresolved" },
        evidence: [], notes: ["JSON-LD skipped: official site unresolved."] };
    }
    const evidence: any[] = [];
    const notes: string[] = [];

    const home = await fetchPage(origin);
    let organization: JsonLdFacts["organization"] = null;
    let rating: JsonLdFacts["rating"] = null;
    let pages = 0;

    if (home.ok && home.body) {
      const { nodes, errors } = parseJsonLd(home.body);
      pages++;
      if (errors) notes.push(`${errors} malformed ld+json block(s) on the homepage were skipped.`);
      for (const n of nodes) {
        const t = String(n["@type"]);
        if ((t === "Organization" || t === "Corporation" || t === "LocalBusiness" || t === "Brand") && !organization) {
          organization = {
            name: typeof n.name === "string" ? n.name : null,
            sameAs: Array.isArray(n.sameAs) ? n.sameAs.map(String) : typeof n.sameAs === "string" ? [n.sameAs] : [],
            url: typeof n.url === "string" ? n.url : null,
          };
        }
        if (!rating && n.aggregateRating) rating = readRating(n);
      }
      if (organization || rating) {
        evidence.push(ev(`Homepage JSON-LD: Organization=${organization?.name ?? "n/a"}, AggregateRating=${rating ? `${rating.value} from ${rating.count} reviews` : "n/a"}`, home.finalUrl, home.fetchedAt));
      }
    } else {
      notes.push(`Homepage not fetchable: ${home.blocked ?? home.error}.`);
    }

    const { urls, evidence: smEvidence, notes: smNotes } = await sitemapProductUrls(origin);
    evidence.push(...smEvidence);
    notes.push(...smNotes);

    const products: JsonLdFacts["products"] = [];
    for (const url of urls) {
      const r = await fetchPage(url);
      if (!r.ok) continue;
      const { nodes } = parseJsonLd(r.body);
      pages++;
      for (const n of nodes) {
        if (!/Product/i.test(String(n["@type"]))) continue;
        const o = firstOffer(n);
        const rt = readRating(n);
        if (rt && !rating) rating = rt;
        products.push({
          url: r.finalUrl,
          name: typeof n.name === "string" ? n.name : null,
          price: o.price,
          currency: o.currency,
          availability: o.availability,
          rating: rt,
          images: Array.isArray(n.image) ? n.image.length : n.image ? 1 : 0,
        });
      }
      if (products.length) {
        const latest = products[products.length - 1];
        evidence.push(ev(
          `Product JSON-LD on ${r.finalUrl}: ${latest.name ?? "unnamed"}${latest.price ? ` at ${latest.price}` : " (no price)"}${latest.rating ? `, rated ${latest.rating.value}/5 from ${latest.rating.count}` : ""}`,
          r.finalUrl, r.fetchedAt,
        ));
      }
    }

    return {
      status: products.length || organization ? "ok" : "partial",
      facts: { organization, products, rating, pagesParsed: pages, reason: products.length ? null : "No Product JSON-LD found via sitemap" },
      evidence,
      notes,
    };
  });
}
