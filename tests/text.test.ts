import { expect, test } from "vitest";
import { brandMatchScore, jaroWinkler, parseCompact, parseMoneyPhrase, parsePrice, parseSocialMeta, median, withinDays } from "@/lib/util/text";

test("jaro-winkler matches near-identical strings and rejects unrelated ones", () => {
  expect(jaroWinkler("higgs", "higgs")).toBe(1);
  expect(brandMatchScore("Higgs", "Higgs")).toBeGreaterThanOrEqual(0.8);
  expect(brandMatchScore("Higgs Nutrition", "Higgs Nutrition India")).toBeGreaterThanOrEqual(0.8);
  expect(brandMatchScore("Higgs", "Himalayan Rock Salt")).toBeLessThan(0.8);
  expect(brandMatchScore("Boat", "Boat Life Sciences")).toBeGreaterThanOrEqual(0.8);
});

test("legal suffixes do not break a brand match", () => {
  expect(brandMatchScore("Nykaa", "Nykaa Cosmetics")).toBeGreaterThanOrEqual(0.8);
  expect(brandMatchScore("Boat", "Boat Private Limited")).toBeGreaterThanOrEqual(0.8);
});

test("compact counts parse K/M and Indian units", () => {
  expect(parseCompact("12K")).toBe(12000);
  expect(parseCompact("1.2M")).toBe(1200000);
  expect(parseCompact("3.5")).toBe(3.5);
  expect(parseCompact("posts")).toBeNull();
});

test("prices parse from rupee and currency-prefixed strings", () => {
  expect(parsePrice("₹1,299.00")).toBe(1299);
  expect(parsePrice("Rs. 450")).toBe(450);
  expect(parsePrice(799)).toBe(799);
  expect(parsePrice("free")).toBeNull();
});

test("money phrases parse Indian crores and reject ambiguous bare units", () => {
  expect(parseMoneyPhrase("the company posted revenue of ₹120 crore in FY24")?.value).toBe(1200000000);
  expect(parseMoneyPhrase("raised $1.2 billion in funding")?.value).toBe(1200000000);
  expect(parseMoneyPhrase("revenue of Rs 20 cr")?.value).toBe(200000000);
  // single-letter units without a currency marker are ordinary words, not amounts
  expect(parseMoneyPhrase("grew 5 m in height")).toBeNull();
  expect(parseMoneyPhrase("revenue of 5 l per year")).toBeNull();
});

test("social meta reads follower and post counts", () => {
  const p = parseSocialMeta("12K Followers, 300 Posts");
  expect(p.followers).toBe(12000);
  expect(p.posts).toBe(300);
  expect(parseSocialMeta("Sign up to follow").followers).toBeNull();
});

test("median and recency helpers", () => {
  expect(median([3, 1, 2])).toBe(2);
  expect(median([4, 1, 2, 3])).toBe(2.5);
  expect(median([])).toBeNull();
  expect(withinDays(new Date().toISOString(), 90)).toBe(true);
  expect(withinDays(new Date(Date.now() - 200 * 86400000).toISOString(), 90)).toBe(false);
  expect(withinDays(null, 90)).toBe(false);
});
