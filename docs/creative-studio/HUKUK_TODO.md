# NordVow Creative Studio — Hukuk ve Uyum Notları (`HUKUK_TODO.md`)

1. **KVKK Aydınlatma ve Yurt Dışı Aktarım (m.9):**
   - `fal-ai/wizper` transkripsiyonu veya görsel/video AI işlemleri ses/medya verisini ABD merkezli fal.ai servisine iletir.
   - Uygulamada ilk çağrı öncesi `fal_transfer_v1` açık rıza kontrolü (`StudioConsent` / `/api/studio/consent`) zorunludur; onay olmadan fal'a veri gönderilmez.
   - **Hukuk Ekibi Aksiyonu:** KVKK Aydınlatma Metni ve Yurt Dışı Aktarım Metni içine fal.ai Standart Sözleşme (SCC) ve Kurum bildirim bilgisi eklenmelidir.
2. **AWS Bedrock AB Veri Sınırları:**
   - Metin zekâsı (altyazı düzeltme, hook, senaryo, highlight) için yalnızca `eu.` önekli Bedrock inference profile kimlikleri (`eu.anthropic.claude-haiku-4-5-20251001-v1:0`, `eu.amazon.nova-lite-v1:0`) kullanılır; `global.` profili kullanılmaz.
3. **Saklama ve Silme Politikası:**
   - Silinen proje ve medyalar S3 lifecycle kuralları + silme işi ile 30 gün içinde kalıcı silinir. Render çıktıları için 90 gün saklama politikası önerilir.
4. **Ticaret Bakanlığı Reklam Etiketi Zorunluluğu:**
   - Marka kampanya şablonlarında yer alan `#reklam / İşbirliği` katmanı varsayılan olarak kilitlidir (`locked: true, lockedBy: "brand"`). Creator bu katmanı silemez; sunucu `PUT /api/studio/projects/:id/timeline` adımında kilitli öğelerin korunmasını ayrıca doğrular.
5. **FFmpeg & Font Lisansları:**
   - FFmpeg yalnızca sunucu ortamında çalıştırılır ve son kullanıcıya ikili dosya olarak dağıtılmaz (`LGPL/GPL` derleme durumu imaj bakımında izlenmelidir).
   - Kullanılan yazı tipleri (`Inter`, `Montserrat`, `Poppins`, `Bebas Neue`) SIL OFL lisanslıdır.
