"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { ciplerFor } from "@/lib/iletisim/etiketler";
import { KurulumListesiniAcButonu } from "./kurulum-listesi";

type CannedResponse = { id: string; shortcut: string; title: string; body: string };
type LabelItem = { id: string; name: string; color: string };
type InboxSettings = {
  aiSuggestionsEnabled: boolean;
  autoReopenResolved?: boolean;
  kvkkRetentionMonths?: number;
  cannedResponses: CannedResponse[];
  labels: LabelItem[];
};

const EMPTY_SETTINGS: InboxSettings = {
  aiSuggestionsEnabled: true,
  autoReopenResolved: true,
  kvkkRetentionMonths: 24,
  cannedResponses: [],
  labels: [],
};

export function IletisimAyarlarClient({
  tenantId,
  section,
}: {
  tenantId: string;
  section: "kisayollar" | "etiketler" | "gizlilik";
}) {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<InboxSettings>(EMPTY_SETTINGS);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [shortcut, setShortcut] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [labelName, setLabelName] = useState("");
  const [labelColor, setLabelColor] = useState("#6366f1");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/inbox/settings?tenantId=${encodeURIComponent(tenantId)}`);
      if (res.ok) {
        const data = (await res.json()) as { settings?: Partial<InboxSettings> };
        setSettings({ ...EMPTY_SETTINGS, ...(data.settings ?? {}) });
      }
    } catch {
      setErr("Ayarlar yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = (ok: string) => {
    setErr(null);
    setMsg(ok);
    setTimeout(() => setMsg(null), 2500);
  };

  const putSettings = async (patch: Partial<InboxSettings>, okMsg: string) => {
    const res = await fetch(`/api/inbox/settings?tenantId=${encodeURIComponent(tenantId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const d = (await res.json().catch(() => ({}))) as { settings?: Partial<InboxSettings>; error?: string };
    if (res.ok && d.settings) {
      setSettings({ ...EMPTY_SETTINGS, ...d.settings });
      flash(okMsg);
    } else {
      setErr(d.error ?? "Kaydedilemedi.");
    }
  };

  const addShortcut = async () => {
    if (!shortcut.trim() || !body.trim()) return;
    const cleanCode = shortcut.trim().replace(/^\//, "").toLowerCase();
    const nextList: CannedResponse[] = [
      ...settings.cannedResponses,
      { id: `cr_${Date.now()}`, shortcut: cleanCode, title: title.trim() || cleanCode, body: body.trim() },
    ];
    setShortcut("");
    setTitle("");
    setBody("");
    await putSettings({ cannedResponses: nextList }, "Kısayol yanıt kaydedildi.");
  };

  const deleteShortcut = async (item: CannedResponse) => {
    if (!window.confirm(`“/${item.shortcut}” silinsin mi? Bu işlem geri alınamaz.`)) return;
    const nextList = settings.cannedResponses.filter((x) => x.id !== item.id);
    await putSettings({ cannedResponses: nextList }, "Kısayol yanıt silindi.");
  };

  const addLabel = async () => {
    if (!labelName.trim()) return;
    const nextLabels: LabelItem[] = [
      ...settings.labels,
      { id: `lbl_${Date.now()}`, name: labelName.trim().toLowerCase(), color: labelColor },
    ];
    setLabelName("");
    await putSettings({ labels: nextLabels }, "Etiket eklendi.");
  };

  const deleteLabel = async (item: LabelItem) => {
    if (!window.confirm(`“${item.name}” silinsin mi? Bu işlem geri alınamaz.`)) return;
    const nextLabels = settings.labels.filter((x) => x.id !== item.id);
    await putSettings({ labels: nextLabels }, "Etiket silindi.");
  };

  if (loading) {
    return <p className="text-sm text-fg-muted">Yükleniyor…</p>;
  }

  const chips = ciplerFor("kisayol");

  return (
    <div className="flex flex-col gap-5">
      {msg ? <p className="text-xs font-medium text-emerald-400">{msg}</p> : null}
      {err ? <p role="alert" className="text-xs font-medium text-red-400">{err}</p> : null}

      {section === "kisayollar" ? (
        <Card interactive={false} className="flex flex-col gap-4">
          <div>
            <CardTitle>Kısayol yanıtlar</CardTitle>
            <p className="mt-1 text-xs text-fg-muted">
              Gelen Kutusu&apos;nda <code>/</code> yazarak temsilcilerin tek tıkla kullanabileceği hazır yanıt şablonları.
              (Otomatik gönderilmez; temsilci seçip gönderir.)
            </p>
          </div>

          <ul className="flex flex-col gap-2">
            {settings.cannedResponses.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-bg/50 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <code className="rounded bg-surface px-1.5 py-0.5 font-semibold text-fg">/{item.shortcut}</code>
                    <span className="font-medium text-fg">{item.title}</span>
                  </div>
                  <p className="mt-1 text-xs text-fg-muted">{item.body}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void deleteShortcut(item)}
                  className="shrink-0 text-xs text-critical hover:underline"
                >
                  Sil
                </button>
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-2.5 rounded-xl border border-dashed border-line p-4">
            <span className="text-xs font-semibold text-fg">Yeni kısayol yanıt</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="text"
                placeholder="Kısakod (ör. merhaba)"
                value={shortcut}
                onChange={(e) => setShortcut(e.target.value)}
                className="h-9 rounded-xl border border-line bg-bg px-3 text-xs text-fg"
              />
              <input
                type="text"
                placeholder="Başlık (ör. Karşılama)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-9 rounded-xl border border-line bg-bg px-3 text-xs text-fg"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-fg-muted">Değişken ekle:</span>
              {chips.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setBody((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}${c.token}`)}
                  className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-[11px] text-fg hover:border-fg"
                >
                  + [{c.label}]
                </button>
              ))}
            </div>
            <textarea
              rows={2}
              placeholder="Yanıt metni..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="rounded-xl border border-line bg-bg p-3 text-xs text-fg"
            />
            <button
              type="button"
              onClick={() => void addShortcut()}
              disabled={!shortcut.trim() || !body.trim()}
              className="w-fit rounded-full bg-fg px-4 py-1.5 text-xs font-semibold text-bg disabled:opacity-50"
            >
              Kaydet
            </button>
          </div>
        </Card>
      ) : null}

      {section === "etiketler" ? (
        <Card interactive={false} className="flex flex-col gap-4">
          <div>
            <CardTitle>Etiketler</CardTitle>
            <p className="mt-1 text-xs text-fg-muted">Konuşmaları kategorize etmek ve filtrelemek için etiketler.</p>
          </div>
          <ul className="flex flex-wrap gap-2">
            {settings.labels.map((lbl) => (
              <li
                key={lbl.id}
                className="inline-flex items-center gap-2 rounded-full border border-line bg-bg px-3 py-1 text-xs text-fg"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: lbl.color }} />
                <span>#{lbl.name}</span>
                <button
                  type="button"
                  onClick={() => void deleteLabel(lbl)}
                  className="text-critical hover:underline"
                  aria-label={`${lbl.name} sil`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Yeni etiket adı (ör. vip-creator)"
              value={labelName}
              onChange={(e) => setLabelName(e.target.value)}
              className="h-9 rounded-xl border border-line bg-bg px-3 text-xs text-fg"
            />
            <input
              type="color"
              value={labelColor}
              onChange={(e) => setLabelColor(e.target.value)}
              aria-label="Etiket rengi"
              className="h-9 w-10 rounded-lg border border-line bg-bg p-1"
            />
            <button
              type="button"
              onClick={() => void addLabel()}
              disabled={!labelName.trim()}
              className="rounded-full bg-fg px-4 py-1.5 text-xs font-semibold text-bg disabled:opacity-50"
            >
              Etiket Ekle
            </button>
          </div>
        </Card>
      ) : null}

      {section === "gizlilik" ? (
        <Card interactive={false} className="flex flex-col gap-5">
          <div>
            <CardTitle>Gizlilik &amp; KVKK</CardTitle>
            <p className="mt-1 text-xs text-fg-muted">
              Mesaj saklama süresi, AI yanıt önerileri ve konuşma yeniden açma tercihleri.
            </p>
          </div>

          <label className="flex items-center justify-between gap-4 rounded-xl border border-line bg-bg/50 p-3.5 text-xs">
            <span>
              <strong className="block text-fg">AI yanıt önerileri (gönderim her zaman sizde)</strong>
              <span className="text-fg-muted">Temsilciler için taslak yanıt önerir; onaylanmadan mesaj gitmez.</span>
            </span>
            <input
              type="checkbox"
              checked={settings.aiSuggestionsEnabled}
              onChange={(e) => void putSettings({ aiSuggestionsEnabled: e.target.checked }, "Ayar kaydedildi.")}
              className="h-4 w-4 accent-[var(--color-fg)]"
            />
          </label>

          <label className="flex items-center justify-between gap-4 rounded-xl border border-line bg-bg/50 p-3.5 text-xs">
            <span>
              <strong className="block text-fg">Çözülen konuşmaya yeni mesaj gelirse yeniden aç</strong>
              <span className="text-fg-muted">Müşteri tekrar yazdığında konuşma otomatik Açık durumuna döner.</span>
            </span>
            <input
              type="checkbox"
              checked={settings.autoReopenResolved ?? true}
              onChange={(e) => void putSettings({ autoReopenResolved: e.target.checked }, "Ayar kaydedildi.")}
              className="h-4 w-4 accent-[var(--color-fg)]"
            />
          </label>

          <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-bg/50 p-3.5 text-xs">
            <div>
              <strong className="block text-fg">KVKK saklama süresi (ay)</strong>
              <span className="text-fg-muted">Süresi dolan mesaj kayıtları otomatik temizlenir.</span>
            </div>
            <input
              type="number"
              min={1}
              max={120}
              value={settings.kvkkRetentionMonths ?? 24}
              onChange={(e) =>
                void putSettings({ kvkkRetentionMonths: Number(e.target.value) || 24 }, "Saklama süresi güncellendi.")
              }
              className="h-9 w-24 rounded-xl border border-line bg-bg px-3 text-xs text-fg"
            />
          </div>

          <div className="border-t border-line pt-4">
            <KurulumListesiniAcButonu />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
