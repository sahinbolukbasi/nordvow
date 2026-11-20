/**
 * Influencer sosyal hesaplarını resmî API'lerden senkronlar.
 *   npm run social:sync -- --all              (24 saatten eski hesaplar, günde bir)
 *   npm run social:sync -- --influencer <id>  (tek influencer)
 * Ortam: SOCIAL_SYNC_MODE=http + INSTAGRAM_IG_USER_ID / META_SYSTEM_USER_TOKEN, YOUTUBE_API_KEY.
 * Eski adlar IG_BUSINESS_ACCOUNT_ID / IG_GRAPH_TOKEN yalnız yedek. META_API_MODE bu işi açmaz.
 */
import { prisma } from "../src/db";
import { syncInfluencer, syncStaleAccounts } from "../src/social/sync";

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--influencer");
  if (i >= 0 && args[i + 1]) {
    for (const r of await syncInfluencer(args[i + 1]!, undefined, { force: true })) console.log(`${r.ok ? "✓" : "✗"} ${r.accountId} ${r.errorClass ?? ""} ${r.message}`);
    return;
  }
  if (args.includes("--all")) {
    const r = await syncStaleAccounts(500);
    console.log(`kontrol edilen=${r.checked} güncellenen=${r.ok}`);
    return;
  }
  console.error("Kullanım: social:sync -- --all | --influencer <id>");
  process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
