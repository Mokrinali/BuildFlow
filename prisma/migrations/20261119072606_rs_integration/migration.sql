-- CreateEnum
CREATE TYPE "RsMode" AS ENUM ('OFF', 'DEMO', 'LIVE');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "rsMode" "RsMode" NOT NULL DEFAULT 'OFF',
ADD COLUMN     "rsServicePassword" TEXT,
ADD COLUMN     "rsServiceUser" TEXT;

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "rsCheckedAt" TIMESTAMPTZ(3),
ADD COLUMN     "rsWaybillId" TEXT;
