import { z } from "zod";
import { deleteObject, headObject, presignMediaPut } from "@infulancer/core/storage/s3";
import { requireApiActor } from "@/lib/auth-guard";

export const runtime = "nodejs";
const MAX_IMAGE = 8 * 1024 * 1024; // 8 MB (etkinlik/kupon/profil görselleri)
const MAX_VIDEO = 50 * 1024 * 1024; // 50 MB (tanıtım videoları)
const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_MIMES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const ALL_MIMES = new Set([...IMAGE_MIMES, ...VIDEO_MIMES]);
const putSchema = z.object({
  mime: z.enum(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "video/quicktime"]),
  size: z.number().int().positive().max(MAX_VIDEO),
});
const confirmSchema = z.object({ key: z.string().regex(/^media\/[a-f0-9-]+\.(jpg|png|webp|mp4|webm|mov)$/) });

/** Etkinlik/kupon görseli veya tanıtım videosu için presigned PUT (admin + marka). */
export async function POST(req: Request) {
  const auth = await requireApiActor("ADMIN", "BRAND");
  if (auth.response) return auth.response;
  const body = await req.json().catch(() => null);
  const p = putSchema.safeParse(body);
  if (!p.success) return Response.json({ error: "Yalnız JPEG/PNG/WebP (8 MB) veya MP4/WebM/MOV (50 MB) yüklenebilir." }, { status: 400 });
  if (IMAGE_MIMES.has(p.data.mime) && p.data.size > MAX_IMAGE) {
    return Response.json({ error: "Görsel en fazla 8 MB olabilir." }, { status: 400 });
  }
  const { key, url } = await presignMediaPut(p.data.mime);
  return Response.json({ key, url }, { headers: { "Cache-Control": "no-store" } });
}

/** Yükleme doğrula: nesne var ve sınırlar içinde mi; key döndür. */
export async function PUT(req: Request) {
  const auth = await requireApiActor("ADMIN", "BRAND");
  if (auth.response) return auth.response;
  const body = await req.json().catch(() => null);
  const c = confirmSchema.safeParse(body);
  if (!c.success) return Response.json({ error: "Geçersiz anahtar." }, { status: 400 });
  const head = await headObject(c.data.key);
  if (!head || head.size === 0) return Response.json({ error: "Dosya yüklenmemiş görünüyor." }, { status: 400 });
  const limit = VIDEO_MIMES.has(head.mime ?? "") ? MAX_VIDEO : MAX_IMAGE;
  if (head.size > limit || !ALL_MIMES.has(head.mime ?? "")) {
    await deleteObject(c.data.key);
    return Response.json({ error: "Dosya boyut sınırını aşıyor veya desteklenmeyen türde." }, { status: 400 });
  }
  return Response.json({ ok: true, key: c.data.key }, { headers: { "Cache-Control": "no-store" } });
}
