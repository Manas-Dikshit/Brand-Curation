import { ensureReference } from "@/lib/engine";
import { createJob, jobProgress, runJob, type BrandState } from "@/lib/job";
import { normalizeBrands } from "@/lib/overrides";
import type { CriterionResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Enqueues brands and starts the pool in the background; progress comes from SSE. */
export async function POST(req: Request) {
  const ref = await ensureReference().catch(e => null);
  if (!ref) return Response.json({ error: "Reference validation failed" }, { status: 422 });

  const body = await req.json().catch(() => null) as
    | { brands?: unknown; overrides?: Record<string, CriterionResult[]> }
    | null;
  const brands = normalizeBrands(body?.brands);
  if (!brands.length) return Response.json({ error: "No brands supplied" }, { status: 400 });
  if (brands.length > 500) return Response.json({ error: "Cap is 500 brands per run" }, { status: 400 });

  const overrides = body?.overrides && typeof body.overrides === "object" ? body.overrides : {};
  const job = createJob(brands, overrides);
  // fire and forget: the client follows /api/jobs/<id>/stream
  runJob(job, ref, ["queued"]).catch(e => {
    job.errors["*"] = (e as Error).message;
    job.finished = true;
  });
  return Response.json({ jobId: job.id, ...jobProgress(job) }, { status: 202 });
}

export async function GET() {
  return Response.json({ error: "POST {brands:[{brand,website?,instagram?}]}" }, { status: 405 });
}

export type { BrandState };
