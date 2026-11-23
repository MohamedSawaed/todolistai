"use client";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: Record<string, unknown>,
  ) {
    super(message);
  }
  get code(): string | undefined {
    return this.body.code as string | undefined;
  }
  get fields(): Record<string, string> {
    return (this.body.fields as Record<string, string>) ?? {};
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch {
    throw new ApiError(0, "You appear to be offline. Nothing was saved.", { code: "network" });
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") window.location.assign(new URL("/welcome", window.location.origin));
    throw new ApiError(res.status, (data.error as string) || `Request failed (${res.status})`, data);
  }
  return data as T;
}
