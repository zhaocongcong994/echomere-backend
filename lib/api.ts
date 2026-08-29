// 使用 ?? 而非 ||，让生产环境可以显式设置为空字符串，从而使用相对路径。
// 使用 || 会把空字符串误判为 falsy，回退到 localhost:3001，导致部署后登录请求失败。
const rawBase =
  (typeof process !== "undefined"
    ? process.env?.NEXT_PUBLIC_API_BASE_URL
    : undefined) ?? "";
const API_BASE = rawBase === "" ? "" : rawBase.replace(/\/$/, "");

export function getApiBase() {
  return API_BASE;
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("echomere-token");
}

export function setAuthToken(token: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem("echomere-token", token);
}

export function clearAuthToken() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("echomere-token");
}

export async function apiFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // 后端 API 统一在 /api 命名空间下；调用处仍可使用旧路径，自动补上前缀。
  const apiPath = path.startsWith("/api/") ? path : `/api${path}`;
  const url = `${getApiBase()}${apiPath}`;
  return fetch(url, { ...init, headers });
}
