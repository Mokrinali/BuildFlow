// Fictional Georgian demo data. Safe to run repeatedly (skips if the demo org exists).
// All people, companies and addresses below are made up.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "../src/generated/prisma/client";
import type { OrgRole, ProjectRole } from "../src/generated/prisma/enums";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

// Demo password for every seeded account. The default is public (this repo is public),
// so production seeding requires an explicit SEED_PASSWORD.
if (process.env.NODE_ENV === "production" && !process.env.SEED_PASSWORD) {
  throw new Error("Set SEED_PASSWORD to seed a production database.");
}
const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? "BuildFlow-demo-2026";

const ORG_NAME = "შპს „მთის სახლი“ (სადემონსტრაციო)";

const people: { key: string; name: string; email: string; orgRole: OrgRole }[] = [
  { key: "admin", name: "ნინო ბერიძე", email: "admin@buildflow.example", orgRole: "ADMIN" },
  {
    key: "requester",
    name: "გიორგი კაპანაძე",
    email: "giorgi@buildflow.example",
    orgRole: "MEMBER",
  },
  { key: "buyer", name: "მარიამ ლომიძე", email: "mariam@buildflow.example", orgRole: "MEMBER" },
  { key: "receiver", name: "დავით ჩხეიძე", email: "davit@buildflow.example", orgRole: "MEMBER" },
  { key: "outsider", name: "ლევან წერეთელი", email: "levan@buildflow.example", orgRole: "MEMBER" },
];

const projects: { name: string; address: string; members: [string, ProjectRole[]][] }[] = [
  {
    name: "საბურთალოს საცხოვრებელი კომპლექსი",
    address: "თბილისი, ვაჟა-ფშაველას გამზ. 999 (გამოგონილი)",
    members: [
      ["requester", ["REQUESTER"]],
      ["buyer", ["BUYER"]],
      ["receiver", ["RECEIVER"]],
    ],
  },
  {
    name: "ბათუმის სასტუმრო „ზღვისპირა“",
    address: "ბათუმი, გამოგონილი ქ. 12",
    members: [
      ["buyer", ["BUYER"]],
      ["outsider", ["REQUESTER", "RECEIVER"]],
    ],
  },
];

const suppliers = [
  { name: "შპს „ქართული ცემენტი“ (გამოგონილი)", phone: "+995 500 00 00 01" },
  { name: "შპს „არმატურა ჯგუფი“ (გამოგონილი)", phone: "+995 500 00 00 02" },
];

async function main() {
  if (await db.organization.findFirst({ where: { name: ORG_NAME } })) {
    console.log("Demo data already present, skipping.");
    return;
  }
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  await db.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: ORG_NAME } });
    const ids: Record<string, string> = {};
    for (const p of people) {
      const id = randomUUID();
      ids[p.key] = id;
      await tx.user.create({
        data: {
          id,
          name: p.name,
          email: p.email,
          emailVerified: true,
          organizationId: org.id,
          orgRole: p.orgRole,
        },
      });
      await tx.account.create({
        data: {
          id: randomUUID(),
          userId: id,
          accountId: id,
          providerId: "credential",
          password: passwordHash,
        },
      });
    }
    for (const pr of projects) {
      await tx.project.create({
        data: {
          organizationId: org.id,
          name: pr.name,
          address: pr.address,
          memberships: {
            create: pr.members.map(([key, roles]) => ({ userId: ids[key]!, roles })),
          },
        },
      });
    }
    for (const s of suppliers) {
      await tx.supplier.create({ data: { organizationId: org.id, ...s } });
    }
  });

  console.log("Demo data created. Accounts (password from SEED_PASSWORD or the default):");
  for (const p of people) console.log(`  ${p.email}  ${p.orgRole === "ADMIN" ? "(admin)" : ""}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
