import { randomBytes } from "node:crypto";
import { prisma } from "@infulancer/core/db";
import type { Actor } from "@infulancer/core/access/actor";
import { formatKurus } from "@infulancer/core/domain/labels";
import { respondOffer } from "@infulancer/core/domain/offers";
import { computeBalances } from "@infulancer/core/domain/ledger";
import { submitGeneration } from "@infulancer/core/creative/generate";
import { ensureStarterCredits } from "@infulancer/core/creative/credits";
import { createShortLink } from "@infulancer/core/notify/shortlink";
import { getLlm } from "@infulancer/core/llm/index";
import { parseJsonObject } from "@infulancer/core/llm/bedrock";
import { envStr } from "@infulancer/core/env";
import { BRAND_NAME } from "@infulancer/core/brand";
import { ownTenant } from "@/lib/creative-tenant";
import { allowedActions, COPILOT_ACTIONS, COPILOT_SUGGESTIONS, matchIntent, type CopilotAction, type CopilotForm, type CopilotRole } from "@infulancer/core/copilot/intents";

export type NextStep = { title: string; detail: string; href: string; tone: "critical" | "warn" | "info" | "ok" };
export type CopilotWelcome = { role: CopilotRole; userId: string; name: string; greeting: string; steps: NextStep[]; suggestions: string[]; brands: { id: string; name: string }[]; brandExecutionMode?: "SELF" | "AJANS" };
export type CopilotAnswer = { reply: string; actions: CopilotAction[]; form?: CopilotForm; steps?: NextStep[]; source: "kural" | "ai" };

const DAY = 24 * 60 * 60 * 1000;
const STAFF_BLOCKED = new Set(["finance", "users", "landing"]);
/** Ajans çalışanı yönetici ekranlarına bağlantı görmez. */
const forActor = (actor: Actor, list: CopilotAction[]) => (actor.staffRole ? list.filter((a) => !STAFF_BLOCKED.has(a.id)) : list);
const OPEN_DELIVERABLE = ["ATANDI", "BRIEF_GONDERILDI", "ICERIK_YUKLENDI", "REVIZYON", "ONAYLANDI"] as const;

