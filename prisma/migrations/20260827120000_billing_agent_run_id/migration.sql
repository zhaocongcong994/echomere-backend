ALTER TABLE "BillingRecord" ADD COLUMN "agentRunId" TEXT;

CREATE UNIQUE INDEX "BillingRecord_agentRunId_key" ON "BillingRecord"("agentRunId");
