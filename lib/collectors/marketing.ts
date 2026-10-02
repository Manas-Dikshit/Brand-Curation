import * as cheerio from "cheerio";
import { fetchPage } from "../util/fetch";
import { ev, safe, type CollectorOutput, type CollectorResult, type MarketingFacts, type MarketingSignal } from "./types";

/**
 * Detects marketing ACTIVITY from the brand's own site. None of these prove spend or
 * willingness to buy visibility — they only show a brand is running marketing.
 */
const TESTS: { signal: MarketingSignal; test: (html: string, $: cheerio.CheerioAPI, hrefs: string[]) => boolean }[] = [
  { signal: "promo_banner", test: (h) => /sale|sale[ -]?off|offer[s]?\s*%|buy\s*1\s*get|limited\s*time|free\s*shipping|flat\s*\d{2}%\s*off|monsoon|festive|end of season/i.test(h) },
  { signal: "discount_code", test: (h) => /discount\s*code|coupon\s*code|promo\s*code|use\s*code\s+[A-Z0-9]{3,}|extra\s*\d{1,2}%\s*off/i.test(h) },
  { signal: "blog_or_press_page", test: (_h, _$, hrefs) => hrefs.some(u => /\/blog|\/news|\/press|\/journal|\/media|\/stories/i.test(u)) },
  { signal: "newsletter_form", test: (h) => /newsletter|subscribe\s*to\s*our\s*(emails|news)|join\s*our\s*(list|newsletter)|type\s*your\s*email/i.test(h) },
  { signal: "meta_pixel", test: (h) => /connect\.facebook\.net|fbq\s*\(|facebook\.com\/tr/i.test(h) },
  { signal: "google_tag", test: (h) => /googletagmanager\.com\/gtm\.js|gtag\s*\(|google-analytics\.com\/analytics\.js|google\.com\/ads\/g-|awc\.google\.com/i.test(h) },
  { signal: "klaviyo", test: (h) => /klaviyo|list-manage\.com|mailchimp|sendinblue|brevo/i.test(h) },
  { signal: "google_ads_link", test: (_h, _$, hrefs) => hrefs.some(u => /ads\.google\.com|googleadservices|adwords/i.test(u)) },
  { signal: "meta_ad_library_link", test: (_h, _$, hrefs) => hrefs.some(u => /facebook\.com\/ads\/library|adlibrary/i.test(u)) },
  // retention signals: read by R03, deliberately not counted as marketing activity.
  // Patterns are matched against RAW HTML, so tolerate entities like "&amp;".
  { signal: "subscription_app", test: (h) => /subscription.?app|rechargeberry|skio|loop\.work|app\.subscriptionship|bold|saucery|smart-subscriptions/i.test(h) },
  { signal: "subscribe_and_save_text", test: (h) => /subscribe\s*(?:&|&amp;|and)\s*save|subscribe\s*now|auto[- ]?ship|deliver\s*every/i.test(h) },
  { signal: "auto_replenish", test: (h) => /auto[- ]?replenish|refill\s*reminder|never\s*run\s*out|reorder\s*reminder/i.test(h) },
  { signal: "loyalty_program", test: (h) => /loyalty\s*(program|programme|rewards?)|rewards\s*(program|tiers)|points\s*(for|on)\s*(every|purchase)|membership\s*(tiers?|program)/i.test(h) },
  { signal: "refund_policy", test: (h) => /return\s*(and|&|&amp;)\s*refund|refund\s*policy|return\s*policy/i.test(h) },
];

export async function collectMarketing(origin: string | null, homepageHtml: string | null): Promise<CollectorResult<MarketingFacts>> {
  return safe<MarketingFacts>("marketing", async (): Promise<CollectorOutput<MarketingFacts>> => {
    if (!origin) {
      return { status: "skipped", facts: { signals: [], pages: [] }, evidence: [], notes: ["Marketing scan skipped: official site unresolved."] };
    }
    const evidence: any[] = [];
    const signals: MarketingSignal[] = [];
    const pages: string[] = [];

    const scan = (html: string, url: string) => {
      const $ = cheerio.load(html);
      const hrefs: string[] = [];
      $("a[href]").each((_, el) => { const u = $(el).attr("href") ?? ""; if (u) hrefs.push(u); });
      const found: string[] = [];
      for (const t of TESTS) if (t.test(html, $, hrefs) && !signals.includes(t.signal)) { signals.push(t.signal); found.push(t.signal); }
      pages.push(url);
      if (found.length) evidence.push(ev(`Marketing signals on ${url}: ${found.join(", ")}`, url));
      return $;
    };

    if (homepageHtml) scan(homepageHtml, origin);
    else {
      const home = await fetchPage(origin);
      if (home.ok && home.body) scan(home.body, home.finalUrl);
      else return { status: "failed", facts: { signals: [], pages: [] }, evidence: [],
        notes: [`Marketing scan could not read the homepage: ${home.blocked ?? home.error}`] };
    }

    // one extra page for press/blog recency + freshness of campaigns
    const home = await fetchPage(origin);
    if (home.ok && home.body) {
      const $ = cheerio.load(home.body);
      const href = $("a[href*='/blog'], a[href*='/news'], a[href*='/press'], a[href*='/journal']").first().attr("href");
      if (href) {
        const url = href.startsWith("http") ? href : new URL(href, home.finalUrl).toString();
        const r = await fetchPage(url);
        if (r.ok && r.body) {
          scan(r.body, r.finalUrl);
          const dates = [...r.body.matchAll(/datetime="([^"]+)"/g)].map(m => m[1]).filter(Boolean);
          if (dates.length) evidence.push(ev(`Blog/press page ${r.finalUrl}: latest dated entry ${dates.sort().at(-1)}`, r.finalUrl, r.fetchedAt));
        }
      }
    }

    return { status: signals.length ? "ok" : "partial", facts: { signals, pages }, evidence,
      notes: signals.length ? [] : ["No marketing activity signals found in static HTML (a JS-only site would show none)."] };
  });
}
