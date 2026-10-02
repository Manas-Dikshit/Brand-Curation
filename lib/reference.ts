import ExcelJS from "exceljs";
import path from "path";
import { META, Criterion } from "./criteria";

export type RefReport = { sheet: string; criteria: Criterion[]; totalWeight: number; issues: string[]; ok: boolean };

export async function loadReference(): Promise<RefReport> {
  const sheetName = process.env.REF_SHEET || "Copy of Criteria & Weights";
  const wb = new ExcelJS.Workbook();
  const issues: string[] = [];
  try { await wb.xlsx.readFile(path.join(process.cwd(), "reference", "Newtail_Brand_Curation_Matrix.xlsx")); }
  catch (e) { return { sheet: sheetName, criteria: [], totalWeight: 0, ok: false, issues: ["Reference workbook inaccessible: " + (e as Error).message] }; }
  const ws = wb.getWorksheet(sheetName);
  if (!ws) return { sheet: sheetName, criteria: [], totalWeight: 0, ok: false, issues: [`Sheet "${sheetName}" not found. Available: ${wb.worksheets.map(w => w.name).join(", ")}`] };
  const criteria: Criterion[] = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const name = String(row.getCell(1).value ?? "").trim();
    const w = row.getCell(3).value;
    if (!name || name.toUpperCase().startsWith("TOTAL") || typeof w !== "number") return;
    const m = META[name];
    if (!m) { issues.push(`Row ${i}: criterion "${name}" has no mapping to the 15 indicators.`); return; }
    criteria.push({ name, what: String(row.getCell(2).value ?? ""), weight: w, ...m });
  });
  const missing = Object.keys(META).filter(n => !criteria.some(c => c.name === n));
  if (missing.length) issues.push("Indicators missing from reference sheet: " + missing.join(", "));
  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0);
  if (Math.abs(totalWeight - 100) > 1e-6) issues.push(`Weights sum to ${totalWeight}, expected 100.`);
  issues.push("NOTE: reference sheet uses 'Offline distribution whitespace' (higher = less existing presence); the written spec says 'Existing offline footprint'. System follows the sheet. Confirm.");
  issues.push("NOTE: blank/unverified criteria are NOT scored as 0; they are 'Insufficient Data' and add no points.");
  return { sheet: sheetName, criteria, totalWeight, issues, ok: !issues.some(i => !i.startsWith("NOTE")) };
}
