import { cacheFresh, readCache, writeCache, type HttpCacheEntry } from "./cache";

export const UA =
  "NewtailBrandCuration/1.0 (+https://newtail.example/brand-curation; research bot; contact: brand-curation@newtail.example)";

export const TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS ?? 8000);
export const MAX_BYTES = 2 * 1024 * 1024;
export const RETRIES = 2;
export const PER_DOMAIN_GAP_MS = Number(process.env.PER_DOMAIN_GAP_MS ?? 1000);
/** Global token bucket: one request per this many ms across every domain (~10 req/s). */
export const GLOBAL_GAP_MS = Number(process.env.GLOBAL_REQUEST_GAP_MS ?? 100);

export type Blocked =
  | "robots" | "timeout" | "too-large" | "network" | "http-error"
  | "non-html" | "redirect-offsite" | "bad-url" | "render-failed" | null;

export type FetchResult = {
  ok: boolean;
  url: string;
  finalUrl: string;
  origin: string;
  status: number;
  body: string;
  contentType: string;
  fetchedAt: string;
  fromCache: boolean;
  error?: string;
  blocked?: Exclude<Blocked, null>;
  etag?: string;
  lastModified?: string;
  /** Set when the page looks like a bot wall rather than real content. */
  suspectedWall?: boolean;
};

const ok = (r: Partial<FetchResult>): FetchResult => ({
  ok: false, url: "", finalUrl: "", origin: "", status: 0, body: "", contentType: "",
  fetchedAt: new Date().toISOString(), fromCache: false, ...r,
});

/** Cache entries keep an epoch ms for freshness maths; FetchResult exposes ISO. */
const fromEntry = (e: HttpCacheEntry) => ({ ...e, fetchedAt: new Date(e.fetchedAt).toISOString() });

/* ---------- per-domain politeness ---------- */

const lastHit = new Map<string, number>();
const inflight = new Map<string, Promise<void>>();
let nextGlobalSlot = 0;

function domainOf(u: string) {
  try { return new URL(u).hostname.toLowerCase(); } catch { return ""; }
}
function registrable(u: string) {
  const h = domainOf(u);
  const p = h.split(".");
  return p.length <= 2 ? h : p.slice(-2).join(".");
}

/** Serialises + spaces out requests per host, and passes every request through a global bucket. */
export async function politeSlot(url: string): Promise<() => void> {
  const host = domainOf(url);
  const prev = inflight.get(host) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>(r => { release = r; });
  inflight.set(host, held);
  await prev.catch(() => {});
  const now = Date.now();
  const slot = Math.max(nextGlobalSlot, now);
  nextGlobalSlot = slot + GLOBAL_GAP_MS;
  if (slot > now) await sleep(slot - now);
  const since = now - (lastHit.get(host) ?? 0);
  if (since < PER_DOMAIN_GAP_MS) await sleep(PER_DOMAIN_GAP_MS - since);
  lastHit.set(host, Date.now());
  return () => release();
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/* ---------- robots.txt (cached per origin) ---------- */

const robots = new Map<string, Promise<{ rules: { path: string; allow: boolean }[]; fetchedAt: number } | null>>();

function parseRobots(txt: string) {
  const groups: { ua: string[]; rules: { path: string; allow: boolean }[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const field = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (field === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { ua: [], rules: [] }; groups.push(cur); }
      cur.ua.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) { cur = { ua: [], rules: [] }; groups.push(cur); }
    if (field === "disallow" || field === "allow") {
      if (field === "disallow" && value === "") continue; // "Disallow:" = allow all
      cur.rules.push({ path: value, allow: field === "allow" });
    }
  }
  const me = groups.find(g => g.ua.some(u => u === "*")) ?? groups[groups.length - 1];
  return me ? me.rules : [];
}

function loadRobots(origin: string) {
  let p = robots.get(origin);
  if (!p) {
    p = (async () => {
      try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
        const r = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": UA }, signal: ac.signal, redirect: "follow" });
        clearTimeout(t);
        if (!r.ok) return null;
        const txt = (await r.text()).slice(0, 200_000);
        return { rules: parseRobots(txt), fetchedAt: Date.now() };
      } catch {
        return null; // unreachable robots => fail open (documented in README)
      }
    })();
    robots.set(origin, p);
  }
  return p;
}

export async function robotsAllows(url: string): Promise<{ allowed: boolean; rule?: string }> {
  const u = new URL(url);
  const r = await loadRobots(u.origin);
  if (!r) return { allowed: true };
  const path = u.pathname + u.search;
  let best: { path: string; allow: boolean } | null = null;
  for (const rule of r.rules) {
    if (!path.startsWith(rule.path)) continue;
    if (!best || rule.path.length > best.path.length) best = rule;
  }
  return best && !best.allow ? { allowed: false, rule: best.path } : { allowed: true };
}

/* ---------- content heuristics ---------- */

const TEXTUAL = /^(text\/|application\/(json|xml|xhtml\+xml|ld\+json))/i;

const WALL_PATTERNS =
  /(captcha|are you (a )?human|unusual traffic|access denied|just a moment|checking your browser|enable javascript and cookies|verify you are human|cf-browser-verification|px-captcha)/i;

export function looksLikeWall(body: string, status: number) {
  if (status === 403 || status === 429 || status === 503) return true;
  if (body.length > 3000) return false;
  return WALL_PATTERNS.test(body);
}

/* ---------- the fetcher ---------- */