/** Rol başına "bugün ne yapmalıyım" listesi — yalnız aktörün görebileceği verilerden. */
export async function nextSteps(actor: Actor): Promise<NextStep[]> {
  const now = new Date();
  const steps: NextStep[] = [];
  if (actor.role === "ADMIN") {
    const [apps, drafts, late, payoutReq, findings, setupDrafts, unpaid] = await Promise.all([
      prisma.signupApplication.count({ where: { status: "PENDING" } }),
      prisma.deliverable.count({ where: { status: "ICERIK_YUKLENDI", assignment: { contractStatus: { not: "RED" } } } }),
      prisma.deliverable.count({ where: { status: { in: [...OPEN_DELIVERABLE] }, plannedAt: { lt: now }, assignment: { contractStatus: { not: "RED" } } } }),
      prisma.payoutRequest.aggregate({ where: { status: "TALEP_EDILDI" }, _count: true, _sum: { amountKurus: true } }),
      prisma.agentRun.count({ where: { status: "ACIK", severity: { in: ["KRITIK", "UYARI"] } } }),
      prisma.campaign.findMany({ where: { status: "TASLAK" }, select: { id: true, name: true, _count: { select: { assignments: true, briefs: true } } }, take: 20 }),
      prisma.campaign.count({ where: { status: "KAPANDI", brandPaymentReceivedAt: null } }),
    ]);
    if (late) steps.push({ title: `${late} geciken yayın`, detail: "Planlanan tarihi geçmiş işler; influencer'la iletişime geçin veya yeniden planlayın.", href: "/admin/takvim", tone: "critical" });
    if (findings) steps.push({ title: `${findings} açık agent uyarısı`, detail: "Uyum, çakışma veya metrik tutarsızlığı bulguları.", href: "/admin/agent", tone: "critical" });
    if (drafts) steps.push({ title: `${drafts} taslak onay bekliyor`, detail: "Yüklenen içerikleri inceleyin, onaylayın veya revizyon isteyin.", href: "/admin", tone: "warn" });
    const accepted = await prisma.offer.count({ where: { status: "KABUL" } });
    if (accepted) steps.push({ title: `${accepted} kabul edilen teklif`, detail: "Kampanyaya ekleyin.", href: "/admin/teklifler", tone: "warn" });
    if (apps) steps.push({ title: `${apps} üyelik başvurusu`, detail: "Davetle gelen başvuruları onaylayın veya reddedin.", href: "/admin/davetler", tone: "warn" });
    if (payoutReq._count && !actor.staffRole) steps.push({ title: `${payoutReq._count} çekim talebi · ${formatKurus(payoutReq._sum.amountKurus ?? 0)}`, detail: "Onaylayıp ödeme listesine alın.", href: "/admin/finans", tone: "warn" });
    for (const c of setupDrafts.filter((c) => c._count.assignments === 0 || c._count.briefs === 0).slice(0, 3)) {
      steps.push({
        title: `“${c.name}” kurulumu eksik`,
        detail: c._count.assignments === 0 ? "Henüz influencer eklenmedi." : "Brief yazılmadı.",
        href: `/admin/kampanyalar/${c.id}/kurulum`,
        tone: "info",
      });
    }
    if (unpaid) steps.push({ title: `${unpaid} kampanyada marka tahsilatı bekliyor`, detail: "Kapanmış ama ödemesi işaretlenmemiş kampanyalar.", href: "/admin/kampanyalar?durum=KAPANDI", tone: "info" });
  } else if (actor.role === "BRAND" && actor.brandId) {
    const brandId = actor.brandId;
    const [toReview, active, openConv, tenant] = await Promise.all([
      prisma.deliverable.count({ where: { status: "ICERIK_YUKLENDI", assignment: { campaign: { brandId }, contractStatus: { not: "RED" } } } }),
      prisma.campaign.findMany({ where: { brandId, status: "AKTIF" }, select: { id: true, name: true, endsAt: true }, take: 5 }),
      prisma.conversation.count({ where: { tenantId: brandId, status: { not: "closed" } } }),
      prisma.tenantSettings.findUnique({ where: { tenantId: brandId }, select: { mode: true } }),
    ]);
    const answered = await prisma.offer.count({ where: { brandId, status: { in: ["KABUL", "RED"] }, respondedAt: { gte: new Date(now.getTime() - 7 * DAY) } } });
    if (answered) steps.push({ title: `${answered} teklif yanıtlandı`, detail: "Son 7 günde gelen kabul/red yanıtları.", href: "/marka/teklifler", tone: "info" });
    if (toReview) steps.push({ title: `${toReview} içerik onayınızı bekliyor`, detail: "Yayın öncesi taslakları onaylayın veya revizyon notu yazın.", href: "/marka", tone: "warn" });
    if (openConv) steps.push({ title: `${openConv} açık konuşma`, detail: "WhatsApp / Instagram DM gelen kutunuzda yanıt bekleyenler.", href: "/marka/gelen-kutusu", tone: "info" });
    for (const c of active) {
      const left = Math.ceil((c.endsAt.getTime() - now.getTime()) / DAY);
      steps.push({ title: `“${c.name}” sürüyor`, detail: left > 0 ? `Bitişe ${left} gün. Skor ve erişimi takip edin.` : "Bitiş tarihi geldi; rapor hazırlanıyor.", href: `/marka/kampanyalar/${c.id}`, tone: "ok" });
    }
    if (tenant?.mode !== "production") steps.push({ title: "Mesaj kanalları sandbox modunda", detail: "Canlı mesajlaşma için kanal kurulumunu ve uyum adımlarını tamamlayın.", href: "/marka/kanallar", tone: "info" });
  } else if (actor.role === "INFLUENCER" && actor.influencerId) {
    const influencerId = actor.influencerId;
    const [offers, revisions, upcoming, accounts, balance] = await Promise.all([
      prisma.assignment.count({ where: { influencerId, contractStatus: "TEKLIF" } }),
      prisma.deliverable.count({ where: { status: "REVIZYON", assignment: { influencerId } } }),
      prisma.deliverable.findMany({
        where: { assignment: { influencerId, contractStatus: "KABUL" }, status: { in: [...OPEN_DELIVERABLE] }, plannedAt: { gte: now, lt: new Date(now.getTime() + 7 * DAY) } },
        orderBy: { plannedAt: "asc" },
        take: 3,
        select: { id: true, plannedAt: true, assignment: { select: { campaign: { select: { name: true } } } } },
      }),
      prisma.socialAccount.findMany({ where: { influencerId }, select: { syncSource: true, syncError: true } }),
      prisma.ledgerEntry.groupBy({ by: ["direction"], where: { influencerId, account: "INFLUENCER_PAYABLE", OR: [{ availableAt: null }, { availableAt: { lte: now } }] }, _sum: { amountKurus: true } }),
    ]);
    const [brandOffers, rates] = await Promise.all([
      prisma.offer.count({ where: { influencerId, status: "GONDERILDI", expiresAt: { gt: now } } }),
      prisma.rateCard.count({ where: { influencerId, active: true } }),
    ]);
    if (brandOffers) steps.push({ title: `${brandOffers} marka teklifi yanıt bekliyor`, detail: "7 gün içinde kabul veya reddedin.", href: "/influencer/teklifler", tone: "warn" });
    if (!rates) steps.push({ title: "Fiyat listenizi girin", detail: "Markalar sizi fiyatınızla bulup teklif gönderebilsin.", href: "/influencer/teklifler?sekme=fiyat", tone: "info" });
    if (offers) steps.push({ title: `${offers} yeni teklif`, detail: "Kabul veya red seçin; süresi geçen teklif başka üreticiye gidebilir.", href: "/influencer", tone: "warn" });
    if (revisions) steps.push({ title: `${revisions} iş revizyon bekliyor`, detail: "Notu okuyup yeni taslağı yükleyin.", href: "/influencer", tone: "critical" });
    for (const d of upcoming) steps.push({ title: `Yaklaşan yayın: ${d.assignment.campaign.name}`, detail: `${d.plannedAt.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium", timeStyle: "short" })}`, href: `/influencer/isler/${d.id}`, tone: "info" });
    const credit = balance.find((b) => b.direction === "CREDIT")?._sum.amountKurus ?? 0;
    const debit = balance.find((b) => b.direction === "DEBIT")?._sum.amountKurus ?? 0;
    if (credit - debit > 0) steps.push({ title: `Çekilebilir bakiye: ${formatKurus(credit - debit)}`, detail: "Ödemeler sayfasından çekim talebi açabilirsiniz.", href: "/influencer/odemeler", tone: "ok" });
    if (accounts.length === 0 || accounts.some((a) => a.syncError)) steps.push({ title: "Sosyal hesaplarınızı bağlayın", detail: "Takipçi verileriniz otomatik güncellenir, daha çok teklif alırsınız.", href: "/influencer/hesaplar", tone: "info" });
  }
  if (steps.length === 0) steps.push({ title: "Her şey yolunda", detail: "Bekleyen bir işiniz yok. Yeni bir şey başlatmak için aşağıdan seçin.", href: actor.role === "ADMIN" ? "/admin" : actor.role === "BRAND" ? "/marka" : "/influencer", tone: "ok" });
  return steps.slice(0, 6);
}

