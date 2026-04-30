import type { DbClient } from "@agents/db";
import { incrementMemoryRetrievals, matchMemories } from "@agents/db";
import type { MemoryMatch } from "@agents/types";
import type { AgentGraphState, AgentGraphUpdate } from "../state";
import { createMemoryEmbedding } from "../embeddings";

const DEFAULT_MEMORY_MATCH_COUNT = 8;
const MIN_MEMORY_MATCH_COUNT = 5;
const MAX_MEMORY_MATCH_COUNT = 8;
const MEMORY_BLOCK_RE = /\n*\[MEMORIA DEL USUARIO\][\s\S]*?\[\/MEMORIA DEL USUARIO\]\n*/g;

function getMemoryMatchCount(): number {
  const raw = Number(process.env.AGENT_MEMORY_MATCH_COUNT);
  if (!Number.isFinite(raw)) return DEFAULT_MEMORY_MATCH_COUNT;
  return Math.min(Math.max(Math.trunc(raw), MIN_MEMORY_MATCH_COUNT), MAX_MEMORY_MATCH_COUNT);
}

function stripExistingMemoryBlock(systemPrompt: string): string {
  return systemPrompt.replace(MEMORY_BLOCK_RE, "\n").trim();
}

function formatMemoryLine(memory: MemoryMatch): string {
  const content = memory.content.replace(/\s+/g, " ").trim();
  return `- (${memory.type}) ${content}`;
}

function injectMemories(systemPrompt: string, memories: MemoryMatch[]): string {
  const basePrompt = stripExistingMemoryBlock(systemPrompt);
  const memoryBlock = [
    "[MEMORIA DEL USUARIO]",
    ...memories.map(formatMemoryLine),
    "[/MEMORIA DEL USUARIO]",
  ].join("\n");

  return `${basePrompt}\n\n${memoryBlock}`;
}

export function createMemoryInjectionNode(db: DbClient) {
  return async function memoryInjectionNode(
    state: AgentGraphState
  ): Promise<AgentGraphUpdate> {
    const userInput = state.userInput?.trim();
    if (!userInput || !state.userId) return {};

    try {
      const embedding = await createMemoryEmbedding(userInput);
      const memories = await matchMemories(
        db,
        state.userId,
        embedding,
        getMemoryMatchCount()
      );

      if (memories.length === 0) return {};

      await incrementMemoryRetrievals(
        db,
        state.userId,
        memories.map((memory) => memory.id)
      );

      return {
        systemPrompt: injectMemories(state.systemPrompt, memories),
      };
    } catch (error) {
      console.error("Memory injection failed:", error);
      return {};
    }
  };
}
