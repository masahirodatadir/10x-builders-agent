import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServerClient } from "@agents/db";
import { flushSessionMemoriesSafely } from "../../memory";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServerClient();
  const { data: session } = await db
    .from("agent_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .single();

  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await flushSessionMemoriesSafely(db, user.id, sessionId, "web close");

  const { error } = await db
    .from("agent_sessions")
    .update({ status: "closed", updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: "Failed to close session" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
