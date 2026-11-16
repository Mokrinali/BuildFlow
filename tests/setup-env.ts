// Point the app's database client at the test database before any module loads it.
import "dotenv/config";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
if (testUrl === process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL: tests wipe the database");
}
process.env.DATABASE_URL = testUrl;
