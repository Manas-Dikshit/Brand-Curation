import fs from "fs";
import path from "path";
import { beforeEach, expect, test } from "vitest";
import { collectMarketing } from "@/lib/collectors/marketing";
import { extractCandidateTitles } from "@/lib/collectors/marketplaces";
import { parseJsonLd } from "@/lib/collectors/jsonld";
import { isCredible } from "@/lib/collectors/search";
import { identityOf } from "@/lib/collectors/site";
import { looksLikeWall } from "@/lib/util/fetch";
import { brandMatchScore } from "@/lib/util/text";

const FIX = path.join(__dirname, "fixtures");
const read = (f: string) => fs.readFileSync(path.join(FIX, f), "utf8");

test("site identity comes from og:site_name / JSON-LD / title", () => {
  const id = identityOf(read("homepage.html"));
  expect(id.name).toBe("Demo Skincare");
  expect(brandMatchScore("Demo Skincare", id.name!)).toBeGreaterThanOrEqual(0.8);
  // an unrelated brand must not pass on the demo fixture
  expect(brandMatchScore("Himalayan Rock Salt", id.scoreAgainst)).toBeLessThan(0.8);
});

test("JSON-LD parse recovers Organization sameAs and Product nodes, skipping malformed blocks", () => {
  const { nodes } = parseJsonLd(read("homepage.html") + '<script type="application/ld+json">{ not json </script>');
  const org = nodes.find(n => n["@type"] === "Organization");
  expect(org.name).toBe("Demo Skincare");
  expect(org.sameAs).toContain("https://instagram.com/demoskincare");
  expect(nodes.some(n => n["@type"] === "Product")).toBe(true);
});

test("marketing signals are detected in static HTML only", async () => {
  const r = await collectMarketing("https://demo.example", read("homepage.html"));
  const s = r.facts.signals;
  expect(s).toContain("promo_banner");
  expect(s).toContain("discount_code");
  expect(s).toContain("newsletter_form");
  expect(s).toContain("meta_pixel");
  expect(s).toContain("google_tag");
  expect(s).toContain("blog_or_press_page");
  expect(s).toContain("subscribe_and_save_text");
  expect(s).toContain("loyalty_program");
  expect(s).not.toContain("klaviyo");
});

test("a page with no marketing activity yields no signals and is partial, not zero", async () => {
  const r = await collectMarketing("https://demo.example", "<html><body><h1>Quiet</h1></body></html>");
  expect(r.facts.signals).toHaveLength(0);
  expect(r.status).toBe("partial");
});

test("bot walls are detected and are never read as content", () => {
  expect(looksLikeWall(read("bot-wall.html"), 200)).toBe(true);
  expect(looksLikeWall(read("amazon-search.html"), 200)).toBe(false);
  expect(looksLikeWall("", 403)).toBe(true);
});

test("marketplace probe requires a fuzzy title match before calling a brand present", () => {
  const titles = extractCandidateTitles(read("amazon-search.html"));
  expect(titles.length).toBeGreaterThanOrEqual(2);
  const scored = titles.map(t => ({ t, s: brandMatchScore("Demo Skincare", t) })).sort((a, b) => b.s - a.s);
  expect(scored[0].s).toBeGreaterThanOrEqual(0.8);
  expect(scored[0].t).toMatch(/Demo Skincare/);
  // the unrelated product on the same page must not match, otherwise every brand "exists"
  expect(scored[scored.length - 1].s).toBeLessThan(0.8);
});

test("retail parsing counts declared stores, cities and configured retail partners", () => {
  const html = read("store-locator.html");
  expect(html).toMatch(/320 retail stores/);
  expect(html).toMatch(/Apollo Pharmacy/);
  expect(html).toMatch(/Health &amp; Glow/);
});

test("credible-domain allow-list only permits listed domains", () => {
  expect(isCredible("https://www.livemint.com/news/x")).toBe(true);
  expect(isCredible("https://random-blog.example.com/x")).toBe(false);
  expect(isCredible("not a url")).toBe(false);
});
