import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { insertMemories, type DbClient } from "@agents/db";
import type { AgentMessage, MemoryType } from "@agents/types";
import { z } from "zod";
import { createMemoryEmbeddings } from "./embeddings";
import { createLangfuseCallbackHandler, flushLangfuseTracing } from "./langfuse";

const HAIKU_MODEL = "anthropic/claude-3.5-haiku";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const MAX_EXTRACTED_MEMORIES = 12;
const MESSAGE_BATCH_SIZE = 1000;
const MIN_HISTORY_CHARS = 80;

const MEMORY_EXTRACTION_PROMPT = `Eres un extractor conservador de memoria a largo plazo para un agente personal.

Extrae SOLO recuerdos que probablemente seguiran siendo verdaderos y utiles en la proxima sesion.

Tipos permitidos:
- episodic: hechos sobre que ocurrio o que se hizo en esta sesion, con contexto temporal util.
- semantic: preferencias, datos estables del usuario o conocimiento durable.
- procedural: rutinas, formas de operar, convenciones o procesos que el usuario quiere mantener.

Reglas estrictas:
- Devuelve [] si no hay nada durable o relevante.
- No extraigas relleno conversacional, saludos, agradecimientos ni detalles triviales.
- No inventes. Cada recuerdo debe estar sustentado por el historial.
- No guardes secretos, tokens, credenciales, claves API ni informacion altamente sensible.
- Escribe recuerdos breves, autonomos y utiles sin referencias ambiguas como "esto" o "lo anterior".
- Devuelve maximo ${MAX_EXTRACTED_MEMORIES} recuerdos.

Formato de salida obligatorio: JSON valido sin markdown, exactamente un arreglo de objetos:
[{"type":"semantic","content":"..."}]`;

const extractedMemorySchema = z.object({
  type: z.enum(["episodic", "semantic", "procedural"]),
  content: z.string().trim().min(12).max(2000),
});

const extractedMemoriesSchema = z.array(extractedMemorySchema).max(MAX_EXTRACTED_MEMORIES);

export interface FlushSessionMemoriesInput {
  db: DbClient;
  userId: string;
  sessionId: string;
}

export interface FlushSessionMemoriesResult {
  extracted: number;
  inserted: number;
}

function createMemoryExtractionModel(): ChatOpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY");

  return new ChatOpenAI({
    modelName: HAIKU_MODEL,
    temperature: 0,
    configuration: {
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: {
        "HTTP-Referer": "https://agents.local",
      },
    },
    apiKey,
  });
}

async function loadSessionMessages(
  db: DbClient,
  sessionId: string
): Promise<AgentMessage[]> {
  const messages: AgentMessage[] = [];

  for (let from = 0; ; from += MESSAGE_BATCH_SIZE) {
    const to = from + MESSAGE_BATCH_SIZE - 1;
    const { data, error } = await db
      .from("agent_messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .range(from, to);

    if (error) throw error;
    const batch = (data ?? []) as AgentMessage[];
    messages.push(...batch);
    if (batch.length < MESSAGE_BATCH_SIZE) break;
  }

  return messages;
}

function serializeMessages(messages: AgentMessage[]): string {
  return messages
    .filter((message) => message.content.trim().length > 0)
    .map((message, index) => {
      const createdAt = new Date(message.created_at).toISOString();
      return `${index + 1}. [${createdAt}] ${message.role}: ${message.content}`;
    })
    .join("\n");
}

function messageContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (
          item &&
          typeof item === "object" &&
          "text" in item &&
          typeof item.text === "string"
        ) {
          return item.text;
        }
        return JSON.stringify(item);
      })
      .join("\n");
  }
  return JSON.stringify(content);
}

function parseExtractionJson(content: string): Array<{ type: MemoryType; content: string }> {
  const cleaned = content
    .replace(/<analysis>[\s\S]*?<\/analysis>/gi, "")
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];

  try {
    const json = cleaned.slice(start, end + 1);
    const parsed = JSON.parse(json) as unknown;
    return extractedMemoriesSchema.parse(parsed);
  } catch {
    return [];
  }
}

function normalizeExtractedMemories(
  memories: Array<{ type: MemoryType; content: string }>
): Array<{ type: MemoryType; content: string }> {
  const seen = new Set<string>();
  const normalized: Array<{ type: MemoryType; content: string }> = [];

  for (const memory of memories) {
    const content = memory.content.replace(/\s+/g, " ").trim();
    const key = `${memory.type}:${content.toLocaleLowerCase()}`;
    if (!content || seen.has(key)) continue;
    seen.add(key);
    normalized.push({ type: memory.type, content });
  }

  return normalized;
}

export async function flushSessionMemories({
  db,
  userId,
  sessionId,
}: FlushSessionMemoriesInput): Promise<FlushSessionMemoriesResult> {
  const sessionMessages = await loadSessionMessages(db, sessionId);
  const serializedHistory = serializeMessages(sessionMessages);
  if (serializedHistory.length < MIN_HISTORY_CHARS) {
    return { extracted: 0, inserted: 0 };
  }

  const langfuseHandler = createLangfuseCallbackHandler({
    userId,
    sessionId,
    tags: ["memory-flush"],
    traceMetadata: {
      operation: "memory_flush",
    },
  });

  const response = await createMemoryExtractionModel().invoke(
    [
      new SystemMessage(MEMORY_EXTRACTION_PROMPT),
      new HumanMessage(serializedHistory),
    ],
    langfuseHandler
      ? {
          callbacks: [langfuseHandler],
          runName: "memory_extraction",
        }
      : undefined
  );
  await flushLangfuseTracing();

  const extracted = normalizeExtractedMemories(
    parseExtractionJson(messageContentToString(response.content))
  );
  if (extracted.length === 0) return { extracted: 0, inserted: 0 };

  const embeddings = await createMemoryEmbeddings(extracted.map((memory) => memory.content));
  const inserted = await insertMemories(
    db,
    extracted.map((memory, index) => ({
      user_id: userId,
      type: memory.type,
      content: memory.content,
      embedding: embeddings[index],
    }))
  );

  return { extracted: extracted.length, inserted: inserted.length };
}