export async function copilotWelcome(actor: Actor): Promise<CopilotWelcome> {
  const [user, steps, brands, brandCfg] = await Promise.all([
    prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } }),
    nextSteps(actor),
    actor.role === "ADMIN" ? prisma.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true }, take: 300 }) : Promise.resolve([]),
    actor.role === "BRAND" && actor.brandId ? prisma.brand.findUnique({ where: { id: actor.brandId }, select: { defaultExecutionMode: true } }) : Promise.resolve(null),
  ]);
  const first = (user?.name ?? "").split(" ")[0] ?? "";
  const hour = Number(new Date().toLocaleString("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", hour12: false }));
  const hello = hour < 12 ? "Günaydın" : hour < 18 ? "İyi günler" : "İyi akşamlar";
  const role = actor.role as CopilotRole;
  const brandExecutionMode = brandCfg?.defaultExecutionMode ?? (role === "BRAND" ? "AJANS" : undefined);
  const intro =
    role === "ADMIN"
      ? "Ajans operasyonunuzu birlikte yönetelim. Bugün öncelikli olanlar:"
      : role === "BRAND"
        ? brandExecutionMode === "SELF"
          ? "Kampanyalarınızı kendi yönetiminizle (Manuel mod) birlikte takip edelim. Bugün dikkat etmeniz gerekenler:"
          : "Ajansla yürüttüğünüz kampanyaları birlikte takip edelim. Bugün dikkat etmeniz gerekenler:"
        : "İşlerinizi ve ödemelerinizi birlikte takip edelim. Bugün sizi bekleyenler:";
  const suggestions =
    role === "BRAND" && brandExecutionMode === "SELF"
      ? COPILOT_SUGGESTIONS.BRAND.map((s) => (s === "Yeni kampanya talep et" ? "Yeni kampanya başlat" : s))
      : COPILOT_SUGGESTIONS[role];
  return { role, userId: actor.userId, brands, brandExecutionMode, name: user?.name ?? "", greeting: `${hello}${first ? ` ${first}` : ""}! ${intro}`, steps, suggestions };
}

const ROLE_TR: Record<CopilotRole, string> = { ADMIN: "ajans yöneticisi", BRAND: "marka kullanıcısı", INFLUENCER: "içerik üreticisi" };

const normText = (s: string) =>
  s
    .trim()
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");

