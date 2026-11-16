// Create an organization and its first administrator (production bootstrap).
//
// Reads the values from environment variables so the password never appears in shell history:
//   ADMIN_ORG_NAME   organization name
//   ADMIN_NAME       admin's full name
//   ADMIN_EMAIL      admin's login email
//   ADMIN_PASSWORD   at least 10 characters
//
// Usage: npm run create-admin
import "dotenv/config";
import { db } from "../src/lib/db";
import { AppError } from "../src/server/errors";
import { createOrganizationWithAdmin } from "../src/server/users/service";

const required = ["ADMIN_ORG_NAME", "ADMIN_NAME", "ADMIN_EMAIL", "ADMIN_PASSWORD"] as const;

async function main() {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
  const result = await createOrganizationWithAdmin({
    organizationName: process.env.ADMIN_ORG_NAME!,
    name: process.env.ADMIN_NAME!,
    email: process.env.ADMIN_EMAIL!,
    password: process.env.ADMIN_PASSWORD!,
  });
  console.log(
    `Created organization ${result.organizationId} with admin ${process.env.ADMIN_EMAIL}.`,
  );
}

main()
  .catch((e) => {
    if (e instanceof AppError) {
      console.error(`${e.message}${e.fieldErrors ? " " + JSON.stringify(e.fieldErrors) : ""}`);
    } else {
      console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
    }
    process.exit(1);
  })
  .finally(() => db.$disconnect());
