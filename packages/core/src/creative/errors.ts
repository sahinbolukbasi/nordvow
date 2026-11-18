/**
 * Creative Stüdyo hata mesajlarını kullanıcı dostu, anlamlı Türkçe açıklamalara çevirir.
 * Ham HTTP kodları ("Unexpected status code: 422", "HTTP 500" vb.) son kullanıcıya yansıtılmaz.
 */
export function humanizeCreativeError(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw ?? "");
  const lower = msg.toLowerCase();

  if (!msg.trim()) {
    return "İçerik üretimi sırasında beklenmeyen bir sorun oluştu. Lütfen tekrar deneyin.";
  }

  if (lower.includes("422") || lower.includes("unprocessable") || lower.includes("validation")) {
    if (lower.includes("nsfw") || lower.includes("safety") || lower.includes("policy") || lower.includes("content")) {
      return "Gönderdiğiniz görsel veya komut güvenlik politikasına takıldı. Lütfen farklı bir görsel veya ifadeyle deneyin.";
    }
    if (lower.includes("image") || lower.includes("url") || lower.includes("aspect") || lower.includes("size")) {
      return "Yüklenen görsel AI modeli tarafından işlenemedi (format, boyut veya oran uyumsuz). Lütfen farklı bir JPEG/PNG görsel ile deneyin.";
    }
    return "Görsel veya komut AI modeli tarafından işlenemedi. Lütfen farklı bir fotoğraf veya daha net bir açıklamayla tekrar deneyin.";
  }

  if (lower.includes("401") || lower.includes("403") || lower.includes("unauthorized") || lower.includes("forbidden")) {
    return "AI servis yetkilendirmesi geçersiz veya süresi dolmuş. Lütfen yönetim panelinden FAL_KEY ayarını kontrol edin.";
  }

  if (lower.includes("402") || lower.includes("exhausted") || lower.includes("balance") || lower.includes("quota")) {
    return "AI servis sağlayıcı kotası yetersiz; lütfen yöneticinizle iletişime geçin.";
  }

  if (lower.includes("413") || lower.includes("too large") || lower.includes("payload")) {
    return "Yüklenen dosya boyutu AI modeli için çok büyük. Lütfen daha küçük bir dosya yükleyin.";
  }

  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("too many")) {
    return "Şu anda çok fazla eşzamanlı işlem var. Lütfen birkaç saniye bekleyip tekrar deneyin.";
  }

  if (lower.includes("408") || lower.includes("504") || lower.includes("timeout") || lower.includes("abort") || lower.includes("timed out")) {
    return "İşlem zaman aşımına uğradı. Lütfen tekrar deneyin.";
  }

  if (lower.includes("500") || lower.includes("502") || lower.includes("503") || lower.includes("service unavailable")) {
    return "AI üretim servisi geçici olarak yoğun veya yanıt vermiyor. Lütfen kısa süre sonra tekrar deneyin.";
  }

  if (lower.includes("unexpected status code") || lower.includes("fal error")) {
    return "AI modeli isteği işleyemedi. Lütfen görseli veya komutu güncelleyip tekrar deneyin.";
  }

  return msg;
}

