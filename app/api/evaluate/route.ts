import { loadReference } from "@/lib/reference";
import { researchBrand } from "@/lib/research";
import { summarize } from "@/lib/scoring";
export const maxDuration = 300;
export async function POST(req: Request) {
  const { brand } = await req.json();
  const ref = await loadReference();
  if (!ref.ok) return Response.json({ error: "Reference validation failed", issues: ref.issues }, { status: 422 });
  const results = await researchBrand(brand, ref.criteria);
  return Response.json({ brand, results, ...summarize(ref.criteria, results) });
}
