import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createVoiceAssistantApp, type VoiceAssistantApp } from '../src/app.ts';

describe('Voice Assistant Service', () => {
  let tmpDir: string;
  let app: VoiceAssistantApp;
  let baseUrl: string;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-assistant-test-'));
    const kbDir = path.join(tmpDir, 'knowledge');
    fs.mkdirSync(kbDir, { recursive: true });
    fs.writeFileSync(
      path.join(kbDir, 'sss.md'),
      `# SSS\n\n## Çalışma Saatleri\nSoru: Saat kaça kadar açıksınız?\nCevap: Hafta içi ve Cumartesi 09:00 ile 20:00 arasında açığız.`,
      'utf-8'
    );

    app = createVoiceAssistantApp(tmpDir);
    await new Promise<void>((resolve) => {
      app.server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Test sunucu adresi alınamadı');
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sağlık kontrolü ve varsayılan ayarları döner', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; costProfile: string };
    assert.equal(body.status, 'ok');
    assert.equal(body.costProfile, 'balanced');
  });

  it('çalışma anında özellik anahtarlarını ve maliyet profilini günceller', async () => {
    const patchRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        costProfile: 'eco',
        features: { bargeInEnabled: false },
        conversation: { maxResponseSentences: 1 },
      }),
    });
    assert.equal(patchRes.status, 200);
    const updated = (await patchRes.json()) as {
      costProfile: string;
      features: { bargeInEnabled: boolean };
      conversation: { maxResponseSentences: number };
      voice: { provider: string };
    };
    assert.equal(updated.costProfile, 'eco');
    assert.equal(updated.features.bargeInEnabled, false);
    assert.equal(updated.conversation.maxResponseSentences, 1);
    assert.equal(updated.voice.provider, 'polly');

    // Testlerin geri kalanı için balanced moda geri al
    await fetch(`${baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        costProfile: 'balanced',
        features: { bargeInEnabled: true },
        conversation: { maxResponseSentences: 2 },
      }),
    });
  });

  it('yeni belge yükler ve Türkçe soru-cevap aramasını çalıştırır', async () => {
    const uploadRes = await fetch(`${baseUrl}/api/knowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'otopark.md',
        content:
          '# Otopark\nSoru: Otoparkınız var mı?\nCevap: Evet, misafirlerimiz için ücretsiz vale ve kapalı otoparkımız vardır.',
      }),
    });
    assert.equal(uploadRes.status, 201);

    const chatRes = await fetch(`${baseUrl}/api/simulate/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Aracımla geleceğim, otoparkınız var mı?',
      }),
    });
    assert.equal(chatRes.status, 200);
    const chatBody = (await chatRes.json()) as { reply: string };
    assert.match(chatBody.reply.toLowerCase(), /otopark/);
  });

  it('rezervasyon oluşturur ve görevli notu kaydeder', async () => {
    const rezRes = await fetch(`${baseUrl}/api/simulate/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Yarın akşam 19:30 için 2 kişilik rezervasyon yapmak istiyorum.',
        callerPhone: '+905321112233',
      }),
    });
    assert.equal(rezRes.status, 200);
    const rezBody = (await rezRes.json()) as { reply: string };
    assert.match(rezBody.reply, /Onay kodunuz/i);

    const listRez = await fetch(`${baseUrl}/api/reservations`);
    const reservations = (await listRez.json()) as {
      reservations: Array<{ time: string; phone: string }>;
    };
    assert.equal(reservations.reservations.length, 1);
    assert.equal(reservations.reservations[0].time, '19:30');
    assert.equal(reservations.reservations[0].phone, '+905321112233');

    const noteRes = await fetch(`${baseUrl}/api/simulate/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Fatura ile ilgili müdürünüz beni geri arasın lütfen not alın.',
        callerPhone: '+905321112233',
      }),
    });
    assert.equal(noteRes.status, 200);

    const listNotes = await fetch(`${baseUrl}/api/notes`);
    const notes = (await listNotes.json()) as {
      notes: Array<{ category: string; summary: string }>;
    };
    assert.equal(notes.notes.length, 1);
    assert.equal(notes.notes[0].category, 'callback');
  });

  it('aylık maliyet metriklerini raporlar', async () => {
    const res = await fetch(`${baseUrl}/api/metrics/costs`);
    assert.equal(res.status, 200);
    const report = (await res.json()) as {
      totalCalls: number;
      totalLlmTokens: number;
      budgetUsd: number;
    };
    assert.ok(report.totalCalls >= 3);
    assert.ok(report.totalLlmTokens > 0);
    assert.equal(report.budgetUsd, 50);
  });

  it('admin panelini sunar, yönlendirme numarasını kaydeder ve çağrı kayıtlarını tutar', async () => {
    const adminRes = await fetch(`${baseUrl}/admin`);
    assert.equal(adminRes.status, 200);
    const html = await adminRes.text();
    assert.match(html, /Sesli Asistan Admin Paneli/);

    const patchRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telephony: {
          personalMobileNumber: '05348987073',
          virtualForwardingNumber: '08501234567',
        },
      }),
    });
    assert.equal(patchRes.status, 200);
    const updated = (await patchRes.json()) as {
      telephony: { virtualForwardingNumber: string };
    };
    assert.equal(updated.telephony.virtualForwardingNumber, '08501234567');

    const callsRes = await fetch(`${baseUrl}/api/calls`);
    assert.equal(callsRes.status, 200);
    const callsData = (await callsRes.json()) as {
      calls: Array<{ transcript: Array<{ speaker: string; text: string }> }>;
    };
    assert.ok(callsData.calls.length >= 3);
    assert.ok(callsData.calls[0].transcript.length >= 2);
  });
});

