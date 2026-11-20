/**
 * Meta Graph hatalarını tek yerde sınıflar. Business Discovery ve Instagram Login aynı kuralları kullanır.
 * Sınıf adları ham Graph gövdesi değildir; mesajlar Türkçe ve belirteç içermez.
 */
export const GRAPH_ERROR_CLASSES = [
  "TOKEN_INVALID",
  "MISSING_PERMISSION",
  "TARGET_NOT_DISCOVERABLE",
  "RATE_LIMITED",
  "UNKNOWN",
] as const;

export type GraphErrorClass = (typeof GRAPH_ERROR_CLASSES)[number];

/** Otomatik tekrar yok. RATE_LIMITED ayrıdır. */
export const PERMANENT_GRAPH_CLASSES = [
  "TOKEN_INVALID",
  "MISSING_PERMISSION",
  "TARGET_NOT_DISCOVERABLE",
  "UNKNOWN",
] as const satisfies readonly GraphErrorClass[];

/** Ajans belirteci / uygulama izni: hedef hesapmış gibi yeniden denenmez. */
export const AGENCY_GRAPH_CLASSES = ["TOKEN_INVALID", "MISSING_PERMISSION"] as const satisfies readonly GraphErrorClass[];

export type GraphBlame = "target" | "agency" | "app" | "transport";

export type ClassifiedGraphError = {
  errorClass: GraphErrorClass;
  httpStatus?: number;
  code?: number;
  errorSubcode?: number;
  message: string;
  retryable: boolean;
  blame: GraphBlame;
  estimatedTimeToRegainAccessSec?: number;
};

export type GraphFailureInput = {
  httpStatus?: number;
  message?: string;
  code?: number;
  errorSubcode?: number;
  type?: string;
  estimatedTimeToRegainAccessSec?: number;
  /** İstekteki ajans IG kullanıcı kimliği. Hata bu kimliğe aitse hedef sayılmaz. */
  agencyIgUserId?: string;
  targetHandle?: string;
};

const TOKEN_CODES = new Set([190, 102, 463, 467]);
const TOKEN_SUBCODES = new Set([463, 467]);
const RATE_CODES = new Set([4, 17, 32, 613, 80007]);
const PERMISSION_CODES = new Set([10, 200]);

/** İlk denemeden sonra en fazla bu kadar hız sınırı tekrarı. */
export const GRAPH_MAX_RETRIES = 3;

const TARGET_MESSAGE = /not a business|cannot find user|user not found|is not a business|private account|profil gizli/i;

export function graphBackoffMs(attempt: number, estimatedSec?: number, rand: () => number = Math.random): number {
  const clamp = (n: number) => Math.min(60_000, Math.max(500, Math.round(n)));
  if (estimatedSec != null && Number.isFinite(estimatedSec) && estimatedSec > 0) {
    return clamp(estimatedSec * 1000);
  }
  const exp = 500 * 2 ** Math.max(0, attempt - 1);
  const jitter = Math.floor(rand() * Math.min(1_000, exp * 0.25));
  return clamp(exp + jitter);
}

function codeLabel(code?: number, sub?: number): string {
  if (code == null && sub == null) return "";
  if (code != null && sub != null) return ` (${code}/${sub})`;
  if (code != null) return ` (${code})`;
  return "";
}

function mentionsAgencyObject(message: string, agencyIgUserId?: string): boolean {
  const id = agencyIgUserId?.trim();
  if (!id || !message) return false;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const objectHit = new RegExp(`object with id ['"]?${escaped}['"]?`, "i").test(message);
  const idHit = new RegExp(`\\b${escaped}\\b`, "i").test(message) && /does not exist|unsupported get request|invalid user id/i.test(message);
  return objectHit || idHit;
}

