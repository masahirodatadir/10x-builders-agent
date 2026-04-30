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
  notion_search: z.object({
    query: z.string().min(1).describe("Text to search for in titles and content."),
    page_size: z.number().int().min(1).max(25).optional().default(10),
    filter_type: z.enum(["page", "database"]).optional(),
  }),
  notion_get_page_text: z.object({
    page_id: z
      .string()
      .min(1)
      .describe("Notion page id (UUID), from notion_search or a Notion URL."),
  }),
  read_file: z.object({
    path: z
      .string()
      .describe(
        "Host filesystem on the agent: absolute path or path relative to process.cwd() of the Node server. Not necessarily the same cwd as the bash tool when BASH_TOOL_CWD is set."
      ),
    offset: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("1-based line number of the first line to return. Defaults to 1."),
    limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "Max lines to return from offset; server also enforces an internal max — omitting limit does not mean unlimited lines."
      ),
  }),
  write_file: z.object({
    path: z
      .string()
      .describe(
        "Absolute or relative to server process cwd. Target file must not exist yet; tool fails with FILE_EXISTS if it does."
      ),
    content: z
      .string()
      .max(500_000)
      .describe(
        "Full UTF-8 body for the new file. Schema max length may be below disk limits."
      ),
  }),
  edit_file: z.object({
    path: z
      .string()
      .describe(
        "Absolute or relative to server process cwd. File must already exist."
      ),
    old_string: z
      .string()
      .min(1)
      .describe(
        "Non-empty literal substring; must match file bytes exactly once (whitespace and CRLF vs LF). Prefer copy-paste from read_file."
      ),
    new_string: z
      .string()
      .describe(
        "Literal replacement for that single occurrence; may be empty to delete the matched span. Not regex."
      ),
  }),
  bash: z.object({
    terminal: z.string().describe("Terminal identifier for correlation and logging"),
    prompt: z.string().max(4096).describe("Bash command to execute"),
  }),
  schedule_task: z
    .object({
      prompt: z.string().min(1).describe("The instruction the agent will run when the task fires."),
      schedule_type: z
        .enum(["one_time", "recurring"])
        .describe("Whether this is a single execution or a recurring one."),
      run_at: z
        .string()
        .optional()
        .describe("ISO 8601 datetime for one_time tasks (e.g. '2026-04-10T09:00:00Z')."),
      cron_expr: z
        .string()
        .optional()
        .describe(
          "5-field cron expression for recurring tasks (e.g. '0 9 * * 1' = every Monday 9 AM)."
        ),
      timezone: z
        .string()
        .optional()
        .describe("IANA timezone name (e.g. 'America/Bogota'). Defaults to user timezone."),
    })
    .refine(
      (data) => {
        if (data.schedule_type === "one_time") return !!data.run_at;
        if (data.schedule_type === "recurring") return !!data.cron_expr;
        return false;
      },
      {
        message:
          "one_time tasks require run_at; recurring tasks require cron_expr.",
      }
    ),
} as const;

export type ToolSchemas = typeof TOOL_SCHEMAS;
export type ToolId = keyof ToolSchemas;
