import ExcelJS from "exceljs";
export async function POST(req: Request) {
  const f = (await req.formData()).get("file") as File | null;
  if (!f) return Response.json({ error: "No file" }, { status: 400 });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await f.arrayBuffer());
  const ws = wb.worksheets[0]; const seen = new Set<string>(); const brands: string[] = []; const dupes: string[] = [];
  ws.eachRow((row, i) => {
    const v = String(row.getCell(1).value ?? "").trim();
    if (!v || (i === 1 && /^brand/i.test(v))) return;
    const k = v.toLowerCase(); if (seen.has(k)) { dupes.push(v); return; } seen.add(k); brands.push(v);
  });
  return Response.json({ brands, dupes });
}
