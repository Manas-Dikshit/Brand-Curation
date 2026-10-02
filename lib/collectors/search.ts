import * as cheerio from "cheerio";
import credible from "../../config/credible-domains.json";
import { fetchPage } from "../util/fetch";
import { ev, safe, type CollectorOutput, type CollectorResult, type SearchFacts, type SearchHit } from "./types";

const DDG = "https://html.duckduckgo.com/html/?q=";
const NEWS = "https://news.google.com/rss/search?q=";

const CREDIBLE = new Set(credible.domains);

export function isCredible(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return [...CREDIBLE].some(d => h === d || h.endsWith("." + d));
  } catch { return false; }
}

/**
 * Google News gives a publisher *name*, not a URL. Treat it as allow-listed only
 * when the name carries a token from the domain allow-list, so an unknown blog
 * cannot seed a score just by having a `source`.
 */
export function isCredibleSource(source: string | null | undefined): boolean {
  if (!source) return false;
  const s = source.toLowerCase();
  const tokens = (d: string) => d.replace(/^www\./, "").split(".").filter(t => t.length > 3 && !t.startsWith("www"));
  return [...CREDIBLE].some(d => tokens(d).some(t => s.includes(t)));
}

function unwrap(href: string): string {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const t = u.searchParams.get("uddg");
    return t ? decodeURIComponent(t) : u.toString();
  } catch { return href; }
}

/** DuckDuckGo HTML endpoint: titles + URLs only. No summarisation, no LLM. */
export async function duckduckgo(query: string, limit = 8): Promise<{ hits: SearchHit[]; evidence: any[] }> {
  const r = await fetchPage(DDG + encodeURIComponent(query));
  const evidence: any[] = [];
  if (!r.ok || !r.body) return { hits: [], evidence };
  const $ = cheerio.load(r.body);
  const hits: SearchHit[] = [];
  $(".result, .web-result").each((_, el) => {
    if (hits.length >= limit) return;
    const a = $(el).find("a.result__a").first();
    const href = a.attr("href");
    if (!href) return;
    const url = unwrap(href);
    const title = a.text().trim();
    if (!title || !/^https?:/i.test(url)) return;
    const snippet = $(el).find(".result__snippet").first().text().trim().slice(0, 300) || null;
    let host: string | null = null;
    try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep null */ }
    hits.push({ title, url, source: host, date: null, snippet });
  });
  evidence.push(ev(`DuckDuckGo results for "${query}": ${hits.length} titles (no summarisation)`, r.finalUrl, r.fetchedAt));
  return { hits, evidence };
}

/** Google News RSS for recency + source. */
export async function googleNews(query: string, limit = 10): Promise<{ hits: SearchHit[]; evidence: any[] }> {
  const url = `${NEWS}${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const r = await fetchPage(url);
  const evidence: any[] = [];
  if (!r.ok || !r.body) return { hits: [], evidence };
  const hits: SearchHit[] = [];
  for (const m of r.body.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    if (hits.length >= limit) break;
    const b = m[1];
    const get = (tag: string) => b.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"))?.[1]?.trim() ?? null;
    const title = get("title");
    const link = get("link");
    const pubDate = get("pubDate");
    const source = get("source");
    if (!title || !link) continue;
    hits.push({ title, url: link, source, date: pubDate, snippet: null });
  }
  evidence.push(ev(`Google News RSS for "${query}": ${hits.length} items`, url, r.fetchedAt));
  return { hits, evidence };
}

/** Full-text read of allow-listed domains only, used to find cited money figures. */
export async function readCredible(hit: SearchHit, budget = 2): Promise<{ text: string; evidence: any[] }> {
  const evidence: any[] = [];
  if (!isCredible(hit.url)) return { text: "", evidence };
  const r = await fetchPage(hit.url);
  if (!r.ok || !r.body) return { text: "", evidence };
  const $ = cheerio.load(r.body);
  $("script, style, nav, footer, header, noscript").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 20000);
  evidence.push(ev(`Read allow-listed source "${hit.title}" (${hit.source ?? new URL(hit.url).hostname})`, r.finalUrl, r.fetchedAt));
  void budget;
  return { text, evidence };
}

export async function collectSearch(brand: string): Promise<CollectorResult<SearchFacts>> {
  return safe<SearchFacts>("search", async (): Promise<CollectorOutput<SearchFacts>> => {
    const evidence: any[] = [];
    const notes: string[] = [];
    const [web, news] = await Promise.all([
      duckduckgo(`"${brand}" revenue OR funding OR "annual sales"`),
      googleNews(`"${brand}"`),
    ]);
    evidence.push(...web.evidence, ...news.evidence);
    if (!web.hits.length) notes.push("DuckDuckGo returned no parseable results for the revenue/funding query.");
    if (!news.hits.length) notes.push("Google News RSS returned no items for this brand.");
    return { status: web.hits.length || news.hits.length ? "ok" : "partial",
      facts: { web: web.hits, news: news.hits }, evidence, notes };
  });
}
