const REMOTE_BACKEND_ORIGIN = "http://81.70.23.109.sslip.io:8080";
const BACKEND_ORIGIN = (
  process.env.ECHOMERE_BACKEND_ORIGIN ||
  (process.env.NODE_ENV === "production"
    ? REMOTE_BACKEND_ORIGIN
    : "http://127.0.0.1:3001")
).replace(/\/$/, "");

const BACKEND_HOST =
  process.env.ECHOMERE_BACKEND_HOST ||
  (BACKEND_ORIGIN === REMOTE_BACKEND_ORIGIN ? "81.70.23.109" : null);

type RouteParams = { params: Promise<{ path: string[] }> };

async function proxy(request: Request, { params }: RouteParams) {
  const { path } = await params;
  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(`/api/${path.map(encodeURIComponent).join("/")}`, BACKEND_ORIGIN);
  targetUrl.search = incomingUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("accept-encoding");
  if (BACKEND_HOST) headers.set("host", BACKEND_HOST);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: "manual",
  });

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.set("cache-control", "no-store");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
