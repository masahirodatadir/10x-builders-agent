"use client";

import { useState, useRef, useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";

interface PendingConfirmation {
  tool_call_id: string;
  tool_name: string;
  message: string;
  args: Record<string, unknown>;
}

interface Message {
  role: string;
  content: string;
  created_at?: string;
  confirmation?: PendingConfirmation;
  confirmationStatus?: "pending" | "approved" | "rejected";
}

interface SessionItem {
  id: string;
  created_at: string;
  last_used_at: string;
  status: string;
}

interface Props {
  agentName: string;
  initialMessages: Message[];
  sessions: SessionItem[];
  currentSessionId: string | null;
}

function formatSessionDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ChatInterface({ agentName, initialMessages, sessions, currentSessionId }: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(currentSessionId);
  const [sessionList, setSessionList] = useState<SessionItem[]>(sessions);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSwitchSession(sessionId: string) {
    if (sessionId === activeSessionId) return;
    const { data } = await supabase
      .from("agent_messages")
      .select("role, content, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(50);
    setMessages(data ?? []);
    setActiveSessionId(sessionId);
  }

  async function handleNewSession() {
    const res = await fetch("/api/sessions", { method: "POST" });
    const { session } = await res.json();
    if (session) {
      setSessionList((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
      setMessages([]);
    }
  }

  async function handleClearSession() {
    if (!activeSessionId) return;
    await fetch(`/api/sessions/${activeSessionId}/clear`, { method: "POST" });
    setMessages([]);
  }

  async function handleConfirm(index: number, action: "approve" | "reject") {
    const msg = messages[index];
    if (!msg.confirmation) return;

    setMessages((prev) =>
      prev.map((m, i) =>
        i === index ? { ...m, confirmationStatus: action === "approve" ? "approved" : "rejected" } : m
      )
    );

    try {
      const res = await fetch("/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolCallId: msg.confirmation.tool_call_id,
          action,
        }),
      });
      const data = await res.json();

      if (action === "approve" && data.result) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: formatToolResult(msg.confirmation!.tool_name, data.result),
          },
        ]);
      } else if (action === "reject") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Accion cancelada." },
        ]);
      } else if (data.message) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.message },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error al procesar la confirmacion." },
      ]);
    }
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

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId: activeSessionId }),
      });

      const data = await res.json();

      if (data.response) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.response },
        ]);
      }

      if (data.pendingConfirmation) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.pendingConfirmation.message,
            confirmation: data.pendingConfirmation,
            confirmationStatus: "pending",
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error al procesar tu mensaje. Intenta de nuevo." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const isReadOnly = !activeSessionId;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? "w-64" : "w-0"
        } flex-shrink-0 overflow-hidden border-r border-neutral-200 transition-all dark:border-neutral-800`}
      >
        <div className="flex h-full w-64 flex-col">
          <div className="p-3">
            <button
              onClick={handleNewSession}
              className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              + Nueva sesion
            </button>
          </div>
          <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
            {sessionList.map((s) => (
              <button
                key={s.id}
                onClick={() => handleSwitchSession(s.id)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                  s.id === activeSessionId
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                    : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:bg-neutral-900"
                }`}
              >
                <div className="truncate font-medium text-xs">
                  {formatSessionDate(s.created_at)}
                </div>
              </button>
            ))}
            {sessionList.length === 0 && (
              <p className="px-3 py-4 text-xs text-neutral-400">
                No hay sesiones. Crea una nueva.
              </p>
            )}
          </nav>
        </div>
      </aside>

      {/* Chat area */}
      <div className="flex flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title="Sesiones"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span className="flex-1 truncate text-xs text-neutral-500">
            {activeSessionId ? "Sesion activa" : "Sin sesion"}
          </span>
          {activeSessionId && (
            <button
              onClick={handleClearSession}
              className="rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-900/20"
            >
              Limpiar
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-2xl space-y-4">
            {messages.length === 0 && (
              <div className="text-center text-sm text-neutral-400 py-20">
                <p className="text-lg font-medium text-neutral-600 dark:text-neutral-300">
                  {agentName ? `Hola! Soy ${agentName}` : "Hola!"}
                </p>
                <p className="mt-1">Escribe un mensaje para comenzar.</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {msg.confirmation && msg.confirmationStatus === "pending" && (
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => handleConfirm(i, "approve")}
                        className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
                      >
                        Aprobar
                      </button>
                      <button
                        onClick={() => handleConfirm(i, "reject")}
                        className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                  {msg.confirmation && msg.confirmationStatus === "approved" && (
                    <p className="mt-2 text-xs font-medium text-green-700 dark:text-green-400">Aprobado</p>
                  )}
                  {msg.confirmation && msg.confirmationStatus === "rejected" && (
                    <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">Cancelado</p>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-lg bg-neutral-100 px-4 py-2.5 text-sm dark:bg-neutral-800">
                  <span className="animate-pulse">Pensando...</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <form
            onSubmit={handleSend}
            className="mx-auto flex max-w-2xl gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe tu mensaje..."
              disabled={loading || isReadOnly}
              className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button
              type="submit"
              disabled={loading || !input.trim() || isReadOnly}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Enviar
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
