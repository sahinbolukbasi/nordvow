-- AlterTable
ALTER TABLE "Brand" ADD COLUMN IF NOT EXISTS "preferredAgencyUserId" TEXT;

-- AlterTable
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "counterKurus" INTEGER,
ADD COLUMN IF NOT EXISTS "counterNote" TEXT,
ADD COLUMN IF NOT EXISTS "counterByRole" TEXT;

