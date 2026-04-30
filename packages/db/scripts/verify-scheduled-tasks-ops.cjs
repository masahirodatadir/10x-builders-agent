/** Prints row counts for scheduled_tasks and telegram_accounts (no secrets). */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function findRepoRoot() {
  const fromFile = path.resolve(__dirname, "..", "..", "..");
  if (fs.existsSync(path.join(fromFile, "apps", "web", ".env.local"))) return fromFile;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "apps", "web", ".env.local"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fromFile;
}

function loadDatabaseUrl(repoRoot) {
  const envPath = path.join(repoRoot, "apps", "web", ".env.local");
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
  const url = process.env.DATABASE_URL || loadDatabaseUrl(repoRoot);
  if (!url) throw new Error("DATABASE_URL missing");
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const t = await c.query("select count(*)::int as n from telegram_accounts");
    const s = await c.query("select count(*)::int as n from scheduled_tasks");
    const u = await c.query(
      "select count(*)::int as n from user_tool_settings where tool_id = $1 and enabled = true",
      ["schedule_task"]
    );
    console.log(
      JSON.stringify({
        telegram_accounts: t.rows[0].n,
        scheduled_tasks: s.rows[0].n,
        users_with_schedule_task_enabled: u.rows[0].n,
      })
    );
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
