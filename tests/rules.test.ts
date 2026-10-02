import { beforeAll, describe, expect, test } from "vitest";
import { loadReference } from "@/lib/reference";
import { RULES } from "@/lib/rules";
import { brand, probe, product, run, shopify } from "./helpers";
import type { Criterion } from "@/lib/criteria";

let cs: Criterion[];
let byName: Record<string, Criterion>;

beforeAll(async () => {
  const ref = await loadReference();
  cs = ref.criteria;
  byName = Object.fromEntries(cs.map(c => [c.name, c]));
});

const R = (name: string) => RULES[byName[name].key];

describe("R01 product price fit", () => {
  test("scores 5 when >=80% of prices sit in the target range", () => {
    const prices = [299, 399, 499, 599, 4999];
    const out = run(R("Product price fit"), brand(null, shopify(prices.map(p => product({ prices: [{ price: p, compareAt: null, available: true }] })))), byName["Product price fit"]);
    expect(out.score).toBe(5);
    expect(out.verification).toBe("Verified");
  });

  test("scores 0 only when prices exist and none are in range", () => {
    const out = run(R("Product price fit"), brand(null, shopify([2000, 3000].map(p => product({ prices: [{ price: p, compareAt: null, available: true }] })))), byName["Product price fit"]);
    expect(out.score).toBe(0);
    expect(out.verification).toBe("Verified");
  });

  test("no price data is Insufficient Data, never 0", () => {
    const out = run(R("Product price fit"), brand(), byName["Product price fit"]);
    expect(out.score).toBeNull();
    expect(out.verification).toBe("Insufficient Data");
  });
});

describe("R02 high-margin products", () => {
  test("scores from the MRP discount gap and labels it a proxy", () => {
    const ps = [product({ prices: [{ price: 500, compareAt: 1500, available: true }] })];
    const out = run(R("High-margin products"), brand(null, shopify([...ps, ...ps, ...ps])), byName["High-margin products"]);
    expect(out.score).toBeGreaterThan(0);
    expect(out.evidence.toLowerCase()).toContain("proxy");
    expect(out.missing).toMatch(/not margin/i);
  });

  test("no gaps and no stated margin is Insufficient Data", () => {
    const out = run(R("High-margin products"), brand(null, shopify([product(), product(), product()])), byName["High-margin products"]);
    expect(out.score).toBeNull();
  });

  test("a cited stated margin outranks the proxy", () => {
    const facts = brand(null, {
      ...shopify([product()]),
      search: { web: [{ title: "Brand holds gross margin of 62% per filings", url: "https://moneycontrol.com/x", source: "moneycontrol.com", date: null, snippet: null }], news: [] },
    });
    const out = run(R("High-margin products"), facts, byName["High-margin products"]);
    expect(out.score).toBe(5);
    expect(out.verification).toBe("Evidence-based assessment");
  });
});

describe("R03 repeat customers", () => {
  test("caps at 3 on a subscription signal with no stated repeat rate", () => {
    const out = run(R("Repeat customers"), brand(null, { marketing: { signals: ["subscribe_and_save_text"], pages: [] } }), byName["Repeat customers"]);
    expect(out.score).toBe(3);
    expect(out.missing).toMatch(/capped/i);
  });

  test("a cited repeat rate can score 5", () => {
    const facts = brand(null, {
      marketing: { signals: ["loyalty_program"], pages: [] },
      search: { web: [{ title: "45% of customers repeat purchase within 90 days", url: "https://inc42.com/x", source: "inc42.com", date: null, snippet: null }], news: [] },
    });
    expect(run(R("Repeat customers"), facts, byName["Repeat customers"]).score).toBe(5);
  });

  test("followers are never treated as repeat purchase", () => {
    const facts = brand(null, { social: { links: [], profiles: [{ platform: "instagram", url: "https://instagram.com/b", followers: 500000, posts: 900, likes: null, status: "parsed" }] } });
    const out = run(R("Repeat customers"), facts, byName["Repeat customers"]);
    expect(out.score).toBeNull();
  });
});

