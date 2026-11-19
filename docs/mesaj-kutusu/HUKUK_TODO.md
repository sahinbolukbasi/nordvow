# NordVow Mesaj Kutusu — Hukuk, KVKK ve İYS Uyum Notları (`HUKUK_TODO.md`)

1. **Toplu İleti ve İstenmeyen Mesaj Yasağı (6563 Sayılı Kanun & Meta Politikaları):**
   - Mesaj Kutusu yalnızca kişilerin başlattığı konuşmalara **birebir insan yanıtı** vermek içindir.
   - Uygulamada toplu mesaj (broadcast/kampanya), CSV/numara listesi yükleme, kişi kazıma (scraping) veya tüm kişilere şablon gönderme uç noktası **bulunmamaktadır**.
   - 24 saatlik müşteri hizmeti penceresi dışında WhatsApp şablonu yalnızca:
     1. `UTILITY` (bilgilendirme) kategorisindeki onaylı şablonlarla,
     2. Tek bir konuşmada tek bir kişiye,
     3. Belgelenmiş `ContactConsent` (`state: "GRANTED"`) ve İYS onayı varken gönderilebilir (`MARKETING` şablonları kutuda varsayılan kapalıdır).

2. **Opt-Out (Onay Geri Çekme — Bölüm 7.9):**
   - Gelen mesaj metni Türkçe küçük harfe (`toLocaleLowerCase("tr-TR")`) çevrilip noktalama işaretlerinden arındırıldığında `dur`, `iptal`, `stop`, `abonelikten çık` ifadelerinden biriyse kişinin `ContactConsent` kaydı otomatik olarak `WITHDRAWN` (geri çekildi) durumuna alınır, İYS `captureOptOut` tetiklenir ve konuşmaya aktivite satırı düşülür.
   - Opt-out sonrası pencere dışı şablon gönderimi kalıcı olarak engellenir; otomatik yanıt gönderilmez.

3. **Yapay Zekâ (AI) Kullanım Kuralı:**
   - AI (AWS Bedrock) **asla kendi başına mesaj göndermez**.
   - Yalnızca temsilci `"✨ Yanıt öner"` butonuna bastığında 1–3 adet taslak üretir; temsilci metni düzenleyip `"Gönder"` butonuna basmadan mesaj çıkmaz.
   - Bedrock'a gönderilen son 20 mesajda telefon numaraları ve e-posta adresleri `[gizli]` olarak maskelenir ve yalnızca AB (`eu-central-1`, `eu.` inference profile) modelleri kullanılır.

4. **KVKK Aydınlatma, Saklama ve Unutulma Hakkı:**
   - **Yurt Dışı Aktarım (KVKK md. 9):** Instagram ve WhatsApp mesajları Meta Platforms Inc. altyapısı üzerinden işlenir. Hukuk ekibi tarafından KVKK Aydınlatma Metnine Meta API entegrasyonu ve saklama süresi (varsayılan `24 ay`, tenant ayarlarından değiştirilebilir) eklenmelidir.
   - **Veri Silme & Dışa Aktarma:** Sağ kişi panelinden ve `/api/inbox/contacts/:id` uçlarından kişinin tüm mesaj/ek verileri JSON olarak dışa aktarılabilir veya kalıcı olarak silinebilir (`contact.delete` audit kaydı hariç tüm kişisel veriler temizlenir).
   - **Meta Data Deletion & Deauthorize Callback:**
     - `POST /api/meta/data-deletion` (`signed_request` HMAC-SHA256 doğrulamalı) silme talebini kayda alır ve Türkçe durum takip adresi (`https://nordvow.com/veri-silme-durumu?kod=...`) ile `confirmation_code` döndürür.
     - `POST /api/meta/deauthorize` ilgili kanal bağlantısını `REVOKED` / `DISCONNECTED` durumuna çeker ve erişim token'ını kasadan siler.

