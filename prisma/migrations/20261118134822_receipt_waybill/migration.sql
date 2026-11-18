-- AlterEnum
ALTER TYPE "RequestStatus" ADD VALUE 'AWAITING_WAYBILL';

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "waybillDate" DATE,
ADD COLUMN     "waybillNumber" TEXT;

-- CreateIndex
CREATE INDEX "Receipt_waybillNumber_idx" ON "Receipt"("waybillNumber");
