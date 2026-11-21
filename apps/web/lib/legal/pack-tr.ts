import type { LegalBody, LegalDocId } from "./types";

const p = (text: string) => ({ p: text });
const ul = (items: string[]) => ({ ul: items });
const ol = (items: string[]) => ({ ol: items });

export const PACK_TR: Record<LegalDocId, LegalBody> = {
  terms: {
    title: "Platform Kullanım Sözleşmesi",
    intro: "Bu sözleşme; Nordvow platformunu kullanan ajans, ajans çalışanı (Admin ve Ajans rolleri), marka ve içerik üreticisi (Influencer) ile Nordvow arasındaki kullanımı düzenler. Platformu kullanarak, hesap açarak veya hizmetten yararlanarak bu sözleşmeyi kabul etmiş olursunuz. Tüketici sıfatınız varsa kanunun emredici hükümleri saklıdır.",
    sections: [
      { id: "tanim", title: "Tanımlar ve sıfat", blocks: [
        ul([
          "Nordvow: [Şirket unvanı]. Platformun sahibi ve işletmecisidir.",
          "Platform: Nordvow’un kampanya, teklif, içerik, ödeme, mesajlaşma, etkinlik, kupon ve yapay zekâ araçlarını sunduğu yazılım.",
          "Ajans / Admin: platformu kampanya operasyonu için kullanan ajans ve onun adına hareket eden kullanıcılar. Ajans, çalışanlarının işlemlerinden sorumludur.",
          "Marka: içerik üreticileriyle iş birliği yapan ticari işletme ve yetkilileri.",
          "Influencer: teklif alan ve içerik üreten gerçek veya tüzel kişi. Ticari amaçla hareket eden influencer tacir veya esnaf hükümlerine tabi olabilir.",
          "Kullanıcı: platforma erişen her hesap sahibi.",
          "İçerik: kullanıcı tarafından yüklenen veya platformda üretilen metin, görsel, video, ses, brief, yorum ve yapay zekâ çıktısı.",
        ]),
        p("Nordvow, marka ile influencer arasındaki iş birliğine aracılık eden bir yazılım sağlayıcıdır. Aksi yazılı olarak kararlaştırılmadıkça o sözleşmenin tarafı, kefili veya ifa yardımcısı değildir. 5651 sayılı Kanun anlamında aracı hizmet sağlayıcı sıfatı saklıdır; Nordvow, kullanıcı içeriğini önceden denetlemekle yükümlü değildir."),
      ]},
      { id: "hesap", title: "Hesap, yaş ve güvenlik", blocks: [
        ul([
          "Üyelik davet ve Nordvow onayıyla açılır. Nordvow başvuruyu gerekçe göstermeden reddedebilir.",
          "Platform 18 yaşından küçükler için değildir. 18 yaş altı bir kişiyle çalışılacaksa veli veya vasi onayı ve ajans sorumluluğu aranır; aksi kullanım Nordvow’un kusuru sayılmaz.",
          "Bilgilerin doğruluğu, güncelliği ve hesap güvenliği kullanıcıya aittir. Yetkisiz kullanımı derhâl bildirmelisiniz. Bildirimden önceki işlemler size aittir.",
          "Nordvow, risk, mevzuat, ödeme gecikmesi, şüpheli işlem veya sözleşme ihlali halinde hesabı askıya alabilir, sınırlayabilir veya sona erdirebilir. Bu yetki ölçülülük içinde kullanılır; tüketiciye karşı haksız şart yasağı saklıdır.",
        ]),
      ]},
      { id: "hizmet", title: "Hizmetin niteliği ve sonuç garantisi yokluğu", blocks: [
        p("Platform “olduğu gibi” ve “mevcut olduğu ölçüde” sunulur. Nordvow; kesintisiz erişim, belirli bir erişim, etkileşim, satış, marka bilinirliği, kampanya kârlılığı veya üçüncü taraf platformların (Meta, TikTok, Google, YouTube) politikalarına uyum sonucu vermeyi taahhüt etmez. Kampanya skoru, öneri ve yapay zekâ çıktısı karar destek aracıdır; nihai karar kullanıcıya aittir."),
        p("Üçüncü taraf API’lerinin değişmesi, kısıtlanması veya kapanması Nordvow’un temerrüdü değildir."),
      ]},
      { id: "fikri", title: "Fikri mülkiyet ve lisans", blocks: [
        p("Platformun yazılımı, arayüzü, markası ve veritabanı sui generis hakkı Nordvow’a aittir. Kullanıcıya yalnızca sözleşme süresince, devredilemez, münhasır olmayan bir kullanım hakkı verilir."),
        p("Kullanıcı, yüklediği veya ürettiği içerik üzerinde hak sahibi olduğunu veya gerekli izinleri aldığını beyan eder. Kullanıcı, Nordvow’a; platformu işletmek, güvenliğini sağlamak, yedeklemek, ilgili kampanyayı yürütmek, raporlamak ve Nordvow ile kampanyayı tanıtmak için dünya çapında, bedelsiz, devredilebilir ve alt lisanslanabilir, münhasır olmayan bir mali hak lisansı verir. Lisans, hesap süresince ve kampanya kayıtlarının saklanması için gerekli makul arşiv süresi boyunca geçerlidir. Yayımlanmış kampanya içeriği, tarihsel raporların doğruluğu için kampanya bitiminden sonra da bu sınırlı amaçla kullanılabilir."),
        p("Eser sahibinin manevi hakları (FSEK) devredilmiş sayılmaz. Nordvow, format, kırpma, altyazı ve platforma uyarlama için zorunlu teknik değişiklikleri yapabilir. Kullanıcı, bu değişikliklerin eserinin özüne aykırı saldırı oluşturmadığını kabul eder."),
      ]},
      { id: "ai", title: "Creative ve yapay zekâ", blocks: [
        ul([
          "Görsel, video, ses ve metin çıktıları olasılıksaldır; doğruluk, özgünlük, üçüncü kişi haklarına aykırılık taşımama veya ticari elverişlilik garantisi yoktur.",
          "Çıktıyı yayımlamadan önce hukuka, reklam mevzuatına ve üçüncü kişi haklarına uygunluğunu denetlemek kullanıcıya aittir.",
          "Gerçek bir kişinin yüzü veya sesiyle kimlik üretimi reddedilebilir. Bu filtrenin her ihlali yakalayacağı garanti edilmez.",
          "Sağlayıcılar (fal.ai, Amazon Bedrock ve benzerleri) kendi şartlarına tabidir. Nordvow onların model davranışından, kesintisinden ve eğitim verisinden sorumlu değildir.",
          "Yapay zekâ ile üretilen içerikte “AI ile üretildi” işaretinin bulunmaması, kullanıcının açıklama yükümlülüğünü kaldırmaz.",
        ]),
      ]},
      { id: "influencer", title: "Influencer’ın yükümlülükleri", blocks: [
        ul([
          "Ücretli veya menfaat karşılığı paylaşımlarda Ticari Reklam ve Haksız Ticari Uygulamalar Yönetmeliği md. 23/A uyarınca reklam ibaresi, Reklam Kurulu içtihadı ve platformun ücretli ortaklık etiketi ilk andan itibaren açıkça kullanılır.",
          "Yanıltıcı sağlık, kazanç veya ürün iddiası kurulmaz. Rakip marka yasağı ve münhasırlık varsa uyulur.",
          "Kararlaştırılan süre boyunca içerik silinmez. Erken silme, sözleşme ihlali ve hakedişin kısmen veya tamamen kesilmesi sebebi olabilir.",
          "Ayrıntılı influencer şartları /influencer-sozlesmesi metnindedir ve bu sözleşmenin parçasıdır.",
        ]),
      ]},
      { id: "marka", title: "Markanın yükümlülükleri", blocks: [
        ul([
          "Brief, ürün, fiyat ve vaatler doğru ve günceldir. Ürünün piyasaya arzı ve reklamı için gerekli izinler markadadır.",
          "Kullanım hakkı tanınan marka varlıkları üzerinde marka hak sahibidir veya lisanslıdır.",
          "Onay sürelerine ve ödeme planına uyulur. Gecikme, içeriğin askıya alınması ve temerrüt faizi sebebi olabilir.",
          "WhatsApp, Instagram ve benzeri kanallarda 6563 sayılı Kanun, İYS ve Meta şartlarına uymak markanın sorumluluğundadır.",
          "Ayrıntılı marka şartları /marka-sozlesmesi metnindedir ve bu sözleşmenin parçasıdır.",
        ]),
      ]},
      { id: "odeme", title: "Bedel, komisyon, stopaj, iade, chargeback ve takas", blocks: [
        ul([
          "Ücretler, komisyonlar ve kredi bedelleri platformda ilan edilen veya teklifte yazılı olan tutarlardır. Vergiler hariçtir; aksi yazılmadıkça KDV ayrıca eklenir.",
          "Nordvow’un gösterdiği stopaj ve belge uyarıları bilgilendirmedir; vergi danışmanlığı değildir. Beyan ve ödeme yükümlülüğü ilgili tarafa aittir.",
          "Influencer hakedişi, işin platform kurallarına göre tamamlanması ve varsa bekleme süresiyle muaccel olur. Nordvow, markadan tahsil edemediği bedeli influencer’a ödemek zorunda değildir; aksi yazılı garanti verilmedikçe tahsilat riski ajans modelinde ayrıca kararlaştırılır.",
          "Tüketici işlemi olmayan ödemelerde iade, ancak kanunen zorunluysa veya Nordvow yazılı kabul ettiyse yapılır. Kullanılmış kredi, ifa edilmiş yapay zekâ üretimi ve başlanmış kampanya için iade yoktur.",
          "Kart itirazı (chargeback) ve ters ibraz, ilgili marka veya hizmeti satın alan tarafa rücu edilir. Nordvow bu tutarı, komisyonu ve banka masrafını alacaklarından takas ve mahsup edebilir.",
          "Karşılıklı borçlar vadeleri gelmeden de Nordvow’un tek taraflı takas beyanıyla mahsup edilebilir (TBK md. 139 vd. saklıdır).",
        ]),
        p("Tüketiciye satılan bilet ve kuponlarda 6502 sayılı Kanun ile Mesafeli Sözleşmeler Yönetmeliği’nin emredici hükümleri ve /mesafeli-satis ile /iade-iptal metinleri uygulanır."),
      ]},
      { id: "sona", title: "Askıya alma ve fesih", blocks: [
        p("Nordvow, ağır ihlal, hukuka aykırılık, sahtecilik, güvenlik riski veya yasal talep halinde sözleşmeyi derhâl feshedebilir. Diğer hallerde hesap, bildirimle kapatılabilir. Kullanıcı, işleyen kampanya ve muaccel borçlar bitmeden fesih isterse, ifa edilmiş işlerin bedeli ve Nordvow’un o ana kadarki komisyon alacağı saklıdır. Fesih, doğmuş borçları ve gizlilik, fikri mülkiyet, tazminat ve delil kayıtlarını ortadan kaldırmaz."),
      ]},
      { id: "sorumluluk", title: "Sorumluluğun sınırı", blocks: [
        p("Nordvow’un bu sözleşmeden doğan toplam sorumluluğu, talebin doğduğu tarihten geriye doğru on iki ay içinde ilgili kullanıcının Nordvow’a fiilen ödediği hizmet bedeli ile sınırlıdır. Bu süre içinde ödeme yoksa sorumluluk, doğrudan zararla ve her hâlde bin Türk lirası ile sınırlıdır. Dolaylı zarar, kâr kaybı, veri kaybı, itibar kaybı ve üçüncü kişi platformlarının yaptırımları istenemez."),
        p("Bu sınır; Nordvow’un kastı veya ağır kusuru halinde ve kanunun sınırlamaya izin vermediği bedensel zararlarda uygulanmaz (TBK md. 115). Tüketici işlemlerinde sınır, yalnızca 6502 sayılı Kanun’un haksız şart denetimine aykırı olmadığı ölçüde geçerlidir. Emredici tüketici hükümleri bu maddeden üstündür."),
      ]},
      { id: "tazminat", title: "Tazminat yükümlülüğü", blocks: [
        p("Kullanıcı; içeriği, reklamı, 23/A ihlali, İYS’siz ticari iletisi, fikri mülkiyet ihlali, kişisel veri ihlali veya iş birliğinin diğer tarafına verdiği zarardan doğan üçüncü kişi taleplerine, idari para cezalarına ve makul avukatlık giderlerine karşı Nordvow’u tazmin eder. Nordvow’un kastı veya ağır kusuruyla kendi başına neden olduğu kısım bu tazminatın dışındadır. Nordvow, davayı üstlenip kullanıcıdan avansı isteyebilir."),
      ]},
      { id: "mucbir", title: "Mücbir sebep", blocks: [
        p("Doğal afet, savaş, terör, salgın, yaygın siber saldırı, elektrik veya omurga kesintisi, bulut veya model sağlayıcısının kesintisi, Meta, TikTok veya Google’ın API veya politika değişikliği ve resmi mercilerin işlemi, Nordvow’un makul kontrolü dışındaysa temerrüt sayılmaz. Etkilenen yükümlülük, engel süresince askıdadır."),
      ]},
      { id: "degisiklik", title: "Tek taraflı değişiklik", blocks: [
        p("Nordvow sözleşmeyi ve ücretleri değiştirebilir. Kullanıcının aleyhine esaslı değişiklik, yürürlükten en az on beş gün önce e-posta veya uygulama içi bildirimle duyurulur. Yürürlükten sonra platformu kullanmak değişikliği kabuldür. Değişikliği kabul etmeyen kullanıcı, yürürlükten önce hesabını kapatabilir; doğmuş borçlar saklıdır. Tüketici aleyhine haksız şart oluşturan değişiklik uygulanmaz."),
      ]},
      { id: "hukuk", title: "Uygulanacak hukuk ve yetki", blocks: [
        p("Sözleşmeye Türk hukuku uygulanır. Tacir, esnaf ve ticari amaçla hareket eden kullanıcılar için uyuşmazlığın çözümünde İstanbul Mahkemeleri (Çağlayan Adliyesi) ve İstanbul icra daireleri yetkilidir. Tüketici, kendi yerleşim yerindeki tüketici hakem heyetine ve tüketici mahkemesine başvurma hakkını kaybetmez; bu hak sözleşme ile kaldırılamaz."),
      ]},
      { id: "delil", title: "Delil sözleşmesi", blocks: [
        p("Taraflar, 6100 sayılı HMK md. 193 uyarınca Nordvow’un ticari defter, elektronik log, işlem kaydı, kabul kaydı ve sistem çıktılarının kesin delil olduğunu kabul eder. Bu kayıtların aksi, ancak aynı kuvvetle yazılı delille kanıtlanabilir. Tüketici işlemlerinde bu madde, ancak kanunun kesin delil sözleşmesine izin verdiği ölçüde uygulanır."),
      ]},
      { id: "tebligat", title: "Bildirimler", blocks: [
        p("Bildirimler, hesapta kayıtlı e-posta adresine ve uygulama içi bildirime yapılır. E-posta, gönderildiği günü izleyen iş gününde tebliğ edilmiş sayılır; “iletilemedi” iletisi varsa Nordvow ikinci bir kanaldan dener. Kullanıcı, e-posta adresini güncel tutmakla yükümlüdür."),
      ]},
      { id: "bolunebilirlik", title: "Bölünebilirlik, devir ve bütünlük", blocks: [
        ul([
          "Bir hükmün geçersizliği sözleşmenin kalanını etkilemez. Geçersiz hüküm, amaca en yakın geçerli hükümle değiştirilmiş sayılır.",
          "Nordvow, sözleşmeyi bağlı ortaklığına veya işin devralanına devredebilir. Kullanıcı, Nordvow’un yazılı izni olmadan devredemez.",
          "Bu sözleşme, /influencer-sozlesmesi veya /marka-sozlesmesi, ilan edilen ücretler ve kabul kaydı ile birlikte bütün teşkil eder. Çelişkide, tüketici işlemi değilse şu sıra geçerlidir: özel kampanya sözleşmesi, rol sözleşmesi, bu platform sözleşmesi.",
        ]),
      ]},
    ],
  },
  privacy: {
    title: "Gizlilik Politikası",
    intro: "Bu politika, Nordvow’un hangi kişisel verileri neden işlediğini sade dille açıklar. Hukuki aydınlatma yükümlülüğünün tam metni KVKK Aydınlatma Metni’dir (/kvkk-aydinlatma). İkisi çelişirse aydınlatma metni ve kanunun emredici hükümleri esas alınır.",
    sections: [
      { id: "rol", title: "Veri sorumlusu ve veri işleyen sıfatı", blocks: [
        p("Hesap, güvenlik, faturalama ve platform işletimi bakımından veri sorumlusu Nordvow’dur. Markanın kendi müşterilerine WhatsApp, Instagram veya Messenger üzerinden yazdığı mesajlarda ve markanın yüklediği alıcı listelerinde veri sorumlusu kural olarak markadır; Nordvow veri işleyendir ve veriyi markanın talimatı, bu politika ve sözleşme ile işler."),
      ]},
      { id: "kategori", title: "Veri kategorileri", blocks: [
        ul([
          "Kimlik ve iletişim: ad, e-posta, telefon, vergi kimlik numarası, şirket bilgisi.",
          "Hesap ve işlem güvenliği: parola özeti, oturum, IP, tarayıcı, çerez, denetim kaydı.",
          "Profil: kategori, şehir, fiyat, sosyal hesap kullanıcı adı, takipçi ve etkileşim sayıları, IBAN ve vergi profili.",
          "Kampanya: brief, teklif, içerik, metrik, skor, sohbet.",
          "Mesajlaşma: markanın bağladığı Meta kanallarındaki yazışma içeriği, telefon numarası ve teslim durumu.",
          "Ödeme ve etkinlik: bilet, kupon, çekim talebi.",
          "Yapay zekâ: prompt, yüklenen referans dosya ve üretilen çıktı.",
        ]),
      ]},
      { id: "amac", title: "Amaçlar ve hukuki sebepler", blocks: [
        p("Veriler; sözleşmenin kurulması ve ifası (KVKK md. 5/2-c), hukuki yükümlülük (md. 5/2-ç, vergi ve ticari ileti mevzuatı), bir hakkın tesisi ve korunması (md. 5/2-e) ve meşru menfaat (md. 5/2-f; güvenlik, dolandırıcılığın önlenmesi, hizmetin iyileştirilmesi, menfaat dengesinin gözetilmesi şartıyla) için işlenir. Pazarlama iletisi, yurt dışı aktarımın sözleşme veya yükümlülükle zorunlu olmadığı hâlleri ve isteğe bağlı yapay zekâ işleme için ayrıca açık rıza alınır (/acik-riza). Özel nitelikli veri bilerek istenmez; kullanıcı böyle veri yüklerse bunu yapmamalıdır."),
      ]},
      { id: "meta", title: "Meta, WhatsApp ve Instagram", blocks: [
        p("Meta Platform Şartları gereği şu hususlar açıklanır. Facebook, Instagram, Messenger veya WhatsApp hesabı bağlandığında; hesap kimliği, sayfa veya işletme kimliği, kullanıcı adı, profil bilgisi, mesaj içeriği, mesajın teslim ve okunma durumu, reklam yönlendirmesi bilgisi ve webhook olayları işlenebilir. Amaç; gelen kutusunu göstermek, kampanya ve müşteri yazışmasını yürütmek, yasal ticari ileti kurallarına uymak ve kötüye kullanımı engellemektir."),
        p("Bu veriler satılmaz, veri aracısına devredilmez ve Meta dışındaki reklam ağlarında profil çıkarmak için kullanılmaz. Mesajların Meta altyapısında işlenmesine Meta’nın kendi gizlilik metni uygulanır. Bağlantı, Meta hesap ayarlarından veya Nordvow panelinden kaldırılabilir; kaldırma, yasal saklama süresindeki kayıtları hemen silmez. Meta’nın “verilerimi sil” akışı /veri-silme sayfası ve /api/meta/data-deletion uç noktasıyla karşılanır."),
      ]},
      { id: "aktarim", title: "Aktarım ve yurt dışı", blocks: [
        p("Veri; iş birliği yapılan marka veya influencer, ödeme kuruluşu, e-posta ve barındırma sağlayıcıları, bağımsız denetçi ve kanunen yetkili kurumlarla paylaşılabilir. Barındırma öncelikle AWS Avrupa (Frankfurt) bölgesindedir. Meta (İrlanda ve Amerika Birleşik Devletleri), fal.ai ve Amazon Bedrock yurt dışında işleme yapabilir."),
        p("Yurt dışı aktarım, 7499 sayılı Kanun ile değişik KVKK md. 9 rejimine göre yapılır: yeterlilik kararı, standart sözleşme, bağlayıcı şirket kuralları, taahhütname veya kanundaki istisnalar. Standart sözleşme kullanıldığında Kurul’a bildirim yükümlülüğü Nordvow’dadır. Aktarımın sözleşmenin ifası için zorunlu olmadığı hâllerde açık rıza ayrıca sorulur."),
      ]},
      { id: "sure", title: "Saklama", blocks: [
        p("Hesap verisi üyelik boyunca ve zamanaşımı için makul süre; mali kayıtlar Vergi Usul Kanunu süreleri; mesaj içeriği markanın belirlediği süre, varsayılan doksan gün; denetim kaydı hukuki uyuşmazlık süresi; çerezler çerez politikasındaki süre kadar saklanır. Süre bitince veri silinir, anonimleştirilir veya arşivlenir."),
      ]},
      { id: "hak", title: "Haklar ve başvuru", blocks: [
        p("KVKK md. 11 hakları için /kvkk-aydinlatma metnine bakınız. Başvuru [KVKK başvuru e-postası] adresine veya [KEP adresi] üzerinden yapılır. Meta kaynaklı silme talepleri /veri-silme sayfasındaki usule de tabidir."),
      ]},
    ],
  },
  kvkk: {
    title: "KVKK Aydınlatma Metni",
    intro: "6698 sayılı Kanun md. 10 ve Aydınlatma Yükümlülüğünün Yerine Getirilmesinde Uyulacak Usul ve Esaslar Hakkında Tebliğ uyarınca hazırlanmıştır. Bu metin bilgilendirmedir; açık rıza yerine geçmez ve sözleşme kurulmasının ön şartı olarak rıza ile birleştirilemez.",
    sections: [
      { id: "sorumlu", title: "Veri sorumlusunun kimliği", blocks: [
        p("Veri sorumlusu, kimlik bölümünde yazılı [Şirket unvanı]’dır. Başvuru adresi [KVKK başvuru e-postası] ve [KEP adresi]’dir."),
      ]},
      { id: "amac-hukuki", title: "İşleme amaçları ve hukuki sebepler", blocks: [
        ul([
          "Üyelik, kimlik doğrulama, sözleşme ve destek: md. 5/2-c.",
          "Fatura, stopaj bilgisi, ticari defter ve saklama: md. 5/2-ç ve md. 5/2-a (kanunlarda öngörülme) ölçüsünde.",
          "Dolandırıcılık, güvenlik, uyuşmazlık ve delil: md. 5/2-e ve md. 5/2-f.",
          "Hizmetin çalışması için zorunlu işlem kayıtları ve çerezler: md. 5/2-c veya md. 5/2-f.",
          "Pazarlama iletisi, zorunlu olmayan yurt dışı aktarım ve isteğe bağlı yapay zekâ özellikleri: md. 5/1 açık rıza. Rıza vermemeniz üyeliği tek başına engellemez.",
        ]),
      ]},
      { id: "toplama", title: "Toplama yöntemi", blocks: [
        p("Veriler; üyelik formu, davet, panel, çerez, Meta webhook’ları, ödeme bildirimleri ve destek yazışmalarıyla otomatik veya kısmen otomatik yollarla toplanır."),
      ]},
      { id: "aktarim", title: "Kimlere ve hangi amaçla aktarılır", blocks: [
        p("Aktarım; işin ifası için marka, ajans ve influencer arasında, barındırma (AWS), yapay zekâ sağlayıcıları (fal.ai, Amazon Bedrock), Meta (WhatsApp, Instagram, Messenger), ödeme ve e-posta altyapısı ile kanunen yetkili kamu kurumlarına yapılır. Amaç, gizlilik politikasındaki amaçlarla sınırlıdır."),
      ]},
      { id: "yurtdisi", title: "Yurt dışına aktarım", blocks: [
        p("KVKK md. 9, 12 Mart 2024 tarihli 7499 sayılı Kanun ile değişmiştir. Aktarım; Kurul’un yeterlilik kararına, uygun güvencelere (standart sözleşme, bağlayıcı şirket kuralları veya yazılı taahhüt) veya md. 9’daki istisnai hâllere dayanır. Standart sözleşme Kurul’a bildirilir. AWS Frankfurt bölgesi Avrupa Ekonomik Alanı içindedir; Meta, fal.ai ve Bedrock aktarımları bu güvenceler veya açık rıza ile yapılır. Ayrıntı gizlilik politikasındadır."),
      ]},
      { id: "haklar", title: "İlgili kişinin hakları (md. 11)", blocks: [
        ul([
          "İşlenip işlenmediğini öğrenme, işlenmişse bilgi isteme.",
          "Amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme.",
          "Yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme.",
          "Eksik veya yanlış işlenmişse düzeltilmesini ve bu düzeltmenin aktarılanlara bildirilmesini isteme.",
          "KVKK md. 7’deki şartlar çerçevesinde silinmesini veya yok edilmesini isteme.",
          "Otomatik analizin aleyhe bir sonuca yol açmasına itiraz etme.",
          "Kanuna aykırı işlemden zarar doğarsa giderilmesini talep etme.",
        ]),
        p("Başvurular Tebliğ’deki usule uygun yapılır. Nordvow, talebi niteliğine göre en kısa sürede ve en geç otuz gün içinde sonuçlandırır. İşlemin ayrıca bir maliyet gerektirmesi hâlinde Kurul’un tarifesindeki ücret istenebilir. Yanıtı yetersiz bulan kişi Kurul’a şikâyet edebilir."),
      ]},
    ],
  },
  consent: {
    title: "Açık Rıza Metni",
    intro: "Bu metin isteğe bağlıdır. Onay kutusunu işaretlemezseniz üyelik ve sözleşmenin ifası için zorunlu işlemler devam eder. Rızanızı dilediğiniz zaman, gerekçe göstermeden geri alabilirsiniz. Geri alma, geri almadan önceki hukuka uygun işlemi ortadan kaldırmaz.",
    sections: [
      { id: "konu", title: "Rızanın konusu", blocks: [
        ul([
          "Nordvow ve iş birliği yapılan markalar adına ticari elektronik ileti gönderilmesi için ayrıca /ileti-izni metni geçerlidir. Bu açık rıza, ileti onayının yerine geçmez.",
          "Kişisel verilerinizin, sözleşmenin ifası veya hukuki sebeple zorunlu olmayan ölçüde yurt dışındaki Meta, fal.ai ve Amazon Bedrock altyapılarına aktarılması.",
          "Brief, içerik önerisi, görsel veya video üretimi gibi isteğe bağlı yapay zekâ özelliklerinde prompt ve yüklediğiniz dosyanın bu sağlayıcılarda işlenmesi.",
          "Ürün geliştirme amacıyla, kimliğinizden arındırılamayan kullanım verisinin hizmet iyileştirmesinde kullanılması. Tamamen anonim istatistik için rıza aranmaz.",
        ]),
      ]},
      { id: "ozgurluk", title: "Özgür irade", blocks: [
        p("Rıza; sözleşmenin kurulmasının ön şartı yapılmamıştır, önceden işaretli kutu ile alınmaz ve aydınlatma metninin içine gizlenmez. Rızayı [KVKK başvuru e-postası] adresine yazarak geri alabilirsiniz. Geri alma üzerine ilgili isteğe bağlı işleme durdurulur; kanuni saklama süreleri saklıdır."),
      ]},
    ],
  },
  cookies: {
    title: "Çerez Politikası",
    intro: "Bu politika, Kişisel Verileri Koruma Kurulu’nun çerez uygulamalarına ilişkin ilke kararı ve rehberleri ile KVKK’ya uygun olarak hazırlanmıştır. Çerez, siteyi ziyaret ettiğinizde tarayıcınıza kaydedilen küçük metin dosyasıdır. Benzer amaçla yerel depolama da kullanılabilir.",
    sections: [
      { id: "tur", title: "Çerez türleri", blocks: [
        ul([
          "Zorunlu çerezler: oturum (authjs.session-token), güvenlik (authjs.csrf-token), giriş sonrası dönüş (authjs.callback-url), çıkış bayrağı (nv_logout), dil ve ülke (nv_locale, nv_country) ve çerez tercihi. Hukuki sebep KVKK md. 5/2-c veya md. 5/2-f’dir. Bunlar olmadan giriş ve güvenlik sağlanamaz; rıza aranmaz.",
          "İşlevsel çerezler: tema tercihi (infl-theme) ve sekme süresince asistan taslağı. Hizmetin temelini etkilemez. İlk ziyarette tercih sorulur; reddederseniz varsayılan tema kullanılır.",
          "Analitik, reklam ve üçüncü taraf takip çerezi kullanılmaz. İleride eklenirse bu politika güncellenir ve ayrıca açık rıza alınır; kutu önceden işaretli olmaz.",
        ]),
      ]},
      { id: "sure", title: "Süreler", blocks: [
        ul([
          "Oturum çerezleri: tarayıcı oturumu veya en geç on iki saat.",
          "Dil, ülke ve çerez tercihi: en fazla bir yıl.",
          "Tema: en fazla bir yıl.",
        ]),
      ]},
      { id: "yonetim", title: "Tercih ve tarayıcı", blocks: [
        p("Zorunlu olmayan çerezleri çerez bildirimindeki seçimle kapatabilirsiniz. Tarayıcı ayarlarından çerezleri silebilir veya engelleyebilirsiniz. Zorunlu çerezleri engellemek giriş yapmanızı durdurabilir. Üçüncü taraf sitelerin çerezleri o sitelerin politikasına tabidir."),
      ]},
    ],
  },
  deletion: {
    title: "Veri silme",
    intro: "Hesabınızdaki veya Meta (Facebook, Instagram, WhatsApp, Messenger) üzerinden platforma iletilen kişisel verilerin silinmesini bu sayfadaki usulle isteyebilirsiniz. Meta’nın kendi sunucularındaki kopyalar için ayrıca Meta’nın silme araçlarını kullanmanız gerekir.",
    sections: [
      { id: "adim", title: "Talep nasıl yapılır", blocks: [
        ol([
          "Konu satırına “Veri silme” yazarak [KVKK başvuru e-postası] veya root@nordvow.com adresine gönderin. Hesap e-postanızı ve varsa Meta kullanıcı kimliğinizi yazın.",
          "Meta uygulamasındaki “Verilerimi sil” akışı, imzalı bir istek olarak /api/meta/data-deletion adresine düşer. Nordvow, META_APP_SECRET ile imzayı doğrular ve size bir onay kodu ile bu sayfanın bağlantısını döner.",
          "Onay kodunu bu sayfanın adresindeki kod parametresiyle açtığınızda talebin alınıp alınmadığı görünür.",
        ]),
      ]},
      { id: "surec", title: "Ne silinir, ne saklanır", blocks: [
        p("Yasal saklama yükümlülüğü olmayan profil, mesaj ve içerik verileri en geç otuz gün içinde silinir veya anonimleştirilir. Vergi, fatura, denetim ve uyuşmazlık kayıtları kanuni süre boyunca tutulabilir. Silme, marka ile influencer arasındaki sözleşme borçlarını düşürmez."),
      ]},
      { id: "meta", title: "Meta kanalları", blocks: [
        p("Webhook ile gelen mesajlar, hesap bağlantı belirteçleri ve ilgili kişi kayıtları silme kapsamındadır. Meta altyapısındaki kopya Nordvow’un sisteminden silinmekle Meta’dan silinmiş olmaz."),
      ]},
    ],
  },
  influencer: {
    title: "Influencer Hizmet Şartları",
    intro: "Bu metin, Platform Kullanım Sözleşmesi’nin parçasıdır. Çelişkide, tüketici işlemi değilse bu metin influencer’a özgü konularda önceliklidir.",
    sections: [
      { id: "ifa", title: "İfa", blocks: [
        p("Teklifi kabul etmek, brief’teki platform, format, tarih, etiket ve yasaklı ifadelerle bağlı bir iş üstlenmektir. İçerik, kararlaştırılan tarihte yayımlanır ve kararlaştırılan süre boyunca yayında kalır. Nordvow, markanın veya influencer’ın ifasını garanti etmez."),
      ]},
      { id: "reklam", title: "Reklam açıklaması", blocks: [
        p("Her menfaatli paylaşımda 23/A uyarınca reklam olduğu ilk bakışta anlaşılır. “#reklam”, “#işbirliği” veya mevzuatın aradığı eşdeğer ibare ve platformun ücretli ortaklık etiketi kullanılır. Reklam Kurulu’nca yanıltıcı sayılan sağlık, gelir ve “herkeste etki” iddiaları yasaktır. İhlal, içeriğin reddi, kampanyadan çıkarma ve hakedişin kesilmesi sonucunu doğurabilir. İdari para cezasının muhatabı kural olarak reklam veren ve mecra ile birlikte içerik üreticisidir; Nordvow bu cezayı üstlenmez."),
      ]},
      { id: "ucret", title: "Ücret", blocks: [
        p("Bedel teklifte yazılıdır. Nordvow komisyonu ayrıca gösterilir. Ödeme, işin kurallara uygun tamamlanması, bekleme süresi ve vergi profilinin uygunluğuna bağlıdır. IBAN ve vergi bilgisinin yanlışlığından influencer sorumludur. Erken silme veya etiket ihlalinde Nordvow ve marka, hakedişi orantılı olarak kesebilir."),
      ]},
      { id: "lisans", title: "Markaya verilen hak", blocks: [
        p("Aksi teklifte yazılmadıkça marka, içeriği kampanya süresince ve sonrasında kararlaştırılan kanallarda, bedeli içinde kullanır. Sürenin veya kanalın genişletilmesi yeni bedel gerektirir. Nordvow’a verilen platform lisansı saklıdır."),
      ]},
    ],
  },
  brand: {
    title: "Marka Hizmet Şartları",
    intro: "Bu metin, Platform Kullanım Sözleşmesi’nin parçasıdır. Çelişkide, tüketici işlemi değilse markaya özgü konularda bu metin önceliklidir.",
    sections: [
      { id: "brief", title: "Brief ve ürün", blocks: [
        p("Marka, brief’in, ürün iddiasının ve fiyatın doğru olduğunu; ürünün piyasaya arz ve reklam için gerekli izinlere sahip olduğunu beyan eder. Yanlış brief’ten doğan yeniden üretim ve üçüncü kişi talepleri markaya aittir."),
      ]},
      { id: "odeme", title: "Ödeme", blocks: [
        p("Marka, kabul edilen teklif ve Nordvow komisyonunu vadesinde öder. Gecikmede Nordvow hizmeti askıya alabilir ve kanuni temerrüt faizi isteyebilir. Chargeback ve hatalı ters ibraz markaya rücu edilir."),
      ]},
      { id: "iletisim", title: "Ticari ileti ve Meta", blocks: [
        p("Marka, kendi müşterilerine ticari elektronik ileti göndermeden önce İYS ve 6563 sayılı Kanun’a uygun onayı bulundurmakla yükümlüdür. Nordvow’un teknik engeli, markanın hukuki sorumluluğunu kaldırmaz. Meta yaptırımı (hesap düşmesi, şablon reddi) Nordvow’un borcu değildir."),
      ]},
      { id: "hak", title: "Marka varlıkları", blocks: [
        p("Marka, logosu, ürün görseli ve metni üzerinde hak sahibi olduğunu veya alt lisans verebildiğini kabul eder. Aksi ortaya çıkarsa Nordvow’u tazmin eder."),
      ]},
    ],
  },
  distance: {
    title: "Mesafeli Satış Sözleşmesi",
    intro: "Bu metin, Nordvow’un tüketiciye mesafeli olarak sattığı etkinlik bileti, kupon, hediye çeki veya dijital kredi için 6502 sayılı Kanun ve Mesafeli Sözleşmeler Yönetmeliği kapsamında düzenlenir. Marka ile influencer arasındaki ticari iş birliği bu metnin kapsamında değildir.",
    sections: [
      { id: "taraf", title: "Taraflar ve konu", blocks: [
        p("Satıcı Nordvow’dur ([Şirket unvanı], [Merkez adresi], [Destek e-postası], [Telefon], [MERSİS numarası]). Alıcı, siparişi veren tüketicidir. Konu, sipariş anında gösterilen bilet, kupon veya dijital hizmettir. Toplam bedel, vergiler dahil, ödeme adımında teyit edilir."),
      ]},
      { id: "ifa", title: "İfa", blocks: [
        p("Elektronik bilet ve kupon, ödemenin onayından sonra gecikmesiz ve en geç kanuni süre içinde hesabınıza veya e-postanıza teslim edilir. Etkinliğin tarihi, yeri ve ifa zamanı sipariş özetinde yer alır."),
      ]},
      { id: "cayma", title: "Cayma hakkı ve istisna", blocks: [
        p("Kanuni süre on dört gündür. Ancak Mesafeli Sözleşmeler Yönetmeliği md. 15/1-g uyarınca, belirli bir tarihte veya dönemde yapılması gereken eğlence veya dinlenme amacıyla boş zamanın değerlendirilmesine ilişkin sözleşmelerde cayma hakkı yoktur. Tarihli etkinlik bileti bu istisnaya girer; bilet devri etkinlik kurallarına tabidir."),
        p("Kupon ve hediye çeki, henüz kullanılmamışsa on dört gün içinde cayılabilir. Kullanılmış veya üçüncü kişiye devredilmiş çek için cayma hakkı, ifanın tüketicinin onayıyla başlaması hâlinde düşebilir. Dijital kredide ifaya, tüketicinin cayma hakkını kaybedeceğini bildiği açık onayıyla başlanmışsa cayma hakkı kullanılamaz."),
        p("Cayma, [Destek e-postası] adresine açık bir beyanla yapılır. Bedel, bildirimin Nordvow’a ulaşmasından itibaren on dört gün içinde, tahsilatta kullanılan araca uygun şekilde iade edilir. Kanunen iade edilemeyen bedel ayrıca gösterilir."),
      ]},
      { id: "uyusmazlik", title: "Uyuşmazlık", blocks: [
        p("Tüketici, yerleşim yerindeki veya işlemin yapıldığı yerdeki tüketici hakem heyetine ve tüketici mahkemesine başvurabilir. Parasal sınırlar her yıl ilan edilen tarifeye tabidir."),
      ]},
    ],
  },
  refund: {
    title: "İade ve iptal",
    intro: "Bu metin, mesafeli satışla alınan bilet, kupon ve dijital kredinin iade ve iptal şartlarını açıklar. Ticari kampanya bedelleri Platform Kullanım Sözleşmesi’ndeki iade kuralına tabidir.",
    sections: [
      { id: "bilet", title: "Etkinlik bileti", blocks: [
        p("Belirli tarihli etkinlik biletinde kanuni cayma hakkı yoktur. Nordvow veya düzenleyen etkinliği iptal ederse, kullanılmamış bilet bedeli tahsilat aracına iade edilir. Tüketicinin katılmaması, biletin üçüncü kişiye süresinde iletilmiş olması veya etkinlik kurallarına aykırılık iade sebebi değildir. Ertelemede bilet yeni tarih için geçerli kalır; tüketici yeni tarihte katılamayacağını bildirirse bedel iade edilir."),
      ]},
      { id: "kupon", title: "Kupon ve hediye çeki", blocks: [
        p("Kullanılmamış kupon, teslimden itibaren on dört gün içinde iade edilebilir. Kısmen veya tamamen kullanılmış, süresi dolmuş veya kampanyaya özel olarak kişiye tanımlanmış ve ifası başlamış kodlarda iade, kanunen zorunlu değilse yapılmaz. Nordvow’un kusuruyla kodun hiç teslim edilmemesi halinde bedelin tamamı iade edilir."),
      ]},
      { id: "kredi", title: "Dijital kredi", blocks: [
        p("Henüz harcanmamış kredi, cayma şartları varsa iade edilir. Harcanmış üretim, açılmış bekleme (hold) ve üçüncü kişi model maliyetine dönüşmüş tutar iade edilmez. Hatalı çift tahsilat Nordvow tarafından düzeltilir."),
      ]},
      { id: "usul", title: "Başvuru", blocks: [
        p("İade talebi [Destek e-postası] adresine, sipariş numarası ve hesap e-postası ile yapılır. Onaylanan iade, aynı ödeme aracına ve on dört gün içinde gönderilir. Bankanın yansıtma süresi Nordvow’un süresine dahil değildir."),
      ]},
    ],
  },
  iys: {
    title: "Ticari elektronik ileti onayı",
    intro: "6563 sayılı Kanun ve Ticari İletişim ve Ticari Elektronik İletiler Hakkında Yönetmelik uyarınca, ticari elektronik ileti için ayrı onay gerekir. Bu onay sözleşme kabulünün içine gizlenmez ve önceden işaretli değildir. Onay vermemeniz platformu kullanmanızı engellemez.",
    sections: [
      { id: "kapsam", title: "Kim, ne gönderebilir", blocks: [
        p("Onay verirseniz Nordvow; kampanya duyurusu, ürün ve hizmet tanıtımı ile anketleri e-posta, SMS, arama ve WhatsApp üzerinden gönderebilir. İletide gönderenin kimliği ve ret imkânı bulunur. İşlemin ifası için zorunlu servis iletileri (şifre, fatura, güvenlik, sözleşme bildirimi) bu onaya bağlı değildir."),
      ]},
      { id: "iys", title: "İYS ve ret", blocks: [
        p("Onay, reddetme hakkınız saklı kalmak üzere İleti Yönetim Sistemi’ne kaydedilir. Ret, İYS üzerinden veya iletideki ret yöntemiyle ya da [Destek e-postası] adresine yazılarak verilebilir. Ret, Nordvow’a ulaştıktan sonra en geç üç iş günü içinde işlenir. Ret, önceki hukuka uygun gönderimi geri almaz."),
      ]},
      { id: "sure", title: "Süre", blocks: [
        p("Onay, geri alınana kadar geçerlidir. Nordvow, mevzuatın aradığı saklama süresi boyunca onay kaydını tutar."),
      ]},
    ],
  },
};
