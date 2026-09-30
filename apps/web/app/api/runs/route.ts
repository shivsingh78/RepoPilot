import { proxy } from "../../lib/api";

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  return proxy("/api/v1/runs", { method: "POST", body });
}

export async function GET(): Promise<Response> {
  return proxy("/api/v1/runs?limit=20");
}
