import { getJob, jobProgress } from "@/lib/job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Server-Sent Events. Polls the job's event log and replays anything the client missed,
 * so a reconnect after a refresh catches up instead of restarting the run.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return Response.json({ error: "Unknown job" }, { status: 404 });

  const encoder = new TextEncoder();
  let cursor = Number(new URL(req.url).searchParams.get("since") ?? 0);
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { closed = true; }
      };

      send("progress", jobProgress(job));
      send("brand", { evaluations: Object.values(job.evaluations), errors: job.errors });

      const timer = setInterval(() => {
        if (closed) return;
        const fresh = job.events.slice(cursor);
        cursor = job.events.length;
        if (fresh.length) send("events", fresh);
        send("progress", jobProgress(job));
        if (job.finished) {
          send("brand", { evaluations: Object.values(job.evaluations), errors: job.errors });
          clearInterval(timer);
          closed = true;
          controller.close();
        }
      }, 500);

      req.signal.addEventListener("abort", () => {
        clearInterval(timer);
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
