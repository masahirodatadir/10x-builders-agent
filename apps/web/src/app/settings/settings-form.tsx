"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { TOOL_CATALOG } from "@agents/types";

function notionOAuthErrorMessage(reason: string | null): string {
  switch (reason) {
    case "access_denied":
      return "Autorización cancelada en Notion.";
    case "state_mismatch":
      return "La sesión de OAuth no coincide. Vuelve a intentar conectar.";
    case "no_code":
      return "Notion no devolvió un código de autorización. Vuelve a intentar.";
    case "token_exchange":
      return "No se pudo obtener el token de Notion. Comprueba el client secret y la URL de redirección.";
    case "config":
      return "Falta configurar NOTION_CLIENT_ID o NOTION_CLIENT_SECRET en el servidor.";
    default:
      return reason
        ? `No se pudo conectar Notion (${reason}).`
        : "No se pudo conectar Notion.";
  }
}

function githubOAuthErrorMessage(reason: string | null): string {
  switch (reason) {
    case "access_denied":
      return "Autorización cancelada en GitHub.";
    case "state_mismatch":
      return "La sesión de OAuth no coincide. Vuelve a intentar conectar.";
    case "no_code":
      return "GitHub no devolvió un código de autorización. Vuelve a intentar.";
    case "token_exchange":
      return "No se pudo obtener el token de GitHub. Comprueba el client secret y vuelve a intentar.";
    default:
      return reason
        ? `No se pudo conectar GitHub (${reason}).`
        : "No se pudo conectar GitHub.";
  }
}

interface Props {
  userId: string;
  profile: Record<string, unknown> | null;
  toolSettings: Array<{ tool_id: string; enabled: boolean }>;
  telegramLinked: boolean;
  githubConnected: boolean;
  notionConnected: boolean;
}

