import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServerClient, createSession, touchSession } from "@agents/db";
import { ChatInterface } from "./chat-interface";

export default async function ChatPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile?.onboarding_completed) redirect("/onboarding");

  const { data: sessions } = await supabase
    .from("agent_sessions")
    .select("*")
    .eq("user_id", user.id)
    .eq("channel", "web")
    .eq("status", "active")
    .order("updated_at", { ascending: false });

  let allSessions = sessions ?? [];
  if (allSessions.length === 0) {
    const payload = {
      user_id: user.id,
      channel: "web" as const,
      status: "active" as const,
      budget_tokens_used: 0,
      budget_tokens_limit: 100000,
    };
    const { data: fromCookie } = await supabase
      .from("agent_sessions")
      .insert(payload)
      .select()
      .single();

    let bootstrap: (typeof allSessions)[0] | null = fromCookie;
    if (!bootstrap) {
      try {
        const db = createServerClient();
        const created = await createSession(db, user.id, "web");
        await touchSession(db, created.id);
        bootstrap = created as (typeof allSessions)[0];
      } catch {
        // Sin SUPABASE_SERVICE_ROLE_KEY o error de red: el chat cliente crea sesión al enviar.
      }
    }
    if (bootstrap) {
      allSessions = [bootstrap];
    }
  }
  const currentSession = allSessions[0] ?? null;

  let sessionMessages: Array<{ role: string; content: string; created_at: string; structured_payload?: Record<string, unknown> }> = [];
  let initialPendingToolCallId: string | null = null;
  let initialPendingMessage: string | null = null;
  let initialPendingToolName: string | null = null;
  let initialPendingArgs: Record<string, unknown> | null = null;

  if (currentSession) {
    const { data } = await supabase
      .from("agent_messages")
      .select("role, content, created_at, structured_payload")
      .eq("session_id", currentSession.id)
      .not("content", "is", null)
      .neq("content", "")
      .order("created_at", { ascending: true })
      .limit(50);
    sessionMessages = data ?? [];

    // Find the most recent unresolved pending confirmation
    const { data: pendingCalls } = await supabase
      .from("tool_calls")
      .select("*")
      .eq("session_id", currentSession.id)
      .eq("status", "pending_confirmation")
      .order("created_at", { ascending: false })
      .limit(1);

    if (pendingCalls && pendingCalls.length > 0) {
      const pc = pendingCalls[0];
      initialPendingToolCallId = pc.id as string;
      initialPendingToolName = pc.tool_name as string;
      initialPendingArgs = pc.arguments_json as Record<string, unknown>;

      // Find the corresponding agent_message with the confirmation text
      const confirmMsg = [...sessionMessages]
        .reverse()
        .find(
          (m) =>
            m.structured_payload &&
            (m.structured_payload as Record<string, unknown>).type === "pending_confirmation" &&
            (m.structured_payload as Record<string, unknown>).tool_call_id === pc.id
        );
      initialPendingMessage =
        (confirmMsg?.structured_payload as Record<string, unknown> | undefined)?.message as string ??
        confirmMsg?.content ??
        `Se requiere confirmación para "${pc.tool_name}".`;
    }
  }

  const initialPendingConfirmation =
    initialPendingToolCallId
      ? {
          tool_call_id: initialPendingToolCallId,
          tool_name: initialPendingToolName!,
          message: initialPendingMessage!,
          args: initialPendingArgs!,
        }
      : null;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
            {(profile.agent_name as string)?.[0]?.toUpperCase() ?? "A"}
          </div>
          <div>
            <h1 className="text-sm font-semibold">{profile.agent_name as string}</h1>
            <p className="text-xs text-neutral-500">Chat web</p>
          </div>
        </div>
        <div className="flex gap-2">
          <a
            href="/settings"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            Ajustes
          </a>
          <form action="/api/auth/signout" method="POST">
            <button
              type="submit"
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              Salir
            </button>
          </form>
        </div>
      </header>
      <ChatInterface
        agentName={profile.agent_name as string}
        initialMessages={sessionMessages}
        sessions={allSessions}
        currentSessionId={currentSession?.id ?? null}
        initialPendingConfirmation={initialPendingConfirmation}
      />
    </div>
  );
}
