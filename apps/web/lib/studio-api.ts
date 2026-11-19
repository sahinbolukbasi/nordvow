import { isDomainError } from "@infulancer/core/domain/errors";
import { jsonError } from "@/lib/uploads";

export function isStudioEditorEnabled(): boolean {
  return process.env.CREATIVE_STUDIO_EDITOR_ENABLED !== "false";
}

export function studioDisabledResponse(): Response | null {
  if (!isStudioEditorEnabled()) {
    return jsonError(404, "Video Editörü özelliği şu anda devre dışı.");
  }
  return null;
}

export function studioErrorResponse(err: unknown): Response {
  if (isDomainError(err)) {
    const status =
      err.code === "YETKISIZ"
        ? 403
        : err.code === "BULUNAMADI"
          ? 404
          : err.code === "CAKISMA"
            ? 409
            : err.code === "SUNUCU_HATASI"
              ? 500
              : 422;
    return Response.json(
      {
        error: err.message,
        code: err.code,
        ...(err.details ? { details: err.details } : {}),
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
  console.error("[studio-api]", err);
  return jsonError(500, "Beklenmeyen bir stüdyo hatası oluştu.");
}
