import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServerClient, touchSession } from "@agents/db";
import { flushSessionMemoriesSafely } from "./memory";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: sessions } = await supabase
    .from("agent_sessions")
    .select("*")
    .eq("user_id", user.id)
    .eq("channel", "web")
    .eq("status", "active")
    .order("updated_at", { ascending: false });

  return NextResponse.json({ sessions: sessions ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServerClient();
  const body = await request.json().catch(() => ({}));
  const fromSessionId = body?.fromSessionId;

  if (fromSessionId && typeof fromSessionId === "string") {
    const { data: sourceSession } = await db
      .from("agent_sessions")
      .select("id")
      .eq("id", fromSessionId)
      .eq("user_id", user.id)
      .eq("channel", "web")
      .eq("status", "active")
      .single();

    if (sourceSession) {
      await flushSessionMemoriesSafely(db, user.id, fromSessionId, "web new session");
    }
  }

  const { data: session, error } = await db
    .from("agent_sessions")
    .insert({
      user_id: user.id,
      channel: "web",
      status: "active",
      budget_tokens_used: 0,
      budget_tokens_limit: 100000,
    })
    .select()
    .single();

  if (error || !session) {
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }

  await touchSession(db, session.id);
  return NextResponse.json({ session });
}
