import { CallbackHandler } from "@langfuse/langchain";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { setLangfuseTracerProvider } from "@langfuse/tracing";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { randomUUID } from "node:crypto";

let tracingInitialized = false;
let tracerProvider: NodeTracerProvider | undefined;

interface CreateLangfuseCallbackHandlerInput {
  userId: string;
  sessionId: string;
  tags?: string[];
  traceMetadata?: Record<string, unknown>;
}

interface RecordLangfuseTraceInput {
  name: string;
  userId: string;
  sessionId: string;
  input?: unknown;
  output?: unknown;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

function isLangfuseConfigured(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

function initializeLangfuseTracing(): void {
  if (tracingInitialized || !isLangfuseConfigured()) return;

  const provider = new NodeTracerProvider({
    spanProcessors: [
      new LangfuseSpanProcessor({
        exportMode: "immediate",
      }),
    ],
  });

  // Keep Langfuse tracing isolated from other OpenTelemetry users such as Sentry.
  setLangfuseTracerProvider(provider);
  tracerProvider = provider;
  tracingInitialized = true;
}

export function createLangfuseCallbackHandler({
  userId,
  sessionId,
  tags = [],
  traceMetadata,
}: CreateLangfuseCallbackHandlerInput): CallbackHandler | undefined {
  if (!isLangfuseConfigured()) return undefined;

  initializeLangfuseTracing();

  return new CallbackHandler({
    userId,
    sessionId,
    tags: ["agent", ...tags],
    traceMetadata,
  });
}

export async function flushLangfuseTracing(): Promise<void> {
  if (!tracerProvider) return;

  try {
    await tracerProvider.forceFlush();
  } catch (error) {
    console.warn("Failed to flush Langfuse traces:", error);
  }
}

export async function recordLangfuseTrace({
  name,
  userId,
  sessionId,
  input,
  output,
  tags = [],
  metadata,
}: RecordLangfuseTraceInput): Promise<void> {
  if (!isLangfuseConfigured()) return;

  const baseUrl = process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com";
  const auth = Buffer.from(
    `${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`,
    "utf8"
  ).toString("base64");
  const timestamp = new Date().toISOString();
  const traceId = randomUUID();

  try {
    const response = await fetch(`${baseUrl}/api/public/ingestion`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        batch: [
          {
            type: "trace-create",
            id: randomUUID(),
            timestamp,
            body: {
              id: traceId,
              timestamp,
              name,
              userId,
              sessionId,
              input,
              output,
              tags: ["agent", "legacy-ingestion", ...tags],
              metadata,
            },
          },
        ],
      }),
    });

    if (!response.ok) {
      console.warn("Failed to record Langfuse trace:", response.status, await response.text());
    }
  } catch (error) {
    console.warn("Failed to record Langfuse trace:", error);
  }
}
