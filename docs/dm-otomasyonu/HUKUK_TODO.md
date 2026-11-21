# NordVow DM Otomasyonu — Hukuk, KVKK ve İYS Değerlendirme Notları (`HUKUK_TODO.md`)

**Tarih:** 19 Kasım 2026  
**Durum:** Hukuk ekibi incelemesi için teknik uyum özeti

---

## 1. 6563 Sayılı Kanun, Ticari Elektronik İleti Yönetmeliği ve İYS
- **Kapsam:** Kupon kodu veya indirim bağlantısı içeren DM'ler ticari elektronik ileti niteliği taşıyabilir.
- **Teknik Önlem:** Özellik, soğuk/toplu DM göndermez; yalnızca kullanıcının gönderinin altındaki açık talimat doğrultusunda anahtar kelime yorumlayarak talep ettiği içeriği **tek seferlik yanıt** olarak iletir.
- **Zorunlu Bilgilendirme Satırı:** Her DM mesajının sonuna düzenlenebilir ancak silinemeyen ve mutlaka `"DUR"` ifadesini içeren bilgilendirme satırı eklenir:  
  `"Bu mesajı yorumundaki talebin üzerine gönderdik. Bir daha mesaj almak istemezsen DUR yaz."`
- **Kampanya Aktivasyon Kontrol Listesi:** Kullanıcı kampanyayı başlatmadan önce gönderi açıklamasında talimatın açıkça yazdığını ve DM içeriğinin vaat edilenle aynı olduğunu onaylamak zorundadır.
- **Hukukçuya Sorulacaklar:**
  1. Instagram Private Replies üzerinden gönderilen talep bazlı tek seferlik kupon/link DM'lerinin İYS kayıt kapsamına girip girmediğinin teyit edilmesi.
  2. Marka işbirliği kampanyalarında DM ve herkese açık yorum yanıtı metinlerinde `#reklam` / `#işbirliği` ibaresinin zorunluluk sınırının belirlenmesi.

## 2. Reklam İbaresi (Ticaret Bakanlığı Etkileyici Reklam Kılavuzu)
- Kampanya bir marka işbirliğiyse gönderide `#reklam` veya `#işbirliği` ibaresinin bulunması creator/marka sorumluluğundadır; sihirbazın son adımında zorunlu hatırlatma ve onay kutusu gösterilir.

## 3. KVKK Aydınlatma, Saklama ve Silme Kuralları
- **Kişisel Veriler:** Yorum sahibinin IG kullanıcı adı, IGSID ve yorum metni yalnızca talep edilen içeriği iletmek ve toplu istatistik üretmek amacıyla işlenir.
- **Saklama Süreleri (`runDmRetentionJob`):**
  - `DmLog.triggerText` ve `recipientUsername`: **90 gün** sonunda otomatik olarak `null` yapılır (`DM_RETENTION_TEXT_DAYS=90`).
  - `DmOperationalEvent.bodyPreview`: **30 gün** sonunda silinir.
  - `DmLinkClick` ve `recipientIgsid`: **12 ay** sonunda temizlenir / tek yönlü hash'lenir.
  - `DmDailyStat` (kişisel veri içermeyen günlük toplamlar): kalıcı tutulur.
- **Tıklama Gizliliği:** Ham IP adresi **hiçbir zaman saklanmaz**; yalnızca `DM_TRACKING_SECRET` tuzlu SHA-256 hash (`ipHash`) tutulur. Linklerde IGSID açık yer almaz; 22 karakterlik HMAC token (`recipientToken`) taşınır.
- **Opt-Out Kayıtları:** `DUR / İPTAL / STOP / ABONELİKTEN ÇIK` yazan kişinin `DmOptOut` kaydı, kişiye tekrar otomatik mesaj gitmesini engellemek için meşru menfaat kapsamında tutulur (aydınlatma metnine yazılmalıdır).
- **Yurt Dışı Aktarım (KVKK md. 9):** Mesaj iletimi Meta Platforms Inc. (ABD) altyapısı üzerinden gerçekleştiğinden KVKK Aydınlatma Metninde yurt dışı aktarım maddesi yer almalıdır.
- **CSV Dışa Aktarma:** Yalnızca `ADMIN` / `OWNER` rollerine açıktır; indirilen dosyanın başında KVKK aydınlatma uyarısı bulunur ve indirme işlemi audit log'a kaydedilir.

