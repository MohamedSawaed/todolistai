import { NextResponse } from "next/server";
import { supabaseEnv } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (supabaseEnv()) {
    const sb = await createSupabaseServerClient();
    await sb.auth.signOut();
  }
  return NextResponse.redirect(new URL("/welcome", request.url), { status: 303 });
}
