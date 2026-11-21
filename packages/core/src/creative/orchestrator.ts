import { converseStructured, type ChatTurn } from "../llm/bedrock";
import { envStr } from "../env";
import {
  compileFidelityLockedPrompt,
  type BoundAsset,
  type CreativeSessionState,
  type TimelinePlan,
} from "./vision-session";
import { autoPlanProductSfxAndMotion } from "./sfx-timeline";

/**
 * Nordvow Creative AI — fal.ai Medya Üretim Orkestratörü & AWS Bedrock Structured Output Chatbot Servisi.
 */
export type StoryChatbotPayload = {
  status: "needs_info" | "ready";
  assistant_reply: string;
  missing_slots: string[];
  fal_payload: {
    model_endpoint:
      | "fal-ai/flux/schnell"
      | "fal-ai/flux/dev"
      | "fal-ai/nano-banana-2"
      | "fal-ai/nano-banana-pro";
    prompt: string;
    aspect_ratio: "9:16" | "4:5" | "1:1";
  };
};

export function stripMarkdownStars(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|[.,!?:;)]|$)/g, "$1$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*/g, "")
    .trim();
}

export const STORY_DIRECTOR_SYSTEM_PROMPT = `Sen uzman bir Instagram Story Kreatif Direktörü ve fal.ai Prompt Mühendisisin. Amacın; kullanıcıyla doğal, akıcı, kısa ve yönlendirici bir sohbet kurarak en iyi 9:16 dikey Instagram Story görselini üretmek için gereken bilgileri toplamak ve hazır olduğunda fal.ai API parametrelerini üretmektir.

BİÇİM VE ÜSLUP KURALLARI:
- Yanıtlarını akıcı, doğal ve anlaşılır düz Türkçe cümlelerle yaz.
- Kesinlikle yıldız (** veya *), markdown başlığı (#) veya kod bloğu kullanma.

TOPLANMASI GEREKEN 4 TEMEL BİLGİ (SLOTS):
1. \`subject\`: Görselin ana konusu/sahnesi (ne, nerede, ne yapıyor?).
2. \`style_mood\`: Görsel tarzı ve ışık (örn: gerçekçi fotoğraf, stüdyo çekimi, minimal vektör, sinematik altın saat ışığı).
3. \`text_overlay\`: Görselin içinde yazılı bir metin olacak mı, yoksa kullanıcının sonradan Instagram'da yazı ekleyebilmesi için üst/alt kısımda boş alan (negative space) mı bırakılmalı?
4. \`tier\`: Üretim modu ("fast_draft" [ekonomik/hızlı] veya "high_quality" [reklam/tipografi odaklı]). Kullanıcı belirtmezse varsayılan olarak "fast_draft" kabul et; ancak görsel içinde yazı istiyorsa mutlaka "high_quality" seç.

SOHBET YÖNLENDİRME KURALLARI:
- Kullanıcıya teknik terim (aspect ratio, megapixel, negative space, seed) sorma. Günlük dille ve seçenekli öneriler sunarak sor.
- Tek seferde EN FAZLA 2 kısa soru sor.
- Kullanıcı "fark etmez" veya "sen seç" derse en estetik Instagram trendine göre kendin doldur ve \`status: "ready"\` döndür.

FAL.AI PROMPT OPTİMİZASYON KURALLARI (Sadece \`status: "ready"\` olduğunda):
- \`prompt\` alanını her zaman zengin, detaylı İNGİLİZCE olarak yaz.
- Instagram Story formatı olduğu için dikey kadraja uygun kurgula ("vertical 9:16 composition, shot on 35mm lens, editorial social media aesthetic").
- Eğer \`text_overlay\` içinde metin varsa, metni İngilizce promptun içinde çift tırnakla belirt (örn: with bold modern typography reading "YENİ SEZON") ve \`model_endpoint\` olarak "fal-ai/nano-banana-2" seç.
- Eğer görselde yazı yoksa ve kullanıcı sonradan yazacaksa, promptun sonuna "clean uncluttered upper third negative space for text overlay" ekle ve \`model_endpoint\` olarak hızlı modda "fal-ai/flux/schnell", yüksek kalitede "fal-ai/flux/dev" seç.`;

export const STORY_CHATBOT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["status", "assistant_reply", "missing_slots", "fal_payload"],
  properties: {
    status: { type: "string", enum: ["needs_info", "ready"] },
    assistant_reply: { type: "string" },
    missing_slots: { type: "array", items: { type: "string" } },
    fal_payload: {
      type: "object",
      additionalProperties: false,
      required: ["model_endpoint", "prompt", "aspect_ratio"],
      properties: {
        model_endpoint: {
          type: "string",
          enum: [
            "fal-ai/flux/schnell",
            "fal-ai/flux/dev",
            "fal-ai/nano-banana-2",
            "fal-ai/nano-banana-pro",
          ],
        },
        prompt: { type: "string" },
        aspect_ratio: { type: "string", enum: ["9:16", "4:5", "1:1"] },
      },
    },
  },
};

