import * as cheerio from "cheerio";
import { fetchPage, looksLikeWall } from "../util/fetch";
import { brandMatchScore } from "../util/text";
import { ev, safe, type CollectorOutput, type CollectorResult, type MarketplaceFacts, type MarketplaceProbe, type MarketplaceRank } from "./types";

const MATCH_THRESHOLD = 0.8;

const TARGETS: { platform: string; url: (q: string) => string; qc: boolean }[] = [
  { platform: "Blinkit", url: q => `https://blinkit.com/s/?q=${encodeURIComponent(q)}`, qc: true },
  { platform: "Zepto", url: q => `https://www.zepto.co/search?q=${encodeURIComponent(q)}`, qc: true },
  { platform: "Swiggy Instamart", url: q => `https://www.swiggy.com/instamart/search?query=${encodeURIComponent(q)}`, qc: true },
  { platform: "BigBasket", url: q => `https://www.bigbasket.com/search/?q=${encodeURIComponent(q)}`, qc: true },
  { platform: "Amazon.in", url: q => `https://www.amazon.in/s?k=${encodeURIComponent(q)}`, qc: false },
  { platform: "Flipkart", url: q => `https://www.flipkart.com/search?q=${encodeURIComponent(q)}`, qc: false },
  { platform: "Nykaa", url: q => `https://www.nykaa.com/search/result/?q=${encodeURIComponent(q)}`, qc: false },
];

/** Product-ish title strings in static HTML or embedded JSON. */
export function extractCandidateTitles(html: string): string[] {
  const out = new Set<string>();
  const $ = cheerio.load(html);
  $("[itemprop='name'], .product-title, [data-testid='product-name']").each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 2 && t.length < 300) out.add(t);
  });
  const title = $("title").first().text().trim();
  if (title) out.add(title.replace(/\s*[-|:]\s*(Amazon|Flipkart|Nykaa|Blinkit|Zepto|BigBasket|Swiggy).*$/i, "").trim());
  for (const m of html.matchAll(/"(?:name|title|productName|product_name)"\s*:\s*"([^"]{3,200})"/g)) out.add(m[1]);
  return [...out];
}

function extractRanks(platform: string, html: string, productTitle: string): MarketplaceRank[] {
  // only a marker sitting near the *matched* product counts: a bestseller page also
  // lists unrelated brands, and their ranks are not this brand's rank.
  const at = html.toLowerCase().indexOf(productTitle.toLowerCase().slice(0, 40));
  if (at < 0) return [];
  const ranks: MarketplaceRank[] = [];
  const re = /(?:best\s*seller|best-selling|#\s*best|no\.\s*\d+|rank\s*#?\s*\d+)[^<>"]{0,40}?(\d{1,6})|(\d{1,6})\s*#\s*(?:best\s*seller|best-selling)/gi;
  for (const m of html.slice(Math.max(0, at - 2000), at + 2000).matchAll(re)) {
    const n = Number(m[1] ?? m[2]);
    if (!n || n <= 0 || n > 100000) continue;
    ranks.push({ platform, rank: n, label: m[0].trim().slice(0, 80), productTitle, url: "" });
    if (ranks.length >= 3) break;
  }
  return ranks;
}

const NO_RESULTS = /(no\s+results|did\s+not\s+match|0\s+results|nothing\s+found|no\s+products\s+found)/i;

/**
 * Public search-page probes. Most of these are bot-protected: a wall is recorded as
 * "unverifiable-blocked" and NEVER as "absent", so absence is never inferred from a block.
 */
export async function collectMarketplaces(brand: string): Promise<CollectorResult<MarketplaceFacts>> {
  return safe<MarketplaceFacts>("marketplaces", async (): Promise<CollectorOutput<MarketplaceFacts>> => {
    const probes: MarketplaceProbe[] = [];
    const evidence: any[] = [];
    const notes: string[] = [];
    const ranks: MarketplaceRank[] = [];

    for (const t of TARGETS) {
      const url = t.url(brand);
      const r = await fetchPage(url);
      if (!r.ok || r.suspectedWall || !r.body) {
        const blocked = r.suspectedWall || r.status === 403 || r.status === 429;
        probes.push({ platform: t.platform, url, qc: t.qc, status: blocked ? "unverifiable-blocked" : "unverifiable-empty", matchedTitle: null });
        notes.push(`${t.platform}: ${blocked ? "bot-protected or login-walled" : `not readable (${r.blocked ?? r.error})`} — excluded from the denominator, NOT counted as absent.`);
        evidence.push(ev(`${t.platform} search page for "${brand}" is ${blocked ? "blocked" : "unreadable"} (${r.status || r.blocked}). Recorded as unverifiable, not as absent.`, url, r.fetchedAt));
        continue;
      }

      const titles = extractCandidateTitles(r.body);
      const hit = titles.map(t => ({ t, s: brandMatchScore(brand, t) })).sort((a, b) => b.s - a.s)[0];
      const isWall = looksLikeWall(r.body, r.status);
      const hasNoResults = NO_RESULTS.test(r.body);

      if (hit && hit.s >= MATCH_THRESHOLD && !isWall) {
        probes.push({ platform: t.platform, url: r.finalUrl, qc: t.qc, status: "present", matchedTitle: hit.t });
        evidence.push(ev(`${t.platform}: listing found. Product title fuzzy-matched "${hit.t}" to brand "${brand}" (score ${hit.s.toFixed(2)}).`, r.finalUrl, r.fetchedAt));
        for (const rk of extractRanks(t.platform, r.body, hit.t)) ranks.push({ ...rk, url: r.finalUrl });
      } else if (hasNoResults || titles.length > 3) {
        probes.push({ platform: t.platform, url: r.finalUrl, qc: t.qc, status: "absent", matchedTitle: null });
        evidence.push(ev(`${t.platform}: no listing for "${brand}" in the public search results (page loaded, ${hasNoResults ? "explicit no-results state" : `${titles.length} unrelated product titles`}).`, r.finalUrl, r.fetchedAt));
      } else {
        probes.push({ platform: t.platform, url: r.finalUrl, qc: t.qc, status: "unverifiable-blocked", matchedTitle: null });
        notes.push(`${t.platform}: page loaded but looks like a JS shell — presence unknown, not counted as absent.`);
      }
    }

    return {
      status: "ok",
      facts: {
        probes,
        present: probes.filter(p => p.status === "present").map(p => p.platform),
        blocked: probes.filter(p => p.status.startsWith("unverifiable")).map(p => p.platform),
        absent: probes.filter(p => p.status === "absent").map(p => p.platform),
        ranks,
      },
      evidence, notes,
    };
  });
}
