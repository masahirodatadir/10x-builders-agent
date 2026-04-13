import type { DbClient } from "./client";
import { decrypt, encrypt } from "./crypto";
import { upsertIntegration } from "./queries/integrations";

export const NOTION_API_VERSION = "2026-03-11";

/** OAuth callback URL; use NOTION_REDIRECT_URI when origin is wrong behind proxies. */
export function resolveNotionRedirectUri(requestUrl: string): string {
  const envUri = process.env.NOTION_REDIRECT_URI?.trim();
  if (envUri) return envUri;
  const { origin } = new URL(requestUrl);
  return `${origin}/api/integrations/notion/callback`;
}

export interface NotionStoredTokens {
  access_token: string;
  refresh_token: string;
  workspace_name?: string;
  bot_id?: string;
}

const refreshInFlight = new Map<string, Promise<NotionStoredTokens | null>>();

function notionBasicAuthHeader(): string {
  const id = process.env.NOTION_CLIENT_ID;
  const secret = process.env.NOTION_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("NOTION_CLIENT_ID and NOTION_CLIENT_SECRET must be set");
  }
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

/** POST /v1/oauth/token — authorization_code grant (callback) */
export async function exchangeNotionAuthorizationCode(
  code: string,
  redirectUri: string
): Promise<NotionStoredTokens | null> {
  const res = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: notionBasicAuthHeader(),
      "Content-Type": "application/json",
      "Notion-Version": NOTION_API_VERSION,
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    console.error("Notion code exchange failed:", data);
    return null;
  }

  const access = data.access_token as string | undefined;
  const refresh = data.refresh_token as string | undefined;
  if (!access || !refresh) return null;

  return {
    access_token: access,
    refresh_token: refresh,
    workspace_name: data.workspace_name as string | undefined,
    bot_id: data.bot_id as string | undefined,
  };
}

/** POST /v1/oauth/token — refresh grant */
export async function exchangeNotionRefreshToken(
  refreshToken: string
): Promise<NotionStoredTokens | null> {
  const res = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: notionBasicAuthHeader(),
      "Content-Type": "application/json",
      "Notion-Version": NOTION_API_VERSION,
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    console.error("Notion token refresh failed:", data);
    return null;
  }

  const access = data.access_token as string | undefined;
  const refresh = (data.refresh_token as string | null) ?? refreshToken;
  if (!access) return null;

  return {
    access_token: access,
    refresh_token: refresh,
    workspace_name: data.workspace_name as string | undefined,
    bot_id: data.bot_id as string | undefined,
  };
}

export async function persistNotionTokens(
  db: DbClient,
  userId: string,
  tokens: NotionStoredTokens
): Promise<void> {
  const payload = JSON.stringify(tokens);
  const encrypted = encrypt(payload);
  await upsertIntegration(db, userId, "notion", ["read_content"], encrypted);
}

/**
 * Single-flight refresh per user: concurrent callers await the same refresh.
 */
export async function refreshAndPersistNotionTokens(
  db: DbClient,
  userId: string,
  refreshToken: string
): Promise<NotionStoredTokens | null> {
  const existing = refreshInFlight.get(userId);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const fresh = await exchangeNotionRefreshToken(refreshToken);
    if (!fresh) return null;
    await persistNotionTokens(db, userId, fresh);
    return fresh;
  })();

  refreshInFlight.set(userId, promise);
  try {
    return await promise;
  } finally {
    refreshInFlight.delete(userId);
  }
}

export async function loadNotionTokenBundle(
  db: DbClient,
  userId: string
): Promise<NotionStoredTokens | null> {
  const { data, error } = await db
    .from("user_integrations")
    .select("encrypted_tokens, status")
    .eq("user_id", userId)
    .eq("provider", "notion")
    .eq("status", "active")
    .maybeSingle();

  if (error || !data?.encrypted_tokens) return null;

  try {
    const raw = decrypt(data.encrypted_tokens as string);
    const parsed = JSON.parse(raw) as NotionStoredTokens;
    if (!parsed.access_token || !parsed.refresh_token) return null;
    return parsed;
  } catch {
    return null;
  }
}
