"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/form";

type TikTokAnalyticsResponse = {
  connected: boolean;
  account: {
    id: string;
    openId: string;
    displayName: string | null;
    username: string | null;
    avatarUrl: string | null;
    bio: string | null;
    profileDeepLink: string | null;
    isVerified: boolean;
    followerCount: number;
    followingCount: number;
    likesCount: number;
    videoCount: number;
    status: string;
    lastSyncedAt: string | null;
    lastError: string | null;
    scopes: string[];
    missingScopes: string[];
  } | null;
  dailyStats?: { date: string; followerCount: number; likesCount: number; videoCount: number }[];
  videos?: {
    id: string;
    title: string | null;
    videoDescription: string | null;
    createTime: string;
    shareUrl: string | null;
    viewCount: number;
    likeCount: number;
    commentCount: number;
    shareCount: number;
    engagementRate: number;
  }[];
  posts?: {
    id: string;
    publishId: string;
    mode: string;
    privacyLevel: string;
    caption: string | null;
    status: string;
    failReason: string | null;
    brandContentToggle: boolean;
    createdAt: string;
  }[];
};

type CreatorPreflight = {
  audited: boolean;
  missingPublishScopes: string[];
  creatorNickname: string;
  creatorUsername: string;
  privacyLevelOptions: string[];
  duetDisabled: boolean;
  commentDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
};

type AiInsights = {
  captions: string[];
  hashtags: string[];
  bestPostingHours: string[];
  performanceSummary: string;
};

const PRIVACY_LABELS: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Herkese Açık (Public)",
  MUTUAL_FOLLOW_FRIENDS: "Karşılıklı Takipçiler",
  FOLLOWER_OF_CREATOR: "Takipçiler",
  SELF_ONLY: "Yalnızca Ben (Gizli / SELF_ONLY)",
};

