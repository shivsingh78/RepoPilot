import { proxy } from "../../../lib/api";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: { code: "VALIDATION_ERROR", message: "bad id" } }, { status: 400 });
  const [runRes, eventsRes] = await Promise.all([proxy(`/api/v1/runs/${id}`), proxy(`/api/v1/runs/${id}/events`)]);
  const run = await runRes.json();
  const events = eventsRes.ok ? await eventsRes.json() : { events: [] };
  return Response.json({ ...run, ...events }, { status: runRes.status });
}
