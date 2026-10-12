import { test } from "vitest";
import { identityOf } from "./lib/collectors/site";
import { brandMatchScore } from "./lib/util/text";
import { UA } from "./lib/util/fetch";

async function probe(url: string, brand: string) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8", "accept-language": "en-IN,en;q=0.9" },
    redirect: "follow",
  });
  const body = await res.text();
  const id = identityOf(body);
  console.log(`\n${brand} -> ${url}`);
  console.log(JSON.stringify({ finalUrl: res.url, status: res.status, bytes: body.length, ...id, score: brandMatchScore(brand, id.scoreAgainst) }, null, 2));
  return body;
}

test("identity probe", async () => {
  const sleepy = await probe("https://www.thesleepyowl.com/", "Sleepy Owl");
  const boatLife = await probe("https://www.boat-lifestyle.com/", "boAt");
  await probe("https://www.boat.com/", "boAt");
  const t = sleepy.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  console.log("sleepy <title>:", JSON.stringify(t));
  console.log("sleepy og:site_name:", JSON.stringify(sleepy.match(/og:site_name[^>]*content=["']([^"']*)/i)?.[1] ?? null));
  const b = boatLife.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  console.log("boat-lifestyle <title>:", JSON.stringify(b));
}, 120000);