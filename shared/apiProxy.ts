interface ProxyEnv {
  BACKEND_ORIGIN?: string;
}

const unavailable = (detail: string) =>
  new Response(JSON.stringify({ detail }), {
    status: 502,
    headers: { "content-type": "application/json" }
  });

export async function proxyApiRequest(request: Request, env: ProxyEnv): Promise<Response> {
  const configured = env.BACKEND_ORIGIN?.trim();
  if (!configured) {
    return unavailable("LocalVision API is unavailable. Configure BACKEND_ORIGIN in Cloudflare.");
  }

  let origin: URL;
  try {
    origin = new URL(configured);
  } catch {
    return unavailable("LocalVision API is unavailable. BACKEND_ORIGIN must be a full HTTPS URL.");
  }

  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, origin);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("cf-connecting-ip");
  headers.delete("cf-ray");

  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : request.body;

  let response: Response;
  try {
    response = await fetch(target.toString(), {
      method,
      headers,
      body,
      redirect: "manual"
    });
  } catch {
    return unavailable("LocalVision API is unreachable. Check the FastAPI backend and BACKEND_ORIGIN.");
  }

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders
  });
}
