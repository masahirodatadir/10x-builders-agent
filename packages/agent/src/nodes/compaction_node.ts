import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { getEncoding } from "js-tiktoken";
import { replaceMessages, type AgentGraphState, type AgentGraphUpdate } from "../state";

const TOOL_RESULTS_TO_KEEP = 5;
const RECENT_MESSAGES_TO_KEEP = 20;
const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
const COMPACTION_THRESHOLD = 0.1;
const MAX_COMPACTION_FAILURES = 3;
const CLEARED_TOOL_RESULT = "[tool result cleared]";
const HAIKU_MODEL = "anthropic/claude-3.5-haiku";
const DEFAULT_LOG_FILE = "compaction.log";
const LOG_PREVIEW_CHARS = 500;

const encoding = getEncoding("cl100k_base");

const COMPACTION_SYSTEM_PROMPT = `Eres un compactador mecánico de historial para un agente.
Tu tarea es convertir el historial antiguo en un resumen estructurado que preserve contexto crítico.
No inventes hechos. No resuelvas la tarea del usuario. No omitas decisiones, archivos, herramientas ni restricciones importantes.

Devuelve exactamente estas 9 secciones:
1. Objetivo actual
2. Estado del trabajo
3. Decisiones y restricciones
4. Archivos y módulos relevantes
5. Cambios ya realizados
6. Herramientas ejecutadas y resultados importantes
7. Errores, bloqueos y riesgos
8. Preferencias del usuario y contexto estable
9. Próximos pasos sugeridos`;

function getContextWindowTokens(): number {
  const configured = Number(process.env.AGENT_CONTEXT_WINDOW_TOKENS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_CONTEXT_WINDOW_TOKENS;
}

function messageContentToString(content: BaseMessage["content"]): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}

function truncateForLog(value: string, maxChars = LOG_PREVIEW_CHARS): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
}

function getMessageType(message: BaseMessage): string {
  return typeof message._getType === "function" ? message._getType() : message.constructor.name;
}

function serializeMessage(message: BaseMessage): string {
  const payload: Record<string, unknown> = {
    type: getMessageType(message),
    content: messageContentToString(message.content),
  };

  if (message instanceof AIMessage && message.tool_calls?.length) {
    payload.tool_calls = message.tool_calls.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.name,
      args: toolCall.args,
    }));
  }

  if (message instanceof ToolMessage) {
    payload.tool_call_id = message.tool_call_id;
  }

  return JSON.stringify(payload);
}

function serializeMessages(messages: BaseMessage[]): string {
  return messages.map((message, index) => `${index + 1}. ${serializeMessage(message)}`).join("\n");
}

function estimateTokens(messages: BaseMessage[], systemPrompt: string): number {
  return encoding.encode(`${systemPrompt}\n${serializeMessages(messages)}`).length;
}

interface RedactedToolResult {
  index: number;
  toolCallId?: string;
  beforeChars: number;
  beforePreview: string;
  after: typeof CLEARED_TOOL_RESULT;
}

function snapshotMessages(messages: BaseMessage[]) {
  return messages.map((message, index) => {
    const content = messageContentToString(message.content);
    return {
      index,
      type: getMessageType(message),
      chars: content.length,
      preview: truncateForLog(content),
      ...(message instanceof ToolMessage ? { toolCallId: message.tool_call_id } : {}),
      ...(message instanceof AIMessage && message.tool_calls?.length
        ? {
            toolCalls: message.tool_calls.map((toolCall) => ({
              id: toolCall.id,
              name: toolCall.name,
            })),
          }
        : {}),
    };
  });
}

async function writeCompactionLog(
  event: string,
  state: AgentGraphState,
  details: Record<string, unknown>
): Promise<void> {
  const logPath = process.env.AGENT_COMPACTION_LOG_PATH || DEFAULT_LOG_FILE;
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    sessionId: state.sessionId,
    userId: state.userId,
    ...details,
  };

  try {
    await mkdir(path.dirname(logPath), { recursive: true });
    await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Observability must never block the graph.
  }
}

function microcompactToolResults(messages: BaseMessage[]): {
  messages: BaseMessage[];
  changed: boolean;
  redactedToolResults: RedactedToolResult[];
} {
  const toolIndexes = messages
    .map((message, index) => (message instanceof ToolMessage ? index : -1))
    .filter((index) => index >= 0);
  const keepIndexes = new Set(toolIndexes.slice(-TOOL_RESULTS_TO_KEEP));
  let changed = false;
  const redactedToolResults: RedactedToolResult[] = [];

  const compacted = messages.map((message, index) => {
    if (!(message instanceof ToolMessage) || keepIndexes.has(index)) {
      return message;
    }

    if (messageContentToString(message.content) === CLEARED_TOOL_RESULT) {
      return message;
    }

    changed = true;
    const before = messageContentToString(message.content);
    redactedToolResults.push({
      index,
      toolCallId: message.tool_call_id,
      beforeChars: before.length,
      beforePreview: truncateForLog(before),
      after: CLEARED_TOOL_RESULT,
    });
    return new ToolMessage({
      content: CLEARED_TOOL_RESULT,
      tool_call_id: message.tool_call_id,
    });
  });

  return { messages: compacted, changed, redactedToolResults };
}

