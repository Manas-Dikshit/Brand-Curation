import * as cheerio from "cheerio";
import retailerConfig from "../../config/retailers.json";
import { fetchPage } from "../util/fetch";
import { parseCompact } from "../util/text";
import { ev, safe, type CollectorOutput, type CollectorResult, type RetailFacts, type RetailStore } from "./types";

/** Paths probed directly, and the pattern used to recognise a locator page when reading one. */
const LOCATOR_PATHS = [
  "/where-to-buy", "/store-locator", "/stockists", "/find-us", "/retailers", "/distributors", "/availability",
];
const LOCATOR_RE = LOCATOR_PATHS.map(p => new RegExp(p.replace(/[/-]/g, "[-/]?"), "i"));

const CITY_RE =
  /(mumbai|delhi|bengaluru|bangalore|hyderabad|chennai|pune|kolkata|ahmedabad|jaipur|lucknow|chandigarh|indore|bhopal|nagpur|surat|coimbatore|kochi|guwahati|bhubaneswar|dehradun|patna|varanasi|kanpur|noida|gurugram|gurgaon|faridabad|thiruvananthapuram|mysuru|mysore|visakhapatnam|agra|amritsar|ranchi|jodhpur|raipur)/gi;

const STORE_COUNT_RE =
  /\b(\d[\d,]*\+?)\s*(?:retail|partner|outlet|store|shop|stockist|touch ?points?|doors|franchisee)s?\b/i;

/** Documented offline footprint only: store-locator / stockist listings. */
export async function collectRetail(origin: string | null, homepageHtml: string | null): Promise<CollectorResult<RetailFacts>> {
  return safe<RetailFacts>("retail", async (): Promise<CollectorOutput<RetailFacts>> => {
    if (!origin) {
      return { status: "skipped",
        facts: { pagesFound: [], stores: [], retailerMatches: [], storeCountDeclared: null },
        evidence: [], notes: ["Retail scan skipped: official site unresolved. Offline presence cannot be assessed without the brand's own listing."] };
    }
    const evidence: any[] = [];
    const notes: string[] = [];
    const pagesFound: string[] = [];
    const stores: RetailStore[] = [];
    const retailerMatches: { retailer: string; url: string; matchedOn: string }[] = [];
    let storeCountDeclared: number | null = null;

    const candidateUrls = new Set<string>();
    if (homepageHtml) {
      const $ = cheerio.load(homepageHtml);
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href") ?? "";
        if (LOCATOR_RE.some(re => re.test(href))) candidateUrls.add(new URL(href, origin).toString());
      });
    }
    for (const p of LOCATOR_PATHS) candidateUrls.add(new URL(p, origin).toString());

    const urls = [...candidateUrls].slice(0, 5);
    for (const url of urls) {
      const r = await fetchPage(url);
      if (!r.ok || !r.body || r.suspectedWall) continue;
      const $ = cheerio.load(r.body);
      const text = $("body").text().replace(/\s+/g, " ");
      if (!LOCATOR_RE.some(re => re.test(r.finalUrl)) && !/where to buy|store locator|stockist|find a store/i.test(text)) continue;

      pagesFound.push(r.finalUrl);
      evidence.push(ev(`Store/stockist locator page read: ${r.finalUrl}`, r.finalUrl, r.fetchedAt));

      const declared = text.match(STORE_COUNT_RE);
      if (declared) {
        const n = parseCompact(declared[1]);
        if (n && n > 0) {
          storeCountDeclared = Math.max(storeCountDeclared ?? 0, n);
          evidence.push(ev(`Brand declares offline footprint: "${declared[0].trim()}" on ${r.finalUrl}`, r.finalUrl, r.fetchedAt));
        }
      }

      for (const m of text.matchAll(CITY_RE)) {
        const city = m[1].replace(/\b\w/g, c => c.toUpperCase());
        if (!stores.some(s => s.city === city)) {
          const idx = Math.max(0, (m.index ?? 0) - 60);
          stores.push({ name: text.slice(idx, (m.index ?? 0) + 60).trim().slice(0, 80) || null, city });
        }
      }

      for (const rtr of retailerConfig.retailers) {
        const nameIdx = text.toLowerCase().indexOf(rtr.name.toLowerCase());
        if (nameIdx >= 0) {
          const matchedOn = text.slice(Math.max(0, nameIdx - 40), nameIdx + rtr.name.length + 40).trim();
          retailerMatches.push({ retailer: rtr.name, url: rtr.url, matchedOn });
          evidence.push(ev(`Listed retailer "${rtr.name}" named on the brand's own locator page. Presence only, not sell-through. Context: "${matchedOn}"`, r.finalUrl, r.fetchedAt));
        }
      }
    }

    if (!pagesFound.length) {
      notes.push(origin
        ? "No store-locator / where-to-buy / stockist page found on the brand's site. Treated as no documented offline presence."
        : "Site unresolved, so offline footprint is unknown.");
    }

    return {
      status: pagesFound.length ? "ok" : "partial",
      facts: { pagesFound, stores, retailerMatches, storeCountDeclared },
      evidence, notes,
    };
  });
}