export function SettingsForm({
  userId,
  profile,
  toolSettings,
  telegramLinked,
  githubConnected,
  notionConnected,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [githubStatus, setGithubStatus] = useState<"connected" | "disconnected">(
    githubConnected ? "connected" : "disconnected"
  );
  const [disconnectingGithub, setDisconnectingGithub] = useState(false);
  const [disconnectingNotion, setDisconnectingNotion] = useState(false);
  const [githubOAuthNotice, setGithubOAuthNotice] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [notionOAuthNotice, setNotionOAuthNotice] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [notionStatus, setNotionStatus] = useState<"connected" | "disconnected">(
    notionConnected ? "connected" : "disconnected"
  );

  const [name, setName] = useState((profile?.name as string) ?? "");
  const [agentName, setAgentName] = useState((profile?.agent_name as string) ?? "Agente");
  const [systemPrompt, setSystemPrompt] = useState(
    (profile?.agent_system_prompt as string) ?? ""
  );
  const [enabledTools, setEnabledTools] = useState<string[]>(
    toolSettings.filter((t) => t.enabled).map((t) => t.tool_id)
  );
  const [linkCode, setLinkCode] = useState<string | null>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    const gh = searchParams.get("github");
    const reason = searchParams.get("reason");
    if (gh === "connected") {
      setGithubOAuthNotice({ type: "success", text: "GitHub conectado correctamente." });
      setGithubStatus("connected");
      router.replace("/settings", { scroll: false });
      return;
    }
    if (gh === "error") {
      setGithubOAuthNotice({ type: "error", text: githubOAuthErrorMessage(reason) });
      router.replace("/settings", { scroll: false });
    }
  }, [searchParams, router]);

  useEffect(() => {
    const n = searchParams.get("notion");
    const reason = searchParams.get("reason");
    if (n === "connected") {
      setNotionOAuthNotice({ type: "success", text: "Notion conectado correctamente." });
      setNotionStatus("connected");
      router.replace("/settings", { scroll: false });
      return;
    }
    if (n === "error") {
      setNotionOAuthNotice({ type: "error", text: notionOAuthErrorMessage(reason) });
      router.replace("/settings", { scroll: false });
    }
  }, [searchParams, router]);

  useEffect(() => {
    setGithubStatus(githubConnected ? "connected" : "disconnected");
  }, [githubConnected]);

  useEffect(() => {
    setNotionStatus(notionConnected ? "connected" : "disconnected");
  }, [notionConnected]);

  function toggleTool(id: string) {
    setEnabledTools((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }

  async function handleSave() {
    setSaving(true);

    await supabase.from("profiles").update({
      name,
      agent_name: agentName,
      agent_system_prompt: systemPrompt.slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("id", userId);

    for (const toolId of TOOL_CATALOG.map((t) => t.id)) {
      await supabase.from("user_tool_settings").upsert(
        {
          user_id: userId,
          tool_id: toolId,
          enabled: enabledTools.includes(toolId),
          config_json: {},
        },
        { onConflict: "user_id,tool_id" }
      );
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    router.refresh();
  }

  async function handleDisconnectGithub() {
    setDisconnectingGithub(true);
    try {
      const res = await fetch("/api/integrations/github/disconnect", { method: "POST" });
      if (res.ok) {
        setGithubStatus("disconnected");
        router.refresh();
      }
    } finally {
      setDisconnectingGithub(false);
    }
  }

  async function handleDisconnectNotion() {
    setDisconnectingNotion(true);
    try {
      const res = await fetch("/api/integrations/notion/disconnect", { method: "POST" });
      if (res.ok) {
        setNotionStatus("disconnected");
        router.refresh();
      }
    } finally {
      setDisconnectingNotion(false);
    }
  }

  async function generateTelegramCode() {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    await supabase.from("telegram_link_codes").insert({
      user_id: userId,
      code,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    setLinkCode(code);
  }

  return (
    <div className="space-y-8">
      {/* Profile */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold">Perfil</h2>
        <div>
          <label className="block text-sm font-medium mb-1">Nombre</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>
      </section>

      {/* Agent */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold">Agente</h2>
        <div>
          <label className="block text-sm font-medium mb-1">Nombre del agente</label>
          <input
            type="text"
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            maxLength={50}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Instrucciones</label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value.slice(0, 500))}
            rows={4}
            maxLength={500}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <p className="text-xs text-neutral-400 text-right mt-1">{systemPrompt.length}/500</p>
        </div>
      </section>

      {/* Tools */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold">Herramientas</h2>
        <div className="space-y-2">
          {TOOL_CATALOG.map(({ id, displayName, displayDescription }) => (
            <label key={id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabledTools.includes(id)}
                onChange={() => toggleTool(id)}
                className="rounded border-neutral-300"
              />
              <span>
                <span className="font-medium">{displayName}</span>
                <span className="ml-1 text-neutral-500">— {displayDescription}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      {/* GitHub */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold">GitHub</h2>
        {githubOAuthNotice && (
          <div
            className={`flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm ${
              githubOAuthNotice.type === "success"
                ? "border-green-200 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-100"
                : "border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
            }`}
          >
            <span>{githubOAuthNotice.text}</span>
            <button
              type="button"
              onClick={() => setGithubOAuthNotice(null)}
              className="shrink-0 rounded px-1.5 text-xs font-medium opacity-70 hover:opacity-100"
              aria-label="Cerrar"
            >
              ×
            </button>
          </div>
        )}
        {githubStatus === "connected" ? (
          <div className="flex items-center justify-between rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              <span className="text-sm font-medium text-green-700 dark:text-green-400">Conectado</span>
            </div>
            <button
              onClick={handleDisconnectGithub}
              disabled={disconnectingGithub}
              className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              {disconnectingGithub ? "Desconectando..." : "Desconectar"}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-neutral-500">
              Conecta tu cuenta de GitHub para que el agente pueda trabajar con tus repositorios e issues.
            </p>
            <a
              href="/api/integrations/github"
              className="inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Conectar GitHub
            </a>
          </div>
        )}
      </section>

      {/* Notion */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold">Notion</h2>
        {notionOAuthNotice && (
          <div
            className={`flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm ${
              notionOAuthNotice.type === "success"
                ? "border-green-200 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-100"
                : "border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
            }`}
          >
            <span>{notionOAuthNotice.text}</span>
            <button
              type="button"
              onClick={() => setNotionOAuthNotice(null)}
              className="shrink-0 rounded px-1.5 text-xs font-medium opacity-70 hover:opacity-100"
              aria-label="Cerrar"
            >
              ×
            </button>
          </div>
        )}
        {notionStatus === "connected" ? (
          <div className="flex items-center justify-between rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              <span className="text-sm font-medium text-green-700 dark:text-green-400">Conectado</span>
            </div>
            <button
              onClick={handleDisconnectNotion}
              disabled={disconnectingNotion}
              className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              {disconnectingNotion ? "Desconectando..." : "Desconectar"}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-neutral-500">
              Conecta Notion para que el agente busque y lea páginas que <strong>tú compartas</strong> con la
              integración durante la autorización (o desde &quot;Conexiones&quot; en cada página en Notion).
            </p>
            <a
              href="/api/integrations/notion"
              className="inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Conectar Notion
            </a>
          </div>
        )}
      </section>

      {/* Telegram */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold">Telegram</h2>
        {telegramLinked ? (
          <p className="text-sm text-green-600">Cuenta de Telegram vinculada.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-neutral-500">
              Vincula tu cuenta de Telegram para usar el agente desde allí.
            </p>
            {linkCode ? (
              <div className="rounded-md bg-neutral-50 p-4 dark:bg-neutral-900">
                <p className="text-sm">
                  Envía este código al bot en Telegram:{" "}
                  <code className="rounded bg-blue-100 px-2 py-0.5 text-sm font-mono font-bold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                    /link {linkCode}
                  </code>
                </p>
                <p className="text-xs text-neutral-400 mt-1">Expira en 10 minutos.</p>
              </div>
            ) : (
              <button
                onClick={generateTelegramCode}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
              >
                Generar código de vinculación
              </button>
            )}
          </div>
        )}
      </section>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Guardando..." : "Guardar cambios"}
        </button>
        {saved && (
          <span className="text-sm text-green-600">Guardado correctamente.</span>
        )}
      </div>
    </div>
  );
}
