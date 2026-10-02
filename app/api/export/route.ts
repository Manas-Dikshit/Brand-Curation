import { loadReference } from "@/lib/reference";
import { summarize, enforceEvidenceRule } from "@/lib/scoring";
import { buildWorkbook } from "@/lib/export";
import type { ImportError } from "@/lib/overrides";
import type { Evaluation } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const ref = await loadReference();
  if (!ref.ok) return Response.json({ error: "Reference validation failed", issues: ref.issues }, { status: 422 });

  const body = await req.json().catch(() => null) as
    | { evaluations?: Evaluation[]; duplicates?: string[]; importErrors?: ImportError[] }
    | null;
  const evaluations = body?.evaluations ?? [];
  if (!Array.isArray(evaluations) || !evaluations.length) {
    return Response.json({ error: "No evaluations supplied" }, { status: 400 });
  }

  // re-gate and re-total server-side: a client-supplied score without a source URL
  // can never reach the workbook, and a client total can never be trusted.
  const normalised = evaluations.map(e => ({
    ...e,
    ...summarize(ref.criteria, enforceEvidenceRule(e.results ?? [])),
  }));
  const buf = await buildWorkbook(ref, normalised, {
    duplicates: body?.duplicates ?? [],
    importErrors: body?.importErrors ?? [],
  });

  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": "attachment; filename=brand_curation_output.xlsx",
      "cache-control": "no-store",
    },
  });
}
