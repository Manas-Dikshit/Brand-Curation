import ExcelJS from "exceljs";
import { loadReference } from "@/lib/reference";
import { summarize } from "@/lib/scoring";
export async function POST(req: Request) {
  const { evaluations } = await req.json() as { evaluations: { brand: string; results: any[] }[] };
  const ref = await loadReference();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Assessment");
  ws.columns = ["Brand Name","Pillar","Evaluation Criterion","Criterion Score (0–5)","Criterion Weight (%)","Weighted Contribution","Supporting Evidence / Research Findings","Source URL","Data Verification Status","Missing Information / Research Notes","Total Weighted Score (%)","Assessment Completion Status"].map(h => ({ header: h, width: h.length > 25 ? 45 : 22 }));
  ws.getRow(1).font = { bold: true };
  let r = 2;
  for (const ev of evaluations) {
    const s = summarize(ref.criteria, ev.results);
    for (const c of ref.criteria) {
      const x = ev.results.find(y => y.name === c.name);
      const row = ws.getRow(r);
      row.getCell(1).value = ev.brand; row.getCell(2).value = c.pillar; row.getCell(3).value = c.name;
      row.getCell(4).value = x?.score ?? "Insufficient Data";
      row.getCell(5).value = c.weight;
      row.getCell(6).value = { formula: `IF(ISNUMBER(D${r}),D${r}/5*E${r},"")` } as any;
      row.getCell(7).value = x?.evidence ?? ""; row.getCell(8).value = x?.sourceUrl ?? "";
      row.getCell(9).value = x?.verification ?? "Insufficient Data"; row.getCell(10).value = x?.missing ?? "";
      row.getCell(11).value = { formula: `SUMIFS($F:$F,$A:$A,A${r})` } as any;
      row.getCell(12).value = s.status;
      r++;
    }
  }
  ws.views = [{ state: "frozen", ySplit: 1 }]; ws.autoFilter = { from: "A1", to: "L1" };
  const sm = wb.addWorksheet("Summary");
  sm.addRow(["Brand Name","Total Weighted Score (%)","Assessed Weight (%)","Assessment Completion Status"]).font = { bold: true };
  evaluations.forEach((ev, i) => { const n = i + 2;
    sm.addRow([ev.brand, { formula: `SUMIFS(Assessment!$F:$F,Assessment!$A:$A,A${n})` }, { formula: `SUMIFS(Assessment!$E:$E,Assessment!$A:$A,A${n},Assessment!$D:$D,">=0")` }, summarize(ref.criteria, ev.results).status]); });
  sm.columns = [{ width: 28 }, { width: 26 }, { width: 22 }, { width: 36 }];
  const n = sm.rowCount + 2;
  sm.getCell(`A${n}`).value = `Weights source: "${ref.sheet}" in Newtail_Brand_Curation_Matrix.xlsx (total ${ref.totalWeight}). Score = Σ(score/5 × weight), out of 100. Insufficient Data adds no points and is not a verified zero; only 'Complete' totals are comparable.`;
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=brand_curation_output.xlsx" } });
}
