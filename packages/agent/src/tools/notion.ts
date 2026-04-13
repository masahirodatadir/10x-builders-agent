import type { DbClient } from "@agents/db";
import {
  NOTION_API_VERSION,
  refreshAndPersistNotionTokens,
  type NotionStoredTokens,
} from "@agents/db";

export type NotionRuntimeContext = {
  db: DbClient;
  userId: string;
  notionTokens?: NotionStoredTokens;
};

function richTextToPlain(rich: unknown): string {
  if (!Array.isArray(rich)) return "";
  return rich
    .map((t) => String((t as Record<string, unknown>).plain_text ?? ""))
    .join("");
}

function extractTitle(obj: Record<string, unknown>): string {
  const props = obj.properties as Record<string, unknown> | undefined;
  if (!props) return "(sin título)";
  for (const key of Object.keys(props)) {
    const p = props[key] as Record<string, unknown>;
    if (p?.type === "title") {
      const t = richTextToPlain(p.title);
      if (t) return t;
    }
  }
  return "(sin título)";
}

async function notionFetchJson(
  ctx: NotionRuntimeContext,
  path: string,
  init?: RequestInit
): Promise<unknown> {
  let tokens = ctx.notionTokens;
  if (!tokens?.access_token) {
    throw new Error("Notion no conectado");
  }

  const request = async (access: string) =>
    fetch(`https://api.notion.com/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${access}`,
        "Notion-Version": NOTION_API_VERSION,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });

  let res = await request(tokens.access_token);
  if (res.status === 401 && tokens.refresh_token) {
    const fresh = await refreshAndPersistNotionTokens(
      ctx.db,
      ctx.userId,
      tokens.refresh_token
    );
    if (fresh) {
      ctx.notionTokens = fresh;
      tokens = fresh;
      res = await request(fresh.access_token);
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Notion API ${res.status}: ${body}`);
  }

  return res.json();
}

export async function executeNotionSearch(
  ctx: NotionRuntimeContext,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const query = String(args.query ?? "").trim();
  if (!query) {
    return { error: "Indica un texto de búsqueda (query)." };
  }

  const pageSize = Math.min(Math.max(Number(args.page_size) || 10, 1), 25);
  const filterType = args.filter_type as string | undefined;
  const body: Record<string, unknown> = { query, page_size: pageSize };
  if (filterType === "page" || filterType === "database") {
    body.filter = { value: filterType, property: "object" };
  }

  const data = (await notionFetchJson(ctx, "/search", {
    method: "POST",
    body: JSON.stringify(body),
  })) as Record<string, unknown>;

  const results = (data.results as Array<Record<string, unknown>>) ?? [];
  const items = results.map((r) => {
    const object = r.object as string;
    const id = r.id as string;
    const url = (r.url as string) ?? "";
    return {
      id,
      type: object,
      title: extractTitle(r),
      url,
    };
  });

  return { results: items, has_more: data.has_more === true };
}

const MAX_DEPTH = 5;
const MAX_BLOCKS = 250;
const MAX_CHARS = 60_000;

function blockPlainText(block: Record<string, unknown>): string {
  const type = block.type as string;
  const inner = block[type] as Record<string, unknown> | undefined;
  if (!inner) return "";
  if (type === "child_page" && inner.title) {
    return `[Página enlazada: ${String(inner.title)}]`;
  }
  if (type === "child_database" && inner.title) {
    return `[Base de datos: ${String(inner.title)}]`;
  }
  if (Array.isArray(inner.rich_text)) {
    return richTextToPlain(inner.rich_text);
  }
  return "";
}

export async function executeNotionGetPageText(
  ctx: NotionRuntimeContext,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const pageId = String(args.page_id ?? "").replace(/-/g, "");
  if (!pageId) {
    return { error: "Indica page_id (UUID de la página en Notion)." };
  }

  const formattedId =
    pageId.length === 32
      ? `${pageId.slice(0, 8)}-${pageId.slice(8, 12)}-${pageId.slice(12, 16)}-${pageId.slice(16, 20)}-${pageId.slice(20)}`
      : String(args.page_id);

  let totalBlocks = 0;
  let totalChars = 0;
  let truncated = false;
  const lines: string[] = [];

  async function fetchChildren(blockId: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || truncated) return;

    let cursor: string | undefined;
    do {
      if (totalBlocks >= MAX_BLOCKS || truncated) break;
      const qs = new URLSearchParams({ page_size: "100" });
      if (cursor) qs.set("start_cursor", cursor);

      const list = (await notionFetchJson(
        ctx,
        `/blocks/${blockId}/children?${qs.toString()}`
      )) as Record<string, unknown>;

      const blockList = (list.results as Array<Record<string, unknown>>) ?? [];
      for (const block of blockList) {
        if (totalBlocks >= MAX_BLOCKS) {
          truncated = true;
          break;
        }
        totalBlocks += 1;
        const text = blockPlainText(block);
        if (text) {
          const prefix = "  ".repeat(Math.max(0, depth - 1));
          const line = `${prefix}${text}`;
          if (totalChars + line.length + 1 > MAX_CHARS) {
            truncated = true;
            break;
          }
          lines.push(line);
          totalChars += line.length + 1;
        }

        if (block.has_children === true && depth < MAX_DEPTH) {
          const id = block.id as string;
          if (id) await fetchChildren(id, depth + 1);
        }
      }

      cursor = list.has_more ? (list.next_start_cursor as string) : undefined;
    } while (cursor && !truncated);
  }

  const page = (await notionFetchJson(ctx, `/pages/${formattedId}`)) as Record<
    string,
    unknown
  >;
  const title = extractTitle(page);
  const heading = `# ${title}`;
  lines.push(heading);
  totalChars = heading.length;

  await fetchChildren(formattedId, 1);

  const text = lines.join("\n");

  return {
    page_id: formattedId,
    title,
    text,
    truncated,
    blocks_scanned: totalBlocks,
    char_count: text.length,
  };
}
