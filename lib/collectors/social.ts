import * as cheerio from "cheerio";
import { fetchPage } from "../util/fetch";
import { parseSocialMeta } from "../util/text";
import { duckduckgo } from "./search";
import { ev, safe, type CollectorOutput, type CollectorResult, type SocialFacts, type SocialHandle } from "./types";
import type { BrandInput } from "../types";

const PLATFORMS: { platform: SocialHandle["platform"]; test: RegExp }[] = [
  { platform: "instagram", test: /(?:https?:)?\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\//i },
  { platform: "facebook", test: /(?:https?:)?\/\/(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.com)\//i },
  { platform: "youtube", test: /(?:https?:)?\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i },
  { platform: "x", test: /(?:https?:)?\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i },
];

/** Collects social links from JSON-LD sameAs + footer/nav, then reads public profile meta. */
export async function collectSocial(input: BrandInput, homepageHtml: string | null, sameAs: string[]): Promise<CollectorResult<SocialFacts>> {
  return safe<SocialFacts>("social", async (): Promise<CollectorOutput<SocialFacts>> => {
    const links: SocialHandle[] = [];
    const evidence: any[] = [];
    const notes: string[] = [];

    const add = (href: string, foundVia: string) => {
      if (!href) return;
      const abs = href.startsWith("http") ? href : "https://" + href.replace(/^\/+/, "");
      const hit = PLATFORMS.find(p => p.test.test(abs));
      if (!hit) return;
      if (links.some(l => l.platform === hit.platform)) return;
      const handle = abs.replace(/^https?:\/\/(www\.)?/i, "").split(/[?#]/)[0];
      links.push({ platform: hit.platform, url: abs, handle, foundVia });
    };

    for (const s of sameAs) add(s, "JSON-LD sameAs");

    if (input.instagram && !links.some(l => l.platform === "instagram")) {
      const h = input.instagram.replace(/^@/, "").trim();
      add(`https://instagram.com/${h}`, "analyst-supplied column");
    }

    if (homepageHtml) {
      const $ = cheerio.load(homepageHtml);
      $("footer a[href], nav a[href], [class*='social' i] a[href], a[href*='instagram'], a[href*='facebook'], a[href*='youtube'], a[href*='twitter'], a[href*='x.com']").each((_, el) => {
        add($(el).attr("href") ?? "", "site link");
      });
    }

    // discovery fallback: no site, no analyst handle -> look the handles up publicly
    if (!links.length) {
      const { hits } = await duckduckgo(`"${input.brand}" (instagram OR facebook OR youtube OR "x.com")`);
      for (const h of hits) add(h.url, "web search discovery");
    }

    const profiles: SocialFacts["profiles"] = [];
    const results = await Promise.all(links.map(async link => {
      const r = await fetchPage(link.url, { retries: 0, timeoutMs: 3500 });
      if (!r.ok || !r.body) {
        const status: SocialFacts["profiles"][number]["status"] = r.suspectedWall ? "login-walled" : r.blocked === "robots" ? "blocked" : "unreachable";
        return {
          profile: { platform: link.platform, url: link.url, followers: null, posts: null, likes: null, status },
          note: `${link.platform}: ${status} (${r.blocked ?? r.error}) — followers not read, treated as Insufficient Data.`,
          evidence: ev(`${link.platform} profile ${link.url} not readable: ${r.blocked ?? r.error}. Recorded as Insufficient Data, NOT as zero followers.`, link.url, r.fetchedAt),
        };
      }
      const $ = cheerio.load(r.body);
      const desc =
        $("meta[property='og:description']").attr("content") ??
        $("meta[name='description']").attr("content") ??
        $("body").text().slice(0, 3000);
      const parsed = parseSocialMeta(desc);
      const hasNumbers = parsed.followers !== null || parsed.posts !== null;
      return {
        profile: {
          platform: link.platform, url: r.finalUrl, followers: parsed.followers, posts: parsed.posts, likes: parsed.likes,
          status: (hasNumbers ? "parsed" : r.suspectedWall ? "login-walled" : "unreachable") as SocialFacts["profiles"][number]["status"],
        },
        note: hasNumbers ? null : `${link.platform}: follower/post counts are not in public markup (login wall or JS-rendered) — Insufficient Data.`,
        evidence: hasNumbers
          ? ev(`${link.platform} public meta: ${parsed.followers !== null ? `${parsed.followers} followers` : "followers not stated"}${parsed.posts !== null ? `, ${parsed.posts} posts` : ""}${parsed.likes !== null ? `, ${parsed.likes} likes` : ""} (from og:description)`, r.finalUrl, r.fetchedAt)
          : null,
      };
    }));

    for (const res of results) {
      profiles.push(res.profile);
      if (res.note) notes.push(res.note);
      if (res.evidence) evidence.push(res.evidence);
    }

    return { status: profiles.some(p => p.status === "parsed") ? "ok" : profiles.length ? "partial" : "skipped",
      facts: { links, profiles }, evidence, notes };
  });
}
