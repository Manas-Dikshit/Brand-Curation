import ExcelJS from "exceljs";
import rubric from "../config/rubric.json";
import type { Criterion, RefReport } from "./criteria";
import { PILLARS } from "./criteria";
import { qualityChecks, type ImportError } from "./overrides";
import { summarize } from "./scoring";
import type { Evaluation } from "./types";

export const ASSESSMENT_COLUMNS = [
  "Brand Name", "Pillar", "Evaluation Criterion", "Criterion Score (0-5)", "Criterion Weight",
  "Weighted Contribution", "Supporting Evidence / Research Findings", "Source URL",
  "Data Verification Status", "Missing Information / Research Notes", "Total Weighted Score (%)",
  "Assessment Completion Status", "Score Source", "Rule ID",
] as const;

const GREY = "FFF0F0F0";
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };

/**
 * Weighted Contribution and both totals are written as live Excel formulas so the
 * workbook recalculates itself. The code-side equivalent is cross-checked in the
 * Quality Check sheet (qualityChecks -> evaluateWeightedFormula).
 */
export async function buildWorkbook(
  ref: RefReport,
  evaluations: Evaluation[],
  extras: { duplicates?: string[]; importErrors?: ImportError[] } = {},
): Promise<Buffer> {
  const criteria: Criterion[] = ref.criteria;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Newtail Brand Curation (local, keyless)";
  wb.created = new Date();
  // the workbook ships live formulas, so let Excel evaluate them on open
  wb.calcProperties.fullCalcOnLoad = true;

  /* ---------------- Assessment ---------------- */
  const ws = wb.addWorksheet("Assessment");
  ws.columns = ASSESSMENT_COLUMNS.map(h => ({ header: h, width: h.length > 25 ? 48 : h.length > 18 ? 30 : 20 }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = HEADER_FILL;

  let r = 2;
  const firstDataRow = 2;

  for (const ev of evaluations) {
    const s = summarize(criteria, ev.results);
    for (const c of criteria) {
      const x = ev.results.find(y => y.name === c.name);
      const row = ws.getRow(r);
      row.getCell(1).value = ev.brand;
      row.getCell(2).value = c.pillar;
      row.getCell(3).value = c.name;
      row.getCell(4).value = x?.score ?? "Insufficient Data";
      row.getCell(5).value = c.weight;
      row.getCell(6).value = { formula: `IF(ISNUMBER(D${r}),D${r}/5*E${r},0)` } as ExcelJS.CellValue;
      row.getCell(7).value = x?.evidence ?? "";
      row.getCell(8).value = x?.sourceUrl ?? "";
      row.getCell(9).value = x?.verification ?? "Insufficient Data";
      row.getCell(10).value = x?.missing ?? "";
      row.getCell(11).value = { formula: `SUMIFS($F$${firstDataRow}:$F$${firstDataRow + 10000},$A$${firstDataRow}:$A$${firstDataRow + 10000},$A${r})` } as ExcelJS.CellValue;
      row.getCell(12).value = s.status;
      row.getCell(13).value = x?.source ?? "auto";
      row.getCell(14).value = x?.ruleId ?? "";
      if (x && x.sourceUrl) {
        row.getCell(8).value = { text: x.sourceUrl, hyperlink: x.sourceUrl } as ExcelJS.CellValue;
      }
      if (x?.score === null) {
        row.getCell(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY } };
        row.getCell(9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY } };
      }
      if (x?.source === "analyst") {
        row.getCell(13).font = { bold: true, color: { argb: "FF1F6FB2" } };
      }
      r++;
    }
  }

  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ASSESSMENT_COLUMNS.length } };
  ws.addConditionalFormatting({
    ref: `D${firstDataRow}:D${r - 1}`,
    rules: [{ type: "containsText", operator: "containsText", text: "Insufficient Data", priority: 1,
      style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: GREY }, fgColor: { argb: GREY } } } }],
  });
  ws.addConditionalFormatting({
    ref: `I${firstDataRow}:I${r - 1}`,
    rules: [
      { type: "containsText", operator: "containsText", text: "Insufficient Data", priority: 2,
        style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: GREY }, fgColor: { argb: GREY } } } },
      { type: "containsText", operator: "containsText", text: "Verified", priority: 3,
        style: { font: { color: { argb: "FF1B5E20" } } } },
    ],
  });

  /* ---------------- Summary ---------------- */
  const sm = wb.addWorksheet("Summary");
  const smHead = ["Brand Name", "Total Weighted Score (%)", "Assessed Weight (%)", "Assessment Completion Status",
    ...PILLARS.map(p => `${p} subtotal (pts)`), "Analyst Overrides", "Duration (s)", "Error"];
  sm.addRow(smHead).font = { bold: true };
  sm.getRow(1).fill = HEADER_FILL;

  let sr = 2;
  for (const ev of evaluations) {
    const s = summarize(criteria, ev.results);
    const row = sm.getRow(sr);
    row.getCell(1).value = ev.brand;
    row.getCell(2).value = { formula: `SUMIFS(Assessment!$F:$F,Assessment!$A:$A,$A${sr})` } as ExcelJS.CellValue;
    row.getCell(3).value = s.assessedWeight;
    row.getCell(4).value = s.status;
    PILLARS.forEach((p, i) => { row.getCell(5 + i).value = s.pillarSubtotals[p]; });
    row.getCell(5 + PILLARS.length).value = ev.results.filter(x => x.source === "analyst").length;
    row.getCell(6 + PILLARS.length).value = ev.durationMs ? Math.round(ev.durationMs / 100) / 10 : null;
    row.getCell(7 + PILLARS.length).value = ev.error ?? "";
    if (s.status !== "Complete") row.getCell(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY } };
    sr++;
  }
  sm.columns = smHead.map(h => ({ width: h.includes("Status") ? 34 : h.length > 26 ? 32 : 22 }));
  sm.views = [{ state: "frozen", ySplit: 1 }];

  /* ---------------- Rubric ---------------- */
  const rb = wb.addWorksheet("Rubric");
  rb.addRow(["Rubric thresholds used to produce these scores"]).font = { bold: true };
  rb.addRow(["Rubric version", rubric.version]);
  rb.addRow(["Weights source", `"${ref.sheet}" in reference/Newtail_Brand_Curation_Matrix.xlsx`]);
  rb.addRow(["Weights total", ref.totalWeight]);
  rb.addRow(["Score formula", "Score = SUM(score/5 x weight), out of 100"]);
  rb.addRow(["Insufficient Data", "Adds no points. NOT a verified zero. Partial totals are NOT normalised."]);
  rb.addRow([]);
  rb.addRow(["Criterion", "Rule ID", "Weight (%)", "Rubric thresholds used"]).font = { bold: true };

  const ruleJson = rubric as unknown as Record<string, unknown>;
  // rule ids and threshold sections are both R01..R15 in order, so zip by index.
  // (this survives renames like R09_packaging_signals vs R09-packaging-signals)
  const sections = Object.keys(ruleJson).filter(k => /^R\d\d_/.test(k)).sort();
  for (const c of criteria) {
    const body = sections[Number(c.ruleId.slice(1, 3)) - 1];
    rb.addRow([c.name, c.ruleId, c.weight, body ? JSON.stringify(ruleJson[body]) : "see config/rubric.json"]);
  }
  rb.addRow([]);
  rb.addRow(["Rubric is editable in config/rubric.json; this sheet records what was actually used."]).font = { italic: true };
  for (const n of ref.notes) rb.addRow([n]).font = { italic: true };
  rb.columns = [{ width: 34 }, { width: 26 }, { width: 12 }, { width: 100 }];

  /* ---------------- Quality Check ---------------- */
  const qc = wb.addWorksheet("Quality Check");
  qc.addRow(["Check", "Severity", "Detail"]).font = { bold: true };
  qc.getRow(1).fill = HEADER_FILL;
  const blocked = [...new Set(evaluations.flatMap(e => e.blockedPlatforms ?? []))];
  const checks = qualityChecks(evaluations, criteria, {
    duplicates: extras.duplicates ?? [],
    blockedPlatforms: blocked,
    importErrors: extras.importErrors ?? [],
  });
  for (const c of checks) {
    const row = qc.addRow([c.check, c.severity, c.detail]);
    if (c.severity === "error") row.font = { color: { argb: "FFB00020" } };
    else if (c.severity === "warn") row.font = { color: { argb: "FF9A6700" } };
  }
  qc.columns = [{ width: 26 }, { width: 12 }, { width: 120 }];

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
