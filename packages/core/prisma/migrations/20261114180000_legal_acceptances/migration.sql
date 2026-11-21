-- CreateTable
CREATE TABLE "legal_acceptances" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "email" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_acceptances_user_id_document_idx" ON "legal_acceptances"("user_id", "document");

-- CreateIndex
CREATE INDEX "legal_acceptances_email_document_idx" ON "legal_acceptances"("email", "document");

-- AddForeignKey
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