async function readCapped(res: Response) {
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > MAX_BYTES) return { body: "", tooLarge: true };
  if (!res.body) return { body: await res.text(), tooLarge: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) { await reader.cancel().catch(() => {}); return { body: "", tooLarge: true }; }
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks.map(c => Buffer.from(c)));
  return { body: buf.toString("utf8"), tooLarge: false };
}

function normalise(u: string) {
  try {
    const x = new URL(u);
    if (x.protocol !== "http:" && x.protocol !== "https:") return null;
    x.hash = "";
    return x.toString();
  } catch { return null; }
}

/**
 * Keyless page fetch. Honours robots.txt, per-domain spacing, an 8s abort,
 * 2 retries with backoff, a 2 MB cap and same-domain-only redirects.
 * Returns a result object for every outcome; never throws.
 */
export async function fetchPage(rawUrl: string, opts: { refresh?: boolean } = {}): Promise<FetchResult> {
  const start = normalise(rawUrl);
  if (!start) return ok({ url: rawUrl, blocked: "bad-url", error: `Unsupported URL: ${rawUrl}` });

  const gate = await robotsAllows(start);
  if (!gate.allowed) return ok({ url: start, finalUrl: start, blocked: "robots", error: `robots.txt disallows ${gate.rule}` });

  const cached = readCache<HttpCacheEntry>("http", start);
  if (cached && !opts.refresh && cacheFresh(cached)) {
    return ok({ ...fromEntry(cached), url: start, origin: new URL(start).origin, ok: cached.status === 200, fromCache: true });
  }

  let url = start;
  const release = await politeSlot(start);
  try {
    for (let hop = 0; hop <= 3; hop++) {
      const headers: Record<string, string> = {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "accept-language": "en-IN,en;q=0.9",
      };
      if (cached && cached.url === url) {
        if (cached.etag) headers["if-none-match"] = cached.etag;
        if (cached.lastModified) headers["if-modified-since"] = cached.lastModified;
      }

      let lastErr = "";
      for (let attempt = 0; attempt <= RETRIES; attempt++) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
        try {
          const res = await fetch(url, { headers, signal: ac.signal, redirect: "manual" });
          clearTimeout(timer);

          if (res.status === 304 && cached) {
            const entry = { ...cached, fetchedAt: Date.now() };
            writeCache("http", start, entry);
            return ok({ ...fromEntry(entry), url: start, origin: new URL(start).origin, ok: true, fromCache: true });
          }

          if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get("location");
            await res.body?.cancel().catch(() => {});
            if (!loc) break;
            const next = normalise(new URL(loc, url).toString());
            if (!next || registrable(next) !== registrable(start)) {
              return ok({ url: start, finalUrl: url, status: res.status, blocked: "redirect-offsite", error: "Redirect left the domain" });
            }
            url = next;
            lastErr = "";
            break; // next hop
          }

          if (!res.ok) {
            await res.body?.cancel().catch(() => {});
            lastErr = `HTTP ${res.status}`;
            if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) { await sleep(500 * 2 ** attempt); continue; }
            const body = (await readCapped(res)).body.slice(0, 4000);
            return ok({ url: start, finalUrl: url, status: res.status, body, contentType: res.headers.get("content-type") ?? "",
              blocked: "http-error", error: lastErr, suspectedWall: looksLikeWall(body, res.status) });
          }

          const ct = res.headers.get("content-type") ?? "";
          if (!TEXTUAL.test(ct)) {
            await res.body?.cancel().catch(() => {});
            return ok({ url: start, finalUrl: url, status: res.status, contentType: ct, blocked: "non-html", error: `Unsupported content-type ${ct}` });
          }

          const { body, tooLarge } = await readCapped(res);
          if (tooLarge) return ok({ url: start, finalUrl: url, status: res.status, blocked: "too-large", error: `Response exceeded ${MAX_BYTES} bytes` });
          // opt-in: only pay for a real browser when the markup looks like a wall
          const finalBody = looksLikeWall(body, res.status) ? await render(url, body) : body;

          const entry: HttpCacheEntry = {
            url: start, finalUrl: url, status: res.status, body: finalBody, contentType: ct, fetchedAt: Date.now(),
            etag: res.headers.get("etag") ?? undefined,
            lastModified: res.headers.get("last-modified") ?? undefined,
          };
          writeCache("http", start, entry);
          return ok({ ...fromEntry(entry), url: start, origin: new URL(start).origin, ok: true,
            suspectedWall: looksLikeWall(finalBody, res.status) });
        } catch (e) {
          clearTimeout(timer);
          const msg = (e as Error).message;
          lastErr = msg.includes("abort") ? `Timed out after ${TIMEOUT_MS}ms` : msg;
          if (attempt < RETRIES) { await sleep(500 * 2 ** attempt); continue; }
        }
      }
      // fell through the retry loop without a redirect hop to take
      return ok({ url: start, finalUrl: url, blocked: lastErr.includes("Timed out") ? "timeout" : "network", error: lastErr || "Request failed" });
    }
    return ok({ url: start, finalUrl: url, blocked: "network", error: "Too many redirects" });
  } finally {
    release();
  }
}

/** Optional JS rendering. Off unless USE_PLAYWRIGHT=true; never throws. */
export async function render(url: string, html: string): Promise<string> {
  if (process.env.USE_PLAYWRIGHT !== "true") return html;
  try {
    // Indirection keeps the optional dependency out of the TS module graph.
    const importOptional = new Function("s", "return import(s)") as (s: string) => Promise<any>;
    const { chromium } = await importOptional("playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ userAgent: UA });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      return await page.content();
    } finally { await browser.close(); }
  } catch (e) {
    return html;
  }
}

export { sleep, registrable, domainOf };
