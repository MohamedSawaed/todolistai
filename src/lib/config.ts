/** Runtime configuration. Only NEXT_PUBLIC_* values are ever exposed to the browser. */

export function supabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

export type StorageMode = "supabase" | "local";

export function storageMode(): StorageMode {
  return supabaseEnv() ? "supabase" : "local";
}

/** True when the server can call the Claude API (key or other SDK credential configured). */
export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
}

export const AI_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
export const AI_EFFORT = (process.env.ANTHROPIC_EFFORT as "low" | "medium" | "high" | undefined) || "medium";

export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001";