describe("R04 revenue-generating brand", () => {
  test("scores from a cited press figure", () => {
    const out = run(R("Revenue-generating brand"), brand(), byName["Revenue-generating brand"],
      { statements: [{ text: "Brand reported revenue of Rs 150 crore in FY24", url: "https://livemint.com/x", year: 2024, value: 1500000000, currency: "INR" }] });
    expect(out.score).toBe(5);
    expect(out.verification).toBe("Evidence-based assessment");
  });

  test("stale figures are not scored", () => {
    const out = run(R("Revenue-generating brand"), brand(), byName["Revenue-generating brand"],
      { statements: [{ text: "revenue of Rs 150 crore", url: "https://livemint.com/x", year: 2005, value: 1500000000, currency: "INR" }] });
    expect(out.score).toBeNull();
    expect(out.missing).toMatch(/stale/i);
  });

  test("a USD figure is not scored against INR bands", () => {
    const out = run(R("Revenue-generating brand"), brand(), byName["Revenue-generating brand"],
      { statements: [{ text: "Brand reported revenue of $1.5 billion in FY24", url: "https://livemint.com/x", year: 2024, value: 1.5e9, currency: "USD" }] });
    expect(out.score).toBeNull();
    expect(out.verification).toBe("Insufficient Data");
    expect(out.missing).toMatch(/USD/);
    expect(out.missing).toMatch(/not converted/i);
  });

  test("a Wikipedia article with no revenue figure stays Insufficient Data", () => {
    const facts = brand(null, { wiki: { found: true, title: "Brand", description: "An Indian company.", url: "https://en.wikipedia.org/wiki/Brand", founded: "2011", revenue: null } });
    const out = run(R("Revenue-generating brand"), facts, byName["Revenue-generating brand"]);
    expect(out.score).toBeNull();
    expect(out.missing).toMatch(/not proof of sales/i);
  });
});

describe("R05 digital PMF", () => {
  test("needs two evidence types to score 4 or more", () => {
    const oneType = brand(null, { ...shopify([product()]) });
    expect(run(R("Digital PMF"), oneType, byName["Digital PMF"]).score).toBeLessThanOrEqual(3);

    const twoTypes = brand(null, {
      ...shopify([product()]),
      jsonld: { organization: null, products: [], rating: { value: 4.6, count: 900 }, pagesParsed: 1, reason: null },
    });
    const out = run(R("Digital PMF"), twoTypes, byName["Digital PMF"]);
    expect(out.score).toBeGreaterThanOrEqual(4);
    expect(out.verification).toBe("Verified");
  });
});

