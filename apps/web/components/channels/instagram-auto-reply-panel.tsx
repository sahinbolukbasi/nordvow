"use client";

import { useState, useTransition } from "react";
import type { InstagramAutoReplyRule, InstagramMatchMode } from "@infulancer/core/messaging/instagram-auto-reply";
import { saveIgAutoReplyRulesAction, testIgAutoReplyAction } from "@/lib/actions/ig-auto-reply";
import { Card, CardTitle } from "@/components/ui/card";

export function InstagramAutoReplyPanel({
  tenantId,
  initialRules,
}: {
  tenantId: string;
  initialRules: InstagramAutoReplyRule[];
}) {
  const [rules, setRules] = useState<InstagramAutoReplyRule[]>(initialRules);
  const [newTitle, setNewTitle] = useState("");
  const [newKeywords, setNewKeywords] = useState("");
  const [newReply, setNewReply] = useState("");
  const [newMode, setNewMode] = useState<InstagramMatchMode>("contains");
  const [testInput, setTestInput] = useState("");
  const [testResult, setTestResult] = useState<{ title: string | null; reply: string | null } | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const persist = (nextRules: InstagramAutoReplyRule[], msg: string) => {
    setRules(nextRules);
    start(async () => {
      const res = await saveIgAutoReplyRulesAction(tenantId, nextRules);
      if (res.ok && res.rules) {
        setRules(res.rules);
        setStatusMsg(msg);
        setTimeout(() => setStatusMsg(null), 2500);
      }
    });
  };

  const handleAdd = () => {
    if (!newReply.trim()) return;
    const rule: InstagramAutoReplyRule = {
      id: `ig-${Date.now()}`,
      title: newTitle.trim() || "Hazır Cevap",
      keywords: newKeywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
      reply: newReply.trim(),
      enabled: true,
      matchMode: newMode,
    };
    setNewTitle("");
    setNewKeywords("");
    setNewReply("");
    persist([rule, ...rules], "Yeni hazır cevap kaydedildi.");
  };

  const handleTest = () => {
    if (!testInput.trim()) return;
    start(async () => {
      const res = await testIgAutoReplyAction(tenantId, testInput);
      setTestResult({ title: res.matchedTitle, reply: res.reply });
    });
  };

  return (
    <Card interactive={false} className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Anahtar kelime cevabı</CardTitle>
          <p className="mt-1 text-[13px] text-fg-muted">
            Instagram DM&apos;den yazan kişilere anahtar kelimeye göre anında otomatik cevap gönderir. Türkçe karakter ve büyük-küçük harf fark etmez (ör. &quot;ücret&quot; = &quot;ucret&quot;).
          </p>
        </div>
        {statusMsg ? <span className="text-xs font-medium text-emerald-500">{statusMsg}</span> : null}
      </div>

      {/* Mevcut Kurallar */}
      <ul className="flex flex-col gap-3">
        {rules.map((r, idx) => (
          <li key={r.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-bg/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={() => {
                    const next = rules.map((x, i) => (i === idx ? { ...x, enabled: !x.enabled } : x));
                    persist(next, "Kural durumu güncellendi.");
                  }}
                  aria-label={`${r.title} aktif`}
                />
                <span className="text-sm font-semibold text-fg">{r.title}</span>
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-fg-muted">
                  {r.matchMode === "always" ? "Her mesaja (varsayılan)" : r.matchMode === "exact" ? "Tam eşleşme" : "İçeriyorsa"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`“${r.title}” silinsin mi? Bu işlem geri alınamaz.`)) return;
                  persist(rules.filter((_, i) => i !== idx), "Kural silindi.");
                }}
                className="text-xs text-critical hover:underline"
              >
                Sil
              </button>
            </div>
            {r.keywords.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {r.keywords.map((kw) => (
                  <span key={kw} className="rounded-full bg-surface px-2.5 py-0.5 text-[11px] text-fg-muted">
                    {kw}
                  </span>
                ))}
              </div>
            ) : null}
            <p className="text-xs leading-relaxed text-fg">{r.reply}</p>
          </li>
        ))}
      </ul>

      {/* Yeni Hazır Cevap Ekle */}
      <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-border p-4">
        <span className="text-xs font-semibold text-fg">Yeni Hazır Cevap Ekle</span>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            type="text"
            placeholder="Başlık (ör. Kargo & Teslimat)"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
          />
          <select
            value={newMode}
            onChange={(e) => setNewMode(e.target.value as InstagramMatchMode)}
            className="rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
          >
            <option value="contains">Anahtar kelime geçiyorsa yanıtla</option>
            <option value="exact">Birebir aynıysa yanıtla</option>
            <option value="always">Eşleşen yoksa varsayılan yanıt</option>
          </select>
        </div>
        <input
          type="text"
          placeholder="Anahtar kelimeler (virgülle ayırın: fiyat, teklif, kargo)"
          value={newKeywords}
          onChange={(e) => setNewKeywords(e.target.value)}
          className="rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
        />
        <textarea
          rows={2}
          placeholder="Otomatik gönderilecek hazır cevap metni..."
          value={newReply}
          onChange={(e) => setNewReply(e.target.value)}
          className="rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg"
        />
        <button
          type="button"
          disabled={pending || !newReply.trim()}
          onClick={handleAdd}
          className="w-fit rounded-full bg-fg px-4 py-1.5 text-xs font-semibold text-bg disabled:opacity-50"
        >
          Hazır Cevabı Kaydet
        </button>
      </div>

      {/* Hızlı Test */}
      <div className="flex flex-col gap-2 rounded-2xl border border-border bg-bg/40 p-4">
        <span className="text-xs font-semibold text-fg">Gelen Mesajı Test Et</span>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Örn: Merhaba, iş birliği fiyatı alabilir miyim?"
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleTest();
            }}
            className="flex-1 rounded-xl border border-border bg-bg px-3 py-1.5 text-sm text-fg"
          />
          <button
            type="button"
            disabled={pending || !testInput.trim()}
            onClick={handleTest}
            className="rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-medium text-fg hover:border-fg/40"
          >
            Test Et
          </button>
        </div>
        {testResult ? (
          <div className="mt-1 rounded-xl border border-border bg-surface p-3 text-xs">
            {testResult.reply ? (
              <>
                <span className="font-semibold text-emerald-500">Eşleşen Kural: {testResult.title}</span>
                <p className="mt-1 text-fg">{testResult.reply}</p>
              </>
            ) : (
              <span className="text-fg-muted">Eşleşen aktif kural bulunamadı.</span>
            )}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

