import { clearStoredToken, getStoredToken } from "./auth";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const API_PREFIX = "/api";

type FetchOptions = RequestInit & {
  auth?: boolean;
};

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({ detail: "Unexpected error" }));
    const message = errorPayload?.detail || errorPayload?.message || response.statusText;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (options.auth !== false && typeof window !== "undefined") {
    const token = getStoredToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${API_BASE}${API_PREFIX}${path}`, {
    ...options,
    headers,
    cache: "no-store",
  });
  if (response.status === 401) {
    clearStoredToken();
    if (typeof window !== "undefined") window.location.href = "/login";
  }
  return parseResponse<T>(response);
}