describe("R06 in-demand category", () => {
  test("maps a known product type to a sourced category", () => {
    const facts = brand(null, shopify([product({ productType: "Skincare", tags: ["serum"] })]));
    const out = run(R("In-demand category"), facts, byName["In-demand category"]);
    expect(out.score).toBeGreaterThan(0);
    expect(out.evidence).toMatch(/skincare/);
    expect(out.sourceUrl).toMatch(/^https?:\/\//);
  });

  test("an unmappable type is null, not a guess", () => {
    const facts = brand(null, shopify([product({ productType: "Quantum widgets" })]));
    const out = run(R("In-demand category"), facts, byName["In-demand category"]);
    expect(out.score).toBeNull();
    expect(out.missing).toMatch(/category-demand\.json/);
  });
});

describe("R07 marketing activity", () => {
  test("counts verified signals into a band", () => {
    const facts = brand(null, { marketing: { signals: ["promo_banner", "discount_code", "newsletter_form", "meta_pixel"], pages: [] } });
    expect(run(R("Active marketing"), facts, byName["Active marketing"]).score).toBe(4);
  });

  test("no signals is Insufficient Data, not 0", () => {
    expect(run(R("Active marketing"), brand(), byName["Active marketing"]).score).toBeNull();
  });
});

describe("R08 quick-commerce presence", () => {
  test("blocked platforms are excluded from the denominator, not counted absent", () => {
    const facts = brand(null, {
      marketplaces: {
        probes: [
          probe({ platform: "Blinkit", qc: true, status: "present", matchedTitle: "Brand X" }),
          probe({ platform: "Zepto", qc: true, status: "unverifiable-blocked" }),
          probe({ platform: "Swiggy Instamart", qc: true, status: "unverifiable-blocked" }),
        ],
        present: ["Blinkit"], blocked: ["Zepto", "Swiggy Instamart"], absent: [], ranks: [],
      },
    });
    const out = run(R("Quick-commerce presence"), facts, byName["Quick-commerce presence"]);
    expect(out.score).toBe(2);
    expect(out.missing).toMatch(/Zepto/);
    expect(out.evidence).not.toMatch(/not list/);
  });

  test("all platforms blocked means presence is unknown, not absent", () => {
    const facts = brand(null, {
      marketplaces: {
        probes: [probe({ platform: "Blinkit", qc: true, status: "unverifiable-blocked" })],
        present: [], blocked: ["Blinkit"], absent: [], ranks: [],
      },
    });
    const out = run(R("Quick-commerce presence"), facts, byName["Quick-commerce presence"]);
    expect(out.score).toBeNull();
    expect(out.missing).toMatch(/never inferred from a block/i);
  });
});

describe("R09 packaging", () => {
  test("objective imaging signals cap at 3", () => {
    const ps = [product({ images: 5 }), product({ images: 4 }), product({ images: 4 })];
    const out = run(R("Distinctive packaging"), brand(null, shopify(ps)), byName["Distinctive packaging"]);
    expect(out.score).toBe(3);
    expect(out.verification).toBe("Evidence-based assessment");
    expect(out.missing).toMatch(/analyst/i);
  });

  test("too few products is Insufficient Data", () => {
    expect(run(R("Distinctive packaging"), brand(null, shopify([product()])), byName["Distinctive packaging"]).score).toBeNull();
  });
});

describe("R10 reviews", () => {
  test("score by rating and count together", () => {
    const facts = brand(null, { jsonld: { organization: null, products: [], rating: { value: 4.7, count: 800 }, pagesParsed: 1, reason: null } });
    expect(run(R("Customer reviews"), facts, byName["Customer reviews"]).score).toBe(5);
  });

  test("a small sample caps the score", () => {
    const facts = brand(null, { jsonld: { organization: null, products: [], rating: { value: 4.9, count: 6 }, pagesParsed: 1, reason: null } });
    const out = run(R("Customer reviews"), facts, byName["Customer reviews"]);
    expect(out.score).toBe(3);
    expect(out.missing).toMatch(/small sample/i);
  });

  test("no AggregateRating is Insufficient Data, not bad sentiment", () => {
    const out = run(R("Customer reviews"), brand(), byName["Customer reviews"]);
    expect(out.score).toBeNull();
    expect(out.missing).toMatch(/NOT zero satisfaction/i);
  });
});

describe("R11 willingness to pay for visibility", () => {
  test("ad tags alone are never enough", () => {
    const facts = brand(null, { marketing: { signals: ["meta_pixel", "google_tag", "klaviyo"], pages: [] } });
    const out = run(R("Willingness to pay for visibility"), facts, byName["Willingness to pay for visibility"]);
    expect(out.score).toBeNull();
    expect(out.missing).toMatch(/not evidence/i);
  });

  const hit = (title: string) => brand(null, {
    search: { web: [{ title, url: "https://retailfocus.in/x", source: "retailfocus.in", date: null, snippet: null }], news: [] },
  });

  test("one documented signal scores conservatively", () => {
    const out = run(R("Willingness to pay for visibility"), hit("Brand begins sampling programme in 200 stores"), byName["Willingness to pay for visibility"]);
    expect(out.score).toBe(2);
    expect(out.verification).toBe("Evidence-based assessment");
  });

  test("two documented signals score the band", () => {
    const out = run(R("Willingness to pay for visibility"), hit("Brand trade programme expands with new retail media campaign"), byName["Willingness to pay for visibility"]);
    expect(out.score).toBe(4);
  });
});

describe("R12 offline distribution whitespace", () => {
  test("no documented presence with a resolved site scores as whitespace", () => {
    const out = run(R("Offline distribution whitespace"), brand(), byName["Offline distribution whitespace"]);
    expect(out.score).toBe(4);
    expect(out.verification).toBe("Evidence-based assessment");
    expect(out.evidence).toMatch(/HIGHER = LESS/);
  });

  test("many documented stores means low whitespace", () => {
    const facts = brand("https://brand.example", {
      retail: { pagesFound: ["https://brand.example/where-to-buy"], stores: new Array(60).fill({ name: null, city: "Pune" }), retailerMatches: [], storeCountDeclared: 400 },
    });
    const out = run(R("Offline distribution whitespace"), facts, byName["Offline distribution whitespace"]);
    expect(out.score).toBe(1);
  });

  test("unresolved site means unknown footprint, not zero footprint", () => {
    const out = run(R("Offline distribution whitespace"), brand(null), byName["Offline distribution whitespace"]);
    expect(out.score).toBeNull();
    expect(out.missing).toMatch(/HIGHER = LESS/);
  });
});

describe("R13 retailer demand fit", () => {
  test("matches category and price slot against retailer profiles", () => {
    const facts = brand(null, shopify([product({ productType: "Skincare", prices: [{ price: 400, compareAt: null, available: true }] })]));
    const out = run(R("Retailer demand fit"), facts, byName["Retailer demand fit"]);
    expect(out.score).toBeGreaterThan(0);
    expect(out.missing).toMatch(/nothing about whether the retailer/i);
  });

  test("category known but price unknown is Insufficient Data", () => {
    const facts = brand(null, { jsonld: { organization: null, products: [], rating: null, pagesParsed: 1, reason: null } });
    const out = run(R("Retailer demand fit"), facts, byName["Retailer demand fit"]);
    expect(out.score).toBeNull();
  });
});

describe("R14 social presence", () => {
  test("reads followers and post volume from public markup", () => {
    const facts = brand(null, {
      social: { links: [], profiles: [{ platform: "instagram", url: "https://instagram.com/b", followers: 50000, posts: 400, likes: null, status: "parsed" }] },
    });
    const out = run(R("Social media presence"), facts, byName["Social media presence"]);
    expect(out.score).toBe(4);
    expect(out.missing).toMatch(/not proof of revenue/i);
  });

  test("a login wall is Insufficient Data, never zero followers", () => {
    const facts = brand(null, {
      social: { links: [], profiles: [{ platform: "instagram", url: "https://instagram.com/b", followers: null, posts: null, likes: null, status: "login-walled" }] },
    });
    const out = run(R("Social media presence"), facts, byName["Social media presence"]);
    expect(out.score).toBeNull();
    expect(out.missing).toMatch(/never as zero followers/i);
  });
});

describe("R15 proven sell-through", () => {
  test("a cited bestseller rank scores", () => {
    const facts = brand(null, {
      marketplaces: { probes: [probe({ platform: "Amazon.in", status: "present", matchedTitle: "Brand X", url: "https://amazon.in/s?k=b" })], present: ["Amazon.in"], blocked: [], absent: [], ranks: [{ platform: "Amazon.in", rank: 7, label: "Best seller #7", productTitle: "Brand X", url: "https://amazon.in/s?k=b" }] },
    });
    expect(run(R("Proven sell-through"), facts, byName["Proven sell-through"]).score).toBe(5);
  });

  test("a listing without a rank is not sell-through", () => {
    const facts = brand(null, {
      marketplaces: { probes: [probe({ platform: "Amazon.in", status: "present", matchedTitle: "Brand X" })], present: ["Amazon.in"], blocked: [], absent: [], ranks: [] },
    });
    const out = run(R("Proven sell-through"), facts, byName["Proven sell-through"]);
    expect(out.score).toBeNull();
    expect(out.missing).toMatch(/listing is not sell-through/i);
  });
});
