import type { DbClient } from "../client";
import type { Memory, MemoryMatch, MemoryType } from "@agents/types";

export interface MemoryInsert {
  user_id: string;
  type: MemoryType;
  content: string;
  embedding: number[];
}

export async function insertMemories(
  db: DbClient,
  memories: MemoryInsert[]
): Promise<Memory[]> {
  if (memories.length === 0) return [];

  const { data, error } = await db
    .from("memories")
    .upsert(memories, { onConflict: "user_id,type,content", ignoreDuplicates: true })
    .select("id,user_id,type,content,retrieval_count,created_at,last_retrieved_at");

  if (error) throw error;
  return (data ?? []) as Memory[];
}

export async function matchMemories(
  db: DbClient,
  userId: string,
  queryEmbedding: number[],
  matchCount = 8
): Promise<MemoryMatch[]> {
  const { data, error } = await db.rpc("match_memories", {
    query_embedding: queryEmbedding,
    match_user_id: userId,
    match_count: matchCount,
  });

  if (error) throw error;
  return (data ?? []) as MemoryMatch[];
}

export async function incrementMemoryRetrievals(
  db: DbClient,
  userId: string,
  memoryIds: string[]
): Promise<void> {
  if (memoryIds.length === 0) return;

  const { error } = await db.rpc("increment_memory_retrievals", {
    memory_ids: memoryIds,
    retrieved_user_id: userId,
  });

  if (error) throw error;
}
