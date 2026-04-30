/**
 * Applies packages/db/supabase/migrations/00003_scheduled_tasks.sql when
 * `scheduled_tasks` does not exist yet. Reads DATABASE_URL from process.env
 * or from apps/web/.env.local (monorepo root = three levels up from this file).
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

/** This file lives at packages/db/scripts → repo root is three levels up. */
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
    if (m) {
      return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

async function main() {
  const repoRoot = findRepoRoot();
  const databaseUrl = process.env.DATABASE_URL || loadDatabaseUrlFromEnvLocal(repoRoot);
  if (!databaseUrl) {
    console.error(
      "DATABASE_URL not set and apps/web/.env.local not found or has no DATABASE_URL."
    );
    process.exit(1);
  }

  const sqlPath = path.join(repoRoot, "packages", "db", "supabase", "migrations", "00003_scheduled_tasks.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const { rows } = await client.query(
      "SELECT to_regclass('public.scheduled_tasks') AS reg"
    );
    if (rows[0]?.reg) {
      console.log("Migration 00003 already applied (public.scheduled_tasks exists).");
      return;
    }

    await client.query(sql);
    console.log("Migration 00003 applied successfully.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