export function classifyGraphFailure(input: GraphFailureInput): ClassifiedGraphError {
  const message = input.message ?? "";
  const code = input.code;
  const sub = input.errorSubcode;
  const httpStatus = input.httpStatus;
  const label = codeLabel(code, sub);
  const agencyObject = mentionsAgencyObject(message, input.agencyIgUserId);

  const base = {
    httpStatus,
    code,
    errorSubcode: sub,
    estimatedTimeToRegainAccessSec: input.estimatedTimeToRegainAccessSec,
  };

  if (httpStatus === 429 || (code != null && RATE_CODES.has(code))) {
    return {
      ...base,
      errorClass: "RATE_LIMITED",
      retryable: true,
      blame: "transport",
      message: `Meta istek limiti aşıldı${label}. Kısa bir beklemeyle yeniden denenecek.`,
    };
  }

  if ((code != null && TOKEN_CODES.has(code)) || (sub != null && TOKEN_SUBCODES.has(sub)) || (input.type === "OAuthException" && code === 190)) {
    return {
      ...base,
      errorClass: "TOKEN_INVALID",
      retryable: false,
      blame: "agency",
      message: `Meta erişim belirteci geçersiz veya süresi dolmuş${label}. Bu, hedef hesabın bulunamadığı anlamına gelmez; ajans bağlantısı yenilenmeli.`,
    };
  }

  if (code != null && PERMISSION_CODES.has(code)) {
    return {
      ...base,
      errorClass: "MISSING_PERMISSION",
      retryable: false,
      blame: "app",
      message: `Meta uygulamasının bu çağrı için izni yok${label}. Uygulama yayında değil veya izinler henüz gelişmiş erişimde değil (Ready for testing). Bu, hedef hesabın hatası değil.`,
    };
  }

  const targetByMessage = TARGET_MESSAGE.test(message) && !agencyObject;
  const targetByCode = code === 110 && sub === 2207013;
  const targetWithoutAgency = ((code === 110 && sub == null) || targetByMessage) && !agencyObject;
  if (targetByCode || targetWithoutAgency) {
    const handle = input.targetHandle ? `@${input.targetHandle}` : "Hesap";
    return {
      ...base,
      errorClass: "TARGET_NOT_DISCOVERABLE",
      retryable: false,
      blame: "target",
      message: `${handle} Business Discovery ile okunamadı${label || " (110/2207013)"}. Hesap kişisel, gizli veya kısıtlı olabilir. Bu hesapta Business Discovery zorlanmaz. İçerik üreticisi Instagram ile bağlanırsa kendi verisi okunur; gizli profile istek atılmaz.`,
    };
  }

  if (agencyObject || /nonexisting field \(business_discovery\)/i.test(message)) {
    return {
      ...base,
      errorClass: "UNKNOWN",
      retryable: false,
      blame: "agency",
      message: `Ajans Instagram kimliği Graph'ta geçersiz veya Business Discovery bu belirteçle kullanılamıyor${label}. Bu, hedef hesabın hatası değil.`,
    };
  }

  return {
    ...base,
    errorClass: "UNKNOWN",
    retryable: false,
    blame: "transport",
    message: "Instagram verisi alınamadı. Ayrıntı gösterilmez.",
  };
}

export class GraphCallError extends Error {
  readonly classified: ClassifiedGraphError;
  readonly attempts: number;
  constructor(classified: ClassifiedGraphError, attempts = 1) {
    super(classified.message);
    this.name = "GraphCallError";
    this.classified = classified;
    this.attempts = attempts;
  }
}

type GraphErrorBody = {
  message?: string;
  code?: number;
  error_subcode?: number;
  type?: string;
  estimated_time_to_regain_access?: number;
};

let sleepImpl: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Testler gerçek beklemeyi kapatır. Üretimde zamanlayıcı kullanılır. */
export function setGraphRetrySleep(fn?: (ms: number) => Promise<void>) {
  sleepImpl = fn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
}

export type GraphGetOptions = {
  agencyIgUserId?: string;
  targetHandle?: string;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
  maxRetries?: number;
  rand?: () => number;
};

/** Tek GET. Hız sınırında üstel bekleme + jitter; kalıcı sınıfta tekrar yok. Belirteç hata metnine yazılmaz. */
export async function graphGetJson(url: string, opts: GraphGetOptions = {}): Promise<{ json: Record<string, unknown>; attempts: number }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxRetries = opts.maxRetries ?? GRAPH_MAX_RETRIES;
  const rand = opts.rand ?? Math.random;
  let attempt = 0;
  let retries = 0;
  while (true) {
    attempt += 1;
    let res: Response;
    try {
      res = await fetchImpl(url, { headers: opts.headers, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new GraphCallError({
        errorClass: "UNKNOWN",
        retryable: false,
        blame: "transport",
        message: "Instagram verisi alınamadı. Ayrıntı gösterilmez.",
      });
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
      error?: GraphErrorBody;
      estimated_time_to_regain_access?: number;
    };
    const err = json.error;
    if (res.ok && !err) return { json, attempts: attempt };
    const estimated = err?.estimated_time_to_regain_access ?? json.estimated_time_to_regain_access;
    const classified = classifyGraphFailure({
      httpStatus: res.status,
      message: err?.message,
      code: err?.code,
      errorSubcode: err?.error_subcode,
      type: err?.type,
      estimatedTimeToRegainAccessSec: estimated,
      agencyIgUserId: opts.agencyIgUserId,
      targetHandle: opts.targetHandle,
    });
    if (classified.retryable && retries < maxRetries) {
      retries += 1;
      await sleepImpl(graphBackoffMs(retries, classified.estimatedTimeToRegainAccessSec, rand));
      continue;
    }
    throw new GraphCallError(classified, attempt);
  }
}