async function executeCopilotTool(
  actor: Actor,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ reply: string; actionIds: string[] } | null> {
  const role = actor.role as CopilotRole;
  const appBase = envStr("APP_URL", "https://nordvow.com").replace(/\/$/, "");
  const now = new Date();

  switch (toolName) {
    case "shorten_link": {
      const url = String(args.url ?? "").trim();
      if (!/^https?:\/\/\S+/i.test(url)) return null;
      const res = await createShortLink(url, { label: "copilot", createdByUserId: actor.userId });
      return {
        reply: `Kısa linkiniz oluşturuldu:\n${res.shortUrl}`,
        actionIds: role === "ADMIN" ? ["shortlinks"] : ["campaigns"],
      };
    }

    case "create_creative": {
      const kind = String(args.kind ?? "image") === "video" ? "video" : "image";
      const prompt = String(args.prompt ?? "").trim();
      if (prompt.length < 5) {
        return {
          reply: `Ne tür bir ${kind === "video" ? "video" : "görsel"} üretmemi istediğinizi birkaç kelimeyle yazın (örn: "görsel üret: pastel stüdyoda kahve çekimi").`,
          actionIds: ["creative"],
        };
      }
      const tenantId = ownTenant(actor);
      if (role !== "ADMIN") await ensureStarterCredits(tenantId);
      const model = await prisma.modelRegistry.findFirst({
        where: { status: "active", kind, provider: "fal" },
        orderBy: { creditsPerUnit: "asc" },
      });
      if (!model) {
        return { reply: "Şu an aktif üretim modeli bulunamadı.", actionIds: ["creative"] };
      }
      const aspectRaw = String(args.aspect ?? "9:16");
      const aspect = (aspectRaw === "1:1" || aspectRaw === "4:5" || aspectRaw === "16:9" ? aspectRaw : "9:16") as "9:16" | "1:1" | "4:5" | "16:9";
      try {
        await submitGeneration({
          tenantId,
          modelKey: model.key,
          prompt,
          aspect,
          seconds: kind === "video" ? 5 : undefined,
        });
        return {
          reply: `${kind === "video" ? "Video" : "Görsel"} üretiminiz (${model.key}, ${aspect}) başlatıldı ve tamamlandığında otomatik olarak Kitaplığınıza kaydedilecek. Creative Stüdyo'dan takip edip telefonda formatlayabilirsiniz.`,
          actionIds: ["creative"],
        };
      } catch (e) {
        return {
          reply: `Üretim başlatılamadı: ${(e as Error).message}`,
          actionIds: ["creative"],
        };
      }
    }

    case "check_balance": {
      const tenantId = ownTenant(actor);
      if (role !== "ADMIN") await ensureStarterCredits(tenantId);
      const acc = await prisma.creditAccount.findUnique({ where: { tenantId }, select: { balanceCredits: true, heldCredits: true } });
      const avail = Number(acc?.balanceCredits ?? 0) - Number(acc?.heldCredits ?? 0);
      const lines = [`Creative Stüdyo Krediniz: ${avail.toLocaleString("tr-TR")} Kredi`];
      if (role === "INFLUENCER" && actor.influencerId) {
        const bal = await computeBalances(actor.influencerId, now);
        lines.push(`Çekilebilir Hakediş Bakiyeniz: ${formatKurus(bal.cekilebilir)}`);
        if (bal.hakedilen > 0) lines.push(`Hakedilen (Vadesi Bekleyen): ${formatKurus(bal.hakedilen)}`);
      }
      return {
        reply: lines.join("\n"),
        actionIds: role === "INFLUENCER" ? ["payouts", "creative"] : role === "ADMIN" ? ["credit-requests", "finance", "creative"] : ["creative"],
      };
    }

    case "request_credits": {
      const amount = Math.max(50, Math.min(100_000, Number(args.amount ?? 500) || 500));
      const tenantId = ownTenant(actor);
      if (role === "ADMIN") {
        return {
          reply: "Yönetici olarak Creative Stüdyo > Yönetim sekmesinden istediğiniz hesaba doğrudan kredi yükleyebilirsiniz.",
          actionIds: ["creative", "credit-requests"],
        };
      }
      const existing = await prisma.creditRequest.findFirst({ where: { tenantId, status: "BEKLIYOR" }, select: { id: true } });
      if (existing) {
        return {
          reply: "Halihazırda incelenmeyi bekleyen bir kredi talebiniz bulunuyor.",
          actionIds: ["creative"],
        };
      }
      await prisma.creditRequest.create({
        data: {
          tenantId,
          requestedByUserId: actor.userId,
          role: actor.role,
          amountTry: amount,
          note: "AI Asistan üzerinden talep edildi",
        },
      });
      return {
        reply: `${amount.toLocaleString("tr-TR")} Kredi yükleme talebiniz oluşturuldu ve yönetici onayına iletildi.`,
        actionIds: ["creative"],
      };
    }

    case "list_offers": {
      if (role === "INFLUENCER" && actor.influencerId) {
        const offers = await prisma.offer.findMany({
          where: { influencerId: actor.influencerId, status: { in: ["GONDERILDI", "KARSI_TEKLIF"] }, expiresAt: { gt: now } },
          orderBy: { createdAt: "desc" },
          take: 5,
        });
        if (!offers.length) return { reply: "Şu an yanıt bekleyen aktif teklifiniz bulunmuyor.", actionIds: ["offers", "applications"] };
        const list = offers.map((o, i) => `${i + 1}. "${o.title}" — ${formatKurus(o.counterKurus ?? o.totalKurus)} (${o.status})`).join("\n");
        return {
          reply: `Bekleyen teklifleriniz:\n${list}\n\nBuradan doğrudan "1. teklifi kabul et" veya "1. teklifi reddet" yazarak yanıtlayabilirsiniz.`,
          actionIds: ["offers"],
        };
      }
      if (role === "BRAND" && actor.brandId) {
        const offers = await prisma.offer.findMany({ where: { brandId: actor.brandId }, orderBy: { createdAt: "desc" }, take: 5 });
        if (!offers.length) return { reply: "Henüz gönderdiğiniz bir teklif yok. Influencer bul sayfasından tek tıkla teklif gönderebilirsiniz.", actionIds: ["discover", "offers"] };
        const list = offers.map((o, i) => `${i + 1}. "${o.title}" — ${formatKurus(o.counterKurus ?? o.totalKurus)} (${o.status})`).join("\n");
        return { reply: `Son gönderdiğiniz teklifler:\n${list}`, actionIds: ["offers", "discover"] };
      }
      const offers = await prisma.offer.findMany({ orderBy: { createdAt: "desc" }, take: 5 });
      if (!offers.length) return { reply: "Sistemde henüz kayıtlı teklif yok.", actionIds: ["offers"] };
      const list = offers.map((o, i) => `${i + 1}. "${o.title}" — ${formatKurus(o.counterKurus ?? o.totalKurus)} (${o.status})`).join("\n");
      return { reply: `Sistemdeki son teklifler:\n${list}`, actionIds: ["offers"] };
    }

    case "respond_offer": {
      if (role !== "INFLUENCER" || !actor.influencerId) return null;
      const decision = String(args.decision ?? "KABUL").toUpperCase() === "RED" ? "RED" : "KABUL";
      const idx = Math.max(0, (Number(args.index ?? 1) || 1) - 1);
      const offers = await prisma.offer.findMany({
        where: { influencerId: actor.influencerId, status: { in: ["GONDERILDI", "KARSI_TEKLIF"] }, expiresAt: { gt: now } },
        orderBy: { createdAt: "desc" },
        take: 5,
      });
      const target = offers[idx];
      if (!target) return { reply: "Bu sırada bekleyen bir teklif bulunamadı.", actionIds: ["offers"] };
      await respondOffer(target.id, actor.influencerId, decision, decision === "RED" ? String(args.note ?? "Asistan üzerinden reddedildi") : null, now);
      return {
        reply: decision === "KABUL" ? `"${target.title}" teklifi kabul edildi!` : `"${target.title}" teklifi reddedildi.`,
        actionIds: ["offers", "jobs"],
      };
    }

    case "create_invite": {
      if (role === "BRAND") return null;
      const targetRole = role === "ADMIN" && String(args.targetRole ?? "").toUpperCase() === "BRAND" ? "BRAND" : "INFLUENCER";
      const code = randomBytes(4).toString("hex").toUpperCase();
      await prisma.invite.create({
        data: {
          code,
          targetRole,
          createdById: actor.userId,
          inviterInfluencerId: role === "INFLUENCER" ? actor.influencerId : null,
          maxUses: role === "ADMIN" ? 5 : 3,
          expiresAt: new Date(Date.now() + 14 * DAY),
          note: "AI Asistan ile oluşturuldu",
        },
      });
      return {
        reply: `Yeni ${targetRole === "BRAND" ? "Marka" : "Influencer"} davet kodunuz oluşturuldu: ${code}\nKayıt bağlantısı: ${appBase}/kayit?kod=${code}`,
        actionIds: role === "ADMIN" ? ["invites"] : ["invite"],
      };
    }

    case "approve_deliverable": {
      if (role === "INFLUENCER") return null;
      const where =
        role === "BRAND" && actor.brandId
          ? { status: "ICERIK_YUKLENDI" as const, assignment: { campaign: { brandId: actor.brandId } } }
          : { status: "ICERIK_YUKLENDI" as const };
      const pending = await prisma.deliverable.findFirst({
        where,
        orderBy: { updatedAt: "desc" },
        select: { id: true, platform: true, contentType: true, assignment: { select: { campaign: { select: { name: true } }, influencer: { select: { name: true } } } } },
      });
      if (!pending) return { reply: "Şu an onay bekleyen yüklenmiş bir içerik taslağı bulunmuyor.", actionIds: ["campaigns"] };
      await prisma.$transaction([
        prisma.deliverableReview.create({
          data: { deliverableId: pending.id, brandUserId: actor.userId, decision: "ONAY", note: "AI Asistan üzerinden onaylandı." },
        }),
        prisma.deliverable.update({ where: { id: pending.id }, data: { status: "ONAYLANDI" } }),
      ]);
      return {
        reply: `${pending.assignment.influencer.name} tarafından "${pending.assignment.campaign.name}" kampanyası için yüklenen ${pending.platform} ${pending.contentType} taslağı onaylandı.`,
        actionIds: ["campaigns", "calendar"],
      };
    }

    case "list_campaigns": {
      const where = role === "BRAND" && actor.brandId ? { brandId: actor.brandId } : role === "INFLUENCER" && actor.influencerId ? { assignments: { some: { influencerId: actor.influencerId } } } : {};
      const rows = await prisma.campaign.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: 6,
        select: { name: true, status: true, startsAt: true, endsAt: true },
      });
      if (!rows.length) return { reply: "Henüz kayıtlı bir kampanya bulunmuyor.", actionIds: ["campaigns"] };
      const list = rows.map((c, i) => `${i + 1}. "${c.name}" — ${c.status} (${c.startsAt.toLocaleDateString("tr-TR")} – ${c.endsAt.toLocaleDateString("tr-TR")})`).join("\n");
      return { reply: `Kampanyalar:\n${list}`, actionIds: ["campaigns", "calendar"] };
    }

    case "list_influencers": {
      if (role === "INFLUENCER") return null;
      const rows = await prisma.influencer.findMany({
        where: { user: { status: "ACTIVE" } },
        orderBy: { name: "asc" },
        take: 6,
        select: { name: true, category: true, city: true, socialAccounts: { select: { platform: true, followers: true } } },
      });
      if (!rows.length) return { reply: "Sistemde aktif influencer bulunmuyor.", actionIds: role === "ADMIN" ? ["influencers"] : ["discover"] };
      const list = rows
        .map((inf, i) => {
          const total = inf.socialAccounts.reduce((s, a) => s + a.followers, 0);
          return `${i + 1}. ${inf.name} (${inf.category}${inf.city ? `, ${inf.city}` : ""}) — ${total.toLocaleString("tr-TR")} takipçi`;
        })
        .join("\n");
      return { reply: `Öne çıkan influencerlar:\n${list}`, actionIds: role === "ADMIN" ? ["influencers"] : ["discover"] };
    }

    case "list_jobs": {
      const where =
        role === "INFLUENCER" && actor.influencerId
          ? { assignment: { influencerId: actor.influencerId }, status: { notIn: ["TAMAMLANDI", "IPTAL"] as ("TAMAMLANDI" | "IPTAL")[] } }
          : role === "BRAND" && actor.brandId
            ? { assignment: { campaign: { brandId: actor.brandId } }, status: { notIn: ["TAMAMLANDI", "IPTAL"] as ("TAMAMLANDI" | "IPTAL")[] } }
            : { status: { notIn: ["TAMAMLANDI", "IPTAL"] as ("TAMAMLANDI" | "IPTAL")[] } };
      const rows = await prisma.deliverable.findMany({
        where,
        orderBy: { plannedAt: "asc" },
        take: 6,
        select: { platform: true, contentType: true, status: true, plannedAt: true, assignment: { select: { campaign: { select: { name: true } } } } },
      });
      if (!rows.length) return { reply: "Bekleyen aktif iş veya teslim bulunmuyor.", actionIds: [role === "INFLUENCER" ? "jobs" : "campaigns"] };
      const list = rows.map((d, i) => `${i + 1}. ${d.assignment.campaign.name} — ${d.platform} ${d.contentType} (${d.status}, ${d.plannedAt.toLocaleDateString("tr-TR")})`).join("\n");
      return { reply: `Aktif işler ve teslimler:\n${list}`, actionIds: [role === "INFLUENCER" ? "jobs" : "campaigns", "calendar"] };
    }

    case "list_creative": {
      const tenantId = ownTenant(actor);
      const assets = await prisma.generatedAsset.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { modelKey: true, createdAt: true },
      });
      if (!assets.length) return { reply: "Creative Stüdyo'da henüz üretilmiş bir görsel veya video yok. Doğrudan buradan \"görsel üret: ...\" yazarak başlayabilirsiniz.", actionIds: ["creative"] };
      const list = assets.map((a, i) => `${i + 1}. ${a.modelKey} (${a.createdAt.toLocaleDateString("tr-TR")})`).join("\n");
      return { reply: `Son Creative Stüdyo üretimleriniz:\n${list}`, actionIds: ["creative"] };
    }

    default:
      return null;
  }
}

