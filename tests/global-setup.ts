// Create the test database if needed and apply all migrations to it.
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import pg from "pg";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  const dbName = new URL(url).pathname.slice(1);

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${dbName.replace(/"/g, "")}"`);
  await client.end();

  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
}
