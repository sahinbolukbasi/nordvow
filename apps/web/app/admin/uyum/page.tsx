import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@infulancer/core/db";
import { iysPenaltyBands } from "@infulancer/core/compliance/iys";
import { TRANSFER_TARGETS } from "@infulancer/core/compliance/kvkk";
import { Card, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input, Select, Button } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/layout";
import { StatusDot } from "@/components/ui/status";
import { requireActor } from "@/lib/auth-guard";
import { DocLink } from "@/components/docs/doc-components";
import { StatusCards } from "@/components/ui/status-cards";
import { RunJobButton } from "@/components/forms/operations-forms";
import { cn } from "@/lib/cn";
import { fmtDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Uyum" };
export const dynamic = "force-dynamic";

const SECTIONS = [
  { id: "hepsi", label: "Tümü" },
  { id: "iys", label: "İYS Kuyruğu & Onaylar" },
  { id: "kvkk", label: "KVKK Bildirimleri" },
  { id: "md23a", label: "md. 23/A İçerik Kontrolü" },
  { id: "bayraklar", label: "Politika Bayrakları" },
] as const;

export default async function AdminCompliancePage({ searchParams }: { searchParams: Promise<{ bolum?: string; marka?: string; q?: string }> }) {
  const tt = await getTT();
  await requireActor("ADMIN");
  const sp = await searchParams;
  const bolum = SECTIONS.find((s) => s.id === sp.bolum)?.id ?? "hepsi";
  const brandFilter = sp.marka || "";
  const q = (sp.q ?? "").trim().toLocaleLowerCase("tr");
  const now = new Date();

  const [pending, consents, filings, settings, flags, brands, checks] = await Promise.all([
    prisma.consentEvent.findMany({ where: { processedAt: null }, include: { consent: true }, orderBy: { dueAt: "asc" }, take: 200 }),
    prisma.consent.groupBy({ by: ["tenantId", "state"], _count: true }),
    prisma.crossBorderFiling.findMany(),
    prisma.tenantSettings.findMany(),
    prisma.tenantPolicyFlag.findMany(),
    prisma.brand.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.disclosureCheck.findMany({ where: { compliant: false }, orderBy: { checkedAt: "desc" }, take: 100 }),
  ]);

  const name = new Map(brands.map((b) => [b.id, b.name]));
  const matchBrand = (tenantId: string) => (!brandFilter || tenantId === brandFilter) && (!q || (name.get(tenantId) ?? "").toLocaleLowerCase("tr").includes(q));
  const kvkkMissing = settings.filter((st) => !TRANSFER_TARGETS.every((t) => filings.some((f) => f.tenantId === st.tenantId && f.transferTarget === t.key && f.receiptS3Key))).length;
  const kvkkOk = settings.length > 0 && kvkkMissing === 0;

  const filteredPending = pending.filter((e) => matchBrand(e.consent.tenantId) && (!q || e.consent.recipient.toLocaleLowerCase("tr").includes(q) || (name.get(e.consent.tenantId) ?? "").toLocaleLowerCase("tr").includes(q)));
  const filteredSettings = settings.filter((s) => matchBrand(s.tenantId));
  const filteredFlags = flags.filter((f) => matchBrand(f.tenantId) && (!q || (f.detail ?? f.flag).toLocaleLowerCase("tr").includes(q) || (name.get(f.tenantId) ?? "").toLocaleLowerCase("tr").includes(q)));
  const filteredChecks = checks.filter((c) => !q || c.issues.join(" ").toLocaleLowerCase("tr").includes(q) || c.deliverableId.toLocaleLowerCase("tr").includes(q));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tt("Uyum ve Denetim Takibi")}
        description={tt("İYS, KVKK, md. 23/A reklam etiketi ve politika bayraklarını tek tabloda filtreleyerek takip edin.")}
        actions={
          <div className="flex flex-wrap gap-2">
            <RunJobButton job="iys-register" label={tt("İYS kuyruğunu şimdi gönder")} />
            <RunJobButton job="iys-sla" label={tt("Süre kontrolü")} />
          </div>
        }
      />

      <StatusCards
        items={[
          { title: "İYS kuyruğu", state: pending.length === 0 ? "ok" : pending.some((e) => e.dueAt < now) ? "bad" : "warn", value: `${pending.length} bekliyor`, text: "3 iş günü içinde İYS'ye iletilmeli.", href: "/admin/uyum?bolum=iys", action: "Filtrele" },
          { title: "KVKK makbuzları", state: kvkkOk ? "ok" : "warn", value: kvkkOk ? "Tamam" : `${kvkkMissing} marka eksik`, text: "Makbuzsuz marka canlıya geçemez.", href: "/admin/uyum?bolum=kvkk", action: "Filtrele" },
          { title: "Reklam etiketi (23/A)", state: checks.length === 0 ? "ok" : "bad", value: `${checks.length} uyumsuz`, text: "Etiketsiz içerikle kampanya yayına alınmaz.", href: "/admin/uyum?bolum=md23a", action: "Filtrele" },
          { title: "Politika bayrakları", state: flags.some((f) => f.blocking) ? "bad" : "ok", value: `${flags.filter((f) => f.blocking).length} engelleyici`, text: "Yasaklı dikey beyanı gönderimi durdurur.", href: "/admin/uyum?bolum=bayraklar", action: "Filtrele" },
        ]}
      />

      {/* Filtre & Bölüm Seçici */}
      <Card interactive={false} className="flex flex-col gap-4">
        <nav aria-label={tt("Uyum bölümleri")} className="flex flex-wrap gap-2 border-b border-border pb-3">
          {SECTIONS.map((s) => (
            <Link
              key={s.id}
              href={`/admin/uyum?bolum=${s.id}${brandFilter ? `&marka=${brandFilter}` : ""}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`}
              className={cn(
                "rounded-full border px-3 py-1 text-[13px] transition-standard",
                bolum === s.id ? "border-fg bg-fg text-bg font-medium" : "border-border text-fg-muted hover:text-fg",
              )}
            >
              {s.label}
            </Link>
          ))}
        </nav>

        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_240px_auto]">
          <input type="hidden" name="bolum" value={bolum} />
          <Input name="q" defaultValue={sp.q ?? ""} placeholder={tt("Marka, alıcı, sorun veya bayrak ara…")} />
          <Select name="marka" defaultValue={brandFilter}>
            <option value="">{tt("Tüm markalar")}</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">{tt("Filtrele")}</Button>
        </form>
      </Card>

      {bolum === "hepsi" || bolum === "iys" ? (
        <div className="flex flex-col gap-4">
          <DataTable
            caption={tt("İYS Kuyruğu (3 iş günü SLA)")}
            emptyText={tt("Bekleyen İYS kaydı yok.")}
            columns={[
              { key: "brand", header: "Marka", sortable: true },
              { key: "recipient", header: "Alıcı", sortable: true },
              { key: "state", header: "Onay Durumu", sortable: true },
              { key: "due", header: "Son Tarih", sortable: true },
              { key: "err", header: "Not / Hata" },
            ]}
            rows={filteredPending.map((e) => ({
              id: e.id,
              cells: {
                brand: name.get(e.consent.tenantId) ?? e.consent.tenantId,
                recipient: e.consent.recipient,
                state: e.consent.state,
                due: { sort: e.dueAt.getTime(), display: <StatusDot tone={e.dueAt <= now ? "critical" : "muted"}>{fmtDateTime(e.dueAt)}</StatusDot> },
                err: e.lastError ? <span className="text-[12px] text-critical">{e.lastError}</span> : "—",
              },
            }))}
          />

          <DataTable
            caption={tt("Marka Bazında İYS Onay Özeti")}
            emptyText={tt("Onay kaydı yok.")}
            columns={[
              { key: "brand", header: "Marka", sortable: true },
              { key: "state", header: "Durum", sortable: true },
              { key: "count", header: "Kayıt Sayısı", sortable: true, align: "right" },
            ]}
            rows={consents
              .filter((c) => matchBrand(c.tenantId))
              .map((c) => ({
                id: `${c.tenantId}-${c.state}`,
                cells: {
                  brand: name.get(c.tenantId) ?? c.tenantId,
                  state: c.state,
                  count: c._count,
                },
              }))}
          />
        </div>
      ) : null}

      {bolum === "hepsi" || bolum === "kvkk" ? (
        <DataTable
          caption={tt("KVKK Standart Sözleşme & Makbuz Durumu")}
          emptyText={tt("KVKK kaydı yok.")}
          columns={[
            { key: "brand", header: "Marka", sortable: true },
            { key: "mode", header: "Ortam", sortable: true },
            { key: "details", header: "Aktarım Hedefleri" },
            { key: "ready", header: "Durum" },
          ]}
          rows={filteredSettings.map((s) => {
            const fs = filings.filter((f) => f.tenantId === s.tenantId);
            const allOk = TRANSFER_TARGETS.every((t) => fs.some((f) => f.transferTarget === t.key && f.receiptS3Key));
            const bName = name.get(s.tenantId) ?? s.tenantId;
            return {
              id: s.tenantId,
              cells: {
                brand: { sort: bName, display: <Link href={`/admin/markalar/${s.tenantId}`} className="font-medium hover:underline">{bName}</Link> },
                mode: { sort: s.mode, display: <StatusDot tone={s.mode === "production" ? "active" : "muted"}>{s.mode === "production" ? tt("Canlı") : tt("Sandbox")}</StatusDot> },
                details: (
                  <div className="flex flex-col gap-0.5 text-[12px] text-fg-muted">
                    {TRANSFER_TARGETS.map((t) => {
                      const f = fs.find((x) => x.transferTarget === t.key);
                      return (
                        <span key={t.key}>
                          {t.label}: {f?.receiptS3Key ? "makbuz yüklendi" : f ? `bekleniyor (${fmtDateTime(f.dueAt)})` : "imzalanmadı"}
                        </span>
                      );
                    })}
                  </div>
                ),
                ready: <StatusDot tone={allOk ? "active" : "muted"}>{allOk ? tt("Tamam") : tt("Eksik")}</StatusDot>,
              },
            };
          })}
        />
      ) : null}

      {bolum === "hepsi" || bolum === "md23a" ? (
        <DataTable
          caption={tt("md. 23/A — Uyumsuz İçerikler")}
          emptyText={tt("Uyumsuz içerik yok.")}
          columns={[
            { key: "item", header: "İçerik", sortable: true },
            { key: "frame", header: "Kare", sortable: true },
            { key: "issues", header: "Sorunlar" },
            { key: "at", header: "Kontrol", sortable: true },
          ]}
          rows={filteredChecks.map((c) => ({
            id: c.id,
            cells: {
              item: { sort: c.deliverableId, display: <Link href={`/admin/teslimler/${c.deliverableId}`} className="font-medium underline-offset-4 hover:underline">İçerik {c.deliverableId.slice(-6)}</Link> },
              frame: `Kare ${c.frameIndex + 1}`,
              issues: c.issues.join(" · "),
              at: { sort: c.checkedAt.getTime(), display: fmtDateTime(c.checkedAt) },
            },
          }))}
        />
      ) : null}

      {bolum === "hepsi" || bolum === "bayraklar" ? (
        <DataTable
          caption={tt("Politika Bayrakları")}
          emptyText={tt("Politika bayrağı yok.")}
          columns={[
            { key: "brand", header: "Marka", sortable: true },
            { key: "detail", header: "Bayrak / Detay", sortable: true },
            { key: "status", header: "Etki" },
          ]}
          rows={filteredFlags.map((f) => ({
            id: f.id,
            cells: {
              brand: name.get(f.tenantId) ?? f.tenantId,
              detail: f.detail ?? f.flag,
              status: <StatusDot tone={f.blocking ? "critical" : "muted"}>{f.blocking ? tt("Gönderim engelli") : tt("Kısıtlı dikey")}</StatusDot>,
            },
          }))}
        />
      ) : null}

      <Card interactive={false} className="flex flex-col gap-3">
        <CardTitle>{tt("6563 md. 12 ceza bantları ve rehberler")}</CardTitle>
        <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {iysPenaltyBands.map((b) => (
            <li key={b.label} className="flex justify-between gap-3 border-b border-border py-2">
              <span>{b.label}</span>
              <span className="tabular-nums text-fg-muted">{b.range}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-4">
          <DocLink slug="iys-ticari-elektronik-ileti" />
          <DocLink slug="kvkk-yurtdisi-aktarim" />
          <DocLink slug="reklam-aciklamasi-23a" />
        </div>
      </Card>
    </div>
  );
}
