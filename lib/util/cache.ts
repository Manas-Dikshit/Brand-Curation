import { createHash } from "crypto";
import fs from "fs";
import path from "path";

const ROOT = path.join(process.cwd(), ".cache");

export const HTTP_TTL_MS = Number(process.env.CACHE_TTL_DAYS ?? 7) * 24 * 60 * 60 * 1000;
export const FACTS_SCHEMA_VERSION = 3;

function fileFor(kind: "http" | "facts", key: string) {
  const dir = kind === "http" ? path.join(ROOT, "http") : path.join(ROOT, "facts", String(FACTS_SCHEMA_VERSION));
  return path.join(dir, createHash("sha1").update(key).digest("hex") + ".json");
}

export function readCache<T>(kind: "http" | "facts", key: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(fileFor(kind, key), "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeCache(kind: "http" | "facts", key: string, value: unknown) {
  const f = fileFor(kind, key);
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(value));
  } catch {
    /* cache is best-effort */
  }
}

export function dropCache(kind: "http" | "facts", key: string) {
  try { fs.unlinkSync(fileFor(kind, key)); } catch { /* already gone */ }
}

export type HttpCacheEntry = {
  url: string; finalUrl: string; status: number; body: string; contentType: string;
  fetchedAt: number; etag?: string; lastModified?: string;
};

export function cacheFresh(e: HttpCacheEntry, ttlMs = HTTP_TTL_MS) {
  return Date.now() - e.fetchedAt < ttlMs;
}

/** Brand facts cache key: stable across spacing/case so "  H  I G G S " reuses "higgs". */
export function brandKey(brand: string) {
  return brand.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function sha1(s: string) {
  return createHash("sha1").update(s).digest("hex");
}
