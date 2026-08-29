ALTER TABLE "Message" ADD COLUMN "clientRequestId" TEXT;
ALTER TABLE "Message" ADD COLUMN "agentRunId" TEXT;

CREATE UNIQUE INDEX "Message_clientRequestId_key" ON "Message"("clientRequestId");
CREATE UNIQUE INDEX "Message_agentRunId_key" ON "Message"("agentRunId");

CREATE TABLE "Hexagram" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Hexagram_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Hexagram_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Hexagram_conversationId_key" ON "Hexagram"("conversationId");
CREATE INDEX "Hexagram_userId_createdAt_idx" ON "Hexagram"("userId", "createdAt");