async function buildCampaignStatusAnswer(
  actor: Actor,
  message: string,
  history: { role: "user" | "assistant"; text: string }[],
): Promise<{ reply: string; actionIds: string[] }> {
  const role = actor.role as CopilotRole;
  const where =
    role === "BRAND" && actor.brandId
      ? { brandId: actor.brandId, status: { not: "IPTAL" as const } }
      : role === "INFLUENCER" && actor.influencerId
        ? { assignments: { some: { influencerId: actor.influencerId, contractStatus: { not: "RED" as const } } }, status: { not: "IPTAL" as const } }
        : { status: { not: "IPTAL" as const } };

  const camps = await prisma.campaign.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 10,
    include: {
      brand: { select: { name: true } },
      assignments: {
        where: { contractStatus: { not: "RED" } },
        include: {
          influencer: { select: { name: true } },
          deliverables: { select: { id: true, platform: true, contentType: true, status: true, publishedAt: true } },
        },
      },
    },
  });

  if (!camps.length) {
    return {
      reply: "Sistemde henüz takip edilen bir kampanya bulunmuyor.",
      actionIds: [role === "INFLUENCER" ? "jobs" : "campaigns"],
    };
  }

  const n = normText(message);
  const matchedCamp = camps.find((c) => n.includes(normText(c.name)));
  const wantsGeneral = /\b(genel|ozet|tumu|hepsi)\b/.test(n);
  const prevAskedCampaignChoice = history
    .slice(-2)
    .some((h) => h.role === "assistant" && h.text.includes("Genel özet mi"));

  // Eğer kullanıcı belirli bir kampanya adı yazdıysa doğrudan o kampanyanın detaylı analizini ver
  if (matchedCamp) {
    const allDeliv = matchedCamp.assignments.flatMap((a) => a.deliverables);
    const doneCount = allDeliv.filter((d) => ["YAYINLANDI", "TAMAMLANDI"].includes(d.status)).length;
    const trackers = await prisma.trackerAgent.findMany({
      where: { scope: "CAMPAIGN", targetId: matchedCamp.id },
      select: { name: true, lastFindings: true, lastRunAt: true },
    });
    const offersCount = await prisma.offer.groupBy({
      by: ["status"],
      where: { campaignId: matchedCamp.id },
      _count: true,
    });
    const offerSummary = offersCount.map((o) => `${o.status}: ${o._count}`).join(" · ") || "Henüz teklif yok";
    const trackerSummary = trackers.length
      ? trackers
          .map((t) => {
            const fCount = Array.isArray(t.lastFindings) ? t.lastFindings.length : 0;
            return `• ${t.name}: ${fCount} bulgu`;
          })
          .join("\n")
      : "• Takip botu kuruluyor";

    return {
      reply:
        `📊 **${matchedCamp.name}** (${matchedCamp.status}) Detaylı Durumu:\n` +
        `• Marka: ${matchedCamp.brand.name}\n` +
        `• Tarih: ${matchedCamp.startsAt.toLocaleDateString("tr-TR")} – ${matchedCamp.endsAt.toLocaleDateString("tr-TR")}\n` +
        `• Atanan Influencer: ${matchedCamp.assignments.length} (${matchedCamp.assignments.map((a) => a.influencer.name).join(", ") || "Henüz yok"})\n` +
        `• Görev Tamamlama: ${doneCount} / ${allDeliv.length} içerik yayınlandı\n` +
        `• Teklif Durumları: ${offerSummary}\n` +
        `• Otomatik Takip Botları:\n${trackerSummary}`,
      actionIds: [role === "INFLUENCER" ? "jobs" : "campaigns"],
    };
  }

  // Kullanıcı "genel" veya "özet" seçtiyse tüm kampanyaların özetini ver
  if (wantsGeneral || (prevAskedCampaignChoice && n.length <= 20)) {
    const lines = camps.map((c, i) => {
      const allDeliv = c.assignments.flatMap((a) => a.deliverables);
      const done = allDeliv.filter((d) => ["YAYINLANDI", "TAMAMLANDI"].includes(d.status)).length;
      return `${i + 1}. **${c.name}** — ${c.status} · ${c.assignments.length} influencer · ${done}/${allDeliv.length} içerik tamam`;
    });
    return {
      reply: `📋 **Tüm Kampanyaların Genel Özeti:**\n${lines.join("\n")}\n\nBelirli bir kampanyanın detayını öğrenmek için kampanya adını yazabilirsiniz.`,
      actionIds: [role === "INFLUENCER" ? "jobs" : "campaigns"],
    };
  }

  // İlk soruda "Nasıl bir bilgi istiyorsunuz? Genel özet mi, yoksa belirli bir kampanya detayı mı?" diye sor
  const names = camps.slice(0, 6).map((c, i) => `${i + 1}. ${c.name} (${c.status})`).join("\n");
  return {
    reply:
      `Kampanyalarınız hakkında nasıl bir bilgi istersiniz? **Genel özet mi** göstereyim, yoksa belirli bir kampanya hakkında **detaylı bilgi** mi vereyim?\n\n` +
      `Mevcut kampanyalarınız:\n${names}\n\n` +
      `_"Genel özet"_ yazabilir veya detayını istediğiniz kampanyanın adını paylaşabilirsiniz.`,
    actionIds: [role === "INFLUENCER" ? "jobs" : "campaigns"],
  };
}

