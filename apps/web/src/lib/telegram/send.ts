const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";

export async function sendTelegramMessage(
  chatId: number,
  text: string,
  replyMarkup?: Record<string, unknown>
): Promise<void> {
  if (!BOT_TOKEN) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN not set, skipping notification");
    return;
  }

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
    console.error("[telegram] sendMessage failed:", res.status, body);
  }
}

/**
 * Sends a notification to the Telegram chat associated with userId.
 * Returns { notified: true } if the message was sent, or { notified: false, reason }
 * if the user has no linked Telegram account (silent fallback — does not throw).
 */
export async function notifyUserViaTelegram(
  db: import("@agents/db").DbClient,
  userId: string,
  text: string
): Promise<{ notified: boolean; reason?: string }> {
  const { data: account } = await db
    .from("telegram_accounts")
    .select("chat_id")
    .eq("user_id", userId)
    .single();

  if (!account) {
    return { notified: false, reason: "no_telegram_link" };
  }

  try {
    await sendTelegramMessage(account.chat_id as number, text);
    return { notified: true };
  } catch (err) {
    return { notified: false, reason: String(err) };
  }
}
