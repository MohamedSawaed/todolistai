import "server-only";
import path from "path";
import { connection } from "next/server";
import { LOCAL_USER_ID, storageMode } from "./config";
import { LocalRepository, LocalStore } from "./data/local-repo";
import { SupabaseRepository } from "./data/supabase-repo";
import type { Repository } from "./data/repository";
import { createSupabaseServerClient } from "./supabase/server";

export class UnauthorizedError extends Error {
  constructor() {
    super("Please sign in to continue.");
  }
}

// one store per server process; survives hot reloads in dev
const g = globalThis as unknown as { __tempoLocalStore?: LocalStore };
function localStore(): LocalStore {
  g.__tempoLocalStore ??= new LocalStore(path.join(process.cwd(), ".data", "tempo-local.json"));
  return g.__tempoLocalStore;
}

export interface Session {
  repo: Repository;
  user: { id: string; email: string | null };
  mode: "supabase" | "local";
}

/** Resolve the current user and a repository bound to them. Throws UnauthorizedError. */
export async function requireSession(): Promise<Session> {
  // user data is always per-request — never prerender it at build time
  await connection();
  if (storageMode() === "local") {
    return {
      repo: new LocalRepository(LOCAL_USER_ID, localStore()),
      user: { id: LOCAL_USER_ID, email: null },
      mode: "local",
    };
  }
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) throw new UnauthorizedError();
  return { repo: new SupabaseRepository(data.user.id, sb), user: { id: data.user.id, email: data.user.email ?? null }, mode: "supabase" };
}

export async function getOptionalSession(): Promise<Session | null> {
  try {
    return await requireSession();
  } catch (e) {
    if (e instanceof UnauthorizedError) return null;
    throw e;
  }
}