async function detectAndExecuteCommand(
  actor: Actor,
  message: string,
  history: { role: "user" | "assistant"; text: string }[] = [],
): Promise<{ reply: string; actionIds: string[] } | null> {
  const n = normText(message);
  const prevAskedCampaignChoice = history
    .slice(-2)
    .some((h) => h.role === "assistant" && h.text.includes("Genel özet mi"));
  if (
    /(kampanyalarin durumu|kampanya durumu|kampanyalar nasil|kampanyalar hakkinda|kampanyalari ozetle)/.test(n) ||
    (prevAskedCampaignChoice && (/\b(genel|ozet|detay)\b/.test(n) || n.length > 2))
  ) {
    // Eğer prevAskedCampaignChoice true ama mesaj bambaşka bir komutsa (bakiye, görsel üret vb.) aşağıdaki komutlara düşsün
    const isOtherCmd = /^(?:bakiye|kredi|teklif|resim|gorsel|video|davet)/.test(n);
    if (!isOtherCmd) {
      return buildCampaignStatusAnswer(actor, message, history);
    }
  }
  const url = message.match(/https?:\/\/\S+/i)?.[0];
  if (url && (n.includes("kisalt") || n.startsWith("link "))) {
    return executeCopilotTool(actor, "shorten_link", { url });
  }
  const creativeMatch = message.match(/^(?:resim|gorsel|görsel|fotograf|fotoğraf|video)\s+(?:uret|üret|olustur|oluştur|yap)\s*[:-]?\s+([\s\S]+)$/i);
  if (creativeMatch) {
    const isVideo = /^video/i.test(message.trim());
    const aspect = message.includes("16:9") ? "16:9" : message.includes("4:5") ? "4:5" : message.includes("1:1") ? "1:1" : "9:16";
    return executeCopilotTool(actor, "create_creative", { kind: isVideo ? "video" : "image", prompt: creativeMatch[1]!.trim(), aspect });
  }
  if (/^(?:bakiye|bakiye sorgula|kredi|kredim|kredi bakiyem|bakiyem ne kadar)/.test(n)) {
    return executeCopilotTool(actor, "check_balance", {});
  }
  const creditReqMatch = n.match(/(\d+)\s*kredi\s*(?:talep|yukle|iste)/);
  if (creditReqMatch) {
    return executeCopilotTool(actor, "request_credits", { amount: Number(creditReqMatch[1]) });
  }
  if (/^(?:teklifleri listele|tekliflerimi listele|bekleyen tekliflerim|bekleyen tekliflerimi goster|tekliflerim neler)/.test(n)) {
    return executeCopilotTool(actor, "list_offers", {});
  }
  const offerRespondMatch = n.match(/(?:(\d+)\.?\s*)?teklif\w*\s+(kabul|red|onayla)/) ?? n.match(/teklif\s+(kabul|red)\s+(\d+)/);
  if (offerRespondMatch) {
    const isFirstNum = /^\d+$/.test(offerRespondMatch[1] ?? "");
    const idx = isFirstNum ? Number(offerRespondMatch[1]) : Number(offerRespondMatch[2] || 1);
    const decWord = isFirstNum ? offerRespondMatch[2]! : offerRespondMatch[1]!;
    return executeCopilotTool(actor, "respond_offer", { index: idx || 1, decision: decWord.startsWith("red") ? "RED" : "KABUL" });
  }
  if (/(?:davet kodu uret|davet kodu olustur|influencer daveti olustur|marka daveti olustur|arkadas daveti olustur)/.test(n)) {
    return executeCopilotTool(actor, "create_invite", { targetRole: n.includes("marka") ? "BRAND" : "INFLUENCER" });
  }
  if (/(?:bekleyen taslagi onayla|son taslagi onayla|icerigi onayla)/.test(n)) {
    return executeCopilotTool(actor, "approve_deliverable", {});
  }
  if (/^(?:kampanyalar|kampanyalarim|kampanyalari listele|aktif kampanyalar)$/.test(n)) {
    return executeCopilotTool(actor, "list_campaigns", {});
  }
  if (/^(?:influencerlar|influencerlari listele|influencer listesi)$/.test(n)) {
    return executeCopilotTool(actor, "list_influencers", {});
  }
  if (/^(?:isler|islerim|teslimler|islerimi listele)$/.test(n)) {
    return executeCopilotTool(actor, "list_jobs", {});
  }
  if (/^(?:creative|uretimlerim|galerim|kitapligim)$/.test(n)) {
    return executeCopilotTool(actor, "list_creative", {});
  }
  return null;
}

