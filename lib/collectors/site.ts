import * as cheerio from "cheerio";
import { fetchPage } from "../util/fetch";
import { brandMatchScore, parseSocialMeta } from "../util/text";
import { ev, safe, type CollectorOutput, type CollectorResult, type SiteFacts } from "./types";
import type { BrandInput } from "../types";

const MATCH_THRESHOLD = 0.8;
const TLDS = ["com", "in", "co.in", "co", "shop", "net", "io", "store"];
// Priority order of probe batches: hits found in an earlier batch win.
const PROBE_BATCH = 6;
const PROBE_CAP = 40;
/** Guessed domains: one quick attempt. A parked domain that never answers must not
 *  cost three timeouts, which made a no-website brand take ~160s to resolve. */
const PROBE_FETCH = { retries: 0, timeoutMs: 4000 } as const;

function slugify(s: string) {
  return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}

/** Identity of a candidate page: title, og:site_name, JSON-LD Organization name. */
export function identityOf(html: string): { name: string | null; scoreAgainst: string } {
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim() || null;
  const ogSite = $("meta[property='og:site_name']").attr("content")?.trim() || null;
  const ogTitle = $("meta[property='og:title']").attr("content")?.trim() || null;
  let jsonLdName: string | null = null;
  $("script[type='application/ld+json']").each((_, el) => {
    if (jsonLdName) return;
    try {
      const parsed = JSON.parse($(el).contents().text() || "null");
      const nodes = Array.isArray(parsed) ? parsed : parsed?.["@graph"] ? parsed["@graph"] : [parsed];
      for (const n of nodes) {
        const t = n?.["@type"];
        if (t === "Organization" || t === "Corporation" || t === "LocalBusiness") {
          jsonLdName = typeof n.name === "string" ? n.name : null;
          break;
        }
      }
    } catch { /* malformed ld+json is common */ }
  });
  return { name: ogSite || jsonLdName || ogTitle || title, scoreAgainst: ogSite || jsonLdName || title || ogTitle || "" };
}

export async function resolveSite(input: BrandInput): Promise<CollectorResult<SiteFacts>> {
  return safe<SiteFacts>("site", async (): Promise<CollectorOutput<SiteFacts>> => {
    const evidence: { text: string; url: string; fetchedAt: string }[] = [];
    const notes: string[] = [];
    const tried: string[] = [];

    const check = async (url: string): Promise<{ ok: boolean; score: number; name: string | null } | null> => {
      const r = await fetchPage(url);
      tried.push(url);
      if (!r.ok || !r.body) {
        notes.push(`${url}: ${r.blocked ?? "error"} ${r.error ?? ""}`.trim());
        return null;
      }
      if (r.suspectedWall) {
        notes.push(`${url}: looks like a bot wall, not usable for identity`);
        return null;
      }
      const { name, scoreAgainst } = identityOf(r.body);
      const score = brandMatchScore(input.brand, scoreAgainst);
      if (name) evidence.push(ev(`Site identity "${name}" (title/og:site_name/JSON-LD) on ${r.finalUrl}`, r.finalUrl, r.fetchedAt));
      return { ok: score >= MATCH_THRESHOLD, score, name };
    };

    // (a) analyst-supplied URL wins if it validates
    if (input.website) {
      const withScheme = /^https?:\/\//i.test(input.website) ? input.website : "https://" + input.website;
      const res = await check(withScheme);
      if (res?.ok) {
        return {
          status: "ok",
          facts: {
            status: "resolved", url: withScheme, origin: new URL(withScheme).origin,
            siteName: res.name, matchScore: res.score, source: "analyst", candidatesTried: tried, reason: null,
          },
          evidence, notes,
        };
      }
      notes.push(`Analyst-supplied website ${withScheme} did not validate for "${input.brand}"${res ? ` (best match ${res.score.toFixed(2)} < ${MATCH_THRESHOLD})` : ""}; falling back to guessing.`);
    }

    // (b) guess candidates from the brand name, probing a few at a time
    const base = slugify(input.brand);
    const firstWord = input.brand.trim().split(/\s+/)[0];
    const hyphenated = input.brand.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const bases = [...new Set([base, slugify(firstWord), hyphenated])].filter(Boolean);
    const candidates: string[] = [];
    const STOP = /^(the|my|get|shop|try|buy|is|a|an|best)$/;
    for (const b of bases) {
      if (!b || STOP.test(b)) continue;
      for (const t of TLDS) {
        candidates.push(`https://www.${b}.${t}`);
        candidates.push(`https://${b}.${t}`);
      }
      candidates.push(`https://get${b}.com`, `https://shop${b}.com`, `https://try${b}.com`);
    }

    const toProbe = candidates.slice(0, PROBE_CAP);
    for (let i = 0; i < toProbe.length; i += PROBE_BATCH) {
      const batch = toProbe.slice(i, i + PROBE_BATCH);
      const results = await Promise.all(batch.map(url => check(url)));
      const win = results.findIndex(r => r?.ok);
      if (win >= 0) {
        const url = batch[win];
        const res = results[win]!;
        return {
          status: "ok",
          facts: {
            status: "resolved", url, origin: new URL(url).origin,
            siteName: res.name, matchScore: res.score, source: "guess", candidatesTried: tried, reason: null,
          },
          evidence, notes,
        };
      }
    }

    return {
      status: "failed",
      facts: {
        status: "unresolved", url: null, origin: null, siteName: null, matchScore: null,
        source: null, candidatesTried: tried,
        reason: `No candidate domain passed the ${MATCH_THRESHOLD} brand-identity threshold across ${tried.length} probes. Site-derived criteria will be Insufficient Data; analyst should supply the website.`,
      },
      evidence, notes,
    };
  });
}
