import type { BrandInput } from "../types";
import { fetchPage } from "../util/fetch";
import { parseMoneyPhrase, yearOf } from "../util/text";
import { collectJsonLd } from "./jsonld";
import { collectMarketing } from "./marketing";
import { collectMarketplaces } from "./marketplaces";
import { collectRetail } from "./retail";
import { isCredible, collectSearch, readCredible } from "./search";
import { collectShopify } from "./shopify";
import { resolveSite } from "./site";
import { collectSocial } from "./social";
import { collectWiki } from "./wiki";
import { emptyFacts, type BrandFacts, type CollectorResult } from "./types";

export type ProgressFn = (step: string, detail?: string) => void;

/** Press-derived money statements, kept out of the serialised shape for cache stability. */
export type PressFacts = { statements: { text: string; url: string; year: number | null; value: number; currency: string }[] };

export type CollectResult = { facts: BrandFacts; press: PressFacts };

/**
 * Runs every collector for one brand. Site-derived collectors are skipped when the
 * official site is unresolved, but news/wiki/marketplace discovery still runs.
 * Collectors never throw; failures land in `notes` and become Insufficient Data.
 */
export async function collectAll(input: BrandInput, onProgress?: ProgressFn): Promise<CollectResult> {
  const facts = emptyFacts(input);
  const press: PressFacts = { statements: [] };
  const p = onProgress ?? (() => {});

  p("site", "resolving official site");
  const site = await resolveSite(input);
  facts.site = site.facts;
  if (site.notes.length) facts.notes.push(...site.notes);
  p("site", site.facts.status);

  const origin = site.facts.origin;
  let homepageHtml: string | null = null;
  if (site.facts.url) {
    p("site", "reading homepage");
    const home = await fetchPage(site.facts.url);
    if (home.ok && home.body && !home.suspectedWall) homepageHtml = home.body;
    else facts.notes.push(`Homepage unreadable (${home.blocked ?? home.error}); social/marketing/retail signals may be under-reported.`);
  } else {
    facts.notes.push(
      "Official site UNRESOLVED — skipping Shopify, JSON-LD, social, marketing and retail collectors. " +
      "Analyst should supply the website column. News, wiki and marketplace discovery still ran.",
    );
    facts.shopify.reason = "Site unresolved";
    facts.jsonld.reason = "Site unresolved";
  }

  // wave 1: independent of the site
  await Promise.all([
    (async () => {
      const r = await collectShopify(origin);
      facts.shopify = r.facts;
      facts.notes.push(...r.notes);
      p("shopify", r.facts.available ? `${r.facts.products.length} products` : r.status);
    })(),
    (async () => {
      const r = await collectMarketplaces(input.brand);
      facts.marketplaces = r.facts;
      facts.notes.push(...r.notes);
      p("marketplaces", `${r.facts.present.length} present / ${r.facts.blocked.length} blocked`);
    })(),
    (async () => {
      const r = await collectWiki(input.brand);
      facts.wiki = r.facts;
      facts.notes.push(...r.notes);
      p("wiki", r.facts.found ? "article found" : "none");
    })(),
    (async () => {
      const r = await collectSearch(input.brand);
      facts.search = r.facts;
      facts.notes.push(...r.notes);
      p("search", `${r.facts.web.length} web / ${r.facts.news.length} news`);
    })(),
  ]);

  // wave 2a: JSON-LD runs alone because social discovery reads its sameAs links
  const jl = await collectJsonLd(origin);
  facts.jsonld = jl.facts;
  facts.notes.push(...jl.notes);
  p("jsonld", `${jl.facts.products.length} products`);

  // wave 2b: everything that only needs the homepage/origin
  const sameAs = jl.facts.organization?.sameAs ?? [];
  await Promise.all([
    (async () => {
      // social discovery still runs without a site: analyst handle + web search
      const r = await collectSocial(input, homepageHtml, sameAs);
      facts.social = r.facts;
      facts.notes.push(...r.notes);
      p("social", r.status === "skipped"
        ? "skipped"
        : `${r.facts.profiles.filter((x: { status: string }) => x.status === "parsed").length}/${r.facts.profiles.length} readable`);
    })(),
    (async () => {
      const r = await collectMarketing(origin, homepageHtml);
      facts.marketing = r.facts;
      facts.notes.push(...r.notes);
      p("marketing", r.facts.signals.length ? `${r.facts.signals.length} signals` : r.status);
    })(),
    (async () => {
      const r = await collectRetail(origin, homepageHtml);
      facts.retail = r.facts;
      facts.notes.push(...r.notes);
      p("retail", `${r.facts.stores.length} cities`);
    })(),
  ]);

  // allow-listed press read: only to capture explicitly stated money figures
  for (const hit of facts.search.web.filter(h => isCredible(h.url))) {
    if (press.statements.length >= 3) break;
    const { text, evidence } = await readCredible(hit);
    if (!text) continue;
    const sentences = text.match(/[^.]{0,160}(?:revenue|turnover|annual sales|raised|funding|valuation)[^.]{0,160}\./gi) ?? [];
    for (const s of sentences.slice(0, 3)) {
      const money = parseMoneyPhrase(s);
      if (money) press.statements.push({ text: s.trim().slice(0, 400), url: hit.url, year: yearOf(s), value: money.value, currency: money.currency });
    }
    if (evidence.length) facts.notes.push(evidence[0].text);
  }

  return { facts, press };
}

export type { BrandFacts, CollectorResult };
