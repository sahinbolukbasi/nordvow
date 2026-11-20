import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { createInvite, registerWithInvite } from "../src/access/invites";
import { backfillLegacyCategories } from "../src/domain/categories";
import {
  KVKK_ACCEPTANCE_DOC,
  LEGAL_VERSION,
  loginAcceptanceDocs,
  needsKvkkAcceptance,
  recordLegalAcceptances,
  requiredAcceptanceDocs,
} from "../src/legal/acceptance";
import { resetDb } from "./helpers";

describe("KVKK belgesi girişte istenmez", () => {
  it("kayıt listesinde vardır, giriş listesinde yoktur", () => {
    for (const role of ["BRAND", "INFLUENCER", "ADMIN", "AGENCY"] as const) {
      expect(requiredAcceptanceDocs(role)).toContain(KVKK_ACCEPTANCE_DOC);
      expect(loginAcceptanceDocs(role)).not.toContain(KVKK_ACCEPTANCE_DOC);
      expect(loginAcceptanceDocs(role)).toEqual(requiredAcceptanceDocs(role).filter((id) => id !== KVKK_ACCEPTANCE_DOC));
    }
  });
});

describe("kayıtta saklanan KVKK kabulü", () => {
  let admin: { userId: string; role: "ADMIN" };
  let catId: string;

  beforeAll(async () => {
    await resetDb();
    await backfillLegacyCategories();
    const a = await prisma.user.create({ data: { email: "adm-kvkk@ex.com", name: "Admin", role: "ADMIN", passwordHash: "x" } });
    admin = { userId: a.id, role: "ADMIN" };
    catId = (await prisma.category.findUniqueOrThrow({ where: { slug: "moda" } })).id;
  });

  it("onay kutusu olmadan kayıt olmaz ve kullanıcı oluşmaz", async () => {
    const inv = await createInvite(admin, { targetRole: "INFLUENCER" });
    await expect(
      registerWithInvite({
        code: inv.code,
        email: "kvkk-yok@ex.com",
        password: "GucluSifre123",
        name: "Yeni Kişi",
        phone: "+905321110001",
        acceptTerms: false,
        application: { kind: "INFLUENCER", categoryIds: [catId], instagram: "@kvkk.yok" },
      }),
    ).rejects.toThrow(/KVKK aydınlatma/);
    expect(await prisma.user.findUnique({ where: { email: "kvkk-yok@ex.com" } })).toBeNull();
    expect(await prisma.legalAcceptance.count({ where: { email: "kvkk-yok@ex.com" } })).toBe(0);
  });

  it("kayıt kabul zamanını saklar; giriş kaydı bunu silmez ve onaylı kullanıcıya tekrar gerekmez", async () => {
    const inv = await createInvite(admin, { targetRole: "INFLUENCER" });
    const user = await registerWithInvite({
      code: inv.code,
      email: "kvkk-var@ex.com",
      password: "GucluSifre123",
      name: "Yeni Kişi",
      phone: "+905321110002",
      acceptTerms: true,
      application: { kind: "INFLUENCER", categoryIds: [catId], instagram: "@kvkk.var" },
    });
    expect(await needsKvkkAcceptance(user.id)).toBe(false);
    const stored = await prisma.legalAcceptance.findFirstOrThrow({ where: { userId: user.id, document: KVKK_ACCEPTANCE_DOC } });
    expect(stored.version).toBe(LEGAL_VERSION);
    expect(stored.acceptedAt).toBeInstanceOf(Date);
    const stamp = stored.acceptedAt.getTime();

    await recordLegalAcceptances({ userId: user.id, email: user.email, documents: loginAcceptanceDocs(user.role) });

    const rows = await prisma.legalAcceptance.findMany({ where: { userId: user.id, document: KVKK_ACCEPTANCE_DOC } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.acceptedAt.getTime()).toBe(stamp);
    expect(await needsKvkkAcceptance(user.id)).toBe(false);
    const terms = await prisma.legalAcceptance.count({ where: { userId: user.id, document: "kullanim-sartlari" } });
    expect(terms).toBe(2);
  });

  it("kaydı olmayan ilk hesap bir kez ister; kabul yazılınca bir daha istenmez", async () => {
    const fresh = await prisma.user.create({ data: { email: "oauth-yeni@ex.com", name: "OAuth", role: "INFLUENCER", passwordHash: "x" } });
    expect(await needsKvkkAcceptance(fresh.id)).toBe(true);
    await recordLegalAcceptances({ userId: fresh.id, email: fresh.email, documents: [KVKK_ACCEPTANCE_DOC] });
    const row = await prisma.legalAcceptance.findFirstOrThrow({ where: { userId: fresh.id, document: KVKK_ACCEPTANCE_DOC } });
    expect(row.acceptedAt).toBeInstanceOf(Date);
    expect(await needsKvkkAcceptance(fresh.id)).toBe(false);
  });
});
