const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

function resolveMime(rawMime: string, fileName: string): string {
  const base = rawMime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "image/jpg") return "image/jpeg";
  if (base === "video/x-m4v") return "video/mp4";
  if (base && base !== "application/octet-stream") return base;
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? base;
}

/** Tarayıcıdan S3'e Creative yüklemesi (ilerleme çubuğu için XHR). Dosya işlemi yapanın kitaplığına düşer. */
export async function uploadFile(file: Blob, opts: { name: string; mime: string; tenantId?: string; parentId?: string; onProgress?: (p: number) => void }): Promise<{ id: string; kind: "image" | "video" }> {
  const mime = resolveMime(opts.mime, opts.name);
  const pres = await fetch("/api/creative/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mime, size: file.size }) });
  const pj = await pres.json();
  if (!pres.ok) throw new Error(pj.error ?? "Yükleme hazırlanamadı.");
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", pj.url);
    xhr.setRequestHeader("content-type", mime);
    xhr.upload.onprogress = (e) => e.lengthComputable && opts.onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Yükleme başarısız (HTTP ${xhr.status}).`)));
    xhr.onerror = () => reject(new Error("Bağlantı hatası; tekrar deneyin."));
    xhr.send(file);
  });
  const conf = await fetch("/api/creative/upload", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: pj.key, name: opts.name, parentId: opts.parentId }) });
  const cj = await conf.json();
  if (!conf.ok) throw new Error(cj.error ?? "Dosya kaydedilemedi.");
  return { id: cj.id, kind: cj.kind };
}
