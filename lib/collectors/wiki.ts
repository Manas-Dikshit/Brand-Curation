import { fetchPage } from "../util/fetch";
import { brandMatchScore, parseMoneyPhrase, yearOf } from "../util/text";
import { ev, safe, type CollectorOutput, type CollectorResult, type WikiFacts } from "./types";

const API = "https://en.wikipedia.org/w/api.php";
const WD = "https://www.wikidata.org/w/api.php";

/** Only an explicitly stated revenue figure, with its year, is recorded. */
const REVENUE_HINT = /(revenue|turnover|sales|annual sales|founded|funding|raised|valuation)/i;

export async function collectWiki(brand: string): Promise<CollectorResult<WikiFacts>> {
  return safe<WikiFacts>("wiki", async (): Promise<CollectorOutput<WikiFacts>> => {
    const evidence: any[] = [];
    const notes: string[] = [];
    const empty: WikiFacts = { found: false, title: null, description: null, url: null, founded: null, revenue: null };

    const searchUrl = `${API}?action=query&list=search&srsearch=${encodeURIComponent(brand + " company brand")}&srlimit=5&format=json&origin=*`;
    const sr = await fetchPage(searchUrl);
    if (!sr.ok) {
      return { status: "failed", facts: empty, evidence,
        notes: [`Wikipedia search failed: ${sr.blocked ?? sr.error}.`] };
    }
    let results: any[] = [];
    try { results = JSON.parse(sr.body)?.query?.search ?? []; } catch { /* ignore */ }

    let best: any = null;
    let bestScore = 0;
    for (const r of results) {
      const s = brandMatchScore(brand, String(r.title));
      if (s > bestScore) { bestScore = s; best = r; }
    }
    if (!best || bestScore < 0.8) {
      return { status: "partial", facts: empty, evidence,
        notes: [`No Wikipedia article matches "${brand}" (best "${best?.title ?? "none"}" scored ${bestScore.toFixed(2)} < 0.8).`] };
    }

    const title = String(best.title);
    const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
    evidence.push(ev(`Wikipedia article "${title}" matches brand "${brand}" (score ${bestScore.toFixed(2)})`, url, sr.fetchedAt));

    const sumUrl = `${API}?action=query&prop=extracts|pageprops&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}&format=json&origin=*`;
    const sum = await fetchPage(sumUrl);
    let description: string | null = null;
    let body = "";
    if (sum.ok) {
      try {
        const pages = JSON.parse(sum.body)?.query?.pages ?? {};
        for (const k of Object.keys(pages)) { description = pages[k]?.extract ?? null; break; }
      } catch { /* ignore */ }
    }
    if (description) {
      evidence.push(ev(`Wikipedia lead: "${description.slice(0, 400)}"`, url, sum.fetchedAt));
      const phrase = description.match(REVENUE_HINT);
      if (phrase) {
        const money = parseMoneyPhrase(description);
        if (money) {
          notes.push(`Revenue figure taken verbatim from Wikipedia: "${money.matched}". Treat as reported, not audited.`);
          return { status: "ok", facts: { ...empty, found: true, title, description, url,
            founded: String(description.match(/\b(founded|established|formed|started)\s*(?:in\s*)?((?:18|19|20)\d{2})/i)?.[2] ?? "") || null,
            revenue: { value: money.value, year: yearOf(description), statement: description.slice(0, 400), currency: money.currency } },
            evidence, notes };
        }
      }
    }

    // no revenue in the lead: try the full plain-text extract
    const fullUrl = `${API}?action=query&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}&format=json&origin=*`;
    const full = await fetchPage(fullUrl);
    if (full.ok) {
      try {
        const pages = JSON.parse(full.body)?.query?.pages ?? {};
        for (const k of Object.keys(pages)) { body = String(pages[k]?.extract ?? ""); break; }
      } catch { /* ignore */ }
    }
    if (body) {
      for (const m of body.matchAll(/[^.]{0,160}(revenue|turnover|annual sales)[^.]{0,160}\./gi)) {
        const money = parseMoneyPhrase(m[0]);
        if (!money) continue;
        const yr = yearOf(m[0]) ?? yearOf(body.match(/\b(19|20)\d{2}\b/)?.[0] ?? null);
        notes.push(`Revenue figure from the Wikipedia article body: "${money.matched}"${yr ? ` (year ${yr})` : " (no year stated)"}.`);
        evidence.push(ev(`Wikipedia states: "${m[0].trim().slice(0, 300)}"`, url, full.fetchedAt));
        return { status: "ok", facts: { found: true, title, description, url,
          founded: body.match(/\b(?:founded|established|formed)\s*(?:in\s*)?((?:18|19|20)\d{2})/i)?.[1] ?? null,
          revenue: { value: money.value, year: yr, statement: m[0].trim().slice(0, 400), currency: money.currency } },
          evidence, notes };
      }
    }

    notes.push(`Wikipedia article found for "${title}" but it states no revenue figure — R04 stays Insufficient Data (a Wikipedia article is not proof of sales).`);
    return { status: "partial", facts: { found: true, title, description, url,
      founded: description?.match(/\b(?:founded|established|formed)\s*(?:in\s*)?((?:18|19|20)\d{2})/i)?.[1] ?? null,
      revenue: null }, evidence, notes };
  });
}

/** Founding year from Wikidata, best-effort. */
export async function wikidataFounded(brand: string): Promise<string | null> {
  try {
    const r = await fetchPage(`${WD}?action=wbsearchentities&search=${encodeURIComponent(brand)}&language=en&format=json&limit=3&origin=*`);
    if (!r.ok) return null;
    const hits = JSON.parse(r.body)?.search ?? [];
    const hit = hits[0];
    if (!hit || !/company|brand|organization/i.test(String(hit.description ?? ""))) return null;
    const e = await fetchPage(`${WD}?action=wbgetclaims&entity=${hit.id}&property=P571&format=json&origin=*`);
    if (!e.ok) return null;
    const time = JSON.parse(e.body)?.claims?.P571?.[0]?.mainsnak?.datavalue?.value?.time;
    return typeof time === "string" ? time.slice(1, 5) : null;
  } catch {
    return null;
  }
}
