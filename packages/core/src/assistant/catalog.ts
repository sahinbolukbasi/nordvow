import { prisma } from "../db";

/** Hazır agent kataloğu: Postgres şablonundan türer, tenant'a kopyalanır, tenant düzenler. */
export const AGENT_TEMPLATES = [
  {
    key: "brand_faq",
    name: "Marka müşteri asistanı (SSS)",
    description: "Fiyat, kargo, iade, stok ve mağaza sorularını onaylı marka bilgilerinden kaynak göstererek yanıtlar.",
    systemPrompt:
      "Markanın müşteri asistanısın. Yalnız verilen onaylı bilgi parçalarına dayanarak kısa, nazik, Türkçe yanıt ver. Bilgi tabanında olmayan fiyat, tarih veya kupon kodu asla uydurma. Kart veya hesap numarası isteme.",
    tools: [],
    defaultKeywords: [],
  },
  {
    key: "influencer_assistant",
    name: "Influencer kampanya asistanı",
    description: "Kampanyaya katılan içerik üreticilerinin brief, md. 23/A reklam ibaresi, teslim tarihi ve 20/B genel ödeme sorularını yanıtlar. Başka üreticilerin ücretlerini veya marka iç notlarını görmez.",
    systemPrompt:
      "Kampanyaya katılan içerik üreticilerine yardımcı olan asistansın. Yalnız ilgili kampanya brief'ine, md. 23/A reklam ibaresi kurallarına ve teslim tarihlerine göre yanıt ver. Başka içerik üreticilerinin ücretlerini veya markanın iç notlarını asla paylaşma. Vergi / 20-B konularında yalnızca genel bilgilendirme yap, kesinlikle vergi tavsiyesi verme ve mali müşavire yönlendir.",
    tools: [],
    defaultKeywords: ["brief", "hashtag", "reklam ibaresi", "teslim tarihi", "20/b"],
  },
  {
    key: "creator_prescreen",
    name: "Creator başvuru / ön eleme",
    description: "İşbirliği taleplerinde media kit, takipçi, kategori, fiyat beklentisi ve iletişim bilgisini toplar; adayı influencer havuzuna yazar.",
    systemPrompt: "İşbirliği başvurularını karşılayan asistansın. Sırayla: hesap kullanıcı adı, takipçi sayısı, kategori, fiyat beklentisi, media kit bağlantısı ve iletişim bilgisi iste.",
    tools: ["save_candidate"],
    defaultKeywords: ["işbirliği", "collab", "kampanya", "iş birliği", "reklam teklifi"],
  },
  {
    key: "campaign_welcome",
    name: "Kampanya trafiği karşılama",
    description: "Click-to-WhatsApp / Click-to-Direct reklamından gelenleri karşılar; indirim kodu ve kampanya bağlantısını paylaşır.",
    systemPrompt: "Reklamdan gelen kullanıcıyı karşıla, yalnızca onaylı kampanya kodunu ve bağlantısını paylaş, ilgisini sor.",
    tools: ["crm_write_lead"],
    defaultKeywords: [],
  },
  {
    key: "order_status",
    name: "Sipariş / kargo durumu",
    description: "Sipariş veya kargo takip numarası ile kargo durumunu sorgular.",
    systemPrompt: "Sipariş veya kargo takip numarasını iste ve yalnızca doğrulanmış gönderi durumunu paylaş.",
    tools: ["order_lookup"],
    defaultKeywords: ["sipariş", "kargo", "takip numarası"],
  },
  {
    key: "booking",
    name: "Randevu / rezervasyon",
    description: "Uygun saat aralıklarını sorgular ve randevu oluşturur.",
    systemPrompt: "Tarih ve saat tercihini al, uygun saatleri sun, onay al.",
    tools: ["slots_query", "booking_create"],
    defaultKeywords: ["randevu", "rezervasyon"],
  },
  {
    key: "deliverable_reminder",
    name: "Teslim hatırlatma (influencer)",
    description: "Yaklaşan teslim, eksik reklam ibaresi ve revizyon için yalnızca platform içi veya izinli kanaldan hatırlatma gönderir (toplu mesaj yok).",
    systemPrompt: "İçerik üreticisine yaklaşan teslimat tarihini nazikçe hatırlat.",
    tools: [],
    defaultKeywords: [],
  },
] as const;

export type AgentKey = (typeof AGENT_TEMPLATES)[number]["key"];

export async function seedAgentTemplates() {
  for (const t of AGENT_TEMPLATES) {
    await prisma.agentTemplate.upsert({
      where: { key: t.key },
      create: { ...t, tools: [...t.tools], defaultKeywords: [...t.defaultKeywords] },
      update: { name: t.name, description: t.description },
    });
  }
}

/** Tek tıkla etkinleştir: şablon yoksa katalogdan otomatik oluşturulur ve tenant'a kopyalanır. */
export async function activateAgent(tenantId: string, key: AgentKey) {
  let t = await prisma.agentTemplate.findUnique({ where: { key } });
  if (!t) {
    const def = AGENT_TEMPLATES.find((x) => x.key === key);
    if (!def) throw new Error("Asistan şablonu bulunamadı.");
    t = await prisma.agentTemplate.upsert({
      where: { key: def.key },
      create: { ...def, tools: [...def.tools], defaultKeywords: [...def.defaultKeywords] },
      update: { name: def.name, description: def.description },
    });
  }
  return prisma.agentConfig.upsert({
    where: { tenantId_agentId: { tenantId, agentId: key } },
    create: { tenantId, agentId: key, systemPrompt: t.systemPrompt },
    update: { enabled: true },
  });
}
