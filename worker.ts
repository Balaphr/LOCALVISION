import { handleApi, type Env } from "./cloudflare/api";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/") || pathname === "/health" || pathname === "/ready") {
      return handleApi(request, env);
    }
    return env.ASSETS!.fetch(request);
  }
};
