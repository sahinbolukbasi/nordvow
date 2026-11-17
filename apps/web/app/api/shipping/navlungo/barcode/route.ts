import { requireApiActor } from "@/lib/auth-guard";
import { getNavlungoBarcode } from "@infulancer/core/shipping/service";

export async function GET(req: Request) {
  const auth = await requireApiActor("BRAND", "ADMIN");
  if (auth.response) return auth.response;

  const url = new URL(req.url);
  const postNumber = url.searchParams.get("postNumber")?.trim();
  const barcodeType = (url.searchParams.get("type") ?? "pdf") as "pdf" | "html" | "zpl";
  if (!postNumber) {
    return Response.json({ error: "postNumber parametresi zorunludur." }, { status: 400 });
  }
  if (!auth.actor.brandId) {
    return Response.json({ error: "Marka bilgisi bulunamadı." }, { status: 400 });
  }

  try {
    const data = await getNavlungoBarcode(auth.actor.brandId, postNumber, barcodeType);
    return Response.json(data);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Barkod alınamadı." },
      { status: 502 },
    );
  }
}

