-- CreateEnum
CREATE TYPE "CancellationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "CancellationSide" AS ENUM ('REQUESTER', 'BUYER');

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "closeReason" TEXT,
ADD COLUMN     "closedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "RequestItem" ADD COLUMN     "approvedQuantity" DECIMAL(14,3);

-- CreateTable
CREATE TABLE "ItemCancellation" (
    "id" TEXT NOT NULL,
    "requestItemId" TEXT NOT NULL,
    "status" "CancellationStatus" NOT NULL DEFAULT 'PENDING',
    "side" "CancellationSide" NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionReason" TEXT,
    "cancelledQuantity" DECIMAL(14,3),

    CONSTRAINT "ItemCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemCancellation_requestItemId_status_idx" ON "ItemCancellation"("requestItemId", "status");

-- CreateIndex
CREATE INDEX "ItemCancellation_status_idx" ON "ItemCancellation"("status");

-- AddForeignKey
ALTER TABLE "ItemCancellation" ADD CONSTRAINT "ItemCancellation_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "RequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCancellation" ADD CONSTRAINT "ItemCancellation_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCancellation" ADD CONSTRAINT "ItemCancellation_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- At most one pending cancellation per request item (Prisma cannot express partial indexes).
CREATE UNIQUE INDEX "ItemCancellation_one_pending_per_item"
  ON "ItemCancellation"("requestItemId") WHERE "status" = 'PENDING';

-- Quantities stay positive or zero.
ALTER TABLE "RequestItem" ADD CONSTRAINT "RequestItem_approvedQuantity_nonneg"
  CHECK ("approvedQuantity" IS NULL OR "approvedQuantity" >= 0);
