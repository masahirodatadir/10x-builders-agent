import { createToolCall, updateToolCallStatus } from "@agents/db";
import { toolRequiresConfirmation } from "@agents/types";
import type { ToolContext } from "./adapters";

export interface WithTrackingOptions<T> {
  confirmationMessage?: (input: T) => string;
}

export function withTracking<T extends Record<string, unknown>>(
  toolId: string,
  handler: (input: T, ctx: ToolContext) => Promise<Record<string, unknown>>,
  ctx: ToolContext,
  options: WithTrackingOptions<T> = {}
): (input: T) => Promise<string> {
  return async (input) => {
    const needsConfirm = toolRequiresConfirmation(toolId);
    const record = await createToolCall(ctx.db, ctx.sessionId, toolId, input, needsConfirm);

    if (needsConfirm) {
      const message = options.confirmationMessage
        ? options.confirmationMessage(input)
        : `Se requiere confirmación para ejecutar "${toolId}".`;
      return JSON.stringify({
        pending_confirmation: true,
        tool_call_id: record.id,
        tool_name: toolId,
        message,
        args: input,
      });
    }

    try {
      const result = await handler(input, ctx);
      await updateToolCallStatus(ctx.db, record.id, "executed", result);
      return JSON.stringify(result);
    } catch (err) {
      const errResult = { error: String(err) };
      await updateToolCallStatus(ctx.db, record.id, "failed", errResult);
      return JSON.stringify(errResult);
    }
  };
}
