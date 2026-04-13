import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createServerClient,
  exchangeNotionAuthorizationCode,
  persistNotionTokens,
  resolveNotionRedirectUri,
} from "@agents/db";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(
      `${origin}/settings?notion=error&reason=${encodeURIComponent(errorParam)}`
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const cookieState = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("notion_oauth_state="))
    ?.split("=")[1];

  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(
      `${origin}/settings?notion=error&reason=state_mismatch`
    );
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/settings?notion=error&reason=no_code`);
  }

  const redirectUri = resolveNotionRedirectUri(request.url);

  let tokens;
  try {
    tokens = await exchangeNotionAuthorizationCode(code, redirectUri);
  } catch (err) {
    console.error("Notion OAuth config error:", err);
    return NextResponse.redirect(
      `${origin}/settings?notion=error&reason=config`
    );
  }

  if (!tokens) {
    return NextResponse.redirect(
      `${origin}/settings?notion=error&reason=token_exchange`
    );
  }

  const db = createServerClient();
  await persistNotionTokens(db, user.id, tokens);

  const response = NextResponse.redirect(`${origin}/settings?notion=connected`);
  response.cookies.delete("notion_oauth_state");
  return response;
}
