import { proxyApiRequest } from "../../shared/apiProxy";

interface Env {
  BACKEND_ORIGIN?: string;
}

export async function onRequest({ request, env }: { request: Request; env: Env }) {
  return proxyApiRequest(request, env);
}
