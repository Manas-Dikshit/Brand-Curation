import ExcelJS from "exceljs";
import path from "path";
import { CRITERION_NAMES, META, type Criterion, type RefReport } from "./criteria";
import rubric from "../config/rubric.json";

export const EXPECTED_CRITERIA = 15;

/**
 * Reads weights from the reference workbook at runtime. Weights are never hardcoded;
 * scoring is blocked unless the sheet has all 15 criteria and the weights total 100.
 */
export async function loadReference(): Promise<RefReport> {
  const sheetName = process.env.REF_SHEET || "Copy of Criteria & Weights";
  const fail = (issue: string, notes: string[] = []): RefReport =>
    ({ sheet: sheetName, criteria: [], totalWeight: 0, ok: false, issues: [issue], notes });

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.readFile(path.join(process.cwd(), "reference", "Newtail_Brand_Curation_Matrix.xlsx"));
  } catch (e) {
    return fail("Reference workbook inaccessible: " + (e as Error).message);
  }

  const ws = wb.getWorksheet(sheetName);
  if (!ws) {
    return fail(`Sheet "${sheetName}" not found. Available: ${wb.worksheets.map(w => w.name).join(", ")}`);
  }

  const criteria: Criterion[] = [];
  const issues: string[] = [];
  ws.eachRow((row, i) => {
    if (i === 1) return; // header
    const name = String(row.getCell(1).value ?? "").trim();
    const w = row.getCell(3).value;
    if (!name || name.toUpperCase().startsWith("TOTAL") || typeof w !== "number") return;
    const m = META[name];
    if (!m) {
      issues.push(`Row ${i}: criterion "${name}" has no mapping to the ${EXPECTED_CRITERIA} indicators.`);
      return;
    }
    criteria.push({
      name,
      what: String(row.getCell(2).value ?? ""),
      weight: w,
      key: m.key,
      ruleId: rubric.ruleIds[m.key],
      pillar: m.pillar,
      ...(m.hint ? { hint: m.hint } : {}),
    });
  });

  const missing = CRITERION_NAMES.filter(n => !criteria.some(c => c.name === n));
  if (missing.length) issues.push("Indicators missing from reference sheet: " + missing.join(", "));
  if (criteria.length !== EXPECTED_CRITERIA) {
    issues.push(`Expected ${EXPECTED_CRITERIA} criteria, found ${criteria.length}.`);
  }

  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0);
  if (Math.abs(totalWeight - 100) > 1e-6) issues.push(`Weights sum to ${totalWeight}, expected 100.`);

  const notes = [
    "Weights are read at runtime from the reference workbook; nothing is hardcoded. The rubric used for thresholds is config/rubric.json v" + rubric.version + ".",
    "Criterion 'Offline distribution whitespace' is scored so that HIGHER = LESS existing offline presence, per the reference sheet. The written spec said 'existing offline footprint'; confirm which direction the business wants.",
    "Unscored criteria are 'Insufficient Data' and add no points. They are not verified zeros, so only 'Complete' totals are comparable.",
    "Partial scores are intentionally NOT normalised; a 40/100 on 40% assessed weight is not comparable to a 40/100 on 100% assessed weight.",
    "Social platforms are frequently login-walled; those are recorded as Insufficient Data, never as absent.",
    "Blocked marketplace probes are excluded from the quick-commerce denominator rather than counted as 'not present'.",
  ];

  return { sheet: sheetName, criteria, totalWeight, issues, notes, ok: issues.length === 0 };
}
