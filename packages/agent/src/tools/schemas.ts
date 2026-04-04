import { z } from "zod";

export const TOOL_SCHEMAS = {
  get_user_preferences: z.object({}),
  list_enabled_tools: z.object({}),
  github_list_repos: z.object({
    per_page: z.number().max(30).optional().default(10),
  }),
  github_list_issues: z.object({
    owner: z.string(),
    repo: z.string(),
    state: z.enum(["open", "closed", "all"]).optional().default("open"),
  }),
  github_create_issue: z.object({
    owner: z.string(),
    repo: z.string(),
    title: z.string(),
    body: z.string().optional().default(""),
  }),
  github_create_repo: z.object({
    name: z.string(),
    description: z.string().optional().default(""),
    isPrivate: z.boolean().optional().default(false),
  }),
} as const;

export type ToolSchemas = typeof TOOL_SCHEMAS;
export type ToolId = keyof ToolSchemas;
