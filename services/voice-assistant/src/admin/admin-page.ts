/**
 * Sesli asistanın tüm ayarlarını, çağrı yönlendirme numarasını, belgelerini ve çağrı kayıtlarını
 * tek bir yerden yönetmek için gömülü Türkçe Admin Paneli HTML çıktısı üretir.
 */
export function renderAdminHtml(): string {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sesli Asistan Admin Paneli</title>
  <style>
    :root {
      --bg: #0f172a;
      --card: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --accent-hover: #0ea5e9;
      --success: #22c55e;
      --warn: #f59e0b;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    header {
      background: var(--card);
      border-bottom: 1px solid var(--border);
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    header h1 { margin: 0; font-size: 1.2rem; }
    .badge {
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 600;
      background: rgba(56, 189, 248, 0.15);
      color: var(--accent);
      border: 1px solid rgba(56, 189, 248, 0.35);
    }
    .tabs {
      display: flex;
      gap: 8px;
      padding: 14px 24px 0;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .tab-btn {
      background: transparent;
      border: none;
      color: var(--muted);
      padding: 10px 16px;
      cursor: pointer;
      font-size: 0.92rem;
      font-weight: 600;
      border-bottom: 2px solid transparent;
    }
    .tab-btn.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }
    main { max-width: 1120px; margin: 24px auto; padding: 0 20px 60px; }
    .panel { display: none; }
    .panel.active { display: block; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 18px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 18px;
    }
    .card h2 { margin: 0 0 12px; font-size: 1.05rem; color: var(--accent); }
    label { display: block; font-size: 0.85rem; color: var(--muted); margin: 10px 0 4px; }
    input[type="text"], input[type="number"], select, textarea {
      width: 100%;
      padding: 9px 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: #0f172a;
      color: var(--text);
      font-size: 0.92rem;
    }
    textarea { min-height: 90px; resize: vertical; }
    .toggle-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid rgba(51, 65, 85, 0.5);
    }
    .toggle-row:last-child { border-bottom: none; }
    .btn {
      background: var(--accent);
      color: #0f172a;
      border: none;
      padding: 10px 18px;
      border-radius: 8px;
      font-weight: 700;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .btn:hover { background: var(--accent-hover); }
    .btn-secondary {
      background: #334155;
      color: var(--text);
      border: none;
      padding: 7px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.82rem;
    }
    .code-box {
      background: #0f172a;
      border: 1px solid var(--border);
      padding: 10px 12px;
      border-radius: 8px;
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 0.88rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 8px;
      gap: 10px;
      word-break: break-all;
    }
    .alert-warn {
      background: rgba(245, 158, 11, 0.14);
      border: 1px solid rgba(245, 158, 11, 0.4);
      color: #fcd34d;
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 0.86rem;
      margin-top: 12px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
    th, td {
      text-align: left;
      padding: 10px 8px;
      border-bottom: 1px solid var(--border);
    }
    th { color: var(--muted); font-weight: 600; }
    .toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: var(--success);
      color: #052e16;
      padding: 10px 16px;
      border-radius: 8px;
      font-weight: 700;
      display: none;
      z-index: 50;
    }
    .chat-box {
      background: #0f172a;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      height: 280px;
      overflow-y: auto;
      margin-bottom: 12px;
    }
    .msg { margin-bottom: 10px; }
    .msg strong { color: var(--accent); }
    .msg.user strong { color: var(--success); }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Sesli Asistan Admin Paneli</h1>
      <small style="color: var(--muted);">Numara Yönlendirme, Özellikler, Maliyet & Çağrı Kayıtları</small>
    </div>
    <div style="display:flex; gap:10px; align-items:center;">
      <span class="badge" id="costBadge">Maliyet: $0.00</span>
      <span class="badge" id="profileBadge">Mod: balanced</span>
    </div>
  </header>

  <nav class="tabs">
    <button class="tab-btn active" data-tab="telephony">Numara & Yönlendirme</button>
    <button class="tab-btn" data-tab="settings">Asistan & Maliyet Ayarları</button>
    <button class="tab-btn" data-tab="calls">Çağrı Kayıtları</button>
    <button class="tab-btn" data-tab="records">Rezervasyon & Notlar</button>
    <button class="tab-btn" data-tab="knowledge">Belgeler (SSS)</button>
    <button class="tab-btn" data-tab="simulator">Canlı Test</button>
  </nav>

  <main>
    <!-- 1. NUMARA & YÖNLENDİRME -->
    <section id="tab-telephony" class="panel active">
      <div class="grid">
        <div class="card">
          <h2>Telefon Numarası & Yönlendirme Ayarları</h2>
          <label>Kendi Vodafone / Cep Numaranız</label>
          <input type="text" id="personalMobileNumber" placeholder="05348987073" />

          <label>Sanal / SIP Yönlendirme Numarası (0850 / 0212 / SIP)</label>
          <input type="text" id="virtualForwardingNumber" placeholder="Örn: 0850XXXXXXX" />

          <label>Canlı Görevli Aktarım Numarası (Farklı Bir Hat Önerilir)</label>
          <input type="text" id="transferPhoneNumber" placeholder="+90555XXXXXXX" />

          <label>Görevli Bildirim Webhook URL (Slack / CRM / n8n)</label>
          <input type="text" id="webhookUrl" placeholder="https://..." />

          <div id="loopWarning" class="alert-warn" style="display:none;">
            Uyarı: Canlı aktarım numarası ile kendi numaranız aynı görünüyor. Her zaman yönlendirme (*21*) açıkken aynı numaraya aktarım çağrı döngüsüne yol açabilir.
          </div>

          <div style="margin-top:16px;">
            <button class="btn" onclick="saveTelephony()">Numara Ayarlarını Kaydet</button>
          </div>
        </div>

        <div class="card">
          <h2>Vodafone Yönlendirme Kodları & Bağlantı Adresleri</h2>
          <p style="font-size:0.86rem; color:var(--muted); margin-top:0;">
            Sanal numaranızı kaydettikten sonra cep telefonunuzdan aşağıdaki kodu tuşlayarak aramaları asistana bağlayabilirsiniz:
          </p>

          <label>Tüm Aramaları Asistana Yönlendir</label>
          <div class="code-box"><span id="codeAll">*21*0850XXXXXXX#</span><button class="btn-secondary" onclick="copyText('codeAll')">Kopyala</button></div>

          <label>Sadece Cevapsız Kalınca Asistana Yönlendir</label>
          <div class="code-box"><span id="codeNoAnswer">*61*0850XXXXXXX#</span><button class="btn-secondary" onclick="copyText('codeNoAnswer')">Kopyala</button></div>

          <label>Yönlendirmeyi İptal Et</label>
          <div class="code-box"><span id="codeCancel">##002#</span><button class="btn-secondary" onclick="copyText('codeCancel')">Kopyala</button></div>

          <label>VoIP / SIP Gelen Çağrı Webhook Adresi</label>
          <div class="code-box"><span id="inboundWebhookUrl"></span><button class="btn-secondary" onclick="copyText('inboundWebhookUrl')">Kopyala</button></div>

          <label>Canlı Ses Akışı (WebSocket) Adresi</label>
          <div class="code-box"><span id="wsStreamUrl"></span><button class="btn-secondary" onclick="copyText('wsStreamUrl')">Kopyala</button></div>
        </div>
      </div>
    </section>

    <!-- 2. ASİSTAN & MALİYET AYARLARI -->
    <section id="tab-settings" class="panel">
      <div class="grid">
        <div class="card">
          <h2>Genel & Konuşma Ayarları</h2>
          <label>İşletme Adı</label>
          <input type="text" id="businessName" />

          <label>Karşılama Mesajı</label>
          <textarea id="greetingMessage"></textarea>

          <label>Maksimum Cevap Cümle Sayısı (Kısa & Doğal İçin 2 Önerilir)</label>
          <input type="number" id="maxResponseSentences" min="1" max="6" />

          <label>Maksimum Çağrı Süresi (Saniye - Maliyet Koruması)</label>
          <input type="number" id="maxCallDurationSeconds" min="30" max="1800" />
        </div>

        <div class="card">
          <h2>Maliyet Profili & Ses Kalitesi</h2>
          <label>Maliyet / Kalite Modu</label>
          <select id="costProfile">
            <option value="balanced">Balanced (Önerilen: ElevenLabs Flash v2.5 + Düşük Maliyet)</option>
            <option value="eco">Eco (En Düşük Maliyet: Kısa Cevap + Polly)</option>
            <option value="premium">Premium (En Yüksek Kalite: Multilingual v2)</option>
          </select>

          <label>Aylık Bütçe Limiti (USD)</label>
          <input type="number" id="maxMonthlyBudgetUsd" min="1" step="1" />

          <label>Ses Sağlayıcısı</label>
          <select id="voiceProvider">
            <option value="elevenlabs">ElevenLabs (En Gerçekçi Türkçe)</option>
            <option value="polly">Amazon Polly (Ekonomik)</option>
            <option value="mock">Mock (Ses Üretimsiz Test)</option>
          </select>

          <label>ElevenLabs Voice ID</label>
          <input type="text" id="voiceId" />
        </div>
      </div>

      <div class="card">
        <h2>Özellik Anahtarları (Aç / Kapat)</h2>
        <div class="toggle-row"><span>Belge / SSS Tabanlı Soru-Cevap</span><input type="checkbox" id="f_knowledgeBaseEnabled" /></div>
        <div class="toggle-row"><span>Rezervasyon Alma</span><input type="checkbox" id="f_reservationsEnabled" /></div>
        <div class="toggle-row"><span>Görevlilere Not & Talep Aktarma</span><input type="checkbox" id="f_staffNotesEnabled" /></div>
        <div class="toggle-row"><span>Canlı Görevliye Çağrı Aktarımı</span><input type="checkbox" id="f_callTransferEnabled" /></div>
        <div class="toggle-row"><span>Söz Kesme (Barge-in: Arayan Konuşunca Sus)</span><input type="checkbox" id="f_bargeInEnabled" /></div>
        <div class="toggle-row"><span>Otomatik Maliyet Koruma (Bütçe Sınırı)</span><input type="checkbox" id="f_costGuardEnabled" /></div>
        <div style="margin-top:16px;">
          <button class="btn" onclick="saveSettings()">Tüm Ayarları Kaydet</button>
        </div>
      </div>
    </section>

    <!-- 3. ÇAĞRI KAYITLARI -->
    <section id="tab-calls" class="panel">
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <h2 style="margin:0;">Çağrı Kayıtları</h2>
          <button class="btn-secondary" onclick="loadCalls()">Yenile</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Tarih</th>
              <th>Kanal</th>
              <th>Arayan</th>
              <th>Süre</th>
              <th>Durum</th>
              <th>Maliyet</th>
              <th>Döküm</th>
            </tr>
          </thead>
          <tbody id="callsTableBody"></tbody>
        </table>
      </div>
      <div class="card" id="callDetailCard" style="display:none;">
        <h2>Çağrı Konuşma Dökümü</h2>
        <div id="callTranscriptBox" class="chat-box" style="height:220px;"></div>
      </div>
    </section>

    <!-- 4. REZERVASYON & NOTLAR -->
    <section id="tab-records" class="panel">
      <div class="grid">
        <div class="card">
          <h2>Alınan Rezervasyonlar</h2>
          <table>
            <thead><tr><th>Kod</th><th>Müşteri</th><th>Tarih/Saat</th><th>Kişi</th></tr></thead>
            <tbody id="reservationsBody"></tbody>
          </table>
        </div>
        <div class="card">
          <h2>Görevlilere Aktarılan Notlar</h2>
          <table>
            <thead><tr><th>Arayan</th><th>Kategori</th><th>Özet</th></tr></thead>
            <tbody id="notesBody"></tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- 5. BELGELER -->
    <section id="tab-knowledge" class="panel">
      <div class="grid">
        <div class="card">
          <h2>Yeni Soru-Cevap / Belge Ekle</h2>
          <label>Dosya Adı (ör. fiyatlar.md)</label>
          <input type="text" id="docFilename" placeholder="fiyatlar.md" />
          <label>İçerik (Soru: ... / Cevap: ... formatı önerilir)</label>
          <textarea id="docContent" style="min-height:160px;" placeholder="# Hizmetler&#10;Soru: Fiyatlarınız nedir?&#10;Cevap: ..."></textarea>
          <div style="margin-top:12px;">
            <button class="btn" onclick="uploadDoc()">Belgeyi Kaydet</button>
          </div>
        </div>
        <div class="card">
          <h2>Yüklü Belgeler</h2>
          <ul id="docList" style="padding-left:18px;"></ul>
        </div>
      </div>
    </section>

    <!-- 6. CANLI TEST -->
    <section id="tab-simulator" class="panel">
      <div class="card">
        <h2>Asistan Simülatörü (Telefon Bağlamadan Test Edin)</h2>
        <div id="simChatBox" class="chat-box"></div>
        <div style="display:flex; gap:10px;">
          <input type="text" id="simInput" placeholder="Örn: Saat kaça kadar açıksınız? veya Yarın 19:00'a 2 kişilik rezervasyon..." onkeydown="if(event.key==='Enter') sendSim()" />
          <button class="btn" onclick="sendSim()">Gönder</button>
        </div>
      </div>
    </section>
  </main>

  <div class="toast" id="toast">Kaydedildi!</div>

  <script>
    let currentSettings = null;
    let simSessionId = null;

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        if (btn.dataset.tab === 'calls') loadCalls();
        if (btn.dataset.tab === 'records') loadRecords();
        if (btn.dataset.tab === 'knowledge') loadDocs();
      });
    });

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.style.display = 'block';
      setTimeout(() => t.style.display = 'none', 2200);
    }

    function copyText(id) {
      const val = document.getElementById(id).textContent;
      navigator.clipboard?.writeText(val);
      showToast('Kopyalandı: ' + val);
    }

    function updateForwardingCodes() {
      const num = (document.getElementById('virtualForwardingNumber').value || '0850XXXXXXX').replace(/\\s+/g, '');
      const personal = (document.getElementById('personalMobileNumber').value || '').replace(/\\s+/g, '');
      const transfer = (document.getElementById('transferPhoneNumber').value || '').replace(/\\s+/g, '');

      document.getElementById('codeAll').textContent = '*21*' + num + '#';
      document.getElementById('codeNoAnswer').textContent = '*61*' + num + '#';

      const proto = location.protocol === 'https:' ? 'https:' : 'http:';
      const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      document.getElementById('inboundWebhookUrl').textContent = proto + '//' + location.host + '/webhooks/telephony/inbound';
      document.getElementById('wsStreamUrl').textContent = wsProto + '//' + location.host + '/ws/call';

      const same = personal && transfer && transfer.endsWith(personal.replace(/^0/, ''));
      document.getElementById('loopWarning').style.display = same ? 'block' : 'none';
    }

    async function loadSettings() {
      const res = await fetch('/api/settings');
      currentSettings = await res.json();
      document.getElementById('personalMobileNumber').value = currentSettings.telephony?.personalMobileNumber || '05348987073';
      document.getElementById('virtualForwardingNumber').value = currentSettings.telephony?.virtualForwardingNumber || '';
      document.getElementById('transferPhoneNumber').value = currentSettings.staffNotifications?.transferPhoneNumber || '';
      document.getElementById('webhookUrl').value = currentSettings.staffNotifications?.webhookUrl || '';

      document.getElementById('businessName').value = currentSettings.businessName;
      document.getElementById('greetingMessage').value = currentSettings.conversation.greetingMessage;
      document.getElementById('maxResponseSentences').value = currentSettings.conversation.maxResponseSentences;
      document.getElementById('maxCallDurationSeconds').value = currentSettings.conversation.maxCallDurationSeconds;
      document.getElementById('costProfile').value = currentSettings.costProfile;
      document.getElementById('maxMonthlyBudgetUsd').value = currentSettings.costLimits.maxMonthlyBudgetUsd;
      document.getElementById('voiceProvider').value = currentSettings.voice.provider;
      document.getElementById('voiceId').value = currentSettings.voice.voiceId;

      for (const k of ['knowledgeBaseEnabled','reservationsEnabled','staffNotesEnabled','callTransferEnabled','bargeInEnabled','costGuardEnabled']) {
        document.getElementById('f_' + k).checked = Boolean(currentSettings.features[k]);
      }

      document.getElementById('profileBadge').textContent = 'Mod: ' + currentSettings.costProfile;
      updateForwardingCodes();
      loadCostBadge();
    }

    async function loadCostBadge() {
      const res = await fetch('/api/metrics/costs');
      const m = await res.json();
      document.getElementById('costBadge').textContent = 'Aylık Maliyet: $' + m.totalCostUsd + ' / $' + m.budgetUsd;
    }

    async function saveTelephony() {
      const payload = {
        telephony: {
          personalMobileNumber: document.getElementById('personalMobileNumber').value.trim(),
          virtualForwardingNumber: document.getElementById('virtualForwardingNumber').value.trim(),
        },
        staffNotifications: {
          transferPhoneNumber: document.getElementById('transferPhoneNumber').value.trim(),
          webhookUrl: document.getElementById('webhookUrl').value.trim(),
        }
      };
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        await loadSettings();
        showToast('Numara ve yönlendirme ayarları kaydedildi.');
      }
    }

    async function saveSettings() {
      const payload = {
        businessName: document.getElementById('businessName').value.trim(),
        costProfile: document.getElementById('costProfile').value,
        conversation: {
          greetingMessage: document.getElementById('greetingMessage').value.trim(),
          maxResponseSentences: Number(document.getElementById('maxResponseSentences').value),
          maxCallDurationSeconds: Number(document.getElementById('maxCallDurationSeconds').value),
        },
        costLimits: {
          maxMonthlyBudgetUsd: Number(document.getElementById('maxMonthlyBudgetUsd').value),
        },
        voice: {
          provider: document.getElementById('voiceProvider').value,
          voiceId: document.getElementById('voiceId').value.trim(),
        },
        features: {
          knowledgeBaseEnabled: document.getElementById('f_knowledgeBaseEnabled').checked,
          reservationsEnabled: document.getElementById('f_reservationsEnabled').checked,
          staffNotesEnabled: document.getElementById('f_staffNotesEnabled').checked,
          callTransferEnabled: document.getElementById('f_callTransferEnabled').checked,
          bargeInEnabled: document.getElementById('f_bargeInEnabled').checked,
          costGuardEnabled: document.getElementById('f_costGuardEnabled').checked,
        }
      };
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        await loadSettings();
        showToast('Asistan ve maliyet ayarları kaydedildi.');
      }
    }

    let cachedCalls = [];
    async function loadCalls() {
      const res = await fetch('/api/calls');
      const data = await res.json();
      cachedCalls = data.calls || [];
      const tbody = document.getElementById('callsTableBody');
      tbody.innerHTML = cachedCalls.length === 0
        ? '<tr><td colspan="7" style="color:var(--muted);">Henüz çağrı kaydı yok.</td></tr>'
        : cachedCalls.map((c, idx) => \`<tr>
            <td>\${new Date(c.startedAt).toLocaleString('tr-TR')}</td>
            <td>\${c.channel}</td>
            <td>\${c.callerPhone}</td>
            <td>\${c.durationSeconds} sn</td>
            <td>\${c.status}</td>
            <td>$\${c.estimatedCostUsd}</td>
            <td><button class="btn-secondary" onclick="showTranscript(\${idx})">Gör (\${c.transcript.length})</button></td>
          </tr>\`).join('');
    }

    function showTranscript(idx) {
      const c = cachedCalls[idx];
      if (!c) return;
      document.getElementById('callDetailCard').style.display = 'block';
      document.getElementById('callTranscriptBox').innerHTML = c.transcript.map(t =>
        \`<div class="msg \${t.speaker === 'caller' ? 'user' : ''}"><strong>\${t.speaker === 'caller' ? 'Arayan' : (t.speaker === 'assistant' ? 'Asistan' : 'Sistem')}:</strong> \${t.text}</div>\`
      ).join('');
    }

    async function loadRecords() {
      const [rRes, nRes] = await Promise.all([fetch('/api/reservations'), fetch('/api/notes')]);
      const rData = await rRes.json();
      const nData = await nRes.json();
      document.getElementById('reservationsBody').innerHTML = (rData.reservations || []).map(r =>
        \`<tr><td>\${r.confirmationCode}</td><td>\${r.customerName} (\${r.phone})</td><td>\${r.date} \${r.time}</td><td>\${r.partySize}</td></tr>\`
      ).join('') || '<tr><td colspan="4" style="color:var(--muted);">Kayıt yok</td></tr>';

      document.getElementById('notesBody').innerHTML = (nData.notes || []).map(n =>
        \`<tr><td>\${n.callerName} (\${n.callerPhone})</td><td>\${n.category}</td><td>\${n.summary}</td></tr>\`
      ).join('') || '<tr><td colspan="3" style="color:var(--muted);">Not yok</td></tr>';
    }

    async function loadDocs() {
      const res = await fetch('/api/knowledge');
      const data = await res.json();
      document.getElementById('docList').innerHTML = (data.documents || []).map(d =>
        \`<li><strong>\${d.filename}</strong> (\${d.chunkCount} bölüm)</li>\`
      ).join('');
    }

    async function uploadDoc() {
      const filename = document.getElementById('docFilename').value.trim();
      const content = document.getElementById('docContent').value.trim();
      if (!filename || !content) return;
      const res = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content })
      });
      if (res.ok) {
        document.getElementById('docFilename').value = '';
        document.getElementById('docContent').value = '';
        loadDocs();
        showToast('Belge bilgi bankasına eklendi.');
      }
    }

    async function sendSim() {
      const input = document.getElementById('simInput');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      const box = document.getElementById('simChatBox');
      box.innerHTML += \`<div class="msg user"><strong>Siz:</strong> \${text}</div>\`;
      const res = await fetch('/api/simulate/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: simSessionId,
          message: text,
          callerPhone: document.getElementById('personalMobileNumber').value || '05348987073'
        })
      });
      const data = await res.json();
      simSessionId = data.sessionId;
      box.innerHTML += \`<div class="msg"><strong>Asistan:</strong> \${data.reply}</div>\`;
      box.scrollTop = box.scrollHeight;
      loadCostBadge();
    }

    document.getElementById('virtualForwardingNumber').addEventListener('input', updateForwardingCodes);
    document.getElementById('personalMobileNumber').addEventListener('input', updateForwardingCodes);
    document.getElementById('transferPhoneNumber').addEventListener('input', updateForwardingCodes);

    loadSettings();
  </script>
</body>
</html>`;
}

