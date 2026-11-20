import { assertSafeOutboundUrl } from "../security/outbound-url";

export interface ExtractedProductInfo {
  url: string;
  hostname: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  priceText: string | null;
  currency: string | null;
  fetched: boolean;
  error?: string;
}

const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 250_000;
const FETCH_TIMEOUT_MS = 5_000;

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readMeta(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i");
    const m1 = re1.exec(html);
    if (m1?.[1]) return decodeHtmlEntities(m1[1]);
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i");
    const m2 = re2.exec(html);
    if (m2?.[1]) return decodeHtmlEntities(m2[1]);
  }
  return null;
}

function extractJsonLdProduct(html: string): { title?: string; description?: string; image?: string; price?: string; currency?: string } {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    try {
      const raw = JSON.parse(match[1] ?? "");
      const nodes = Array.isArray(raw) ? raw : raw?.["@graph"] && Array.isArray(raw["@graph"]) ? raw["@graph"] : [raw];
      for (const node of nodes) {
        const type = String(node?.["@type"] ?? "");
        if (!type.toLowerCase().includes("product")) continue;
        const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
        const img = Array.isArray(node.image) ? node.image[0] : typeof node.image === "object" ? node.image?.url : node.image;
        return {
          title: typeof node.name === "string" ? decodeHtmlEntities(node.name) : undefined,
          description: typeof node.description === "string" ? decodeHtmlEntities(node.description) : undefined,
          image: typeof img === "string" ? img : undefined,
          price: offer?.price != null ? String(offer.price) : undefined,
          currency: typeof offer?.priceCurrency === "string" ? offer.priceCurrency : undefined,
        };
      }
    } catch {
      // Bozuk JSON-LD atlanır
    }
  }
  return {};
}

export function parseProductHtml(html: string, baseUrl: URL): Omit<ExtractedProductInfo, "fetched" | "error"> {
  const ld = extractJsonLdProduct(html);
  const ogTitle = readMeta(html, ["og:title", "twitter:title"]);
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const title = (ld.title || ogTitle || (titleTag ? decodeHtmlEntities(titleTag) : null))?.slice(0, 160) ?? null;

  const description = (ld.description || readMeta(html, ["og:description", "description"]))?.slice(0, 400) ?? null;

  const rawImage = ld.image || readMeta(html, ["og:image", "twitter:image"]);
  let imageUrl: string | null = null;
  if (rawImage) {
    try {
      const resolved = new URL(rawImage, baseUrl);
      if (resolved.protocol === "https:" || resolved.protocol === "http:") {
        imageUrl = resolved.toString();
      }
    } catch {
      imageUrl = null;
    }
  }

  const priceAmount = ld.price || readMeta(html, ["product:price:amount", "og:price:amount"]);
  const currency = ld.currency || readMeta(html, ["product:price:currency", "og:price:currency"]) || null;
  const priceText = priceAmount ? (currency ? `${priceAmount} ${currency}` : priceAmount) : null;

  return {
    url: baseUrl.toString(),
    hostname: baseUrl.hostname,
    title,
    description,
    imageUrl,
    priceText,
    currency,
  };
}

/**
 * SSRF korumalı ürün linki çıkarıcı:
 * - Yalnızca http/https
 * - Özel IP, loopback, link-local, AWS IMDS ve dahili alan adları engelli
 * - Her yönlendirmede hedef URL tekrar doğrulanır (en çok 3 yönlendirme)
 * - Zaman aşımı: 5 sn
 */
export async function extractProductFromUrl(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExtractedProductInfo> {
  let currentUrl: URL;
  try {
    currentUrl = await assertSafeOutboundUrl(rawUrl.trim(), { allowHttp: true });
  } catch (err) {
    return {
      url: rawUrl,
      hostname: "",
      title: null,
      description: null,
      imageUrl: null,
      priceText: null,
      currency: null,
      fetched: false,
      error: err instanceof Error ? err.message : "Geçersiz veya güvensiz URL.",
    };
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      const res = await fetchImpl(currentUrl.toString(), {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": "NordvowCampaignAssistant/1.0 (+https://nordvow.com)",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc || hop === MAX_REDIRECTS) {
          return {
            url: currentUrl.toString(),
            hostname: currentUrl.hostname,
            title: null,
            description: null,
            imageUrl: null,
            priceText: null,
            currency: null,
            fetched: false,
            error: "Çok fazla yönlendirme nedeniyle ürün bilgisi alınamadı.",
          };
        }
        const nextUrl = new URL(loc, currentUrl).toString();
        currentUrl = await assertSafeOutboundUrl(nextUrl, { allowHttp: true });
        continue;
      }

      if (!res.ok) {
        return {
          url: currentUrl.toString(),
          hostname: currentUrl.hostname,
          title: null,
          description: null,
          imageUrl: null,
          priceText: null,
          currency: null,
          fetched: false,
          error: `Sayfa yanıt vermedi (HTTP ${res.status}). Bilgileri elle girebilirsiniz.`,
        };
      }

      const rawText = (await res.text()).slice(0, MAX_HTML_BYTES);
      const parsed = parseProductHtml(rawText, currentUrl);
      return { ...parsed, fetched: true };
    } catch (err) {
      return {
        url: currentUrl.toString(),
        hostname: currentUrl.hostname,
        title: null,
        description: null,
        imageUrl: null,
        priceText: null,
        currency: null,
        fetched: false,
        error: err instanceof Error ? err.message : "Ürün sayfası okunamadı.",
      };
    }
  }

  return {
    url: currentUrl.toString(),
    hostname: currentUrl.hostname,
    title: null,
    description: null,
    imageUrl: null,
    priceText: null,
    currency: null,
    fetched: false,
    error: "Ürün bilgisi alınamadı.",
  };
}

