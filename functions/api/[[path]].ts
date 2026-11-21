import { handleApi, type Env } from "../../cloudflare/api";

export async function onRequest({ request, env }: { request: Request; env: Env }) {
  return handleApi(request, env);
}
