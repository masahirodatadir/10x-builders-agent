import { Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";

export interface ReplaceMessagesUpdate {
  replaceMessages: BaseMessage[];
}

export type MessagesUpdate = BaseMessage[] | ReplaceMessagesUpdate;

export function replaceMessages(messages: BaseMessage[]): ReplaceMessagesUpdate {
  return { replaceMessages: messages };
}

function isReplaceMessagesUpdate(update: MessagesUpdate): update is ReplaceMessagesUpdate {
  return !Array.isArray(update) && "replaceMessages" in update;
}

export const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[], MessagesUpdate>({
    reducer: (prev, next) =>
      isReplaceMessagesUpdate(next) ? next.replaceMessages : [...prev, ...next],
    default: () => [],
  }),
  sessionId: Annotation<string>(),
  userId: Annotation<string>(),
  userInput: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  systemPrompt: Annotation<string>(),
  compactionCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
});

export type AgentGraphState = typeof GraphState.State;

export type AgentGraphUpdate = Omit<Partial<AgentGraphState>, "messages"> & {
  messages?: MessagesUpdate;
};
