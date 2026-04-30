const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";
const MEMORY_EMBEDDING_MODEL = "openai/text-embedding-3-small";
const MEMORY_EMBEDDING_DIMENSIONS = 1536;

interface OpenRouterEmbeddingResponse {
  data?: Array<{ embedding?: unknown }>;
}

function getOpenRouterApiKey(): string {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY");
  return apiKey;
}

function assertEmbedding(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length !== MEMORY_EMBEDDING_DIMENSIONS ||
    !value.every((item) => typeof item === "number")
  ) {
    throw new Error(`OpenRouter returned an invalid ${MEMORY_EMBEDDING_DIMENSIONS}-dimension embedding`);
  }
  return value;
}

export async function createMemoryEmbeddings(inputs: string[]): Promise<number[][]> {
  const cleanedInputs = inputs.map((input) => input.trim()).filter(Boolean);
  if (cleanedInputs.length === 0) return [];

  const response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getOpenRouterApiKey()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://agents.local",
    },
    body: JSON.stringify({
      model: MEMORY_EMBEDDING_MODEL,
      input: cleanedInputs,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter embeddings request failed: ${response.status} ${text}`);
  }

  const payload = (await response.json()) as OpenRouterEmbeddingResponse;
  const embeddings = payload.data?.map((item) => assertEmbedding(item.embedding)) ?? [];
  if (embeddings.length !== cleanedInputs.length) {
    throw new Error("OpenRouter returned a different number of embeddings than requested");
  }

  return embeddings;
}

export async function createMemoryEmbedding(input: string): Promise<number[]> {
  const [embedding] = await createMemoryEmbeddings([input]);
  if (!embedding) throw new Error("OpenRouter did not return an embedding");
  return embedding;
}
