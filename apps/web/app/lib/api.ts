import { parseEnv, webEnvSchema } from "@repopilot/shared/env";

/** Server-side proxy to the RepoPilot API. Never import from client components. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const env = parseEnv(webEnvSchema);
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (env.API_KEY) headers.set("authorization", `Bearer ${env.API_KEY}`);
  return fetch(`${env.API_BASE_URL}${path}`, { ...init, headers, cache: "no-store" });
}

export async function proxy(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    const upstream = await apiFetch(path, init);
    const body = await upstream.text();
    return new Response(body, { status: upstream.status, headers: { "content-type": "application/json" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: { code: "API_UNREACHABLE", message } }, { status: 502 });
  }
}
