import { ensureReference } from "@/lib/engine";
import { applyOverrides, getJob } from "@/lib/job";
import { ANALYSIS_COLUMNS, parseEvidenceWorkbook, type ImportError } from "@/lib/overrides";
import type { CriterionResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ref = await ensureReference();
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const jobId = String(form.get("jobId") ?? "");

  if (!file) return Response.json({ error: "No file" }, { status: 400 });
  if (!/\.xlsx$/i.test(file.name)) return Response.json({ error: "Upload an .xlsx file" }, { status: 400 });

  let parsed: { overrides: Map<string, CriterionResult[]>; errors: ImportError[]; imported: number };
  try {
    parsed = await parseEvidenceWorkbook(await file.arrayBuffer(), ref.criteria.map(c => c.name));
  } catch (e) {
    return Response.json({ error: "Could not read evidence.xlsx: " + (e as Error).message }, { status: 400 });
  }

  const overrides: Record<string, CriterionResult[]> = Object.fromEntries(parsed.overrides);
  if (jobId) {
    const job = getJob(jobId);
    if (!job) return Response.json({ error: "Unknown jobId " + jobId }, { status: 404 });
    applyOverrides(job, ref, overrides);
  }

  return Response.json({
    imported: parsed.imported,
    errors: parsed.errors,
    overrides,
    expectedColumns: ANALYSIS_COLUMNS,
    unknownBrands: Object.keys(overrides).filter(b => jobId && !(b in (getJob(jobId)?.brands ?? {}))),
    appliedToJob: Boolean(jobId),
  });
}
