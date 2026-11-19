import { proxyApiRequest } from "./shared/apiProxy";

interface Env {
  ASSETS: Fetcher;
  BACKEND_ORIGIN?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return proxyApiRequest(request, env);
    }
    return env.ASSETS.fetch(request);
  }
};
