import "dotenv/config";
import { prisma } from "../src/db";
import { stripLeadingAt } from "../src/social/handle";

/**
 * İdempotent sosyal medya kullanıcı adı normalleştirme betiği.
 * SocialAccount.handle ve InfluencerCandidate.handle alanlarındaki baştaki `@` işaretlerini temizler.
 * Tekrar çalıştırıldığında güvenli (yalnız değişmesi gereken kayıtları günceller).
 */
async function main() {
  const accounts = await prisma.socialAccount.findMany({
    where: { handle: { startsWith: "@" } },
    select: { id: true, handle: true },
  });

  let updatedAccounts = 0;
  for (const acc of accounts) {
    const clean = stripLeadingAt(acc.handle);
    if (clean && clean !== acc.handle) {
      await prisma.socialAccount.update({
        where: { id: acc.id },
        data: { handle: clean },
      });
      updatedAccounts++;
    }
  }

  const candidates = await prisma.influencerCandidate.findMany({
    where: { handle: { startsWith: "@" } },
    select: { id: true, handle: true },
  });

  let updatedCandidates = 0;
  for (const cand of candidates) {
    if (!cand.handle) continue;
    const clean = stripLeadingAt(cand.handle);
    if (clean && clean !== cand.handle) {
      await prisma.influencerCandidate.update({
        where: { id: cand.id },
        data: { handle: clean },
      });
      updatedCandidates++;
    }
  }

  console.log(
    JSON.stringify({
      ok: true,
      scannedAccounts: accounts.length,
      updatedAccounts,
      scannedCandidates: candidates.length,
      updatedCandidates,
    }),
  );
}

main()
  .catch((err) => {
    console.error("normalize-handles failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

