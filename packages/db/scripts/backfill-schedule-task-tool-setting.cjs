/**
 * Runs packages/db/supabase/cron/backfill_schedule_task_tool_setting.sql
 * using DATABASE_URL from env or apps/web/.env.local.
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function findRepoRoot() {
  const fromFile = path.resolve(__dirname, "..", "..", "..");
  const envFromFile = path.join(fromFile, "apps", "web", ".env.local");
  if (fs.existsSync(envFromFile)) return fromFile;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "apps", "web", ".env.local");
    if (fs.existsSync(candidate)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fromFile;
}

function loadDatabaseUrlFromEnvLocal(repoRoot) {
  const envPath = path.join(repoRoot, "apps", "web", ".env.local");
  if (!fs.existsSync(envPath)) return null;
  const text = fs.readFileSync(envPath, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\r$/, "");
    const m = line.match(/^\s*DATABASE_URL=(.+)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

async function main() {
  const repoRoot = findRepoRoot();
  const databaseUrl = process.env.DATABASE_URL || loadDatabaseUrlFromEnvLocal(repoRoot);
  if (!databaseUrl) {
    console.error("DATABASE_URL not set and apps/web/.env.local has no DATABASE_URL.");
    process.exit(1);
  }
  const sqlPath = path.join(
    repoRoot,
    "packages",
    "db",
    "supabase",
    "cron",
    "backfill_schedule_task_tool_setting.sql"
  );
  const sql = fs.readFileSync(sqlPath, "utf8");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const r = await client.query(sql);
    console.log("Backfill done. Rows affected:", r.rowCount ?? "(unknown)");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
