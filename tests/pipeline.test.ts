import { afterEach, beforeAll, expect, test, vi } from "vitest";
import ExcelJS from "exceljs";
import { demoFetch } from "@/lib/demo";

/**
 * Offline end-to-end: global.fetch is served from the shared demo fixtures, so no
 * network is touched. Covers the full path upload -> collect -> rules -> Excel.
 */
function stubFetch() {
  vi.stubGlobal("fetch", demoFetch);
}

beforeAll(() => { process.env.PER_DOMAIN_GAP_MS = "0"; process.env.FETCH_TIMEOUT_MS = "2000"; });
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

test("offline run produces a workbook with 15 scored criteria and a formula cross-check", async () => {
  stubFetch();
  const { evaluateBrand } = await import("@/lib/engine");
  const { loadReference } = await import("@/lib/reference");
  const { buildWorkbook, ASSESSMENT_COLUMNS } = await import("@/lib/export");

  const ref = await loadReference();
  expect(ref.ok, ref.issues.join("; ")).toBe(true);

  const ev = await evaluateBrand({ brand: "Demo Skincare", website: "https://demo.example" }, ref.criteria);
  expect(ev.results).toHaveLength(15);

  // every score is evidence-backed or withheld
  for (const r of ev.results) {
    if (r.score !== null) expect(r.sourceUrl, `${r.name} scored with no URL`).toMatch(/^https?:\/\//);
    if (r.score !== null) expect(r.ruleId, `${r.name} scored with no rule id`).toBeTruthy();
    if (r.score === null) expect(r.verification).toBe("Insufficient Data");
  }

  // the demo brand is priced inside the target range, so price fit must be non-null
  const price = ev.results.find(r => r.name === "Product price fit")!;
  expect(price.score).not.toBeNull();
  expect(price.score!).toBeGreaterThanOrEqual(4);

  // social is not faked: no fixture profile markup, so it must be Insufficient Data
  expect(ev.results.find(r => r.name === "Social media presence")!.score).toBeNull();

  const buf = await buildWorkbook(ref, [ev], { duplicates: [] });
  const wb = new ExcelJS.Workbook();
  // exceljs bundles its own @types/node Buffer; bridge the two identical types.
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  expect(wb.worksheets.map(w => w.name)).toEqual(["Assessment", "Summary", "Rubric", "Quality Check"]);

  const ws = wb.getWorksheet("Assessment")!;
  expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual([...ASSESSMENT_COLUMNS]);
  expect(ws.rowCount).toBe(16); // header + 15 criteria
  expect((ws.getCell("F2").value as any).formula).toMatch(/^IF\(ISNUMBER/);
  expect((ws.getCell("K2").value as any).formula).toMatch(/^SUMIFS/);
  expect(ws.getCell("N2").value).toMatch(/^R\d{2}-/);

  // the code-side total must equal what the sheet formula will compute
  const expected = ref.criteria.reduce((s, c) => {
    const r = ev.results.find(x => x.name === c.name)!;
    return s + (r.score === null ? 0 : (r.score / 5) * c.weight);
  }, 0);
  expect(ev.totalPct).toBeCloseTo(Math.round(expected * 10) / 10, 5);

  const qc = wb.getWorksheet("Quality Check")!;
  const qcText = qc.getSheetValues().flat().filter(Boolean).join(" | ");
  expect(qcText).not.toMatch(/Formula mismatch/);
  expect(qcText).toMatch(/Insufficient data/);
});
