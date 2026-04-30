import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServerClient, touchSession } from "@agents/db";
import { flushSessionMemoriesSafely } from "../memory";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fromSessionId, toSessionId } = await request.json();
  if (!toSessionId || typeof toSessionId !== "string") {
    return NextResponse.json({ error: "Target session required" }, { status: 400 });
  }

  const db = createServerClient();
  const { data: targetSession } = await db
    .from("agent_sessions")
    .select("id")
    .eq("id", toSessionId)
    .eq("user_id", user.id)
    .eq("channel", "web")
    .eq("status", "active")
    .single();

  if (!targetSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (
    fromSessionId &&
    typeof fromSessionId === "string" &&
    fromSessionId !== toSessionId
  ) {
    const { data: sourceSession } = await db
      .from("agent_sessions")
      .select("id")
      .eq("id", fromSessionId)
      .eq("user_id", user.id)
      .eq("channel", "web")
      .eq("status", "active")
      .single();

    if (sourceSession) {
      await flushSessionMemoriesSafely(db, user.id, fromSessionId, "web switch");
    }
  }

  await touchSession(db, toSessionId);
  return NextResponse.json({ ok: true });
}