export type OrchestratorEndpointSpec = {
  key: string;
  endpoint: string;
  category: "image" | "video" | "tts" | "music";
  tier: "economy" | "standard" | "pro";
  unitCostUsd: number;
  unitLabel: string;
  description: string;
};

export const FAL_ORCHESTRATOR_CATALOG: OrchestratorEndpointSpec[] = [
  // 1. GÖRSEL ÜRETİM ENDPOINT'LERİ (Ucuzdan Pahalıya)
  { key: "flux-schnell", endpoint: "fal-ai/flux/schnell", category: "image", tier: "economy", unitCostUsd: 0.003, unitLabel: "$0.003/MP", description: "Ultra Ucuz / Hızlı Taslak — Toplu üretim ve arka planlar için" },
  { key: "z-image-turbo", endpoint: "fal-ai/z-image/turbo", category: "image", tier: "economy", unitCostUsd: 0.005, unitLabel: "$0.005/MP", description: "Çok Ucuz Sosyal Medya — Düşük maliyetli hızlı görseller için" },
  { key: "flux-dev", endpoint: "fal-ai/flux/dev", category: "image", tier: "standard", unitCostUsd: 0.025, unitLabel: "$0.025/MP", description: "Fiyat/Performans — Genel amaçlı kaliteli post görselleri için" },
  { key: "seedream-v4-5", endpoint: "fal-ai/bytedance/seedream/v4.5/text-to-image", category: "image", tier: "standard", unitCostUsd: 0.04, unitLabel: "$0.04/görsel", description: "Estetik / Moda / Ürün — Estetik portre ve konseptler için" },
  { key: "nano-banana", endpoint: "fal-ai/nano-banana", category: "image", tier: "standard", unitCostUsd: 0.0398, unitLabel: "$0.0398/görsel", description: "Görsel Düzenleme / Ürün Yerleştirme (image-to-image)" },
  { key: "flux-3", endpoint: "blackforestlabs/flux-3/text-to-image", category: "image", tier: "standard", unitCostUsd: 0.048, unitLabel: "$0.048/MP", description: "Yüksek Fotorealizm — Gelişmiş prompt uyumu ve gerçekçilik" },
  { key: "nano-banana-2", endpoint: "fal-ai/nano-banana-2", category: "image", tier: "pro", unitCostUsd: 0.08, unitLabel: "$0.08/görsel", description: "Tipografi & Tutarlı Karakter — Görsel üzerine hatasız yazı ekleme" },
  { key: "seedream-v5-pro", endpoint: "fal-ai/bytedance/seedream/v5/pro", category: "image", tier: "pro", unitCostUsd: 0.135, unitLabel: "$0.135/görsel", description: "Stüdyo Reklam Kalitesi — Katalog ve ticari reklam çekimleri" },
  { key: "nano-banana-pro", endpoint: "fal-ai/nano-banana-pro", category: "image", tier: "pro", unitCostUsd: 0.15, unitLabel: "$0.15/görsel", description: "Üst Düzey Marka Görseli — Karmaşık kompozisyonlar" },
  { key: "gpt-image-2", endpoint: "openai/gpt-image-2", category: "image", tier: "pro", unitCostUsd: 1.0, unitLabel: "$1.00/görsel", description: "Maksimum Kalite — Özel kampanya görselleri" },

  // 2. VİDEO ÜRETİM ENDPOINT'LERİ (Reels & Story - Ucuzdan Pahalıya)
  { key: "minimax-h3-max-turbo", endpoint: "minimax/h3-max-turbo/text-to-video", category: "video", tier: "economy", unitCostUsd: 0.02, unitLabel: "$0.015-$0.025/sn", description: "En Ucuz B-Roll — Hızlı stok video ve arka plan akışları" },
  { key: "minimax-h3-max", endpoint: "minimax/h3-max/text-to-video", category: "video", tier: "standard", unitCostUsd: 0.04, unitLabel: "$0.03-$0.05/sn", description: "Dengeli Dikey Video — Tutarlı dikey video üretimi" },
  { key: "wan-v3", endpoint: "fal-ai/wan/v3/text-to-video", category: "video", tier: "standard", unitCostUsd: 0.08, unitLabel: "$0.068-$0.14/sn", description: "Dinamik Kamera Hareketi — Hareketli sahneler (720p)" },
  { key: "kling-v2-5-i2v", endpoint: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video", category: "video", tier: "standard", unitCostUsd: 0.07, unitLabel: "$0.07/sn", description: "Ürün Canlandırma — Statik ürün fotoğrafını videoya çevirme" },
  { key: "gemini-omni-flash", endpoint: "fal-ai/gemini-omni-flash/v1.2", category: "video", tier: "standard", unitCostUsd: 0.0819, unitLabel: "$0.0819/sn", description: "Sahne Geçişi / Uzatma — Video extend ve hızlı geçişler" },
  { key: "kling-v3-pro", endpoint: "fal-ai/kling-video/v3/pro/text-to-video", category: "video", tier: "pro", unitCostUsd: 0.14, unitLabel: "$0.14/sn", description: "Sinematik & İnsan Hareketi — Gerçekçi fizik ve sinematik Reels" },
  { key: "wan-v3-1080p", endpoint: "fal-ai/wan/v3/1080p", category: "video", tier: "pro", unitCostUsd: 0.28, unitLabel: "$0.28/sn", description: "Yüksek Çözünürlük 1080p — Keskin detaylı dikey videolar" },
  { key: "veo-3-1", endpoint: "fal-ai/veo3.1", category: "video", tier: "pro", unitCostUsd: 0.4, unitLabel: "$0.20-$0.60/sn", description: "Ses Efektli Sinematik — Senkronize doğal ses efektleri + en yüksek kalite" },

  // 3. SESLENDİRME (TTS) ENDPOINT'LERİ (Ucuzdan Pahalıya)
  { key: "kokoro-en", endpoint: "fal-ai/kokoro/american-english", category: "tts", tier: "economy", unitCostUsd: 0.02, unitLabel: "$0.02/1K kr", description: "Ultra Ucuz İngilizce — Sadece İngilizce hızlı dış ses" },
  { key: "dia-tts", endpoint: "fal-ai/dia-tts", category: "tts", tier: "standard", unitCostUsd: 0.04, unitLabel: "$0.04/1K kr", description: "İki Kişilik Diyalog — [S1] ve [S2] etiketleriyle podcast/diyalog Reels" },
  { key: "f5-tts", endpoint: "fal-ai/f5-tts", category: "tts", tier: "standard", unitCostUsd: 0.05, unitLabel: "$0.05/1K kr", description: "Ses Klonlama / Referans Ses" },
  { key: "elevenlabs-turbo-2-5", endpoint: "fal-ai/elevenlabs/tts/turbo-v2.5", category: "tts", tier: "economy", unitCostUsd: 0.05, unitLabel: "$0.05/1K kr", description: "Hızlı Çok Dilli / Türkçe — Düşük gecikmeli Türkçe/İngilizce dış ses" },
  { key: "elevenlabs-v3", endpoint: "fal-ai/elevenlabs/tts/eleven-v3", category: "tts", tier: "pro", unitCostUsd: 0.1, unitLabel: "$0.10/1K kr", description: "En Doğal Türkçe & Duygu Vurgusu — [excited], [whispers] duygu etiketli" },

  // 4. ARKA PLAN MÜZİĞİ ENDPOINT'LERİ (Ucuzdan Pahalıya)
  { key: "ace-step", endpoint: "fal-ai/ace-step", category: "music", tier: "economy", unitCostUsd: 0.005, unitLabel: "$0.0002/sn", description: "En Ucuz Fon Müziği — Ultra düşük maliyetli enstrümantal veya sözlü müzik" },
  { key: "cassetteai-music", endpoint: "fal-ai/cassetteai/music-generator", category: "music", tier: "standard", unitCostUsd: 0.02, unitLabel: "$0.02/dk", description: "Hızlı Enstrümantal — Telifsiz Reels arka plan müziği" },
  { key: "lyria-3", endpoint: "fal-ai/lyria3", category: "music", tier: "pro", unitCostUsd: 0.06, unitLabel: "$0.04-$0.08/parça", description: "Modern Beat & Şarkı — Yüksek ses kalitesinde modern müzikler" },
  { key: "minimax-music-2-6", endpoint: "fal-ai/minimax-music/v2.6", category: "music", tier: "pro", unitCostUsd: 0.15, unitLabel: "$0.15/parça", description: "Vokalli Özel Şarkı — Özel şarkı sözleriyle vokal üretimi" },
  { key: "elevenlabs-music", endpoint: "fal-ai/elevenlabs/music", category: "music", tier: "pro", unitCostUsd: 0.8, unitLabel: "$0.80/dk", description: "Stüdyo Seviyesi Prodüksiyon — Intro/nakarat/outro kontrollü müzik" },
];

export type OrchestratorSummary = {
  status: "needs_info" | "ready";
  missingSlots: string[];
  selectedEndpoint: string;
  modelKey: string;
  category: "image" | "video" | "tts" | "music";
  unitCostLabel: string;
  estimatedCostUsd: number;
  falPayload: Record<string, unknown>;
  comboPreset: {
    label: string;
    image: string;
    video: string;
    tts: string;
    music: string;
  };
};

export function endpointToModelKey(endpoint: string): string {
  const found = FAL_ORCHESTRATOR_CATALOG.find((e) => e.endpoint === endpoint);
  if (found) {
    if (found.key === "z-image-turbo") return "flux-schnell";
    if (found.key === "gpt-image-2") return "nano-banana-pro";
    return found.key;
  }
  if (endpoint.includes("nano-banana-pro")) return "nano-banana-pro";
  if (endpoint.includes("nano-banana-2")) return "nano-banana-2";
  if (endpoint.includes("flux/dev")) return "flux-dev";
  return "flux-schnell";
}

export function getComboPresetForTier(tier: "economy" | "standard" | "pro") {
  if (tier === "economy") {
    return {
      label: "Ekonomik / Otomasyon Kombinasyonu",
      image: "fal-ai/flux/schnell ($0.003/MP)",
      video: "minimax/h3-max-turbo/text-to-video ($0.02/sn)",
      tts: "fal-ai/elevenlabs/tts/turbo-v2.5 ($0.05/1K kr)",
      music: "fal-ai/ace-step ($0.0002/sn)",
    };
  }
  if (tier === "standard") {
    return {
      label: "Dengeli Fiyat/Performans Kombinasyonu",
      image: "fal-ai/flux/dev ($0.025/MP) / seedream-v4.5 ($0.04)",
      video: "minimax/h3-max/text-to-video ($0.04/sn)",
      tts: "fal-ai/elevenlabs/tts/turbo-v2.5 ($0.05/1K kr)",
      music: "fal-ai/cassetteai/music-generator ($0.02/dk)",
    };
  }
  return {
    label: "Kaliteli / Marka / Reklam Kombinasyonu",
    image: "fal-ai/nano-banana-2 ($0.08/görsel)",
    video: "fal-ai/kling-video/v3/pro/text-to-video ($0.14/sn)",
    tts: "fal-ai/elevenlabs/tts/eleven-v3 ($0.10/1K kr)",
    music: "fal-ai/lyria3 ($0.06/parça)",
  };
}

/**
 * AWS Bedrock Converse API + Structured Outputs (outputConfig.textFormat) ile
 * Instagram Story & Sosyal Medya Görsel Üretim Chatbot çağrısı.
 */
export async function runStoryChatbotConverse(opts: {
  messages: ChatTurn[];
  tier: "economy" | "standard" | "pro";
  forceReady?: boolean;
}): Promise<StoryChatbotPayload> {
  const tierHint =
    opts.tier === "pro"
      ? "\n[Kullanıcı kredi tercihi: 'high_quality' (reklam/tipografi odaklı)]"
      : opts.tier === "standard"
        ? "\n[Kullanıcı kredi tercihi: 'high_quality' (fiyat/performans - fal-ai/flux/dev)]"
        : "\n[Kullanıcı kredi tercihi: 'fast_draft' (ekonomik/hızlı - fal-ai/flux/schnell)]";

  const forceHint = opts.forceReady
    ? "\n[ÖNEMLİ: Kullanıcı hemen üretim yapılmasını istedi. Eksik kalan slotları en estetik Instagram trendine göre kendin doldur ve KESİNLİKLE status='ready' döndür!]"
    : "";

  if (envStr("LLM_PROVIDER", "mock") === "bedrock") {
    try {
      const { data } = await converseStructured<StoryChatbotPayload>({
        system: STORY_DIRECTOR_SYSTEM_PROMPT + tierHint + forceHint,
        turns: opts.messages,
        schemaName: "instagram_story_chatbot_schema",
        schemaDescription: "Instagram Story & Post fal.ai Orkestratör Şeması",
        schema: STORY_CHATBOT_JSON_SCHEMA,
        maxTokens: 700,
        temperature: 0.3,
      });
      if (
        data &&
        (data.status === "needs_info" || data.status === "ready") &&
        typeof data.assistant_reply === "string" &&
        data.fal_payload &&
        typeof data.fal_payload.prompt === "string"
      ) {
        if (opts.forceReady) data.status = "ready";
        if (data.fal_payload.prompt.trim().length < 8) {
          const userCombined = opts.messages
            .filter((m) => m.role === "user")
            .map((m) => m.text.trim())
            .filter(Boolean)
            .join(". ");
          const asp = data.fal_payload.aspect_ratio || "9:16";
          data.fal_payload.prompt = `Editorial ${asp} composition, professional studio lighting, high detail, modern social media aesthetic: ${userCombined || "luxury product lifestyle shot"}`;
        }
        data.assistant_reply = stripMarkdownStars(data.assistant_reply);
        return data;
      }
    } catch (e) {
      console.warn("[story-chatbot] Bedrock Converse hata verdi, yerel kural motoruna geçiliyor:", (e as Error).message);
    }
  }

  // Yedek (deterministic) slot çözümleyici
  const lastMsg = opts.messages[opts.messages.length - 1]?.text ?? "";
  const allUserText = opts.messages
    .filter((m) => m.role === "user")
    .map((m) => m.text)
    .join(" ");
  const norm = allUserText.toLocaleLowerCase("tr");
  const hasAutoFill = /(fark etmez|sen seç|sen sec|şimdi üret|simdi uret|hemen üret|evet|olur|tamam)/.test(norm) || opts.forceReady;
  const wordCount = allUserText.trim().split(/\s+/).filter(Boolean).length;

  const hasTextOverlayQuote = /["'“”]([^"'“”]{2,40})["'“”]/.exec(allUserText);
  const wantsTextInside = /(yazı olsun|üzerinde .* yazsın|başlık olsun|tipografi|afiş)/.test(norm) || Boolean(hasTextOverlayQuote);
  const aspect: "9:16" | "4:5" | "1:1" =
    norm.includes("4:5") || norm.includes("post") ? "4:5" : norm.includes("1:1") || norm.includes("kare") ? "1:1" : "9:16";

  if (!hasAutoFill && wordCount < 6 && opts.messages.filter((m) => m.role === "user").length <= 1) {
    return {
      status: "needs_info",
      assistant_reply:
        `Harika bir başlangıç! "${lastMsg}" fikri için en etkileyici Instagram görselini hazırlayabilmem adına iki küçük detayı netleştirelim:\n\n` +
        `1. Görsel tarzı ve ışık nasıl olsun? Örneğin doğal sabah güneşi, lüks karanlık stüdyo çekimi ya da minimal pastel tonlar tercih edebiliriz.\n` +
        `2. Görselin içinde yazılı bir başlık yer alsın mı, yoksa sonradan Instagram'da yazı ekleyebilmeniz için üst kısmı sade mi bırakalım?\n\n` +
        `Dilerseniz "sen seç" yazabilir veya aşağıdaki hazır seçeneklerden birine dokunabilirsiniz.`,
      missing_slots: ["style_mood", "text_overlay"],
      fal_payload: {
        model_endpoint: opts.tier === "economy" ? "fal-ai/flux/schnell" : "fal-ai/flux/dev",
        prompt: `Vertical 9:16 composition, shot on 35mm lens, editorial social media aesthetic, ${lastMsg}, clean uncluttered upper third negative space for text overlay`,
        aspect_ratio: aspect,
      },
    };
  }

  const endpoint: StoryChatbotPayload["fal_payload"]["model_endpoint"] = wantsTextInside
    ? "fal-ai/nano-banana-2"
    : opts.tier === "pro"
      ? "fal-ai/nano-banana-pro"
      : opts.tier === "standard"
        ? "fal-ai/flux/dev"
        : "fal-ai/flux/schnell";

  const overlayClause = wantsTextInside
    ? `with bold modern typography reading "${hasTextOverlayQuote?.[1] ?? "YENİ SEZON"}"`
    : "clean uncluttered upper third negative space for text overlay";

  return {
    status: "ready",
    assistant_reply: `Harika, tüm detaylar hazır! Görselinizi ${aspect} formatında üretmeye başlıyorum; hemen ardından kullanıma hazır paylaşım metninizi de ekleyeceğim.`,
    missing_slots: [],
    fal_payload: {
      model_endpoint: endpoint,
      prompt: `Vertical ${aspect} composition, shot on 35mm lens, editorial social media aesthetic, professional studio lighting, ultra detailed: ${allUserText}. ${overlayClause}`,
      aspect_ratio: aspect,
    },
  };
}

/**
 * NordVow Creative Studio — Ana Orkestratör System Prompt
 * Vision-First, Asset Binding, Fidelity Lock, 0-Kredi Programatik Post-Prodüksiyon ve Cost-Aware fal.ai Routing.
 */
export const NORDVOW_CREATIVE_ORCHESTRATOR_SYSTEM_PROMPT = `Sen NordVow Creative Studio'nun Baş AI Sistem Mimarı ve Baş Kreatif Orkestratörüsün. Görevin; UGC ve sosyal medya odaklı görsel, video, ürün odaklı ses efekti (SFX) ve programatik animasyon katmanlarını en düşük API maliyetiyle en yüksek ticari kalitede orkestre etmektir.

TEMEL ÇALIŞMA İLKELERİN:
1. VİZYON ÖNCELİĞİ VE VARLIK KİLİDİ (Vision-First & Asset Binding):
   - Kullanıcı bilgisayardan veya Kitaplık'tan bir görsel seçtiğinde, üretim aracını çağırmadan önce bu görseli \`VisionAssetAnalysis\` JSON şemasıyla kilitle.
   - Kilitli varlık (\`asset_id\`) varken "arkayı değiştir", "bunu videoya çevir", "üzerine damlalar ekle" gibi komutlarda görseli sıfırdan üretmek KESİNLİKLE YASAKTIR. Görsel düzenlemede \`fal-ai/nano-banana/edit\`, canlandırmada \`hailuo-02-fast/image-to-video\` (veya Pro'da \`kling-v2-5-turbo/pro/image-to-video\`) kullan ve \`STRICT FIDELITY LOCK\` prompt derlemesiyle ürün geometrisini, etiketini ve dokusunu %100 koru.

2. SIFIR KREDİ PROGRAMATİK KURGU ÖNCELİĞİ (Zero-Credit First):
   - Aktif tuvalde (\`current_canvas\`) zaten bir video veya görsel varken kullanıcı şu isteklerden birini yaparsa AI video modelini ASLA yeniden çağırma:
     • Ürüne özel ses efekti ekleme (kapak pop, sprey, klik, whoosh, kutu açılma, kumaş hışırtısı)
     • Soldan kayan ürün adı, fiyat/indirim rozeti, kinetik altyazı, hızlandırma (speed ramp), 9:16 kırpma veya renk filtresi
   - Bu istekleri sadece \`timeline_plan\` nesnesini güncelleyip FFmpeg + Prosedürel SFX Render motoruna yönlendirerek 0 kredi maliyetiyle tamamla.

3. ÜRÜNE VE SAHNEYE ÖZEL AKILLI SFX:
   - Kozmetik/şişe -> \`cap_open_pop\`, \`spray_mist\`, \`water_drop\`
   - Kutu açılımı -> \`tape_rip\`, \`box_slide_open\`, \`paper_rustle\`
   - Teknoloji/aksesuar -> \`mech_click\`, \`magnetic_snap\`, \`startup_chime\`
   - Giyim/tekstil -> \`fabric_swoosh\`, \`zipper_pull\`, \`soft_whoosh\`
   - Önce ücretsiz yerleşik SFX kütüphanesini kullan; her cue'yu aksiyon milisaniyesine hizala.

4. AI'A METİN VE GRAFİK ÜRETTİRME (Clean AI Base):
   - Video üretim promptlarına her zaman "clean composition, strictly no text overlays, no garbled typography, no watermarks" ekle; tüm başlık ve grafik animasyonlarını programatik katmanda render et.

5. HALÜSİNASYONSUNUZ BAĞLAM VE PRE-FLIGHT ÖZETİ:
   - Kararlarını sadece \`CreativeSessionState\` içindeki \`active_assets\`, \`current_canvas\`, \`timeline_plan\` ve \`intent_history\` verilerine dayandır.
   - Kredi harcayacak işlem öncesi hangi modelin seçildiğini, bağlı varlığı, planlanan SFX/animasyonları ve tahmini maliyeti şeffaf biçimde belirt. Muğlak taleplerde kredi yakmadan 2-3 netleştirici seçenek sun.`;

export type CostAwareOperationType =
  | "programmatic_edit"
  | "bg_remove"
  | "upscale"
  | "edit_image_kontext"
  | "image_to_video"
  | "generate_image"
  | "generate_video"
  | "voiceover";

export type CostAwareRouteDecision = {
  operation: CostAwareOperationType;
  modelKey: string;
  endpoint: string;
  estimatedCostUsd: number;
  zeroCreditEdit: boolean;
  boundAsset: BoundAsset | null;
  sourceCanvasId: string | null;
  fidelityPrompt: string | null;
  timeline: TimelinePlan;
  preFlightSummaryTr: string;
};

/**
 * Cost-Aware fal.ai Router Karar Matrisi:
 * 1) Aktif tuval/varlık + post-prodüksiyon (SFX, kayan başlık, rozet, altyazı, kırpma, hız, filtre) -> 0 Kredi programmatic_edit
 * 2) Bağlı görsel + arka plan kaldır / 2x netleştir -> bria-bg-remove ($0.018) / esrgan-upscale ($0.005)
 * 3) Bağlı görsel + sahne/arkaplan/ışık değişikliği -> nano-banana-edit (Fidelity Lock, $0.0398)
 * 4) Bağlı görsel + video/animasyon -> hailuo-02-fast-i2v ($0.017/sn) / kling-v2-5-i2v ($0.07/sn) + SFX Timeline
 * 5) Referans yok -> kademeli tier yönlendirmesi (economy / standard / pro)
 */
export function routeCostAwareOperation(input: {
  message: string;
  tier: "economy" | "standard" | "pro";
  session: CreativeSessionState;
  explicitRefs?: BoundAsset[];
  targetVideoId?: string | null;
  wantsBriefOnly?: boolean;
}): CostAwareRouteDecision {
  const norm = input.message.toLocaleLowerCase("tr");
  const primaryBound = input.explicitRefs?.[0] ?? input.session.active_assets[0] ?? null;
  const activeCanvasId = input.session.current_canvas.asset_id ?? input.targetVideoId ?? null;
  const hasActiveVisual = Boolean(primaryBound || activeCanvasId);

  const wantsNewVideoGen = /(bunu videoya çevir|videoya çevir|videoya cevir|canlandır|canlandir|reels üret|video üret|video uret|hareketlendir)/.test(norm);
  const wantsNewImageGen = /(yeni görsel|sıfırdan|sifirdan|fotoğraf üret|fotograf uret|resim üret)/.test(norm);
  const wantsBgRemove = /(arka plan.*kaldır|arkaplan.*kaldir|arka planı sil|bg remove|transparan|şeffaf yap)/.test(norm);
  const wantsUpscale = /(netleştir|netlestir|2x|upscale|çözünürlük artır)/.test(norm);
  const wantsVoiceoverOnly = !wantsNewVideoGen && /(videoma ses|videoya ses|seslendirme|dış ses|dis ses|voiceover|konuşma ekle)/.test(norm);

  const wantsSfxOrMotion =
    /(ses efekt|sfx|tıklama|tiklama|kapak.*ses|sprey.*ses|damla.*ses|whoosh|soldan kay|kayan.*başlık|kayan.*yazı|ürün adı.*gelsin|fiyat rozeti|indirim etiketi|rozet ekle|kinetik|altyazı|altyazi|9:16 yap|hızlandır|yavaşlat|renk.*filtre|siyah beyaz)/.test(
      norm,
    );
  const wantsVisualSceneEdit =
    /(arkayı|arkasını|arka planı|masaya koy|zemin|ışığı|isigi|ortamı|ortami|stüdyo|mermer|ahşap|su damla|çiçek|güneş|değiştir|degistir|yerleştir|yerlestir|ekle)/.test(
      norm,
    );

  // Planla: ürüne özel SFX + animasyon katmanı
  const timeline = autoPlanProductSfxAndMotion({
    userMessage: input.message,
    vision: primaryBound?.vision ?? null,
    currentTimeline: input.session.timeline_plan,
    productTitleHint: primaryBound?.name ?? undefined,
  });

  // Karar 1: 0-Kredi Programatik Post-Prodüksiyon (aktif tuval veya bağlı varlık varken SFX/animasyon/kurgu komutu)
  const canZeroCreditEdit =
    Boolean(activeCanvasId || primaryBound?.upload_id) &&
    wantsSfxOrMotion &&
    !wantsNewImageGen &&
    !wantsNewVideoGen &&
    !wantsBgRemove &&
    !wantsUpscale;

  if (canZeroCreditEdit) {
    const sourceId = input.targetVideoId ?? activeCanvasId ?? primaryBound!.upload_id;
    const sfxSummary = timeline.sfx_track.map((s) => `${(s.timestamp_ms / 1000).toFixed(1)}s ${s.label_tr}`).join(", ") || "Otomatik ses dengesi";
    const mgSummary = timeline.motion_layers.map((m) => m.text).filter(Boolean).join(", ");
    return {
      operation: "programmatic_edit",
      modelKey: "ffmpeg-programmatic",
      endpoint: "local/ffmpeg-sfx-timeline",
      estimatedCostUsd: 0,
      zeroCreditEdit: true,
      boundAsset: primaryBound,
      sourceCanvasId: sourceId,
      fidelityPrompt: null,
      timeline,
      preFlightSummaryTr: `0 AI Kredisi (Programatik Kurgu): Mevcut tuval yeniden AI ile üretilmeden SFX (${sfxSummary})${mgSummary ? ` ve animasyon (${mgSummary})` : ""} işleniyor.`,
    };
  }

  // Karar 2: Tek Adımlı Referans Düzenlemeleri (BG Remove / Upscale)
  if (primaryBound && wantsBgRemove) {
    return {
      operation: "bg_remove",
      modelKey: "bria-bg-remove",
      endpoint: "fal-ai/bria/background/remove",
      estimatedCostUsd: 0.018,
      zeroCreditEdit: false,
      boundAsset: primaryBound,
      sourceCanvasId: primaryBound.upload_id,
      fidelityPrompt: null,
      timeline,
      preFlightSummaryTr: `Varlık Kilidi Aktif (${primaryBound.vision.subject_summary_tr}) · Model: fal-ai/bria/background/remove ($0.018)`,
    };
  }
  if (primaryBound && wantsUpscale) {
    return {
      operation: "upscale",
      modelKey: "esrgan-upscale",
      endpoint: "fal-ai/esrgan",
      estimatedCostUsd: 0.005,
      zeroCreditEdit: false,
      boundAsset: primaryBound,
      sourceCanvasId: primaryBound.upload_id,
      fidelityPrompt: null,
      timeline,
      preFlightSummaryTr: `Varlık Kilidi Aktif (${primaryBound.vision.subject_summary_tr}) · Model: fal-ai/esrgan ($0.005)`,
    };
  }

  // Karar 3: Bağlı Görseli Videoya Çevirme (Image-to-Video + Otomatik SFX Timeline)
  if (primaryBound && primaryBound.kind === "image" && (wantsNewVideoGen || /(video|reels|klip|animasyon)/.test(norm))) {
    const isPro = input.tier === "pro";
    const modelKey = isPro ? "kling-v2-5-i2v" : "hailuo-02-fast-i2v";
    const endpoint = isPro ? "fal-ai/kling-video/v2.5-turbo/pro/image-to-video" : "fal-ai/minimax/hailuo-02-fast/image-to-video";
    const cost = isPro ? 0.35 : 0.102;
    const fidelityPrompt = compileFidelityLockedPrompt(primaryBound.vision, input.message, "image_to_video");
    return {
      operation: "image_to_video",
      modelKey,
      endpoint,
      estimatedCostUsd: cost,
      zeroCreditEdit: false,
      boundAsset: primaryBound,
      sourceCanvasId: primaryBound.upload_id,
      fidelityPrompt,
      timeline,
      preFlightSummaryTr: `Fidelity Lock I2V (${primaryBound.vision.subject_summary_tr}) · Model: ${endpoint} (~$${cost.toFixed(3)}) + Akıllı Ürün SFX`,
    };
  }

  // Karar 4: Bağlı Görsel Üzerinde Kontext/Non-Destructive Edit (arkayı değiştir vb.)
  if (primaryBound && primaryBound.kind === "image" && !wantsVoiceoverOnly && (wantsVisualSceneEdit || !wantsNewImageGen)) {
    const fidelityPrompt = compileFidelityLockedPrompt(primaryBound.vision, input.message, "edit_image");
    return {
      operation: "edit_image_kontext",
      modelKey: "nano-banana-edit",
      endpoint: "fal-ai/nano-banana/edit",
      estimatedCostUsd: 0.0398,
      zeroCreditEdit: false,
      boundAsset: primaryBound,
      sourceCanvasId: primaryBound.upload_id,
      fidelityPrompt,
      timeline,
      preFlightSummaryTr: `Sadece İsteneni Değiştir Kilidi (${primaryBound.vision.subject_summary_tr}) · Model: fal-ai/nano-banana/edit ($0.0398)`,
    };
  }

  // Karar 5: Referanssız veya genel üretim (kademeli model seçimi)
  if (wantsNewVideoGen || /(video|reels|hareketli|klip)/.test(norm)) {
    const modelKey =
      input.tier === "pro" ? "kling-v3-pro" : input.tier === "standard" ? "minimax-h3-max" : "minimax-h3-max-turbo";
    const spec = FAL_ORCHESTRATOR_CATALOG.find((c) => c.key === modelKey);
    return {
      operation: "generate_video",
      modelKey,
      endpoint: spec?.endpoint ?? "minimax/h3-max-turbo/text-to-video",
      estimatedCostUsd: (spec?.unitCostUsd ?? 0.02) * 5,
      zeroCreditEdit: false,
      boundAsset: primaryBound,
      sourceCanvasId: hasActiveVisual ? activeCanvasId : null,
      fidelityPrompt: null,
      timeline,
      preFlightSummaryTr: `Clean AI Video (${spec?.endpoint ?? modelKey} · ${spec?.unitLabel ?? "$0.02/sn"}) + Programatik SFX Katmanı`,
    };
  }

  if (wantsVoiceoverOnly) {
    const modelKey = input.tier === "pro" ? "elevenlabs-v3" : "elevenlabs-turbo-2-5";
    const spec = FAL_ORCHESTRATOR_CATALOG.find((c) => c.key === modelKey);
    return {
      operation: "voiceover",
      modelKey,
      endpoint: spec?.endpoint ?? "fal-ai/elevenlabs/tts/turbo-v2.5",
      estimatedCostUsd: spec?.unitCostUsd ?? 0.05,
      zeroCreditEdit: false,
      boundAsset: primaryBound,
      sourceCanvasId: activeCanvasId,
      fidelityPrompt: null,
      timeline,
      preFlightSummaryTr: `Türkçe Seslendirme · Model: ${spec?.endpoint ?? modelKey} (${spec?.unitLabel ?? "$0.05/1K kr"})`,
    };
  }

  const wantsTextInImage = /(yazı olsun|afiş|poster|tipografi|üzerinde.*yaz)/.test(norm);
  const imgModelKey = wantsTextInImage
    ? "nano-banana-2"
    : input.tier === "pro"
      ? "nano-banana-pro"
      : input.tier === "standard"
        ? "flux-dev"
        : "flux-schnell";
  const spec = FAL_ORCHESTRATOR_CATALOG.find((c) => c.key === imgModelKey);
  return {
    operation: "generate_image",
    modelKey: imgModelKey,
    endpoint: spec?.endpoint ?? "fal-ai/flux/schnell",
    estimatedCostUsd: spec?.unitCostUsd ?? 0.003,
    zeroCreditEdit: false,
    boundAsset: primaryBound,
    sourceCanvasId: null,
    fidelityPrompt: null,
    timeline,
    preFlightSummaryTr: `Kademeli Görsel Üretimi · Model: ${spec?.endpoint ?? imgModelKey} (${spec?.unitLabel ?? "$0.003/MP"})`,
  };
}


