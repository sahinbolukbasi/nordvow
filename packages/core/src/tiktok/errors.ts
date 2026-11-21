export type TikTokErrorCode =
  | "ok"
  | "access_token_invalid"
  | "scope_not_authorized"
  | "rate_limit_exceeded"
  | "spam_risk_too_many_posts"
  | "spam_risk_user_banned_from_posting"
  | "unaudited_client_can_only_post_to_private_accounts"
  | "url_ownership_unverified"
  | "invalid_params"
  | "internal_error"
  | (string & {});

const ERROR_MESSAGES: Record<string, string> = {
  access_token_invalid: "TikTok erişim anahtarı geçersiz veya süresi dolmuş.",
  scope_not_authorized: "Bu işlem için gerekli TikTok izni (scope) onaylanmamış. Lütfen yeniden yetki verin.",
  rate_limit_exceeded: "TikTok API hız sınırına ulaşıldı. Lütfen kısa süre sonra tekrar deneyin.",
  spam_risk_too_many_posts: "Creator 24 saatlik TikTok gönderi sınırına ulaştı.",
  spam_risk_user_banned_from_posting: "TikTok hesabı şu anda içerik paylaşımına kısıtlı.",
  unaudited_client_can_only_post_to_private_accounts:
    "Uygulama TikTok denetiminden geçene kadar yalnızca SELF_ONLY (gizli) içerik yayınlanabilir.",
  url_ownership_unverified: "PULL_FROM_URL için video domain'i TikTok Developer Portal'da doğrulanmamış.",
  invalid_params: "TikTok API isteğindeki parametreler geçersiz.",
  internal_error: "TikTok sunucularında geçici bir hata oluştu.",
};

export class TikTokApiError extends Error {
  readonly code: TikTokErrorCode;
  readonly httpStatus: number;
  readonly logId?: string;
  readonly retryable: boolean;

  constructor(opts: {
    code: TikTokErrorCode;
    message?: string;
    httpStatus?: number;
    logId?: string;
  }) {
    const friendly = ERROR_MESSAGES[opts.code] ?? opts.message ?? `TikTok API hatası (${opts.code})`;
    super(friendly);
    this.name = "TikTokApiError";
    this.code = opts.code;
    this.httpStatus = opts.httpStatus ?? 400;
    this.logId = opts.logId;
    this.retryable =
      opts.httpStatus === 429 ||
      opts.httpStatus === 503 ||
      opts.code === "rate_limit_exceeded" ||
      opts.code === "internal_error";
  }
}

export function isScopeMissingError(err: unknown): boolean {
  return err instanceof TikTokApiError && err.code === "scope_not_authorized";
}

export function isTokenInvalidError(err: unknown): boolean {
  return err instanceof TikTokApiError && err.code === "access_token_invalid";
}