export function TikTokCreatorPanel() {
  const [data, setData] = useState<TikTokAnalyticsResponse | null>(null);
  const [preflight, setPreflight] = useState<CreatorPreflight | null>(null);
  const [ai, setAi] = useState<AiInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Yayınlama formu state'i (privacyLevel varsayılan boş — TikTok UX zorunluluğu)
  const [mode, setMode] = useState<"DIRECT" | "INBOX">("DIRECT");
  const [source, setSource] = useState<"PULL_FROM_URL" | "FILE_UPLOAD">("PULL_FROM_URL");
  const [videoUrl, setVideoUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [privacyLevel, setPrivacyLevel] = useState("");
  const [disableDuet, setDisableDuet] = useState(false);
  const [disableComment, setDisableComment] = useState(false);
  const [disableStitch, setDisableStitch] = useState(false);
  const [brandContentToggle, setBrandContentToggle] = useState(false);
  const [brandOrganicToggle, setBrandOrganicToggle] = useState(false);
  const [userConfirmed, setUserConfirmed] = useState(false);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tiktok/analytics", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as TikTokAnalyticsResponse;
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  async function handleSync() {
    setBusy("sync");
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/tiktok/sync", { method: "POST" });
      const j = (await res.json()) as { ok?: boolean; error?: string; videoCount?: number };
      if (!res.ok || !j.ok) throw new Error(j.error ?? "Senkron başarısız.");
      setMsg(`TikTok hesabı senkronlandı (${j.videoCount ?? 0} video).`);
      await loadAnalytics();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Senkron hatası.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm("TikTok bağlantısı kesilecek ve tüm TikTok profil/video/istatistik verileriniz silinecektir. Onaylıyor musunuz?")) {
      return;
    }
    setBusy("disconnect");
    setErr(null);
    try {
      const res = await fetch("/api/tiktok/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("Bağlantı kesilemedi.");
      setMsg("TikTok bağlantısı kesildi ve veriler silindi.");
      setPreflight(null);
      await loadAnalytics();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Hata");
    } finally {
      setBusy(null);
    }
  }

  async function handleLoadPreflight() {
    setBusy("preflight");
    setErr(null);
    try {
      const res = await fetch("/api/tiktok/creator-info", { cache: "no-store" });
      const j = (await res.json()) as CreatorPreflight & { error?: string };
      if (!res.ok) throw new Error(j.error ?? "Creator bilgisi alınamadı.");
      setPreflight(j);
      setPrivacyLevel(""); // TikTok UX: varsayılan seçili olmamalı
      setDisableDuet(j.duetDisabled);
      setDisableComment(j.commentDisabled);
      setDisableStitch(j.stitchDisabled);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Creator bilgisi hatası.");
    } finally {
      setBusy(null);
    }
  }

  async function handleAiSuggest() {
    setBusy("ai");
    setErr(null);
    try {
      const res = await fetch("/api/tiktok/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: caption || "ürün inceleme" }),
      });
      const j = (await res.json()) as AiInsights;
      setAi(j);
    } catch {
      setErr("AI önerisi alınamadı.");
    } finally {
      setBusy(null);
    }
  }

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (mode === "DIRECT" && !privacyLevel) {
      setErr("Lütfen gizlilik seviyesini seçin.");
      return;
    }
    if (!userConfirmed) {
      setErr("Yayınlamadan önce önizleme onay kutusunu işaretlemelisiniz.");
      return;
    }

    setBusy("publish");
    try {
      let res: Response;
      if (source === "FILE_UPLOAD") {
        if (!file) throw new Error("Lütfen bir video dosyası seçin.");
        const form = new FormData();
        form.append("file", file);
        form.append("mode", mode);
        form.append("caption", caption);
        if (privacyLevel) form.append("privacyLevel", privacyLevel);
        form.append("disableDuet", String(disableDuet));
        form.append("disableComment", String(disableComment));
        form.append("disableStitch", String(disableStitch));
        form.append("brandContentToggle", String(brandContentToggle));
        form.append("brandOrganicToggle", String(brandOrganicToggle));
        form.append("userConfirmed", String(userConfirmed));
        res = await fetch("/api/tiktok/publish", { method: "POST", body: form });
      } else {
        res = await fetch("/api/tiktok/publish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode,
            source: "PULL_FROM_URL",
            videoUrl,
            caption,
            privacyLevel: privacyLevel || undefined,
            disableDuet,
            disableComment,
            disableStitch,
            brandContentToggle,
            brandOrganicToggle,
            userConfirmed,
          }),
        });
      }
      const j = (await res.json()) as { ok?: boolean; error?: string; post?: { publishId: string } };
      if (!res.ok || !j.ok) throw new Error(j.error ?? "Yayınlama başarısız.");
      setMsg(`İçerik TikTok'a gönderildi (publish_id: ${j.post?.publishId}).`);
      setUserConfirmed(false);
      await loadAnalytics();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Yayınlama hatası.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <Card interactive={false}>
        <p className="text-sm text-fg-muted">TikTok entegrasyonu yükleniyor...</p>
      </Card>
    );
  }

  const acc = data?.account;

  if (!data?.connected || !acc) {
    return (
      <Card interactive={false} className="flex flex-col gap-3">
        <CardTitle>TikTok ile Bağlan (Login Kit v2)</CardTitle>
        <p className="text-sm text-fg-muted">
          TikTok profiliniz, video istatistikleriniz ve onaylı içerik yayınlama işlemleri yalnızca sizin açık izninizle TikTok&apos;un resmî OAuth ekranı üzerinden bağlanır.
        </p>
        <ButtonLink href="/api/tiktok/oauth/start" variant="primary" className="w-fit">
          TikTok ile Bağlan
        </ButtonLink>
      </Card>
    );
  }

  const daily = data.dailyStats ?? [];
  const videos = data.videos ?? [];
  const posts = data.posts ?? [];
  const maxFollowers = Math.max(1, ...daily.map((d) => d.followerCount));
  const minFollowers = Math.min(...daily.map((d) => d.followerCount), maxFollowers);

  return (
    <div className="flex flex-col gap-4">
      <Card interactive={false} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>
              TikTok Hesabı: {acc.displayName ?? acc.username ?? acc.openId}
              {acc.isVerified ? " ✓" : ""}
            </CardTitle>
            <p className="text-xs text-fg-muted">
              @{acc.username ?? "tiktok"} · Durum: <span className="font-medium">{acc.status}</span>
              {acc.lastSyncedAt ? ` · Son senkron: ${new Date(acc.lastSyncedAt).toLocaleString("tr-TR")}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={handleSync} disabled={busy !== null}>
              {busy === "sync" ? "Senkronlanıyor..." : "Senkronla"}
            </Button>
            {acc.missingScopes.length > 0 && (
              <ButtonLink href={`/api/tiktok/oauth/start?scopes=${encodeURIComponent(acc.missingScopes.concat(acc.scopes).join(","))}`} variant="primary">
                Eksik İzinleri Tamamla
              </ButtonLink>
            )}
            <Button type="button" variant="secondary" className="text-critical" onClick={handleDisconnect} disabled={busy !== null}>
              Bağlantıyı Kes
            </Button>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md border border-border p-3">
            <dt className="text-xs text-fg-muted">Takipçi</dt>
            <dd className="text-lg font-semibold tabular-nums">{acc.followerCount.toLocaleString("tr-TR")}</dd>
          </div>
          <div className="rounded-md border border-border p-3">
            <dt className="text-xs text-fg-muted">Takip Edilen</dt>
            <dd className="text-lg font-semibold tabular-nums">{acc.followingCount.toLocaleString("tr-TR")}</dd>
          </div>
          <div className="rounded-md border border-border p-3">
            <dt className="text-xs text-fg-muted">Toplam Beğeni</dt>
            <dd className="text-lg font-semibold tabular-nums">{acc.likesCount.toLocaleString("tr-TR")}</dd>
          </div>
          <div className="rounded-md border border-border p-3">
            <dt className="text-xs text-fg-muted">Video Sayısı</dt>
            <dd className="text-lg font-semibold tabular-nums">{acc.videoCount.toLocaleString("tr-TR")}</dd>
          </div>
        </dl>

        {acc.lastError && <p className="text-xs text-critical">Son hata: {acc.lastError}</p>}
        {msg && <p className="text-xs text-emerald-600">{msg}</p>}
        {err && <p className="text-xs text-critical">{err}</p>}
      </Card>

      {daily.length > 1 && (
        <Card interactive={false} className="flex flex-col gap-2">
          <CardTitle>Takipçi Büyüme Grafiği</CardTitle>
          <svg viewBox="0 0 400 80" className="h-24 w-full overflow-visible">
            <polyline
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-primary"
              points={daily
                .map((d, i) => {
                  const x = (i / Math.max(1, daily.length - 1)) * 390 + 5;
                  const span = Math.max(1, maxFollowers - minFollowers);
                  const y = 70 - ((d.followerCount - minFollowers) / span) * 60;
                  return `${x},${y}`;
                })
                .join(" ")}
            />
          </svg>
        </Card>
      )}

      <Card interactive={false} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Video Performans Tablosu ({videos.length})</CardTitle>
          <Button type="button" variant="secondary" onClick={handleAiSuggest} disabled={busy !== null}>
            {busy === "ai" ? "AI Analiz Ediyor..." : "AI Açıklama & Saat Öner"}
          </Button>
        </div>

        {ai && (
          <div className="rounded-md border border-border bg-surface-subtle p-3 text-xs flex flex-col gap-2">
            <p className="font-medium">AI Performans Özeti: {ai.performanceSummary}</p>
            <p>En iyi paylaşım saatleri: {ai.bestPostingHours.join(", ")}</p>
            <p>Önerilen hashtag&apos;ler: {ai.hashtags.join(" ")}</p>
            <div className="flex flex-wrap gap-2">
              {ai.captions.map((c, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setCaption(`${c} ${ai.hashtags.slice(0, 4).join(" ")}`)}
                  className="rounded border border-border px-2 py-1 text-left hover:bg-surface"
                >
                  Kullan: {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {videos.length === 0 ? (
          <p className="text-sm text-fg-muted">Henüz senkronlanmış video yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-fg-muted">
                  <th className="py-2 pr-3">Video</th>
                  <th className="py-2 pr-3">İzlenme</th>
                  <th className="py-2 pr-3">Beğeni</th>
                  <th className="py-2 pr-3">Yorum</th>
                  <th className="py-2 pr-3">Paylaşım</th>
                  <th className="py-2 pr-3">Etkileşim</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((v) => (
                  <tr key={v.id} className="border-b border-border/50">
                    <td className="py-2 pr-3 max-w-[220px] truncate">
                      {v.shareUrl ? (
                        <a href={v.shareUrl} target="_blank" rel="noopener noreferrer" className="underline">
                          {v.title || v.videoDescription || v.id}
                        </a>
                      ) : (
                        v.title || v.videoDescription || v.id
                      )}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{v.viewCount.toLocaleString("tr-TR")}</td>
                    <td className="py-2 pr-3 tabular-nums">{v.likeCount.toLocaleString("tr-TR")}</td>
                    <td className="py-2 pr-3 tabular-nums">{v.commentCount.toLocaleString("tr-TR")}</td>
                    <td className="py-2 pr-3 tabular-nums">{v.shareCount.toLocaleString("tr-TR")}</td>
                    <td className="py-2 pr-3 tabular-nums">{(v.engagementRate * 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card interactive={false} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>TikTok&apos;a İçerik Yayınla (Content Posting API)</CardTitle>
          <Button type="button" variant="secondary" onClick={handleLoadPreflight} disabled={busy !== null}>
            {busy === "preflight" ? "Yükleniyor..." : "Yayın Ayarlarını Getir"}
          </Button>
        </div>

        {preflight && (
          <form onSubmit={handlePublish} className="flex flex-col gap-3 text-sm">
            {!preflight.audited && (
              <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                Uygulama henüz TikTok denetiminden geçmediği için direkt yayınlar yalnızca <strong>SELF_ONLY</strong> (gizli) olarak gönderilebilir ve ücretli ortaklık içerikleri yayınlanamaz.
              </p>
            )}
            <p className="text-xs text-fg-muted">
              Creator: <strong>{preflight.creatorNickname}</strong> · Maks. video süresi: {preflight.maxVideoPostDurationSec} sn
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs">
                <span>Yayın Modu</span>
                <select value={mode} onChange={(e) => setMode(e.target.value as "DIRECT" | "INBOX")} className="rounded border border-border bg-surface px-2 py-1.5">
                  <option value="DIRECT">Direkt Yayın (video.publish)</option>
                  <option value="INBOX">Taslak / Inbox (video.upload)</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs">
                <span>Kaynak</span>
                <select value={source} onChange={(e) => setSource(e.target.value as "PULL_FROM_URL" | "FILE_UPLOAD")} className="rounded border border-border bg-surface px-2 py-1.5">
                  <option value="PULL_FROM_URL">URL&apos;den Çek (PULL_FROM_URL)</option>
                  <option value="FILE_UPLOAD">Dosya Yükle (FILE_UPLOAD)</option>
                </select>
              </label>
            </div>

            {source === "PULL_FROM_URL" ? (
              <label className="flex flex-col gap-1 text-xs">
                <span>Video URL (doğrulanmış domain)</span>
                <input
                  type="url"
                  required
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://nordvow.com/media/video.mp4"
                  className="rounded border border-border bg-surface px-2 py-1.5"
                />
              </label>
            ) : (
              <label className="flex flex-col gap-1 text-xs">
                <span>Video Dosyası (MP4/WebM)</span>
                <input type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            )}

            <label className="flex flex-col gap-1 text-xs">
              <span>Açıklama / Başlık</span>
              <textarea
                rows={2}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                className="rounded border border-border bg-surface px-2 py-1.5"
              />
            </label>

            {mode === "DIRECT" && (
              <label className="flex flex-col gap-1 text-xs">
                <span>Gizlilik Seviyesi (Zorunlu Seçim)</span>
                <select
                  required
                  value={privacyLevel}
                  onChange={(e) => setPrivacyLevel(e.target.value)}
                  className="rounded border border-border bg-surface px-2 py-1.5"
                >
                  <option value="">-- Gizlilik seçiniz --</option>
                  {preflight.privacyLevelOptions.map((opt) => (
                    <option key={opt} value={opt} disabled={!preflight.audited && opt !== "SELF_ONLY"}>
                      {PRIVACY_LABELS[opt] ?? opt}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="flex flex-wrap gap-4 text-xs">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={disableComment} disabled={preflight.commentDisabled} onChange={(e) => setDisableComment(e.target.checked)} />
                Yorumları kapat
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={disableDuet} disabled={preflight.duetDisabled} onChange={(e) => setDisableDuet(e.target.checked)} />
                Duet kapat
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={disableStitch} disabled={preflight.stitchDisabled} onChange={(e) => setDisableStitch(e.target.checked)} />
                Stitch kapat
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={brandContentToggle} onChange={(e) => setBrandContentToggle(e.target.checked)} />
                Ücretli ortaklık / Reklam (brand_content_toggle)
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={brandOrganicToggle} onChange={(e) => setBrandOrganicToggle(e.target.checked)} />
                Kendi markam (brand_organic_toggle)
              </label>
            </div>

            <div className="rounded border border-border p-3 text-xs flex flex-col gap-2">
              <p className="font-medium">Yayın Önizleme ve Açık Onay</p>
              <p className="text-fg-muted">
                Mod: {mode} · Gizlilik: {mode === "INBOX" ? "Taslak (Inbox)" : privacyLevel || "Seçilmedi"} · Açıklama: {caption || "(Boş)"}
              </p>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={userConfirmed} onChange={(e) => setUserConfirmed(e.target.checked)} />
                <span>İçeriği inceledim ve seçilen ayarlarla TikTok hesabıma gönderilmesini onaylıyorum.</span>
              </label>
            </div>

            <Button type="submit" variant="primary" disabled={busy !== null || !userConfirmed} className="w-fit">
              {busy === "publish" ? "Gönderiliyor..." : mode === "INBOX" ? "TikTok Inbox'a Gönder" : "TikTok'ta Yayınla"}
            </Button>
          </form>
        )}

        {posts.length > 0 && (
          <div className="mt-2 flex flex-col gap-1 text-xs">
            <p className="font-medium">Son Yayınlar</p>
            {posts.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/60 px-2 py-1.5">
                <span className="truncate max-w-[260px]">{p.caption || p.publishId}</span>
                <span>
                  {p.mode} · {p.privacyLevel} · <strong>{p.status}</strong>
                  {p.failReason ? ` (${p.failReason})` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
