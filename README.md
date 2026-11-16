# BuildFlow

სამშენებლო შესყიდვების მართვის ვებაპლიკაცია: მოთხოვნა → შეკვეთა → მიღება.

სტეკი: Next.js 16, TypeScript, PostgreSQL, Prisma 7, Better Auth, Tailwind CSS 4.

## ლოკალური გაშვება

საჭიროა Node.js 24 და PostgreSQL 16 ან უფრო ახალი.

1. შექმენით ბაზის მომხმარებელი და ბაზა (`psql`-ით, `postgres` მომხმარებლის სახელით):

   ```sql
   CREATE ROLE buildflow LOGIN CREATEDB PASSWORD 'შეცვალეთ';
   CREATE DATABASE buildflow OWNER buildflow;
   ```

   `CREATEDB` საჭიროა ტესტების ბაზის (`buildflow_test`) ავტომატურად შესაქმნელად.

2. დააკოპირეთ `.env.example` ფაილში `.env` და შეავსეთ მნიშვნელობები.

3. დააყენეთ პაკეტები, გაუშვით მიგრაციები და სატესტო მონაცემები:

   ```sh
   npm install
   npm run db:deploy
   npm run db:seed
   npm run dev
   ```

4. გახსენით http://localhost:3000. სატესტო ანგარიშები (`npm run db:seed`):

   | ელფოსტა                  | როლი                                        |
   | ------------------------ | ------------------------------------------- |
   | admin@buildflow.example  | ადმინისტრატორი                              |
   | giorgi@buildflow.example | მომთხოვნი                                   |
   | mariam@buildflow.example | შემსყიდველი                                 |
   | davit@buildflow.example  | მიმღები                                     |
   | levan@buildflow.example  | სხვა პროექტის წევრი (წვდომის შესამოწმებლად) |

   პაროლი: `BuildFlow-demo-2026` (ან `SEED_PASSWORD` გარემოს ცვლადი). ეს პაროლი საჯაროა, ამიტომ
   production-ში seed მხოლოდ `SEED_PASSWORD`-ით ეშვება.

## ბრძანებები

| ბრძანება               | რას აკეთებს                                    |
| ---------------------- | ---------------------------------------------- |
| `npm run dev`          | დეველოპმენტ სერვერი                            |
| `npm run build`        | Prisma კლიენტის გენერაცია და production build  |
| `npm run start`        | production სერვერი (build-ის შემდეგ)           |
| `npm run check`        | ფორმატი, ლინტერი, ტიპები და ტესტები ერთად      |
| `npm run format:check` | ფორმატის შემოწმება (`npm run format` ასწორებს) |
| `npm run lint`         | ESLint                                         |
| `npm run typecheck`    | TypeScript                                     |
| `npm test`             | ტესტები ცალკე ბაზაზე (`TEST_DATABASE_URL`)     |
| `npm run db:migrate`   | ახალი მიგრაციის შექმნა სქემის ცვლილების შემდეგ |
| `npm run db:deploy`    | არსებული მიგრაციების გაშვება                   |
| `npm run db:seed`      | გამოგონილი ქართული სატესტო მონაცემები          |

ტესტები `TEST_DATABASE_URL` ბაზას ყოველ ჯერზე ასუფთავებს. ის აუცილებლად უნდა განსხვავდებოდეს
`DATABASE_URL`-ისგან (სხვა შემთხვევაში ტესტები არ გაეშვება).

## სტრუქტურა

```
prisma/              სქემა, მიგრაციები, seed
src/app/             გვერდები (App Router); (app)/ — ავტორიზებული ნაწილი
src/server/          ბიზნესწესები: წვდომა, ისტორია, მოდულების სერვისები
src/lib/             ბაზის კლიენტი, ავტორიზაცია, ფორმატირება, ქართული ტექსტები
tests/               ინტეგრაციული ტესტები
branding/, public/   ლოგო და ხატულები
```

ყველა ნახვა და ცვლილება სერვერზე მოწმდება `src/server/access.ts`-ით. ყველა ცვლილება
`AuditEvent`-ში იწერება იმავე ტრანზაქციაში.
