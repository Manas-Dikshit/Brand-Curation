import fs from "fs";
import path from "path";
import type { BrandInput } from "./types";

const FIX = path.join(process.cwd(), "tests", "fixtures");
const read = (f: string) => fs.readFileSync(path.join(FIX, f), "utf8");

/**
 * Offline demo set. `--demo` / the "Load demo data" button swaps globalThis.fetch
 * for this router, so the real collectors, rules and Excel writer all run with no network.
 */
export const DEMO_BRANDS: BrandInput[] = [
  { brand: "Demo Skincare", website: "https://demo.example" },
  // no website on purpose: shows how an unresolved brand degrades to Insufficient Data
  { brand: "Demo Grocery" },
];

export function demoRoutes(): Record<string, string> {
  return {
    "https://demo.example/": read("homepage.html"),
    "https://demo.example/products.json?limit=250&page=1": read("products.json"),
    "https://demo.example/sitemap.xml": read("sitemap.xml"),
    "https://demo.example/pages/where-to-buy": read("store-locator.html"),
    "https://demo.example/robots.txt": read("robots.txt"),
    "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=Demo%20Skincare%20company%20brand&srlimit=5&format=json&origin=*":
      JSON.stringify({ query: { search: [{ title: "Demo Skincare" }] } }),
    "https://en.wikipedia.org/w/api.php?action=query&prop=extracts|pageprops&exintro=1&explaintext=1&redirects=1&titles=Demo%20Skincare&format=json&origin=*":
      JSON.stringify({ query: { pages: { 1: { extract: "Demo Skincare is an Indian skincare brand founded in 2019." } } } }),
  };
}

/** fetch replacement serving fixtures; anything unmapped is a 404, never the real internet. */
export function demoFetch(input: unknown): Promise<Response> {
  const routes = demoRoutes();
  const url = String(input);
  const body = routes[url];
  if (body === undefined) {
    return Promise.resolve(new Response("not found (demo mode)", { status: 404, headers: { "content-type": "text/plain" } }));
  }
  const isJson = url.includes("json") || url.includes("api.php");
  return Promise.resolve(new Response(body, {
    status: 200,
    headers: { "content-type": isJson ? "application/json" : "text/html" },
  }));
}

/** Runs `fn` with the demo router installed, then restores the real fetch. */
export async function withDemoFetch<T>(fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = demoFetch as unknown as typeof fetch;
  process.env.PER_DOMAIN_GAP_MS ??= "0";
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}