/**
 * Yanıt: önce doğrudan eylem/komut yürütücü, ardından kural motoru ve Bedrock AI.
 * LLM_PROVIDER=bedrock ise model hem doğal yanıt üretir hem de gerekirse sistem aracını (`tool`) tetikler.
 */
export async function copilotAnswer(actor: Actor, message: string, history: { role: "user" | "assistant"; text: string }[]): Promise<CopilotAnswer> {
  const role = actor.role as CopilotRole;

  // 1. Doğrudan komut eşleşmesi varsa anında çalıştır
  const direct = await detectAndExecuteCommand(actor, message, history);
  if (direct) {
    return {
      reply: direct.reply,
      actions: forActor(actor, allowedActions(role, direct.actionIds)),
      source: "ai",
    };
  }

  const brandCfg = role === "BRAND" && actor.brandId ? await prisma.brand.findUnique({ where: { id: actor.brandId }, select: { defaultExecutionMode: true } }) : null;
  const isSelfBrand = role === "BRAND" && brandCfg?.defaultExecutionMode === "SELF";
  const rule = matchIntent(role, message);
  const steps = rule.intent === "summary" ? await nextSteps(actor) : undefined;
  const baseReply =
    rule.intent === "summary"
      ? "Bugün öncelikli olanlar aşağıda. Birine tıklayarak doğrudan ilgili sayfaya gidebilirsiniz."
      : isSelfBrand && rule.intent === "campaign-start"
        ? "Manuel çalışma modundasınız: ajansa talep göndermeden doğrudan kendi kampanya taslağınızı oluşturabilirsiniz. Aşağıdaki formu doldurarak hızlıca başlayın veya tam kampanya sihirbazını açın."
        : rule.reply;
  const base: CopilotAnswer = {
    reply: baseReply,
    actions: forActor(actor, allowedActions(role, rule.actions)),
    form: rule.form,
    steps,
    source: "kural",
  };
  if (envStr("LLM_PROVIDER", "mock") !== "bedrock") return base;
  try {
    const context = (steps ?? (await nextSteps(actor))).map((s) => `- ${s.title}: ${s.detail}`).join("\n");
    const catalog = forActor(actor, COPILOT_ACTIONS[role])
      .map((a) => `${a.id} = ${a.label}`)
      .join("\n");
    const convo = history
      .slice(-6)
      .map((h) => `${h.role === "user" ? "Kullanıcı" : "Asistan"}: ${h.text.slice(0, 500)}`)
      .join("\n");
    const res = await getLlm().completeText({
      promptVersion: "copilot-v2",
      system:
        `Sen ${BRAND_NAME} influencer & creative AI platformunun tam yetkili Türkçe asistanısın. Kullanıcı bir ${ROLE_TR[role]}. ` +
        "Kısa, net ve samimi yanıt ver (en fazla 5 cümle). Kullanıcının istediği işlemi doğrudan yapabiliyorsan `tool` alanını doldur:\n" +
        "- shorten_link: {\"url\": \"https://...\"}\n" +
        "- create_creative: {\"kind\": \"image\"|\"video\", \"prompt\": \"...\", \"aspect\": \"9:16\"|\"4:5\"|\"1:1\"|\"16:9\"}\n" +
        "- check_balance: {}\n" +
        "- request_credits: {\"amount\": 500}\n" +
        "- list_campaigns: {}\n" +
        "- list_influencers: {}\n" +
        "- list_jobs: {}\n" +
        "- list_creative: {}\n" +
        "- list_offers: {}\n" +
        "- respond_offer: {\"index\": 1, \"decision\": \"KABUL\"|\"RED\", \"note\": \"...\"}\n" +
        "- create_invite: {\"targetRole\": \"INFLUENCER\"|\"BRAND\"}\n" +
        "- approve_deliverable: {}\n" +
        "Yanıtı yalnız şu JSON olarak döndür: {\"reply\": string, \"actions\": string[] (en fazla 4, yalnız listedeki kimlikler), \"form\": \"campaign-start\" | \"campaign-request\" | null, \"tool\": {\"name\": string, \"args\": object} | null}. " +
        `campaign-start yalnız ajans yöneticisi, campaign-request yalnız marka için geçerlidir.`,
      prompt: `Kullanıcının anlık durumu:\n${context}\n\nİzinli eylemler:\n${catalog}\n\nÖnceki konuşma:\n${convo}\n\nYeni mesaj: ${message.slice(0, 1000)}`,
    });
    const json = parseJsonObject(res.text);
    const toolObj = json?.tool && typeof json.tool === "object" ? (json.tool as { name?: string; args?: Record<string, unknown> }) : null;
    if (toolObj?.name) {
      const executed = await executeCopilotTool(actor, toolObj.name, toolObj.args ?? {});
      if (executed) {
        const mergedActions = forActor(actor, allowedActions(role, [...executed.actionIds, ...(Array.isArray(json?.actions) ? json.actions : [])]));
        return {
          reply: executed.reply,
          actions: mergedActions.length ? mergedActions : base.actions,
          source: "ai",
        };
      }
    }
    const reply = typeof json?.reply === "string" ? json.reply.trim().slice(0, 1500) : "";
    if (!reply) return base;
    const form = json?.form === "campaign-start" && role === "ADMIN" ? "campaign-start" : json?.form === "campaign-request" && role === "BRAND" ? "campaign-request" : base.form;
    const actions = forActor(actor, allowedActions(role, json?.actions));
    return { reply, actions: actions.length ? actions : base.actions, form, steps, source: "ai" };
  } catch {
    return base;
  }
}
