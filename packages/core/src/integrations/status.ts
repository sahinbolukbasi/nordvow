import { envStr } from "../env";
import { getConfig } from "../config/store";
import { falRuntimeMode } from "../creative/fal";
import { emailConfigured } from "../notify/channels";

/**
 * Entegrasyon durumu: hangi dış servisin canlı (anahtar/erişim var) hangisinin mock (anahtar
 * bekliyor) olduğunu TEK YERDEN raporlar. Admin paneli bunu gösterir; "mock mode" hangi
 * özellikleri etkiliyor net olsun. Gizli değer OKUNMAZ; yalnız anahtarın VAR/YOK bilgisi döner.
 */
export type IntegrationMode = "canli" | "mock" | "erisim_bekliyor";

export type IntegrationStatus = {
  key: string;
  name: string;
  mode: IntegrationMode;
  detail: string;
  /** Canlıya geçmek için gereken adım (mock/erişim bekliyorsa). */
  nextStep?: string;
};

function keyPresent(name: string): boolean {
  const v = envStr(name, "");
  return v.trim().length > 0;
}

export async function integrationStatuses(): Promise<IntegrationStatus[]> {
  const features = await getConfig("features");
  const llmProvider = envStr("LLM_PROVIDER", "mock");

  const out: IntegrationStatus[] = [];

  // Creative — fal.ai (FAL_MODE=http ve anahtar birlikte gerekir; fal() ile aynı kural)
  const falKey = keyPresent("FAL_KEY") || keyPresent("FAL_API_KEY");
  const falLive = falRuntimeMode() === "http";
  out.push({
    key: "fal",
    name: "Creative görsel/video (fal.ai)",
    mode: falLive ? "canli" : "mock",
    detail: falLive
      ? "FAL_MODE=http ve anahtar tanımlı; gerçek üretim açık."
      : falKey
        ? "Anahtar var ama FAL_MODE=http değil; üretim mock kalır."
        : "Anahtar yok veya FAL_MODE=mock; üretimler örnek çıktıdır.",
    nextStep: falLive ? undefined : falKey ? "FAL_MODE=http yapın." : "FAL_KEY ekleyin ve FAL_MODE=http yapın.",
  });

  // LLM / Asistan — Bedrock Converse
  const bedrockLive = llmProvider === "bedrock";
  out.push({
    key: "bedrock-llm",
    name: "Asistan / LLM (Amazon Bedrock)",
    mode: bedrockLive ? "canli" : "mock",
    detail: bedrockLive ? "LLM_PROVIDER=bedrock; asistan gerçek modelle yanıt verir." : "LLM_PROVIDER=mock; asistan deterministik mock yanıt üretir (bilgi tabanından).",
    nextStep: bedrockLive ? undefined : "LLM_PROVIDER=bedrock yapın ve bölge/erişimi açın.",
  });

  // Bedrock görsel
  out.push({
    key: "bedrock-image",
    name: "Bedrock görsel üretimi (Nova Canvas / Titan)",
    mode: features["creative.bedrockImage"] ? "canli" : "erisim_bekliyor",
    detail: features["creative.bedrockImage"] ? "Özellik bayrağı açık." : "Bölge/model erişimi açılana kadar kapalı.",
    nextStep: features["creative.bedrockImage"] ? undefined : "Bedrock model erişimi açılınca /admin/ai'dan creative.bedrockImage bayrağını açın.",
  });

  // Bedrock video
  out.push({
    key: "bedrock-video",
    name: "Bedrock video üretimi (Nova Reel)",
    mode: features["creative.bedrockVideo"] ? "canli" : "erisim_bekliyor",
    detail: features["creative.bedrockVideo"] ? "Özellik bayrağı açık." : "Bölge/model erişimi açılana kadar kapalı.",
    nextStep: features["creative.bedrockVideo"] ? undefined : "Bedrock Nova Reel erişimi açılınca /admin/ai'dan creative.bedrockVideo bayrağını açın.",
  });

  // Meta Marketing API (reklam)
  const metaLive = keyPresent("META_ADS_ACCESS_TOKEN") || keyPresent("META_SYSTEM_USER_TOKEN");
  out.push({
    key: "meta-ads",
    name: "Meta reklam (Marketing API)",
    mode: metaLive ? "canli" : "mock",
    detail: metaLive ? "Meta erişim anahtarı tanımlı." : "Anahtar yok; reklam taslakları yalnız onay kuyruğunda kalır, gerçek yayın/harcama olmaz.",
    nextStep: metaLive ? undefined : "META_ADS_ACCESS_TOKEN ekleyin ve Full Access başvurusunu tamamlayın.",
  });

  // TikTok Marketing/Content API
  const tiktokLive = keyPresent("TIKTOK_ACCESS_TOKEN");
  out.push({
    key: "tiktok-ads",
    name: "TikTok reklam/içerik (Marketing API)",
    mode: tiktokLive ? "canli" : "mock",
    detail: tiktokLive ? "TikTok erişim anahtarı tanımlı." : "Anahtar yok; reklam taslakları yalnız onay kuyruğunda kalır.",
    nextStep: tiktokLive ? undefined : "TIKTOK_ACCESS_TOKEN ekleyin ve uygulama denetimini tamamlayın.",
  });

  // WhatsApp / Instagram: metaClient yalnız META_API_MODE=http iken gerçek çağrı yapar.
  const metaHttp = envStr("META_API_MODE", "mock") === "http";
  const waToken = keyPresent("WHATSAPP_ACCESS_TOKEN") || keyPresent("META_WABA_TOKEN");
  const igToken = keyPresent("INSTAGRAM_ACCESS_TOKEN") || keyPresent("META_IG_TOKEN");
  const waLive = metaHttp && (waToken || igToken);
  out.push({
    key: "whatsapp",
    name: "WhatsApp / Instagram mesajlaşma",
    mode: waLive ? "canli" : "mock",
    detail: waLive
      ? "META_API_MODE=http ve mesajlaşma anahtarı tanımlı."
      : metaHttp
        ? "META_API_MODE=http ama WhatsApp/Instagram token yok."
        : waToken || igToken
          ? "Token var ama META_API_MODE=http değil; gönderim mock."
          : "Anahtar yok; mesajlar gerçek alıcılara gitmez.",
    nextStep: waLive ? undefined : "META_API_MODE=http ve WHATSAPP_ACCESS_TOKEN veya META_IG_TOKEN ekleyin.",
  });

  out.push({
    key: "email",
    name: "E-posta bildirimleri",
    mode: "mock",
    detail: emailConfigured()
      ? "EMAIL_PROVIDER ve EMAIL_FROM tanımlı; SES/SMTP çağrısı yok, gönderim FAILED/MOCKED kalır (sahte SENT yok)."
      : "E-posta taşıyıcısı yok; bildirimler MOCKED.",
    nextStep: "SES veya SMTP gönderimini bağlayın (EMAIL_PROVIDER, EMAIL_FROM).",
  });

  return out;
}

export function modeLabel(mode: IntegrationMode): string {
  return mode === "canli" ? "Canlı" : mode === "mock" ? "Mock (anahtar bekliyor)" : "Erişim bekliyor";
}
