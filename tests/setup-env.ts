// Point the app's database client at the test database before any module loads it.
import "dotenv/config";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
// Tests TRUNCATE every table, so insist on a database clearly meant for tests.
// (Comparing URL strings is not enough: localhost vs 127.0.0.1 can point at the same DB.)
const dbName = new URL(testUrl).pathname.slice(1);
if (!dbName.endsWith("_test")) {
  throw new Error(`TEST_DATABASE_URL database name must end with "_test" (got "${dbName}")`);
}
process.env.DATABASE_URL = testUrl;
