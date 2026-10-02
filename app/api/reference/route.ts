import { loadReference } from "@/lib/reference";
export async function GET() { return Response.json(await loadReference()); }
