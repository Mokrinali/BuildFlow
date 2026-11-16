-- CreateTable
CREATE TABLE "RequestImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "lineCount" INTEGER NOT NULL,
    "skippedLineCount" INTEGER NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "flaggedItemCount" INTEGER NOT NULL,
    "repeatConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "sourceLines" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RequestImport_requestId_key" ON "RequestImport"("requestId");

-- CreateIndex
CREATE INDEX "RequestImport_projectId_textHash_idx" ON "RequestImport"("projectId", "textHash");

-- CreateIndex
CREATE UNIQUE INDEX "RequestImport_requestId_organizationId_key" ON "RequestImport"("requestId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RequestImport_organizationId_idempotencyKey_key" ON "RequestImport"("organizationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "RequestImport" ADD CONSTRAINT "RequestImport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestImport" ADD CONSTRAINT "RequestImport_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "Project"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestImport" ADD CONSTRAINT "RequestImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestImport" ADD CONSTRAINT "RequestImport_requestId_organizationId_fkey" FOREIGN KEY ("requestId", "organizationId") REFERENCES "PurchaseRequest"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
