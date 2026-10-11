import { ensureReference } from "@/lib/engine";
import { applyOverrides, getJob, jobProgress, runJob, type BrandState } from "@/lib/job";
import type { CriterionResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return Response.json({ error: "Unknown job" }, { status: 404 });
  return Response.json({
    jobId: job.id,
    ...jobProgress(job),
    // inputs ride along so a reload can rebuild the brand list without a re-upload
    inputs: job.inputs,
    evaluations: Object.values(job.evaluations),
    errors: job.errors,
  });
}

/** {action:"resume"|"retry-failed"|"override", states?:[], overrides?:{brand: results[]}} */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return Response.json({ error: "Unknown job" }, { status: 404 });
  const body = await req.json().catch(() => ({}) as any);

  const ref = await ensureReference().catch(() => null);
  if (!ref) return Response.json({ error: "Reference validation failed" }, { status: 422 });

  if (body.action === "override") {
    const overrides = body.overrides && typeof body.overrides === "object" ? body.overrides : {};
    applyOverrides(job, ref, overrides as Record<string, CriterionResult[]>);
    return Response.json({ jobId: job.id, ...jobProgress(job), applied: true });
  }

  const states: BrandState[] = body.action === "retry-failed"
    ? ["failed"]
    : Array.isArray(body.states) ? body.states : ["queued", "failed"];
  runJob(job, ref, states).catch(e => { job.errors["*"] = (e as Error).message; });
  return Response.json({ jobId: job.id, ...jobProgress(job), started: states }, { status: 202 });
}
