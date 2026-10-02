import { loadReference } from "@/lib/reference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await loadReference());
}
