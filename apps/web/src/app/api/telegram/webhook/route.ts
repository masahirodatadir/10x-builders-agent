import { NextResponse } from "next/server";
import {
  createServerClient,
  decrypt,
  getPendingToolCall,
  updateToolCallStatus,
} from "@agents/db";
import { runAgent, executeGitHubTool } from "@agents/agent";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string };
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message: { chat: { id: number }; message_id: number };
    data: string;
  };
}

async function sendTelegramMessage(
  chatId: number,
  text: string,
  replyMarkup?: Record<string, unknown>
) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("Telegram sendMessage failed:", res.status, body);
  }
}

function parseBotCommand(messageText: string): { command: string; args: string } {
  const trimmed = messageText.trim();
  const i = trimmed.indexOf(" ");
  const head = i === -1 ? trimmed : trimmed.slice(0, i);
  const tail = i === -1 ? "" : trimmed.slice(i + 1).trim();
  const at = head.indexOf("@");
  const command = (at === -1 ? head : head.slice(0, at)).toLowerCase();
  return { command, args: tail };
}

async function answerCallbackQuery(callbackQueryId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

async function resolveGitHubToken(db: ReturnType<typeof createServerClient>, userId: string): Promise<string | undefined> {
  const { data: integration } = await db
    .from("user_integrations")
    .select("encrypted_tokens")
    .eq("user_id", userId)
    .eq("provider", "github")
    .eq("status", "active")
    .single();

  if (!integration?.encrypted_tokens) return undefined;
  try {
    return decrypt(integration.encrypted_tokens);
  } catch (err) {
    console.error("Failed to decrypt GitHub token:", err);
    return undefined;
  }
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update: TelegramUpdate = await request.json();
  const db = createServerClient();

  if (update.callback_query) {
    const cb = update.callback_query;
    const [action, toolCallId] = cb.data.split(":");

    if (action === "approve" && toolCallId) {
      const toolCall = await getPendingToolCall(db, toolCallId);
      if (!toolCall) {
        await answerCallbackQuery(cb.id, "Ya fue procesado");
        return NextResponse.json({ ok: true });
      }

      await updateToolCallStatus(db, toolCallId, "approved");
      await answerCallbackQuery(cb.id, "Aprobado");
      await sendTelegramMessage(cb.message.chat.id, "Acción aprobada. Ejecutando...");

      if (toolCall.tool_name.startsWith("github_")) {
        const { data: session } = await db
          .from("agent_sessions")
          .select("user_id")
          .eq("id", toolCall.session_id)
          .single();

        if (session) {
          const token = await resolveGitHubToken(db, session.user_id);
          if (token) {
            try {
              const result = await executeGitHubTool(
                toolCall.tool_name,
                toolCall.arguments_json,
                token
              );
              await updateToolCallStatus(db, toolCallId, "executed", result);
              const summary = formatToolResult(toolCall.tool_name, result);
              await sendTelegramMessage(cb.message.chat.id, summary);
            } catch (err) {
              await updateToolCallStatus(db, toolCallId, "failed", { error: String(err) });
              await sendTelegramMessage(cb.message.chat.id, `Error: ${String(err)}`);
            }
          } else {
            await updateToolCallStatus(db, toolCallId, "failed", { error: "GitHub not connected" });
            await sendTelegramMessage(cb.message.chat.id, "GitHub no está conectado.");
          }
        }
      }
    } else if (action === "reject" && toolCallId) {
      await db
        .from("tool_calls")
        .update({ status: "rejected" })
        .eq("id", toolCallId)
        .eq("status", "pending_confirmation");
      await answerCallbackQuery(cb.id, "Rechazado");
      await sendTelegramMessage(cb.message.chat.id, "Acción cancelada.");
    }

    return NextResponse.json({ ok: true });
  }

  const message = update.message;
  if (!message?.text) {
    return NextResponse.json({ ok: true });
  }

  const telegramUserId = message.from.id;
  const chatId = message.chat.id;
  const text = message.text.trim();
  const { command, args } = parseBotCommand(text);

  if (command === "/start") {
    await sendTelegramMessage(
      chatId,
      "¡Hola! Soy tu agente personal.\n\nComandos disponibles:\n/link <codigo> - Vincular tu cuenta web\n/sessions - Ver tus sesiones\n/new - Crear nueva sesion\n/switch <numero> - Cambiar de sesion\n/clear - Limpiar la sesion actual"
    );
    return NextResponse.json({ ok: true });
  }

  if (command === "/link") {
    const code = args.trim().toUpperCase();
    if (!code) {
      await sendTelegramMessage(
        chatId,
        "Indica el código que generaste en la web, por ejemplo:\n/link ABC123"
      );
      return NextResponse.json({ ok: true });
    }

    const { data: linkRecord } = await db
      .from("telegram_link_codes")
      .select("*")
      .eq("code", code)
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (!linkRecord) {
      await sendTelegramMessage(chatId, "Código inválido o expirado. Genera uno nuevo desde la web.");
      return NextResponse.json({ ok: true });
    }

    await db.from("telegram_accounts").upsert(
      {
        user_id: linkRecord.user_id,
        telegram_user_id: telegramUserId,
        chat_id: chatId,
        linked_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    await db
      .from("telegram_link_codes")
      .update({ used: true })
      .eq("id", linkRecord.id);

    await sendTelegramMessage(chatId, "¡Cuenta vinculada correctamente! Ya puedes chatear conmigo.");
    return NextResponse.json({ ok: true });
  }

  const { data: telegramAccount } = await db
    .from("telegram_accounts")
    .select("*")
    .eq("telegram_user_id", telegramUserId)
    .single();

  if (!telegramAccount) {
    await sendTelegramMessage(
      chatId,
      "No tienes una cuenta vinculada. Usa /link TU_CODIGO (código desde Ajustes en la web)."
    );
    return NextResponse.json({ ok: true });
  }

  const userId = telegramAccount.user_id;

  // --- Session management commands ---

  if (command === "/sessions") {
    const { data: userSessions } = await db
      .from("agent_sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("channel", "telegram")
      .eq("status", "active")
      .order("last_used_at", { ascending: false });

    if (!userSessions || userSessions.length === 0) {
      await sendTelegramMessage(chatId, "No tienes sesiones. Usa /new para crear una.");
      return NextResponse.json({ ok: true });
    }

    const lines = userSessions.map((s: Record<string, unknown>, i: number) => {
      const date = new Date(s.created_at as string).toLocaleDateString("es");
      const marker = i === 0 ? " (actual)" : "";
      return `${i + 1}. ${date}${marker}`;
    });

    await sendTelegramMessage(
      chatId,
      `Tus sesiones:\n${lines.join("\n")}\n\nUsa /switch <numero> para cambiar.`
    );
    return NextResponse.json({ ok: true });
  }

  if (command === "/new") {
    const { data: newSession } = await db
      .from("agent_sessions")
      .insert({
        user_id: userId,
        channel: "telegram",
        status: "active",
        budget_tokens_used: 0,
        budget_tokens_limit: 100000,
        last_used_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (!newSession) {
      await sendTelegramMessage(chatId, "Error creando sesion.");
      return NextResponse.json({ ok: true });
    }

    await sendTelegramMessage(chatId, "Nueva sesion creada. Ya puedes chatear.");
    return NextResponse.json({ ok: true });
  }

  if (command === "/switch") {
    const num = parseInt(args, 10);
    if (isNaN(num) || num < 1) {
      await sendTelegramMessage(chatId, "Indica un numero valido. Ejemplo: /switch 2");
      return NextResponse.json({ ok: true });
    }

    const { data: userSessions } = await db
      .from("agent_sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("channel", "telegram")
      .eq("status", "active")
      .order("last_used_at", { ascending: false });

    if (!userSessions || num > userSessions.length) {
      await sendTelegramMessage(chatId, `No existe la sesion ${num}. Usa /sessions para ver la lista.`);
      return NextResponse.json({ ok: true });
    }

    const target = userSessions[num - 1];
    await db
      .from("agent_sessions")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", target.id);

    await sendTelegramMessage(chatId, `Cambiado a sesion ${num}.`);
    return NextResponse.json({ ok: true });
  }

  if (command === "/clear") {
    const { data: currentSession } = await db
      .from("agent_sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("channel", "telegram")
      .eq("status", "active")
      .order("last_used_at", { ascending: false })
      .limit(1)
      .single();

    if (!currentSession) {
      await sendTelegramMessage(chatId, "No tienes una sesion activa. Usa /new para crear una.");
      return NextResponse.json({ ok: true });
    }

    await db.from("agent_messages").delete().eq("session_id", currentSession.id);
    await db.from("tool_calls").delete().eq("session_id", currentSession.id);

    await sendTelegramMessage(chatId, "Sesion limpiada. El agente no recuerda mensajes anteriores.");
    return NextResponse.json({ ok: true });
  }

  // --- End session management commands ---

  let session = await db
    .from("agent_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("channel", "telegram")
    .eq("status", "active")
    .order("last_used_at", { ascending: false })
    .limit(1)
    .single()
    .then((r) => r.data);

  if (!session) {
    const { data } = await db
      .from("agent_sessions")
      .insert({
        user_id: userId,
        channel: "telegram",
        status: "active",
        budget_tokens_used: 0,
        budget_tokens_limit: 100000,
        last_used_at: new Date().toISOString(),
      })
      .select()
      .single();
    session = data;
  }

  if (!session) {
    await sendTelegramMessage(chatId, "Error interno creando sesion.");
    return NextResponse.json({ ok: true });
  }

  // Touch session to mark as current
  await db
    .from("agent_sessions")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", session.id);

  const { data: profile } = await db
    .from("profiles")
    .select("agent_system_prompt")
    .eq("id", userId)
    .single();

  const { data: toolSettings } = await db
    .from("user_tool_settings")
    .select("*")
    .eq("user_id", userId);

  const { data: integrations } = await db
    .from("user_integrations")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active");

  const githubToken = await resolveGitHubToken(db, userId);

  try {
    const result = await runAgent({
      message: text,
      userId,
      sessionId: session.id,
      systemPrompt: profile?.agent_system_prompt ?? "Eres un asistente útil.",
      db,
      enabledTools: (toolSettings ?? []).map((t: Record<string, unknown>) => ({
        id: t.id as string,
        user_id: t.user_id as string,
        tool_id: t.tool_id as string,
        enabled: t.enabled as boolean,
        config_json: (t.config_json as Record<string, unknown>) ?? {},
      })),
      integrations: (integrations ?? []).map((i: Record<string, unknown>) => ({
        id: i.id as string,
        user_id: i.user_id as string,
        provider: i.provider as string,
        scopes: (i.scopes as string[]) ?? [],
        status: i.status as "active" | "revoked" | "expired",
        created_at: i.created_at as string,
      })),
      githubToken,
    });

    if (result.pendingConfirmation) {
      await sendTelegramMessage(chatId, result.pendingConfirmation.message, {
        inline_keyboard: [
          [
            { text: "Aprobar", callback_data: `approve:${result.pendingConfirmation.tool_call_id}` },
            { text: "Cancelar", callback_data: `reject:${result.pendingConfirmation.tool_call_id}` },
          ],
        ],
      });
    } else {
      await sendTelegramMessage(chatId, result.response);
    }
  } catch (error) {
    console.error("Telegram agent error:", error);
    await sendTelegramMessage(chatId, "Hubo un error procesando tu mensaje. Intenta de nuevo.");
  }

  return NextResponse.json({ ok: true });
}

function formatToolResult(toolName: string, result: Record<string, unknown>): string {
  if (toolName === "github_create_issue") {
    return `Issue creado: ${result.issue_url}`;
  }
  if (toolName === "github_create_repo") {
    return `Repositorio creado: ${result.html_url}`;
  }
  return JSON.stringify(result, null, 2);
}
