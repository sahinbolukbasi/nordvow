-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN "lastErrorClass" TEXT;
ALTER TABLE "SocialAccount" ADD COLUMN "syncReason" TEXT;
ALTER TABLE "SocialAccount" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SocialSyncEvent" (
    "id" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "errorClass" TEXT,
    "reason" TEXT,
    "source" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialSyncEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialSyncLock" (
    "id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialSyncLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialSyncEvent_socialAccountId_createdAt_idx" ON "SocialSyncEvent"("socialAccountId", "createdAt");

-- AddForeignKey
ALTER TABLE "SocialSyncEvent" ADD CONSTRAINT "SocialSyncEvent_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
