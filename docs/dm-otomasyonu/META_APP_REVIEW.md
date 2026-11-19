# NordVow DM Otomasyonu — Meta App Review ve İzin Rehberi (`META_APP_REVIEW.md`)

**Son Doğrulama Tarihi:** 19 Kasım 2026  
**Graph API Sürümü:** `v27.0` (`META_GRAPH_API_VERSION=v27.0`)  
**Resmî Doküman Referansı:** Meta Graph API — Instagram Private Replies & Rate Limits (hesap başına saatte 750 private reply; yorumdan sonraki 7 gün içinde gönderim; Live için saniyede 100).

---

## 1. İstenen İzinler ve Gerekçeleri (Instagram API with Instagram Login)

Başvuru **Mesaj Kutusu** ve **Instagram İçgörüleri** ile tek bir Meta App Review paketinde birleştirilir.

### `instagram_business_basic`
- **TR:** "Kullanıcı Instagram işletme girişiyle yetki verdikten sonra bağlanan profesyonel hesabı tanımlamak ve otomasyonların hangi hesaba ait olduğunu göstermek için kullanılır."
- **EN:** "Used to identify the connected professional Instagram account after the user grants OAuth authorization and to display which account each automation belongs to."

### `instagram_business_manage_comments`
- **TR:** "Bir takipçi, hesap sahibinin kendi gönderisine sahibin belirlediği anahtar kelimeyle yorum yazdığında yorumu `comments` webhook'u ile alırız ve sahip etkinleştirdiyse yorumun altına herkese açık bir yanıt yazarız. Yalnızca bağlanan hesabın kendi içeriğindeki yorumlar işlenir."
- **EN:** "When a follower comments on the account owner's own post with a keyword configured by the owner, we receive the comment via the `comments` webhook and, if enabled by the owner, post a public reply under that comment. Only comments on the connected account's own media are processed."

### `instagram_business_manage_messages`
- **TR:** "Takipçi anahtar kelimeyle yorum yazdıktan sonra, ona hesap sahibinin hazırladığı içeriği (genellikle takipçinin yorumla istediği link veya kupon kodu) tek seferlik bir özel yanıt (Private Reply) olarak göndeririz. Her eşleşen yorum için yalnızca bir yanıt gönderilir, Meta hız limitlerine uyulur (saatte ≤ 700), takip şartı veya tekrar mesaj yoktur."
- **EN:** "After a follower comments with the requested keyword, we send a single Private Reply containing the content prepared by the account owner (such as the requested link or coupon code). Exactly one reply is sent per matching comment, strict Meta rate limits are enforced, and there is no follow gate or follow-up drip messaging."

---

## 2. Webhook Ayarları (Ortak Uç Nokta)
- **Callback URL:** `https://nordvow.com/api/webhooks/meta/instagram`
- **Abone Olunan Alanlar (`subscribed_fields`):** `comments`, `messages`, `messaging_postbacks`, `message_reactions`, `messaging_seen` (Mesaj Kutusu ile birleşik; biri diğerini ezmez).
- **Data Deletion Callback:** `https://nordvow.com/api/meta/data-deletion`
- **Deauthorize Callback:** `https://nordvow.com/api/meta/deauthorize`

---

## 3. App Review Ekran Kaydı Senaryosu (2–3 dk, Tek Çekim, Canlı Hesaplar)
1. NordVow paneline giriş yapın ve **DM Otomasyonu** (`/dashboard/dm-otomasyonu`) sayfasını açın.
2. **Instagram Hesabını Bağla** akışından resmî OAuth izin ekranını göstererek profesyonel hesabı bağlayın.
3. **+ Yeni Otomasyon** sihirbazını açın:
   - Son yayınlanan Reel'i seçin.
   - Anahtar kelime olarak `KOD` ekleyin (Tam kelime modu) ve canlı test kutusunda eşleştiğini gösterin.
   - DM metnini + takip linkini + kupon kodunu girin; herkese açık yorum yanıtını etkinleştirin.
   - Uyum kontrol listesini onaylayıp kampanyayı **Başlat**ın.
4. İkinci telefondan/hesaptan ilgili Reel'e `KOD` yorumu yazın.
5. İkinci hesapta tek seferlik Private Reply DM'inin geldiğini ve yorum altında herkese açık yanıtın göründüğünü gösterin.
6. NordVow panelinde kampanyanın **Kayıtlar** sekmesinde satırın **"Gönderildi"** olarak canlı güncellendiğini gösterin.

---

## 4. Uyum Pozisyonu
- Veri kazıma (scraping) veya şifre isteme yoktur.
- Yalnızca kullanıcının kendi gönderisine yorum yazan kişiye, yorumdaki talebe karşılık tek bir mesaj gönderilir.
- Token'lar AES-256-GCM ile şifrelidir; `DUR / İPTAL / STOP` opt-out desteklenir.

