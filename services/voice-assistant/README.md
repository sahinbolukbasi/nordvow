# Türkçe Sesli Asistan Servisi (`voice-assistant`)

Türkiye (`+90`) numaralarıyla çalışan, gerçekçi insan sesi (ElevenLabs Flash v2.5) kullanan, maliyet kontrollü ve tüm özellikleri çalışma anında açılıp kapatılabilen bağımsız sesli asistan servisidir.

## Özellikler
- **Gerçekçi Türkçe Ses & Söz Kesme (Barge-in):** ElevenLabs `ulaw_8000` akışı + Deepgram Nova-2 (`tr`) VAD ile arayan kişi konuşmaya başladığında asistan anında susup dinler.
- **Kısa ve Doğal Yanıtlar:** Telefona uygun 1–3 cümlelik yanıtlar; markdown/liste yok.
- **Belge Tabanlı Soru-Cevap (RAG):** `knowledge/` klasöründeki veya `/api/knowledge` ile yüklenen Markdown/TXT/JSON belgelerden vektör veritabanı maliyeti olmadan anında yanıt üretir.
- **Rezervasyon Alma:** Tarih, saat, kişi sayısı ve iletişim bilgilerini alıp onay kodu üretir (`/api/reservations`).
- **Görevlilere Not & Çağrı Aktarımı:** Rezervasyon dışındaki tüm talep, şikayet ve geri arama isteklerini kaydedip `STAFF_WEBHOOK_URL` adresine iletir (`/api/notes`) veya canlı görevli numarasına aktarır.
- **Maliyet Kontrolü & Ayarlanabilir Profiller:** `eco`, `balanced` (varsayılan) ve `premium` profilleri, çağrı süre sınırı (`maxCallDurationSeconds`), token sınırı ve aylık bütçe koruyucusu (`autoSwitchToEcoAtPercent`).

## Hızlı Başlangıç

```bash
cd services/voice-assistant
cp .env.example .env
npm install
npm run dev
```

API anahtarları girilmeden de yerel simülasyon modu çalışır:
```bash
curl -X POST http://localhost:4100/api/simulate/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Saat kaça kadar açıksınız?"}'
```

## Çalışma Anında Özellik ve Maliyet Ayarları

```bash
curl -X PATCH http://localhost:4100/api/settings \
  -H "Content-Type: application/json" \
  -d '{
    "costProfile": "balanced",
    "features": {
      "reservationsEnabled": true,
      "staffNotesEnabled": true,
      "knowledgeBaseEnabled": true,
      "bargeInEnabled": true
    },
    "conversation": {
      "maxResponseSentences": 2,
      "maxCallDurationSeconds": 300
    }
  }'
```

## Türkiye (`+90`) Numara Bağlantısı (AWS)
1. [infra/aws-sip-terraform/main.tf](infra/aws-sip-terraform/main.tf) ile `eu-central-1` bölgesinde **Amazon Chime SDK Voice Connector** oluşturun.
2. Türk VoIP/SIP sağlayıcınızın (Netgsm, Bulutfon vb.) panelinden gelen çağrıları Voice Connector SIP adresine yönlendirin.
3. Çağrı webhook'unu `https://<sunucunuz>/webhooks/telephony/inbound` ve WebSocket akışını `wss://<sunucunuz>/ws/call` olarak bağlayın.

