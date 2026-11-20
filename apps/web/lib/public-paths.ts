/**
 * Oturumsuz erişilen yollar. Eşleşme tamdır: `/api/health` `/api/healthx` veya
 * `/api/health/ek` açmaz. Önekli istisnalar (webhook, bilet) proxy.ts içindedir.
 */
export const PUBLIC_PATHS = new Set([
  "/gizlilik",
  "/kullanim-kosullari",
  "/kullanim-sartlari",
  "/kvkk",
  "/kvkk-aydinlatma",
  "/acik-riza",
  "/cerez-politikasi",
  "/veri-silme",
  "/influencer-sozlesmesi",
  "/marka-sozlesmesi",
  "/mesafeli-satis",
  "/iade-iptal",
  "/ileti-izni",
  "/destek",
  "/health",
  "/api/health",
]);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}
