-- CreateTable
CREATE TABLE "ReceiptWaybillLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4),
    "orderItemId" TEXT,
    "factor" DECIMAL(18,6),

    CONSTRAINT "ReceiptWaybillLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReceiptWaybillLine_orderItemId_idx" ON "ReceiptWaybillLine"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptWaybillLine_receiptId_position_key" ON "ReceiptWaybillLine"("receiptId", "position");

-- AddForeignKey
ALTER TABLE "ReceiptWaybillLine" ADD CONSTRAINT "ReceiptWaybillLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptWaybillLine" ADD CONSTRAINT "ReceiptWaybillLine_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
