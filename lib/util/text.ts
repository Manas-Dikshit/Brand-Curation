/** Text + number helpers shared by collectors and rules. No I/O, fully unit-testable. */

/* ---------- fuzzy brand matching (spec: Jaro-Winkler / token overlap >= 0.8) ---------- */

export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const win = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aFlags = new Array(a.length).fill(false);
  const bFlags = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - win);
    const hi = Math.min(i + win + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bFlags[j] || a[i] !== b[j]) continue;
      aFlags[i] = bFlags[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aFlags[i]) continue;
    for (let j = 0; j < b.length; j++) {
      if (!bFlags[j]) continue;
      if (a[i] !== b[j]) { t++; break; }
    }
  }
  t /= 2;
  return (matches / a.length + matches / b.length + (matches - t) / matches) / 3;
}

export function jaroWinkler(a: string, b: string, prefixWeight = 0.1): number {
  const j = jaro(a, b);
  if (j < 0.7) return j;
  let p = 0;
  while (p < 4 && p < a.length && p < b.length && a[p] === b[p]) p++;
  return j + p * prefixWeight * (1 - j);
}

const STOP = new Set(["the", "pvt", "private", "ltd", "limited", "llp", "inc", "co", "india", "india"]);

/** Normalised token bag: lowercase, stripped of legal suffixes. */
export function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(t => t && !STOP.has(t));
}

export function tokenOverlap(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

/** Best-of: brand name vs candidate site name. Passes the 0.8 gate. */
export function brandMatchScore(brand: string, candidate: string): number {
  if (!candidate.trim()) return 0;
  const a = tokens(brand).join("");
  const b = tokens(candidate).join("");
  if (!a || !b) return 0;
  return Math.max(jaroWinkler(a, b), tokenOverlap(brand, candidate));
}

/* ---------- number + price parsing ---------- */

const UNITS: Record<string, number> = {
  k: 1e3, thousand: 1e3, "1k": 1e3,
  m: 1e6, mn: 1e6, million: 1e6, mil: 1e6,
  b: 1e9, bn: 1e9, billion: 1e9,
  l: 1e5, lakh: 1e5, lakhs: 1e5, lac: 1e5,
  cr: 1e7, crore: 1e7, crores: 1e7,
};

/** "12K", "1.2M", "300" -> number. Returns null when not numeric. */
export function parseCompact(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const m = String(raw).replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([a-z]*)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  const unit = m[2].toLowerCase();
  return unit && UNITS[unit] ? n * UNITS[unit] : n;
}

/** "₹1,299.00" / "Rs. 1299" / "INR 1,299" -> 1299. Rejects "₹1.2k"? no, handled by parseCompact. */
export function parsePrice(raw: unknown): number | null {
  if (typeof raw === "number") return isFinite(raw) ? raw : null;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") {
    const o = raw as any;
    return parsePrice(o.price ?? o.value ?? o.amount ?? o.low ?? null);
  }
  const s = String(raw).replace(/[ ]/g, " ").trim();
  if (!/(\d)/.test(s)) return null;
  const m = s.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

/** Currency symbol/code found alongside a number, defaults to INR. */
export function currencyOf(raw: unknown): string {
  const s = String(raw ?? "");
  if (/\$|usd/i.test(s)) return "USD";
  if (/€|eur/i.test(s)) return "EUR";
  if (/£|gbp/i.test(s)) return "GBP";
  return "INR";
}

const INR_MARKER = /(rs\.?|₹|\binr\b)/i;
const FOREIGN_MARKER = /(\$|\busd\b|€|\beur\b|£|\bgbp\b)/i;

/**
 * "₹120 crore" / "Rs 20 cr" -> absolute rupees. Foreign-currency figures return
 * their value too, but flagged, because INR thresholds cannot judge them.
 */
export function parseMoneyPhrase(text: string): { value: number; matched: string; currency: string } | null {
  const m = text.replace(/,/g, "").match(
    /(?:rs\.?|₹|\binr\b|\$|\busd\b|€|\beur\b|£|\bgbp\b)?\s*(\d+(?:\.\d+)?)\s*(crore|crores|cr|lakhs|lakh|lac|l|million|billion|m|bn|b|k)\b/i,
  );
  if (!m) return null;
  const unit = m[2].toLowerCase();
  // bare "m"/"b"/"k" without a currency marker are ambiguous words, not amounts
  const ambiguous = ["m", "b", "k", "l"].includes(unit);
  const around = text.slice(Math.max(0, m.index! - 8), m.index! + m[0].length);
  const hasCurrency = INR_MARKER.test(around) || FOREIGN_MARKER.test(around);
  if (ambiguous && !hasCurrency) return null;
  const factor = UNITS[unit] ?? 1;
  const value = parseFloat(m[1]) * factor;
  if (!isFinite(value)) return null;
  // crore/lakh are INR units on their own; anything else needs an explicit marker
  const indianUnit = ["cr", "crore", "crores", "l", "lakh", "lakhs", "lac"].includes(unit);
  const currency = !FOREIGN_MARKER.test(around) || INR_MARKER.test(around)
    ? "INR"
    : currencyOf(m[0]);
  return { value, matched: m[0].trim(), currency: indianUnit && !FOREIGN_MARKER.test(around) ? "INR" : currency };
}

/** "12K Followers, 300 Posts" style fragments. */
export function parseSocialMeta(text: string): { followers: number | null; posts: number | null; likes: number | null } {
  const grab = (labels: string[]) => {
    for (const l of labels) {
      const m = text.match(new RegExp(`([\\d,.]+\\s*[a-z]*)\\s*${l}`, "i"));
      if (m) { const v = parseCompact(m[1]); if (v !== null) return v; }
    }
    return null;
  };
  return {
    followers: grab(["followers", "follower", "people following", "fans"]),
    posts: grab(["posts", "post\\b"]),
    likes: grab(["likes", "like\\b"]),
  };
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function round(n: number, dp = 1) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function clampScore(n: number) {
  return Math.max(0, Math.min(5, Math.round(n)));
}

/** True if a date string is within N days of now. */
export function withinDays(dateStr: string | null | undefined, days: number, now = Date.now()): boolean {
  if (!dateStr) return false;
  const t = Date.parse(dateStr);
  if (!isFinite(t)) return false;
  return now - t <= days * 86400000;
}

export function yearOf(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const m = String(dateStr).match(/(19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : null;
}
