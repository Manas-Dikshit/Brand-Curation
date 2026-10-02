import { evaluateBrand } from "@/lib/engine";
import { loadReference } from "@/lib/reference";
import { summarize } from "@/lib/scoring";
import { DEMO_BRANDS, withDemoFetch } from "@/lib/demo";
import type { Evaluation } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Fully offline review run: fixtures stand in for the network, real rules run. */
export async function GET() {
  const ref = await loadReference();
  if (!ref.ok) return Response.json({ error: "Reference validation failed", issues: ref.issues }, { status: 422 });

  const evaluations: Evaluation[] = await withDemoFetch(async () => {
    const out: Evaluation[] = [];
    for (const input of DEMO_BRANDS) {
      const ev = await evaluateBrand(input, ref.criteria);
      out.push({ ...ev, ...summarize(ref.criteria, ev.results) });
    }
    return out;
  });

  return Response.json({ demo: true, brands: DEMO_BRANDS, evaluations }, { headers: { "cache-control": "no-store" } });
}