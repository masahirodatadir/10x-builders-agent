import type { ToolDefinition, ToolRisk } from "./index";

export const TOOL_CATALOG: ToolDefinition[] = [
  {
    id: "get_user_preferences",
    name: "get_user_preferences",
    description: "Returns the current user preferences and agent configuration.",
    risk: "low",
    parameters_schema: { type: "object", properties: {}, required: [] },
    displayName: "Preferencias del usuario",
    displayDescription: "Consulta tu configuración y preferencias.",
  },
  {
    id: "list_enabled_tools",
    name: "list_enabled_tools",
    description: "Lists all tools the user has currently enabled.",
    risk: "low",
    parameters_schema: { type: "object", properties: {}, required: [] },
    displayName: "Listar herramientas",
    displayDescription: "Muestra qué herramientas tienes habilitadas.",
  },
  {
    id: "github_list_repos",
    name: "github_list_repos",
    description: "Lists the user's GitHub repositories.",
    risk: "low",
    requires_integration: "github",
    parameters_schema: {
      type: "object",
      properties: {
        per_page: { type: "number", description: "Results per page (max 30)" },
      },
      required: [],
    },
    displayName: "GitHub: listar repos",
    displayDescription: "Lista tus repositorios de GitHub.",
  },
  {
    id: "github_list_issues",
    name: "github_list_issues",
    description: "Lists issues for a given repository.",
    risk: "low",
    requires_integration: "github",
    parameters_schema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        state: { type: "string", enum: ["open", "closed", "all"] },
      },
      required: ["owner", "repo"],
    },
    displayName: "GitHub: listar issues",
    displayDescription: "Lista issues de un repositorio.",
  },
  {
    id: "github_create_issue",
    name: "github_create_issue",
    description: "Creates a new issue in a GitHub repository. Requires confirmation.",
    risk: "medium",
    requires_integration: "github",
    parameters_schema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["owner", "repo", "title"],
    },
    displayName: "GitHub: crear issue",
    displayDescription: "Crea un issue nuevo (requiere confirmación).",
  },
  {
    id: "github_create_repo",
    name: "github_create_repo",
    description: "Creates a new GitHub repository for the authenticated user. Requires confirmation.",
    risk: "medium",
    requires_integration: "github",
    parameters_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Repository name" },
        description: { type: "string", description: "Repository description" },
        isPrivate: { type: "boolean", description: "Whether the repository is private" },
      },
      required: ["name"],
    },
    displayName: "GitHub: crear repositorio",
    displayDescription: "Crea un repositorio nuevo en GitHub (requiere confirmación).",
  },
  {
    id: "notion_search",
    name: "notion_search",
    description:
      "Searches pages and databases in the user's Notion workspace that were shared with this integration during connect. Use before reading a page to find ids. Returns titles and URLs.",
    risk: "low",
    requires_integration: "notion",
    parameters_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text" },
        page_size: { type: "number", description: "Max results (1–25), default 10" },
        filter_type: {
          type: "string",
          enum: ["page", "database"],
          description: "Optional: only pages or only databases",
        },
      },
      required: ["query"],
    },
    displayName: "Notion: buscar",
    displayDescription: "Busca páginas y bases de datos que compartiste con la integración.",
  },
  {
    id: "notion_get_page_text",
    name: "notion_get_page_text",
    description:
      "Reads the text content of a Notion page (block tree) the integration can access. Pass the page id from notion_search. Large pages are truncated with truncated=true.",
    risk: "low",
    requires_integration: "notion",
    parameters_schema: {
      type: "object",
      properties: {
        page_id: {
          type: "string",
          description: "Notion page UUID (with or without dashes)",
        },
      },
      required: ["page_id"],
    },
    displayName: "Notion: leer página",
    displayDescription: "Obtiene el texto de una página de Notion (contenido legible).",
  },
  {
    id: "read_file",
    name: "read_file",
    description: `Read-only access to one existing regular file as UTF-8 text on the agent host.

When to use:
- You need the current contents of a file you will reason about or cite (source, config, logs, markdown, etc.).
- You want a slice of the file by line range (large files / long logs).

When NOT to use (choose another tool instead):
- Creating a file or changing bytes on disk → use write_file (new file only) or edit_file (single literal replacement in an existing file), or bash if appropriate.
- Listing directory contents or discovering filenames → this tool does not list folders; use bash or another listing mechanism.
- Non-text or binary files → not supported; output may be corrupted or misleading.
- File larger than the server limit (currently 2 MiB on disk) → the tool fails with FILE_TOO_LARGE even if offset/limit are set; use bash (e.g. head) or split the workflow.

Parameters:
- path: string, required. Absolute path, or path relative to the Node process working directory (process.cwd()). Independent of BASH_TOOL_CWD when the bash tool uses a different cwd.
- offset: optional positive integer, default 1. Line number of the first line to return, 1-based (first line of the file is line 1).
- limit: optional positive integer. Maximum number of lines to return starting at offset. If omitted, the server applies an internal maximum line cap (do not assume an entire unlimited file).

Process (server):
1) If file tools are disabled → fail TOOL_DISABLED.
2) Resolve path to an absolute normalized path.
3) stat the path → if missing → NOT_FOUND; if directory → IS_DIRECTORY; if file size > byte limit → FILE_TOO_LARGE.
4) Read full file as UTF-8, split into lines.
5) If offset is outside 1..totalLines → OFFSET_OUT_OF_RANGE.
6) Return the requested line window joined with newline characters.

Successful JSON shape:
{ "ok": true, "tool": "read_file", "path": "<resolved>", "content": "<text slice>", "startLine": <number>, "endLine": <number>, "totalLines": <number> }

Failed JSON shape:
{ "ok": false, "tool": "read_file", "path": "<string>", "error": { "code": "<string>", "message": "<human-readable explanation>" } }

Common error codes: TOOL_DISABLED, NOT_FOUND, IS_DIRECTORY, FILE_TOO_LARGE, READ_ERROR, OFFSET_OUT_OF_RANGE, ACCESS_DENIED, STAT_ERROR.`,
    risk: "low",
    parameters_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Host filesystem: absolute path or path relative to the server process working directory (Node cwd).",
        },
        offset: {
          type: "number",
          description: "1-based line number to start reading from. Defaults to 1.",
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to return starting at offset; server caps total lines returned.",
        },
      },
      required: ["path"],
    },
    displayName: "Leer archivo",
    displayDescription:
      "Lee un archivo de texto existente en el servidor del agente (UTF-8), sin modificarlo. Permite leer por rango de líneas (offset desde 1, limit). No lista carpetas ni crea archivos. Archivos mayores al límite del servidor fallan aunque pidas pocas líneas.",
  },
  {
    id: "write_file",
    name: "write_file",
    description: `Create exactly one new regular file on the agent host with the full UTF-8 body you provide. This is a create-only operation.

When to use:
- The target path must not exist yet and you want the entire initial contents in one write (new module, new config file, new doc, etc.).

When NOT to use:
- The file already exists at that path (any non-zero existing file) → the tool fails by design with FILE_EXISTS; use edit_file for in-place text edits, or another strategy if you need truncation/replacement of the whole file.
- You only need to change part of an existing file → use edit_file.
- You need to append to a log or stream bytes → not supported as append mode; use bash or extend the product.
- Parent path is wrong "on purpose" to overwrite something → still fails if the leaf file exists.

Parameters:
- path: string, required. Absolute or relative to the server process working directory. The final path must not already exist as a file.
- content: string, required. Complete file body after creation. Encoding is UTF-8. The API layer may enforce a maximum length smaller than disk limits.

Process (server):
1) If file tools are disabled → fail TOOL_DISABLED.
2) Resolve path.
3) If a file already exists at resolved path → FILE_EXISTS (includes race where another process creates it first).
4) Create missing parent directories.
5) Create the file with exclusive create semantics, write content, close.

Successful JSON shape:
{ "ok": true, "tool": "write_file", "path": "<resolved>", "bytesWritten": <number> }

Failed JSON shape:
{ "ok": false, "tool": "write_file", "path": "<string>", "error": { "code": "<string>", "message": "<...>" } }

Common error codes: TOOL_DISABLED, FILE_EXISTS, MKDIR_ERROR, WRITE_ERROR.

Human-in-the-loop: this tool is high-risk in the product; the user may need to approve before execution.`,
    risk: "high",
    parameters_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Must not exist yet; fails with FILE_EXISTS if it does. Absolute or relative to server process cwd.",
        },
        content: {
          type: "string",
          description: "Full UTF-8 body for the new file; request schema may cap length below disk limits.",
        },
      },
      required: ["path", "content"],
    },
    displayName: "Crear archivo",
    displayDescription:
      "Crea un archivo nuevo en el servidor del agente con el contenido completo. Si el archivo ya existe, la herramienta falla a propósito; para cambiar un archivo existente usa editar archivo.",
  },
  {
    id: "edit_file",
    name: "edit_file",
    description: `Modify one existing UTF-8 text file on the agent host by replacing exactly one literal occurrence of old_string with new_string. Not regex. Not multi-file.

When to use:
- The file already exists and you need a deterministic, reviewable change to a unique substring (small patch style).

When NOT to use:
- Creating a new file → use write_file.
- old_string might match 0 times or more than 1 time → fix your old_string (add surrounding lines / unique context) until it is unique; otherwise the tool fails with OLD_STRING_NOT_FOUND or OLD_STRING_AMBIGUOUS.
- old_string is empty → do not use; an empty needle is ambiguous and will not match the intended "replace nothing" semantics in a useful way.
- Changing binary files or encoding-sensitive bytes → not supported.
- Global rewrites or regex-based refactors → not supported; use bash or a dedicated refactor path.

Parameters:
- path: string, required. Absolute or relative to the server process working directory. Target must be an existing readable/writable file.
- old_string: string, required, non-empty. Must match the file bytes exactly once, including spaces, tabs, and newline style (CRLF vs LF). Copy-paste from read_file output when possible.
- new_string: string, allowed to be empty (deletes the matched region only). Literal replacement, not interpreted as regex.

Process (server):
1) If file tools are disabled → fail TOOL_DISABLED.
2) Resolve path; read full file as UTF-8.
3) Count non-overlapping literal occurrences of old_string.
   - 0 occurrences → OLD_STRING_NOT_FOUND.
   - >1 occurrences → OLD_STRING_AMBIGUOUS.
   - exactly 1 → build updated text by replacing that single occurrence.
4) Write updated content safely (temporary file then rename to original path).

Successful JSON shape:
{ "ok": true, "tool": "edit_file", "path": "<resolved>", "replacements": 1 }

Failed JSON shape:
{ "ok": false, "tool": "edit_file", "path": "<string>", "error": { "code": "<string>", "message": "<...>" } }

Common error codes: TOOL_DISABLED, NOT_FOUND, OLD_STRING_NOT_FOUND, OLD_STRING_AMBIGUOUS, WRITE_ERROR, INVALID_OLD_STRING, ACCESS_DENIED, READ_ERROR.

Human-in-the-loop: high-risk; user approval may be required before execution.`,
    risk: "high",
    parameters_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Existing file: absolute or relative to server process cwd.",
        },
        old_string: {
          type: "string",
          description:
            "Non-empty literal; must occur exactly once (whitespace and line endings must match the file).",
        },
        new_string: {
          type: "string",
          description: "Literal replacement for that single occurrence; may be empty to delete the matched span.",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
    displayName: "Editar archivo",
    displayDescription:
      "En un archivo existente, reemplaza una sola vez un fragmento literal (old_string) por new_string. Debe haber exactamente una coincidencia; si hay 0 o varias, falla con mensaje claro. No crea archivos nuevos.",
  },
  {
    id: "schedule_task",
    name: "schedule_task",
    description:
      "Creates a scheduled task that will run a given prompt automatically at a specified time or on a recurring cron schedule. For a one-time task provide run_at (ISO 8601 datetime). For a recurring task provide cron_expr (standard 5-field cron expression, e.g. '0 9 * * 1' for every Monday at 9 AM) and optionally timezone (IANA tz, defaults to user timezone). The task will trigger the agent with the given prompt and send the result via Telegram by default. Requires confirmation.",
    risk: "medium",
    parameters_schema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The instruction/prompt the agent will execute when the task fires.",
        },
        schedule_type: {
          type: "string",
          enum: ["one_time", "recurring"],
          description: "Whether this is a single execution or a recurring one.",
        },
        run_at: {
          type: "string",
          description: "ISO 8601 datetime for one_time tasks (e.g. '2026-04-10T09:00:00Z').",
        },
        cron_expr: {
          type: "string",
          description:
            "5-field cron expression for recurring tasks (e.g. '0 9 * * 1' = every Monday 9 AM).",
        },
        timezone: {
          type: "string",
          description: "IANA timezone name (e.g. 'America/Bogota'). Defaults to user timezone.",
        },
      },
      required: ["prompt", "schedule_type"],
    },
    displayName: "Programar tarea",
    displayDescription:
      "Crea una tarea programada que el agente ejecutará automáticamente y notificará por Telegram.",
  },
  {
    id: "bash",
    name: "bash",
    description:
      "Use this tool when you need to execute bash commands and interact with the operative system. This tool executes commands in a new or existing terminal and returns the commands text output. The system running is a unix-like O.S.",
    risk: "high",
    parameters_schema: {
      type: "object",
      properties: {
        terminal: { type: "string", description: "Terminal identifier for correlation and logging" },
        prompt: { type: "string", description: "Bash command to execute" },
      },
      required: ["terminal", "prompt"],
    },
    displayName: "Bash",
    displayDescription: "Ejecuta comandos bash en el servidor (riesgo alto, requiere confirmación).",
  },
];

export function getToolRisk(toolId: string): ToolRisk {
  return TOOL_CATALOG.find((t) => t.id === toolId)?.risk ?? "high";
}

export function toolRequiresConfirmation(toolId: string): boolean {
  const risk = getToolRisk(toolId);
  return risk === "medium" || risk === "high";
}
