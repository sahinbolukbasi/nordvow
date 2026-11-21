/** Verilen media S3 anahtarından görüntüleme URL'i (üretimde CloudFront CDN /media/* üzerinden önbellekli). */
export function mediaSrc(key: string | null | undefined): string | null {
  if (!key) return null;
  const clean = key.replace(/^media\//, "");
  return process.env.NODE_ENV === "production" ? `/media/${clean}` : `/api/media/${clean}`;
}
