import ExcelJS from "exceljs";
import { META } from "./criteria";
import { unsupportedClaims } from "./scoring";
import type { Criterion } from "./criteria";
import type { BrandInput, CriterionResult, Evaluation } from "./types";
import rubric from "../config/rubric.json";

export type ImportError = { row: number; brand: string; criterion: string; error: string };

/**
 * Bulk analyst import. Columns: Brand, Criterion, Score, Evidence, Source URL.
 * Row-level validation; a bad row never blocks the good ones.
 */
export async function parseEvidenceWorkbook(buf: ArrayBuffer, validCriteria: string[]): Promise<{
  overrides: Map<string, CriterionResult[]>;
  errors: ImportError[];
  imported: number;
}> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  const overrides = new Map<string, CriterionResult[]>();
  const errors: ImportError[] = [];
  let imported = 0;
  if (!ws) return { overrides, errors, imported };

  ws.eachRow((row, i) => {
    if (i === 1) return; // header
    const brand = String(row.getCell(1).value ?? "").trim();
    const criterion = String(row.getCell(2).value ?? "").trim();
    if (!brand && !criterion) return;

    const fail = (error: string) => errors.push({ row: i, brand, criterion, error });
    if (!brand) return fail("Brand is blank");
    if (!validCriteria.includes(criterion)) {
      return fail(`Criterion "${criterion}" does not match the reference sheet exactly. Expected one of: ${validCriteria.join(" | ")}`);
    }
    const rawScore = row.getCell(3).value;
    const score = typeof rawScore === "number" ? rawScore : Number(String(rawScore ?? "").trim());
    if (rawScore === null || rawScore === undefined || String(rawScore).trim() === "") {
      return fail("Score is blank; use a number 0-5 or leave the whole row out");
    }
    if (!Number.isFinite(score) || !Number.isInteger(score) || score < 0 || score > 5) {
      return fail(`Score "${String(rawScore)}" must be an integer 0-5`);
    }
    const sourceUrl = String(row.getCell(5).value ?? "").trim();
    if (!/^https?:\/\//i.test(sourceUrl)) return fail("Source URL is required and must start with http:// or https://");
    const evidence = String(row.getCell(4).value ?? "").trim();
    if (!evidence) return fail("Evidence text is required for an analyst score");

    const list = overrides.get(brand) ?? [];
    list.push({
      name: criterion,
      score,
      verification: "Verified",
      evidence,
      sourceUrl,
      missing: "",
      ruleId: null,
      source: "analyst",
    });
    overrides.set(brand, list);
    imported++;
  });

  return { overrides, errors, imported };
}

export const ANALYSIS_COLUMNS = ["Brand", "Criterion", "Score", "Evidence", "Source URL"];

/** Brand upload: Brand, optional Website, optional Instagram handle. */
export async function parseBrandWorkbook(buf: ArrayBuffer): Promise<{
  brands: BrandInput[];
  duplicates: string[];
  empty: string[];
}> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  const brands: BrandInput[] = [];
  const duplicates: string[] = [];
  const empty: string[] = [];
  if (!ws) return { brands, duplicates, empty };

  const seen = new Map<string, string>();
  let headerChecked = false;

  ws.eachRow((row, i) => {
    const raw = String(row.getCell(1).value ?? "").trim();
    if (!raw) { if (i > 1) empty.push(`Row ${i}`); return; }
    if (!headerChecked && i === 1) {
      headerChecked = true;
      if (/^brand/i.test(raw) && !/https?:|@/.test(raw)) return; // header row
    }
    const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (seen.has(key)) { duplicates.push(raw); return; }
    seen.set(key, raw);
    const website = String(row.getCell(2).value ?? "").trim() || null;
    const instagram = String(row.getCell(3).value ?? "").trim() || null;
    brands.push({ brand: raw, website, instagram });
  });

  return { brands, duplicates, empty };
}

export function pillarOf(name: string) {
  return META[name]?.pillar ?? "Unknown";
}

/** Minimal formula evaluator for the exact shapes emitted below, used to cross-check. */
export function evaluateWeightedFormula(cells: { score: number | string; weight: number }[]): number {
  let sum = 0;
  for (const c of cells) sum += typeof c.score === "number" ? (c.score / 5) * c.weight : 0;
  return Math.round(sum * 10) / 10;
}

export type QcRow = { check: string; severity: "error" | "warn" | "info"; detail: string };

export function qualityChecks(
  evaluations: Evaluation[],
  criteria: Criterion[],
  extras: { duplicates: string[]; blockedPlatforms: string[]; importErrors: ImportError[] },
): QcRow[] {
  const rows: QcRow[] = [];
  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0);

  if (Math.abs(totalWeight - 100) > 1e-6) {
    rows.push({ check: "Weights total", severity: "error", detail: `Weights sum to ${totalWeight}, expected 100.` });
  }
  if (criteria.length !== 15) {
    rows.push({ check: "Criteria count", severity: "error", detail: `Expected 15 criteria, found ${criteria.length}.` });
  }

  for (const ev of evaluations) {
    const unsupported = unsupportedClaims(ev.results);
    for (const u of unsupported) rows.push({ check: "Unsupported claim", severity: "error", detail: `${ev.brand} — ${u}` });

    // formula cross-check: TS total vs Σ(score/5 × weight) as written to the sheet
    const expected = evaluateWeightedFormula(
      criteria.map(c => {
        const r = ev.results.find(x => x.name === c.name);
        return { score: r?.score ?? "Insufficient Data", weight: c.weight };
      }),
    );
    if (Math.abs(expected - ev.totalPct) > 0.05) {
      rows.push({ check: "Formula mismatch", severity: "error",
        detail: `${ev.brand} — Excel SUMIFS would give ${expected} but the app reports ${ev.totalPct}.` });
    }

    const insufficientCount = ev.results.filter(r => r.score === null).length;
    if (insufficientCount) {
      rows.push({ check: "Insufficient data", severity: "warn",
        detail: `${ev.brand} — ${insufficientCount}/${ev.results.length} criteria unscored (${ev.results.filter(r => r.score === null).map(r => r.name).join("; ")}). Total is not comparable with a Complete brand.` });
    }
    const overridden = ev.results.filter(r => r.source === "analyst").length;
    if (overridden) {
      rows.push({ check: "Analyst overrides", severity: "info",
        detail: `${ev.brand} — ${overridden} criterion score(s) came from the analyst, not a rule.` });
    }
    if (ev.error) rows.push({ check: "Brand failed", severity: "error", detail: `${ev.brand} — ${ev.error}` });
  }

  if (extras.duplicates.length) {
    rows.push({ check: "Duplicate brands", severity: "warn", detail: `Collapsed ${extras.duplicates.length}: ${extras.duplicates.join(", ")}` });
  }
  if (extras.blockedPlatforms.length) {
    rows.push({ check: "Blocked platforms", severity: "warn",
      detail: `These platforms were bot-protected and are recorded as unverifiable, never as absent: ${[...new Set(extras.blockedPlatforms)].join(", ")}` });
  }
  for (const e of extras.importErrors) {
    rows.push({ check: "Import error", severity: "error", detail: `Row ${e.row}${e.brand ? ` (${e.brand})` : ""}: ${e.error}` });
  }
  if (!rows.length) rows.push({ check: "All checks", severity: "info", detail: "No issues found." });
  return rows;
}

export { rubric };
