import type { DbClient } from "@agents/db";
import { flushSessionMemories } from "@agents/agent";

export async function flushSessionMemoriesSafely(
  db: DbClient,
  userId: string,
  sessionId: string,
  context: string
): Promise<void> {
  try {
    const result = await flushSessionMemories({ db, userId, sessionId });
    console.info(`Memory flush completed during ${context}:`, {
      sessionId,
      extracted: result.extracted,
      inserted: result.inserted,
    });
  } catch (error) {
    console.error(`Memory flush failed during ${context}:`, error);
  }
}
