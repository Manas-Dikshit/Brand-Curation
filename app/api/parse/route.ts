import { parseBrandWorkbook } from "@/lib/overrides";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const f = (await req.formData()).get("file") as File | null;
  if (!f) return Response.json({ error: "No file" }, { status: 400 });
  if (!/\.xlsx$/i.test(f.name)) return Response.json({ error: "Upload an .xlsx file" }, { status: 400 });
  try {
    const { brands, duplicates, empty } = await parseBrandWorkbook(await f.arrayBuffer());
    return Response.json({ brands, duplicates, empty });
  } catch (e) {
    return Response.json({ error: "Could not read the workbook: " + (e as Error).message }, { status: 400 });
  }
}