function findSafeRecentStart(messages: BaseMessage[]): number {
  let start = Math.max(0, messages.length - RECENT_MESSAGES_TO_KEEP);

  while (start > 0 && messages[start] instanceof ToolMessage) {
    start -= 1;
  }

  if (start > 0) {
    const previous = messages[start - 1];
    if (previous instanceof AIMessage && previous.tool_calls?.length) {
      start -= 1;
    }
  }

  while (start > 0 && messages[start] instanceof ToolMessage) {
    start -= 1;
  }

  return start;
}

function stripAnalysisBlocks(content: string): string {
  return content.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "").trim();
}

function createCompactionModel(): ChatOpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY");

  return new ChatOpenAI({
    modelName: HAIKU_MODEL,
    temperature: 0,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://agents.local",
      },
    },
    apiKey,
  });
}

async function summarizeMessages(messages: BaseMessage[]): Promise<string> {
  const response = await createCompactionModel().invoke([
    new SystemMessage(COMPACTION_SYSTEM_PROMPT),
    new HumanMessage(serializeMessages(messages)),
  ]);
  const summary = stripAnalysisBlocks(messageContentToString(response.content));

  if (!summary) {
    throw new Error("Compaction model returned an empty summary");
  }

  return summary;
}

export async function compactionNode(state: AgentGraphState): Promise<AgentGraphUpdate> {
  const {
    messages: microcompacted,
    changed,
    redactedToolResults,
  } = microcompactToolResults(state.messages);
  const threshold = getContextWindowTokens() * COMPACTION_THRESHOLD;
  const tokenEstimate = estimateTokens(microcompacted, state.systemPrompt);

  if (changed) {
    await writeCompactionLog("microcompact_tool_results", state, {
      redactedToolResults,
      beforeMessageCount: state.messages.length,
      afterMessageCount: microcompacted.length,
      before: snapshotMessages(state.messages),
      after: snapshotMessages(microcompacted),
    });
  }

  if (tokenEstimate <= threshold) {
    return changed ? { messages: replaceMessages(microcompacted) } : {};
  }

  if (state.compactionCount >= MAX_COMPACTION_FAILURES) {
    await writeCompactionLog("llm_compaction_circuit_open", state, {
      compactionCount: state.compactionCount,
      maxFailures: MAX_COMPACTION_FAILURES,
      tokenEstimate,
      threshold,
      messageCount: microcompacted.length,
    });
    return changed ? { messages: replaceMessages(microcompacted) } : {};
  }

  const recentStart = findSafeRecentStart(microcompacted);
  const messagesToSummarize = microcompacted.slice(0, recentStart);
  const recentMessages = microcompacted.slice(recentStart);

  if (messagesToSummarize.length === 0) {
    return changed ? { messages: replaceMessages(microcompacted) } : {};
  }

  await writeCompactionLog("llm_compaction_requested", state, {
    model: HAIKU_MODEL,
    tokenEstimate,
    threshold,
    messagesToSummarize: messagesToSummarize.length,
    recentMessagesKept: recentMessages.length,
    before: snapshotMessages(microcompacted),
  });

  try {
    const summary = await summarizeMessages(messagesToSummarize);
    const compactedMessages = [
      new SystemMessage(`Resumen compactado del historial anterior:\n\n${summary}`),
      ...recentMessages,
    ];
    await writeCompactionLog("llm_compaction_succeeded", state, {
      model: HAIKU_MODEL,
      summaryChars: summary.length,
      summaryPreview: truncateForLog(summary),
      beforeMessageCount: microcompacted.length,
      afterMessageCount: compactedMessages.length,
      after: snapshotMessages(compactedMessages),
    });

    return {
      messages: replaceMessages(compactedMessages),
      compactionCount: 0,
    };
  } catch (error) {
    await writeCompactionLog("llm_compaction_failed", state, {
      model: HAIKU_MODEL,
      compactionCountBefore: state.compactionCount,
      compactionCountAfter: state.compactionCount + 1,
      error: String(error),
    });

    return {
      ...(changed ? { messages: replaceMessages(microcompacted) } : {}),
      compactionCount: state.compactionCount + 1,
    };
  }
}
