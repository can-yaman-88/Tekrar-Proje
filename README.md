# Tekrar

Mühendislik öğrencileri için çalışma planlayıcısı. İzlence (syllabus) PDF'inden dersleri,
haftalık konuları ve sınav tarihlerini çıkarır; haftalık görev planı üretir; her akşam
yazdığın serbest metinden ne yaptığını anlayıp planı günceller.

## Ne nerede

| Katman | Yer |
|---|---|
| Uygulama (Expo Router ekranları) | `src/app` — yalnızca yönlendirme, iş mantığı yok |
| Sayfalar / widget'lar / özellikler / varlıklar | `src/pages`, `src/widgets`, `src/features`, `src/entities` |
| Ortak altyapı (Supabase, React Query, tema, hata yönetimi) | `src/shared` |
| Başlangıç kurulumları | `src/core` |
| Veritabanı şeması ve RLS | `supabase/migrations` |
| Sunucu tarafı yapay zekâ | `supabase/functions` |
| Paylaşılan Zod sözleşmeleri | `supabase/functions/_shared/contracts` (uygulama `@contracts/*` ile kullanır) |

Katmanlar arası import yönü ESLint ile zorunlu tutulur: `routes → core → pages → widgets →
features → entities → shared → contracts`. Ters yönde bir import derlemeyi değil, lint'i kırar.

## Geliştirme

```fish
npm install
npx supabase start                                               # yerel veritabanı + API
npx supabase functions serve --env-file supabase/functions/.env  # yapay zekâ fonksiyonları
npx expo run:android                                             # geliştirme derlemesi
```

`.env` (uygulama, `.env.example`'dan kopyala):

```
EXPO_PUBLIC_SUPABASE_URL=http://10.0.2.2:54321   # Android emülatörü için ana makine
EXPO_PUBLIC_SUPABASE_ANON_KEY=...                 # npx supabase status
```

`supabase/functions/.env` (sunucu sırları, uygulamaya gömülmez):

```
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=...
LLM_MODEL=google/gemini-2.5-flash   # yapılandırılmış çıktı desteği şart
```

Demo veri: `docker exec -i supabase_db_tekrar psql -U postgres < supabase/scripts/demo-data.sql`

## Kontroller

```fish
npx tsc --noEmit        # tip kontrolü
npx expo lint           # katman sınırları dahil
npx jest                # alan (domain) ve altyapı testleri (ayar: jest.config.js)
npx expo-doctor         # bağımlılık uyumu
npx supabase test db    # RLS ve veri bütünlüğü testleri (pgTAP, 123 test)
```

Edge Function testleri (Deno kurulu değilse Docker ile):

```fish
cd supabase/functions/_shared; and deno test; cd -               # ortak alan mantığı
# her fonksiyon kendi deno.json'uyla, kendi klasöründe denetlenir
for fn in daily-checkin generate-weekly-plan ingest-syllabus llm-models
  cd supabase/functions/$fn; and deno check index.ts; and deno test --allow-all; cd -
end
docker run --rm -v (pwd)/supabase/functions:/fn -w /fn/daily-checkin denoland/deno:latest deno test planner.test.ts
```

**CI** (`.github/workflows/ci.yml`) her push ve PR'da üç işi koşar: uygulama (`npm ci`, tsc,
lint, Jest), Edge Functions (Deno testleri ve tip kontrolü) ve veritabanı (`supabase start`,
`supabase test db`; ardından `supabase gen types` çıktısı depodaki tiplerle karşılaştırılır,
fark varsa uyarı verir).

## Bilgisayardan bağımsız kullanım (barındırılan Supabase)

Yerel Supabase yalnızca bilgisayar açıkken ve aynı ağdayken çalışır. Telefonun her yerde
çalışması için backend'i buluta taşı — ücretsiz kademe kişisel kullanım için yeterli.

```fish
# 1. supabase.com'da hesap aç ve bir proje oluştur (bölge: Frankfurt önerilir)
npx supabase login                      # tarayıcıda onay ister
npx supabase link --project-ref <ref>   # panodaki Project ID

# 2. Şema + fonksiyonlar + sırlar
npm run deploy:backend

# 3. Uygulama ayarları (panodan: Project Settings → API)
cp .env.production.example .env.production   # URL ve anon key'i yaz

# 4. Bağımsız APK
npm run apk
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

`npm run deploy:backend` şunları yapar: migration'ları gönderir, `supabase/functions/.env`
içindeki yapay zekâ anahtarlarını proje sırrı olarak ayarlar, Edge Function'ları yayına alır.

**Sıra önemli:** yeni uygulama sürümü yeni RPC'leri (`set_task_status`, `skip_tasks`,
`register_push_token`, `report_app_error` …) çağırır. Önce `npm run deploy:backend`, sonra APK.
Şema değiştiyse `npm run db:types` ile tipleri yeniden üret.

Panoda bir kez yapılacak ayar: **Authentication → Providers → Email**. E-posta onayı açıksa
kayıt olurken gelen bağlantıya tıklaman gerekir; kapatırsan doğrudan giriş yaparsın.

> Ücretsiz projeler bir hafta hiç kullanılmazsa duraklatılır; panoyu açmak yeniden başlatır.

## Telefona yükleme

Yayın derlemesi Metro'ya ihtiyaç duymaz; JavaScript paketi APK'nın içindedir.

```fish
cd android
set -x ANDROID_HOME $HOME/Android/Sdk
set -x JAVA_HOME /usr/lib/jvm/java-17-openjdk
set -x EXPO_PUBLIC_SUPABASE_URL https://<proje>.supabase.co
set -x EXPO_PUBLIC_SUPABASE_ANON_KEY <anon key>
./gradlew assembleRelease
```

APK: `android/app/build/outputs/apk/release/app-release.apk`

Kurulum: `adb install -r android/app/build/outputs/apk/release/app-release.apk`
ya da dosyayı telefona kopyalayıp açarak.

Kısayol: `npm run apk` (barındırılan proje, `.env.production`) veya
`npm run apk:local` (yerel sunucu, şifresiz HTTP izniyle).

**Yerel Supabase'e bağlanacaksan iki şey gerekir:**

1. Adres bilgisayarının yerel ağ IP'si olmalı (`ip -4 addr`), `127.0.0.1` değil. Telefon ve
   bilgisayar aynı Wi-Fi ağında olmalı.
2. Android, yayın derlemelerinde şifresiz HTTP'yi engeller. Yalnızca yerel test için:
   ```fish
   set -x TEKRAR_ALLOW_CLEARTEXT 1
   npx expo prebuild --platform android
   ./gradlew assembleRelease
   ```
   Barındırılan Supabase projesi HTTPS olduğu için bu ayara gerek kalmaz; açık bırakma.

> APK, Android'in geliştirme anahtarıyla imzalanır. Kişisel kullanım için yeterlidir;
> mağazaya yükleyecekseniz kendi anahtarınızı üretin
> (`android/app/build.gradle` → `signingConfigs`).

## Kendi kendine çalışan kısımlar

**Haftalık plan pazartesileri kendiliğinden üretilir.** Bulut veritabanındaki cron işi
(`weekly-plan`, pazartesi 05:00 UTC) her profil için `generate-weekly-plan` çağırır. Kurulum
tek seferlik: `configure_weekly_plan_cron(url, service_key)` fonksiyonunu servis anahtarıyla
çağırmak yeterli — anahtar Vault'ta saklanır, cron komutunda görünmez. (Bu iş daha önce pg_net'te
olmayan `extensions.net_http_post`'u çağırdığı için hiç çalışmıyordu; artık `net.http_post`.)
Plan, öğrencinin kendi saat dilimindeki haftaya göre kurulur (`user_today`).

**Henüz işlenmemiş konu planlanmaz.** Bir dersin dönem başlangıcı biliniyorsa (ders sayfası →
**Dönem haftası**: "bu hafta kaçıncı hafta?" sorusuna verilen cevaptan hesaplanır) haftalık plan
o haftadan sonraki konulara dokunmaz; bu hafta işlenen konu da ilk ders gününden önceye konmaz.
Planın notu kaç konunun bu yüzden bekletildiğini söyler. Dönem başlangıcı girilmemiş derste
eski davranış sürer.

**Günlük bütçe ölçülür, varsayılmaz.** Son 6 haftada gerçekten yaptığın iş gün gün ortalanır:
pazartesi 45 dakika, cumartesi 180 dakika gibi. Plan her günü kendi bütçesine göre doldurur.
Hesap bütün planlayıcılarda (uygulama, haftalık plan, değerlendirme) aynı fonksiyondan geçer
(`_shared/domain/capacity.ts → resolveCapacity`), bu yüzden kart ile plan hiçbir zaman ayrışmaz:

- Geçmiş, **ilk çalıştığın günden** başlar; uygulamayı kullanmadan önceki haftalar sıfır sayılmaz.
- Son haftalar eski haftalardan daha ağır basar (haftalık 0,85 azalma).
- Süre tuttuğun görev gerçek dakikasıyla, tutmadığın görev tahminiyle sayılır — aynı saat iki kez
  sayılmaz; alt adımlı ödevin kapsayıcısı ayrıca sayılmaz; tahmini olmayan iş 30 dk sayılır.
- Günler senin saat diliminle hesaplanır (uygulama telefonun saat dilimini profile yazar);
  "pazartesi şunu bitirdim" diye geriye dönük bildirdiğin iş o güne tarihlenir.
- Yeterince görülmemiş gün uydurma bir sayıyı değil, **genel temponu** alır; hiç geçmiş yoksa
  gün **150 dakika** sayılır.
- Ders saati yalnızca tahmini bütçeden (genel tempo ya da varsayılan) düşülür — saatin yarısı
  kadar; öğrenilmiş bir gün zaten derslerinle birlikte yaşadığın gerçek gündür, kendi sayın da
  senindir.
- Ders ne kadar yoğun olursa olsun tahmini gün **en az 60 dakika** — bir konsept + Feynman
  oturumu — tutar (eskiden 30'du ve dört dersli bir hafta içi günü hiçbir oturumu alamıyordu);
  ama bu taban günün kendi bütçesini aşmaz, kapattığın gün kapalı kalır.

Ayarlar'daki **Günlük çalışma kapasiten** kartı her günün sayısını ve nereden geldiğini gösterir
(öğrenildi / senin sayın / genel tempon / varsayılan / kapalı). Bir güne dokunup **Otomatik ·
Elle · Kapalı** seçebilirsin: elle girdiğin dakika (15–600) bütün planlayıcılarda geçerlidir.

**Hafta ortasında yenilenen plan bugünden başlar.** Plan geçmiş günlere iş koymaz: telefon kendi
tarihini gönderir, plan o günden itibaren kurulur. Geçmiş günlerde dokunmadığın plan görevleri
kaldırılır ve konuları bugünden itibaren yeniden planlanır — kaçırdığın iş kaybolmaz, öne gelir.
Pazartesi sabahki otomatik plan için "bugün" zaten pazartesidir.

**Konular izlence sırasıyla ele alınır.** Eşit öncelikteki konulardan hangisinin önce
planlanacağına, hangisinin sınav planında önce geleceğine ve "konu sırasına göre diz" dendiğinde
nasıl dizileceğine konunun izlencedeki yeri karar verir: işlendiği hafta, sonra o haftadaki sırası.
Konu adının alfabetik sırası hiçbir yerde kullanılmaz. (Eskiden eşitlik alfabeyle bozuluyordu:
6. haftanın "Capacitance" konusu, 2. haftanın "Electric charge"ından önce planlanıyordu.)
Defter sekmesi de konuları her dersin içinde izlence sırasıyla gösterir.

**Ara verdiğin günler tek raporla kapanır.** Birkaç gün değerlendirme yazmadıysan Görevler
ekranında bir şerit çıkar. Tek metinde birden çok günü anlatabilirsin ("pazartesi kafesleri
bitirdim, salı hiç çalışamadım, dün Carnot'ta takıldım"); her cümle kendi gününe yazılır ve
tekrar takvimi işin gerçekten yapıldığı güne göre kurulur.

**Tekrar radarı** (Defter → Tekrarlar → Bütün konular): tekrar zamanı gelenler, bu hafta sırada
olanlar, zayıflayanlar ve hiç çalışılmamışlar tek ekranda. Her satır konunun kendi ekranını açar.

**Hatırlatma saati de öğrenilir.** Ayarlar → Hatırlatmalar → "Saati kendi öğrensin" açıkken
uygulama, zamanlayıcıyla ölçülen oturumların bittiği saate bakar ve her gün için ayrı bir
saat seçer (medyan + 1 saat, 17:00–23:00 arasına sıkıştırılmış). Bir günün en az iki ölçümü
yoksa genel ritmin, o da yoksa senin seçtiğin saat kullanılır.

**Bildirimden işaretleme.** Akşam hatırlatmasında iki düğme var: **Bitirdim** o an sırada olan
görevi kapatır, **Değerlendirme yaz** doğrudan değerlendirme ekranını açar. Bildirim günler
önce kurulmuş olabileceği için "Bitirdim" önce görevi sunucudan okur; görev bu arada
kapanmış ya da silinmişse dokunmaz, sana durumu söyler.

## Çalışma zamanlayıcısı

Görev ekranında **Çalışma süresi** kartı var: başlat–bitir ile gerçek süre ölçülür, ya da
15/25/45 dakikalık kısayollarla elle girilir. Sayaç sunucuda tutulur (`task_sessions`), yani
uygulamayı kapatsan da çalışır; aynı anda yalnızca bir sayaç açık olabilir, başka bir görevde
başlatırsan öncekini kapatır.

Ölçülen süre iki yere gider:

- **Kapasite ölçümüne.** Süre tuttuğun günlerde plan artık tahmine değil gerçek dakikaya
  bakar; tutmadığın günlerde tahmin devam eder (ikisi aynı güne birlikte yazılmaz).
- **Tahmin–gerçek karşılaştırmasına.** Görev kartı "Tahmin 25 dk, gerçek 38 dk" der; haftalık
  özet aynı karşılaştırmayı görev türü bazında gösterir.

## Sınav modu

Yaklaşan sınava dokununca (Görevler ekranındaki sınav kartı ya da ders sayfasındaki sınav
satırı) sınav ekranı açılır:

- **Konu hazırlığı**: sınava bağlı her konu için zayıf/orta/sağlam etiketi. Sıralama; biten
  çalışma adımları, kolaylık katsayısı, son başarısızlıklar ve tekrar tarihine göre hesaplanır.
- **Kalan günlerin planı**: sınava 7 günden az kaldıysa gün gün ne yapılacağı. Yarım kalan
  döngü sırayla tamamlanır (konsept → Feynman → sınav), döngüsü bitmiş sağlam konuya yalnızca
  hatırlama turu düşer. Sınav günü çalışma günü sayılmaz, sınavdan önceki akşam kısa tutulur.
  **Planı görevlere ekle** dediğinde bu adımlar gerçek göreve dönüşür; planı yeniden
  oluşturursan dokunulmamış eski sprint görevleri silinir, başladıkların korunur.
- **Sınav nasıl geçti?**: sınav geçtikten sonra tek soru + zorlandığın konuları işaretleme.
  Cevap, sınavın kapsadığı konuların tekrar takvimine SM-2 ile yazılır: kötü geçtiyse konular
  başa döner, iyi geçtiyse aralık uzar, işaretlediğin konu sınav iyi geçse de tekrara döner.
  Kalan sprint görevleri kapatılır.

## Haftalık özet

Hafta ekranındaki **Haftalık özet ›** bağlantısı (ya da pazar akşamı bildirimi) haftayı
özetler: biten/takılan görev sayısı, gün gün çalışma süresi, etiket dağılımı, tahmin–gerçek
sapması, zorlandığın konular ve gelecek haftanın tekrarları. Başlıktaki cümle sayıların
söylediğini söyler — düşük tamamlanmada nedenini de (az değerlendirme mi, fazla plan mı)
ayırır. Önceki haftalara da bakabilirsin.

## Ödevin günlere bölünmesi

Pazartesi teslimli bir ödev pazartesinin işi değil, hafta sonunun işidir. Uygulama ödevi
kendiliğinden günlere böler ve payı **o günün boşluğundan** hesaplar: günlük kapasiten 100 dakika
ama o gün 80 dakikalık concept/Feynman görevin varsa ödeve 20 dakika kalır, kalanı diğer günlere
yayılır. Dağıtım boşlukla orantılıdır (boş gün daha çok pay alır), 5 dakikaya yuvarlanır ve
çeyrek saatin altına düşen dilimler başka güne aktarılır — 6 dakikalık bir oturum kimseye
yaramaz.

Görev kartında bugünkü pay yazar: *"Bugün ~4 soru · 20 dk."* Payı olmayan gün o ödev listede
çıkmaz.

**Dağılımı elle ayarlayabilirsin.** Ödevin detayında gün gün bir tablo var: bir güne kendi
rakamını yazarsan o gün sabitlenir ve kalan iş diğer günlere yeniden dağılır; **0** yazmak o günü
kapatır; "Hepsi otomatik" her şeyi geri alır. Elle girdiğin gün kapasiteni aşsa bile uygulanır —
orada senin bilgin uygulamanınkinden iyidir. Teslim uyarısı da artık katlanabiliyor ve "bugün
için kapat" ile o günlüğüne susturulabiliyor. Pencere teslimden 7 gün önce açılır; kendin daha erken başlamak istersen görev
düzenlemede **Başlama günü** alanı var ("Bugünden başla" / "Otomatik").

Bu hesap iki yerde birden kullanılır: hem Görevler ekranındaki pay, hem de haftalık planlayıcının
bütçesi. Planlayıcı önce ödevlere yer ayırır, döngü adımlarını kalan boşluğa koyar — yani plan
ödevin üstüne iş yığmaz. Kapasite yetmiyorsa Görevler ekranının üstünde uyarı çıkar:
*"29 Eyl teslimli 'Fizik ödevi' için 4 sa 10 dk iş var; o güne kadar boş kapasiten 2 sa 30 dk.
1 sa 40 dk açık."*

Ödevler artık dördüncü bir etiket altında toplanıyor: **Concepts / Sınav / Feynman / Ödev**.
Etiket görevin türünden değil kaynağından gelir (rapordan ya da dosyadan gelen iş), bu yüzden
düzenleme ekranındaki etiket seçimi yine üç seçenektir.

## Doğru/yanlış takibi

"10 soru çözdüm" ile "10 soruda 6 doğru" aynı şey değil. Değerlendirmede doğru sayısını
söylediğinde bu `tasks.correct_count` olarak saklanır ve **tekrar aralığını güven puanı yerine
isabet belirler**: %90 üstü tam puan, %60 altı başarısız sayılır ve konu takvimde öne çekilir —
görev "tamamlandı" görünse bile. Görev kartında ilerleme etiketi "6/10 doğru" olur.

## Biriken işler

Planı aksatan bir hafta, listeyi borç yığınına çevirir — bu tür uygulamaları öldüren şey de
budur. Görevler ekranındaki **"N geciken ›"** sayısı artık tıklanabilir: 3 günden eski açık
işler tek ekranda toplanır ve iki dürüst cevaptan birini verirsin — **önümüzdeki 7 güne dağıt**
(en eski iş en erken boş güne, kapasiteye göre) ya da **kapat**. Hiçbir güne sığmayan iş zorla
yerleştirilmez, "şu kadar dakikalık iş sığmadı" diye söylenir.

## Gidişat

**Defter → Gidişat** (ve haftalık özetin sonundaki düğme) her ders için tek soruya cevap verir:
*bu hızla sınava yetişir miyim?* Ekranda ders başına kapsama (kaç konunun döngüsü bitti),
isabet oranı, sıradaki sınav ve kapsamdaki konuların kaçının hazır olduğu görünür; altında da
hüküm cümlesi:

> Vize 1 · 19 gün sonra: 7 konu kaldı, bu hızla yetişmez (şu anki hızın haftada 1.3, gereken 2.6).

Hız son üç haftanın ölçümüdür — en az iki biten konu yoksa **uydurulmaz**, "yeterli geçmiş yok"
denir. Geride olan ders listenin başına çıkar.

## Tekrar döngüsü

Bir konunun aralıklı tekrar takvimi (SM-2) artık yalnızca değerlendirmeyle değil, **uygulamada
görevi bitirdiğinde** de ilerler (`set_task_status`). Tiki geri alırsan o tekrar da geri alınır.
Kurallar uygulamada ve değerlendirmede aynıdır (`scheduleReview` / `apply_topic_review`):

- Bir konu günde **bir kez** sayılır; aynı gün akşamki rapor öğleden sonraki tiki ikinci kez saymaz.
  Başarısızlık ise her zaman sayılır.
- Vadesinden **önce** yapılan çalışma aralığı uzatmaz, saati yeniden başlatır.
- Takılırsan (ya da 1 puan verirsen) konu ertesi gün geri gelir.

Tekrar günü gelen konu kendiliğinden **Görevler** ekranına düşer: döngüsü bitmiş konuya Feynman
sayfası, ertesi gün sınav; yarım kalmış konuya döngünün sıradaki adımı. Her takvim tarihi için
bir kez üretilir, günün kalan bütçesi gözetilir, kapalı güne konmaz. Haftalık plan da tekrarı
vadesinden önceki bir güne koymaz.

Tekrar görevini bitirirken **"Nasıl geçti?"** diye 1–5 sorulur; bu puan konunun son güven
puanıdır. Ayarlar → Hatırlatmalar → **Tekrar zamanı** açıksa tekrar günü bildirim gelir:

- Derlemede EAS proje kimliği varsa (`EAS_PROJECT_ID`, aşağıya bak) ve bildirim izni verildiyse
  hatırlatma **sunucudan push** olarak gelir: saatlik `review-reminders` cron işi
  (`send_review_reminders`) her öğrencinin kendi saatinde, o gün vadesi gelen konuları — en zayıfı
  önce — tek bildirimde yollar. Uygulama haftalarca açılmasa da gelir. Bildirime dokunmak
  Defter'i açar. Çıkış yapınca cihazın kaydı silinir.
- Push yoksa (emülatör, kimliksiz derleme, çevrimdışı) hatırlatmalar eskisi gibi cihazda kurulur.

Push kurulumu tek seferlik:

1. `npx eas-cli@latest init` → verdiği proje kimliğini `.env.production`'a `EAS_PROJECT_ID=...`
   olarak yaz (`app.config.ts` bunu `extra.eas.projectId`'ye koyar).
2. Android FCM ile teslim eder: Firebase konsolunda `com.tekrar.app` için bir Android uygulaması
   ekle, `google-services.json`'u proje köküne koy (git'e girmez) ve `.env.production`'a
   `GOOGLE_SERVICES_JSON=./google-services.json` yaz. Ardından aynı Firebase projesinin servis
   hesabı anahtarını Expo'ya ver: `npx eas-cli@latest credentials` → Android → FCM V1.
3. İsteğe bağlı: Expo hesabında "Enhanced push security" açıksa erişim jetonunu Vault'a koy:
   `select vault.create_secret('<token>', 'expo_access_token');`

Bu adımlardan biri eksikse uygulama sessizce yerel hatırlatmalarda kalır; hiçbir şey kırılmaz.

Her sayılan tekrar `topic_review_events` tablosuna yazılır (gün, kaynak, kalite, güven, isabet,
aralığın önceki ve sonraki hali). Bir konuya dokunduğunda **konu ekranı** açılır: sıradaki tekrar,
son çalışma, son güven puanı, son isabet, aralık / başarılı tekrar / kolaylık, bütün tekrar
geçmişi, takıldığın yerler ve konunun görevleri. Görev olmadan çalıştıysan **Bugün tekrar
ettim** ile kaydedersin. Değerlendirme sonucu da hangi konunun hangi güne yazıldığını söyler.

## Defter sekmesi

Alt sekmelerden biri **Defter**, iki bölümlü:

- **Tekrarlar**: geciken / bugün / bu hafta sayıları; konular gün gün, her birinde son çalışma,
  son güven, isabet ve aralığın ne kadarının geçtiği. Bildirimler kapalıysa açmayı önerir.
- **Takıldığım yerler**: ders › konu olarak gruplanmış hata defteri. Açık / çözülen / hepsi
  filtresi, arama ve ders çipleri; her maddede kayıt günü, nereden geldiği ve hangi görevde
  takıldığın. **✓ Çözdüm** bildirimdeki **Geri al** ile geri alınır, çözülen madde **Geri aç**
  ile yeniden açılır; basılı tutunca düzenleme ve silme. Bir konuya elle madde eklenebilir.
  Hepsi anında görünür ve çevrimdışıyken de çalışır (bkz. Çevrimdışı davranış).

**Dersler** artık alt sekmede değil — dönemde birkaç kez gerektiği için **Ayarlar → Dersler ve
izlence** altında. Ders ekleme, izlence yükleme, ders programı ve tekrar radarı oradan açılır.

## Hata defteri

Değerlendirmede takıldığın yeri söylediğinde bu artık bir görev notuna gömülüp kaybolmuyor:
`topic_mistakes` tablosuna yazılıyor ve o konunun bir görevini açtığında **"Geçen sefer
takıldığın yerler"** başlığıyla karşına çıkıyor.

Takılıp **sonra çözdüğün** şeyler de yazılır ama **çözülmüş** olarak: "molde takıldım ama
kitaba bakınca çözdüm" dediğinde tekrar aralığın düşmez, telafi görevi doğmaz, madde de
"geçen sefer takıldığın yerler" listesinde çıkmaz — yalnızca defterin geçmişinde durur.

Kayıt iki parçalı: kısa bir **etiket** (gruplama için, "Mol hesapları") ve **senin kendi cümlen**
(okunacak olan). "Molde hesaplamalarda takıldım; birim çevirirken paydayı ters alıyorum" dersen
defterde aynen bu yazar — etikete sıkıştırılmaz. Aynı etiket altında farklı bir ayrıntı yeni bir
madde olur, birebir aynı cümle ikinci kez yazılmaz. Takıldığın yer ayrıca üretilen telafi
görevinin yönergesine de geçer ("Kendi notun: …"). Sınav modunda
da konu satırının altında en çok iki madde görünür. "Çözüldü" dediğinde madde kalır ama
gösterilmez. Aynı madde ikinci kez yazılmaz, konu başına en çok üç madde tutulur, ve
değerlendirmeyi geri alırsan o değerlendirmenin yazdığı maddeler de silinir.

## Grup görevler (alt adımlar)

Bir ödev çoğu zaman tek isim taşıyan üç iştir: 1-8 arası sorular, grafik, rapor. Bunlar tek kart
olarak görünür, adımlar kartın içinde tek tek işaretlenir. Ana görevin durumu kendi başına
değişmez — **adımlarından hesaplanır** (hepsi bitti → tamamlandı, biri geri alındı → devam
ediyor); bu veritabanı tetikleyicisiyle yürür, yani kim yazarsa yazsın tutarlı kalır.

Alt adımlar **her göreve açık değildir**. Yalnızca iki yoldan doğar: değerlendirmede bildirdiğin
**ödevler** ("üç bölümü var: …") ve **açık istek** ("fizik ödevini üç adıma böl"). Haftalık plan,
tekrar döngüsü, telafi görevleri ve sınav sprinti alt adım üretmez; konsept/Feynman/sınav
görevleri tek parça kalır. Tek seviye: alt adımın alt adımı olmaz, veritabanı buna izin vermez.

Alt adımı olan bir ödevde günlere bölme **adımlar üzerinden** yürür: her adım kendi gününü alır,
ana görev yalnızca kapsayıcıdır.

## Değerlendirmede silme ve değiştirme

Günlük değerlendirme yalnızca "şunu yaptım" demek için değil; planı düzeltmek için de kullanılır:

- **Silme**: "Statik dersinde hiçbir şey işlenmedi, ilk haftanın görevlerini sil". Model, kapsamı
  belirtildiği gibi uygular — ikinci haftanın görevlerine dokunmaz. Hiç dokunulmamış görev
  gerçekten silinir (tam bir anlık görüntüsü geri alma için saklanır); ilerleme, not ya da
  ölçülmüş süre taşıyan görev silinmez, yalnızca **kenara alınır** (atlandı). Yaptığını bildirdiğin
  bir görev aynı raporda silinmez.
- **Yerine koyma**: "İngilizce ödevi bu haftaki 3 görevi karşılar" ya da "ödevler soru çözme
  kısmını karşılıyor" dediğinde o görevler kaldırılır ve yerine ödev görevi geçer. Rapordan gelen
  ödev, haftalık planda hocanın materyali gibi sayılır: o konuda ayrıca otomasyon sınavı
  planlanmaz.
- **Günü boşaltma**: "Pazar gününü boşalt, o gün hiçbir şey yapamam, o günün görevlerini bugünden
  başlayarak dağıt". O günün açık işleri **silinmez, taşınır**: hangi güne gideceklerini kod
  hesaplar — senin öğrenilmiş günlük kapasiten, o günlerde zaten duran iş ve teslim tarihleri
  gözetilir. Teslim tarihli bir ödev asla teslimden sonraya atılmaz; yer varsa öne çekilir.
  Hiçbir yere sığmıyorsa en boş güne konur: kapattığın günde iş bırakmak en kötü seçenek.
  "Pazarları hiç çalışamıyorum" gibi tekrar eden bir cümle o günü **tamamen kapatır** — profilde
  saklanır, haftalık plan ve ödev bölüşümü o güne bir daha iş koymaz. Aynı şey Ayarlar →
  *Günlük çalışma kapasiten* kartında güne dokunarak da yapılır.
- **Tek görevi erteleme**: "Fizik ödevini pazartesiye al" o görevi o güne taşır; ne yapılmış
  sayılır ne de silinir.
- **Metinden ödev**: "4 dersten 4 ödev var, İngilizce yarın gece 12'ye kadar, diğerleri pazartesi"
  cümlesi dört göreve ve iki ayrı teslim tarihine dönüşür. Tarihi model değil kod hesaplar: model
  yalnızca "rapor gününden kaç gün sonra" der, onu da saymaz — istemdeki takvim tablosundan bakar
  (aşağıda). "15 Kasım'a kadar" gibi tablonun dışındaki bir tarihi olduğu gibi yazar, kod doğrular.

Değerlendirme ekranındaki görev listesi bu yüzden iki hafta ileriyi kapsar: "bu haftaki görevleri
sil" diyebilmen için o görevlerin modele gösterilmiş olması gerekir. Liste yüz görevle sınırlıdır ve
sınır dolduğunda **seçilir, kesilmez**: önce raporda adı geçen görevler, sonra rapor gününe yakın
açık işler, sonra yakın zamanda bitenler (düzeltme onlara gelir), en son pencerenin geri kalanı.
Eskiden en eski seksen görev alınıyordu; dolu bir haftada bu, iki haftalık bitmiş işin gelecek
haftanın görevlerini listeden itmesi demekti.

## Meşgul günün cümleleri

Yoğun bir öğrenci uzun rapor yazmaz; tek cümleyle bütün bir günü, bir dersi ya da haftanın şeklini
değiştirmek ister. Bunların hepsinde model yalnızca **hangi gün, hangi ders, ne kadar** olduğunu
söyler; hangi görevin nereye gittiğini kod, senin kapasitene ve çalışma döngüsüne göre hesaplar.

| Cümle | Ne olur |
|---|---|
| "Bugünkü her şeyi bitirdim" / "dünkü görevlerin hepsini yaptım" | O günün açık görevleri tamamlanır. Model görevleri tek tek saymaz; kod listeden okur. Öğrenme kartı adımlarından kapanır. |
| "Gauss hariç hepsini bitirdim" / "fizikteki her şeyi bitirdim" | Aynısı, istisna ya da dersle daraltılmış. Ayrıca anılan görev ("ama Carnot'ta 3 yanlışım vardı") kendi sonucunu alır. |
| "Bugün hiç çalışamadım" | O günün işleri **kopyalanmaz, taşınır**: sonraki günlere, kapasiteye ve teslim tarihlerine göre. |
| "Yarın sadece 1 saatim var" | Yarın 60 dakikayı tutar; sığmayan iş taşınır. Önce döngünün sonu gider (sınav, sayfadan önce), o gün teslimi olan ödev hiç gitmez. |
| "Önümüzdeki 3 gün yoğunum, hafiflet" | Sayı söylenmediği için model uydurmaz: her gün, o haftagününün öğrenilmiş kapasitesinin yarısını alır. |
| "Cumadan pazartesiye kadar yokum" / "3 gün hastayım" | Aralığın her günü boşaltılır, işler dağıtılır. |
| "Pazarları artık çalışabiliyorum" | Kalıcı olarak kapattığın gün yeniden açılır (profilde); geri alma eski hâline döndürür. |
| "Bu hafta kimyayı dondur" / "vize bitene kadar statiği ertele" | O dersin aralıktaki işi aralığın hemen sonrasına gider. Teslimi aralığın içinde olan ödev yerinde kalır ve bu söylenir. |
| "Yarın sadece fiziğe çalışacağım" / "bu hafta yalnızca vizelere odaklanacağım" | Tersi: diğer derslerin işi o günlerden çıkar. |
| "Yarın 20 türev sorusu çözeceğim" | Kendi planladığın iş: görev olur ama **ödev sayılmaz** (etiketi ödev değil, teslim koruması yok). |
| "Vize 5 Aralık'a ertelendi" | Takvim tarihi olduğu gibi yazılır; model altmış küsur günü kendisi saymaz. |
| "Yarın ne var?", "bu hafta ne kadar işim var?", "hangi ödevlerin teslimi yakın?", "vizeye kaç gün var?", "nerelerde zayıfım?", "geride kalan işim var mı?" | Cevabı model değil uygulama yazar — ve bu raporun yaptığı değişikliklerden **sonraki** plana bakarak: "pazarı boşalt, yarın ne var?" taşınmış işleri de sayar. |
| "Plan dışı 15 türev sorusu çözdüm, 12 doğru" | O gün **bitmiş** bir görev olur ("Ek çalışma: Türev — 15 soru"): kapasite ölçümüne ve haftalık özete girer, isabeti konunun tekrar takvimine yazılır, düşükse hata defterine not düşer. Süre söylendiyse ölçülmüş oturum olarak kaydedilir. |
| "Vizeden 65 aldım, Gauss'ta zorlandım" / "40 üzerinden 30" / "fizik vizesi kötü geçti" | Sınav ekranındaki "Sınav nasıl geçti?"nin aynısı: sınavın kapsadığı konular sınavın notuyla tekrar takvimine yazılır, zor diye anılan konu başarısız sayılır, kalan sprint görevleri kalkar. Puan söylendiyse his değil **puan** esas alınır; yüzdeyi model değil kod hesaplar. Henüz yapılmamış sınava sonuç yazılmaz. |
| "Fizik vizesi için plan çıkar" | Sınav ekranının **aynı** sprint planı (kod paylaşılır: `_shared/domain/cram-plan.ts`) görev olur; dokunulmamış eski sprint görevleri yerini bırakır. Yalnızca son 7 günde; daha erkense nedeni söylenir. |
| "Fizik ödevi acil" / "artık acil değil" | Görev acil işaretlenir: görev listesinde gecikmiş işlerin bile üstüne çıkar, üzerinde "Acil" yazar, günü süre sınırı ya da ders bekletme yüzünden boşaltılırken yerinde kalır. Görev ekranındaki **Acil olarak işaretle** düğmesi aynı işi elle yapar. |
| "Yarın 9'da fizik ödevini hatırlat" / "cuma akşamı quizi hatırlat" | Telefonda o gün ve saatte bildirim kurulur ("akşam" 19.00, saat yoksa 09.00). Değerlendirme geri alınırsa hatırlatması da iptal olur. |
| "Konsept ve Feynman'ı grupla" | Bir konunun konsept ve Feynman sayfası **öğrenme kartı** olur — haftalık planın yaptığıyla aynı kart — ve tek güne gelir: aynı oturum. Biri diğerinin "üst görevi" yapılmaz (öyle olunca konsept sayfası tek başına işaretlenemiyordu). Grup kartı, adımlarının raporun sonundaki gününde durur: "grupla ve bugüne al" dendiğinde kart dünde, adımları bugünde kalmaz. |
| "Grupları dağıt" / "şu grubu ayır" | Adımlar ayrı görev olur, boş kalan kart gider (üzerinde iş yapılmadıysa silinir, yapıldıysa kenara alınır). Aynı raporda yeniden gruplanabilir. Görev ekranındaki **Grubu dağıt** düğmesi aynısını elle yapar. |
| "Salı ile perşembenin görevlerini değiştir" | İki günün kartları yer değiştirir; teslimi geçecek ödev yerinde kalır ve söylenir. |
| "Görevleri izlencedeki konu sırasına diz, günlerdeki görev sayısı aynı kalsın" | Aralıktaki kartlar konu haftasına göre sıralanıp aynı gün yuvalarına yeniden dağıtılır: her gün yine aynı sayıda kart taşır. Teslimli ve acil işler yerinde kalır. |
| "Haftayı düzenle" / "aynı konunun konsept ve Feynman'ını aynı güne koy" | Hafta düzenleyicinin kuralları bütün aralığa uygulanır: konsept ile Feynman aynı güne ve tek karta, sınav Feynman'la aynı güne ya da sonrasına, dolu gün boşaltılır. |
| "Geciken işleri dağıt" / "geciken işleri kapat" | Gecikmiş bütün açık kartlar önümüzdeki haftaya kapasiteye göre dağıtılır ya da kapatılır. |
| "Vize 1 ilk beş haftayı kapsıyor" / "finalde Carnot da var" | Sınavın konuları ayarlanır; aynı rapordaki sonuç ya da sınav planı yeni listeyi okur. |
| "Tüm görevleri İngilizce yap" | Her göreve tek tek yeni ad (bir raporda 80 göreve kadar). |
| "Az önceki değerlendirmeyi geri al" | Bu rapordan hemen önceki değerlendirme (son iki gün içinde) Geçmiş ekranındaki geri almayla aynı şekilde geri alınır; raporun geri kalanı eski hâline dönmüş plana uygulanır. Yalnızca o bir rapor: tekrar denense bile daha eskisine uzanmaz. |

Bütün taşımalar **kart kart** yapılır: bir öğrenme görevi ile iki adımı aynı güne gider. (Gün
boşaltma eskiden satırları tek tek yerleştirdiği için bir kartın adımlarını ayrı günlere
bölebiliyordu.) Her taşıma sonunda yine döngü onarımından geçer: sınav Feynman gününün önüne
düşmez.

Değerlendirme ekranında sık yazılan dört cümle tek dokunuşla eklenir, **Neler yazabilirim?**
bölümü de bütün bu cümleleri örnekleriyle gösterir.

**Gece yarısından sonra yazılan rapor biten güne sayılır.** Saat 04.00'e kadar yazdığın rapor
dünün raporudur: "bugün 20 soru çözdüm" dünkü güne, "yarın vize var" sabah başlayacak güne gider.
Ekran bunu açıkça yazar.

### Sonuç ekranı: "Ne anladım"

Sonuç ekranı artık yalnızca "3 görev güncellendi" demez; raporun nasıl okunduğunu satır satır
yazar: *"Kafes seti" tamamlandı · 8 doğru*, *"Carnot seti": takıldın; telafi görevi yarın için
eklendi*, *"Gauss seti" → Perşembe 8 Eki*, *Kimya beklemede: bugün – Pazar 4 Eki*. Bir yanlış
okuma ancak gösterilirse yakalanır; yakalandığında Geçmiş → Değerlendirmeler'den geri alınır.
Satırları model değil kod yazar, yani listede yazan şey veritabanına söylenenin ta kendisidir.
Yapılamayanlar ("teslimi bu aralıkta olduğu için yerinde kaldı", "o gün için söylediğin süre
teslimi olan işe yetmiyor") ayrı bir kutuda durur. Sorduğun sorunun cevabı da burada çıkar.

Yanıtın tamamı değerlendirme kaydına da yazılır (`daily_logs.result`): bağlantı koptuğunda telefon
yalnızca sayıları değil, bu listeyi, cevapları ve kurulacak hatırlatmaları da oradan okur.

## Değerlendirmeyi geri alma

Günlük değerlendirme bir modelle okunur; yanlış anlaşılırsa Geçmiş → **Değerlendirmeler**
ekranından geri alınır. Her değerlendirme neyi değiştirdiğini gösterir (görev geçişleri, konu
tekrarları, üretilen ve kaldırılan görevler) ve geri alma işlemi görev durumlarını, çözülen
sayılarını ve tekrar takvimini eski haline döndürür; **silinen görevler anlık görüntülerinden
aynı kimlikle geri gelir**, o değerlendirmenin ürettiği ve sen dokunmadığın görevler silinir.
Taşınan görevler geldikleri güne, kapatılan gün de eski haline döner. Aynı değerlendirme ikinci
kez geri alınamaz.

**Kaydı silme.** Aynı ekranda her değerlendirme silinebilir. Silme, geri almanın yerine geçmez;
ikisinden hangisini istediğini sen söylersin:

- *Geri al ve sil* — önce plan eski haline döner, sonra kayıt gider. Güvenli olan bu.
- *Sadece kaydı sil* — plan olduğu gibi kalır, yalnızca kayıt silinir. Geri almanın dayandığı
  anlık görüntüler de kayıtla birlikte gittiği için bu **geri alınamaz**; onay metni bunu söyler.

Her iki durumda da o değerlendirmenin oluşturduğu görevler yerinde kalır (yalnızca hangi
değerlendirmeden geldikleri bilgisi düşer) ve ekleri depolamadan silinir.

## Model seçimi

Ayarlar sekmesinde **Yapay zekâ modeli** kartı var. Sunucu, sağlayıcının kataloğundan
yalnızca yapılandırılmış çıktı (strict JSON) destekleyen modelleri listeler; ücretsiz olanlar
başa gelir. Liste **kesilmez**: bu desteği olan bütün modeller gelir (bugün 400'den fazla).
Ekranda 40'ar model çizilir; **Daha fazla göster** ve **Tümünü göster** ile hepsine ulaşılır, arama
da bütün listede çalışır. (Eskiden liste 120'de kesiliyordu; ücretsizler başta ve ada göre dizili
olduğu için, adı alfabede geride kalan ücretli modellerin çoğu hiç seçilemiyordu.) Yapılandırılmış
çıktı veremeyen modeller listede yoktur: uygulamanın her çağrısı katı JSON bekler, onlarla her
değerlendirme hata verirdi. Seçtiğin model profiline yazılır ve üç akışta da (değerlendirme, izlence, haftalık
plan) kullanılır. "Seçili modeli dene" düğmesi gerçek bir çağrı yapıp modelin çalışıp
çalışmadığını söyler.

API anahtarı uygulamaya hiç girmez: liste de test de sunucudaki `llm-models` fonksiyonundan
geçer, telefona yalnızca model adları iner. Seçimini kaldırırsan proje varsayılanına
(`LLM_MODEL` sırrı) dönülür.

### Kendi OpenRouter anahtarın

Ayarlar → **Yapay zekâ anahtarı** kartından kendi OpenRouter anahtarını girebilirsin. O andan
sonra değerlendirme, izlence, haftalık plan ve model testi çağrıları senin hesabından geçer;
anahtar girilmemişse sunucudaki proje anahtarı kullanılır.

Anahtar tek yönlü ilerler: uygulamadan veritabanına gider, orada **Vault** içinde şifreli
saklanır (`set_llm_api_key`), ve yalnızca servis anahtarıyla çalışan Edge Function onu geri
okuyabilir (`read_llm_api_key`, `authenticated` rolünden yetkisi alınmıştır). Uygulama anahtarı
bir daha göremez — profilde yalnızca son dört karakteri ve eklenme tarihi tutulur, kutucuk da
bu yüzden her zaman boş açılır. "Sil" dersen hem Vault kaydı hem bu iz silinir.

İstek başına ayrılan çıktı sınırı `LLM_MAX_OUTPUT_TOKENS` sırrıyla ayarlanır (varsayılan 8192).
Bu sınır açıkça gönderilmezse OpenRouter modelin bütün çıktı penceresini (on binlerce token)
rezerve eder ve bakiye bunu karşılamıyorsa isteği **402** ile reddeder — üstelik bu istek
OpenRouter etkinlik kaydında da görünmez.

## Güvenlik

- Her tablo RLS ile korunur; her kullanıcı yalnızca kendi satırlarını görür. 123 pgTAP testi
  bunu kanıtlar (`supabase/tests/rls.test.sql`). Tekrar geçmişi uygulama için salt okunurdur:
  satırları yalnızca takvimi değiştiren veritabanı fonksiyonları yazar.
- **Görev durumu tek kapıdan değişir.** `guard_task_status` tetikleyicisi, uygulamanın
  `tasks.status`'u doğrudan PATCH ile değiştirmesini reddeder; durum yalnızca `set_task_status`,
  `skip_tasks`, `move_tasks` ve değerlendirme fonksiyonlarından geçer. Böylece tekrar takvimi
  hiçbir yoldan atlanamaz.
- **Sınav sonucu sunucuda hesaplanır.** Uygulama yalnızca "nasıl geçti" cevabını ve işaretlenen
  konuları gönderir; SM-2 değerleri `apply_exam_retro` içinde `sm2_next` ile bulunur.
- **Hız sınırı:** yapay zekâ çağıran fonksiyonlar kullanıcı başına saatte sınırlıdır
  (değerlendirme 20, izlence 10, haftalık plan 10, model listesi 30, model denemesi 10). Aşılınca
  uygulama "biraz bekle" der (HTTP 429, `rate_limited`). Sayaç `rate_limit_hits` tablosundadır,
  iki günden eski satırlar silinir.
- Alt tablolar ana tabloya iki sütunlu (id + user_id) yabancı anahtarla bağlıdır: başka bir
  kullanıcının verisine bağlanmak veritabanı düzeyinde imkânsızdır.
- Oturum anahtarları ve önbelleğe alınmış veriler cihazda şifreli saklanır; şifreleme anahtarı
  Android Keystore / iOS Keychain içindedir (`src/shared/lib/storage/secure.ts`).
- Yapay zekâ anahtarları yalnızca Edge Function ortamındadır, uygulamaya hiç girmez.
- İşleme durumu (`status`, `summary`, `processed_at`) istemciden yazılamaz; yalnızca sunucu
  tarafı servis anahtarıyla güncellenir.

## Çevrimdışı davranış

- Sorgu önbelleği şifreli olarak diske yazılır; bağlantı yokken son bilinen plan gösterilir.
- Görev işaretleme, düzenleme, silme, not ekleme ve çalışma süresi kaydı çevrimdışıyken
  kuyruğa alınır ve bağlantı gelince kendiliğinden gönderilir (uygulama kapanıp açılsa bile).
  Süre kayıtları kendi zaman damgalarını taşır: geç gönderilse de gerçek saatiyle yazılır.
- Hata defteri (ekleme, düzeltme, çözdüm, geri aç, silme) ve ayarlar (günlük kapasite, kapalı
  günler, otomatik haftalık plan) da aynı kuyruktadır. Değişiklik ekranda hemen görünür; her
  alanın kuyruğu sırayla boşalır (çevrimdışı eklenip sonra düzeltilen madde önce eklenir).
  Yeni maddenin kimliği cihazda üretilir; aynı yazma iki kez gitse de çift kayıt oluşmaz.
  Sunucu reddederse ekran eski haline döner ve nedenini söyler.
- Yapay zekâ anahtarı kuyruğa girmez: bağlantı yoksa hemen hata verir, sır diske yazılmaz.
- Görevler ekranındaki şerit hem çevrimdışı olduğunu hem de kaç değişikliğin beklediğini yazar.

## Hata raporları

Öğrencinin düzeltemeyeceği hatalar (sunucu hatası, beklenmeyen istisna) kendiliğinden
`app_error_reports` tablosuna yazılır — bağlantı yok, form hatası, oturum süresi gibi beklenen
durumlar yazılmaz.

- **Uygulama:** başarısız sorgu ve yazmalar, ekranı çökerten render hataları ve React dışında
  yakalanmayan JS hataları `report_app_error` RPC'siyle gönderilir
  (`src/shared/api/telemetry`). Aynı hata 10 dakikada bir kez, bir çalıştırmada en çok 20 rapor;
  sunucu da kullanıcı başına saatte 30 ile sınırlar. Uygulamayı kapatan hata cihaza yazılır ve
  bir sonraki açılışta gönderilir. Geliştirme derlemesinde yalnızca konsola yazılır.
- **Edge Functions:** 500 ve üstü her yanıt, istek kimliğiyle birlikte aynı tabloya yazılır.
- Aynı hata tek **grupta** toplanır: nerede olduğu (sorgu, ekran ya da fonksiyon) ve mesajı, içindeki
  kimlikler ve sayılar çıkarılarak karşılaştırılır — "görev 3fa8… başarısız" ile "görev 9c85…
  başarısız" aynı gruptur. Raporlar 90 gün sonra silinir.

### Haftalık hata özeti

Her **pazartesi 06:17 UTC**'de (`error-digest` cron işi, `send_error_digest`) geçen haftanın özeti
saklanır ve yöneticilere push bildirimi olarak gelir: kaç hata, kaç grup, geçen haftayla farkı ve en
sık yaşanan. Bildirime dokununca **Hata özeti** ekranı açılır. Hata olmayan hafta saklanır ama
bildirilmez.

Ekran (Ayarlar → Geliştirici → Hata özeti; yalnızca yöneticiler görür): son 7 gün, son 30 gün ya da
geçmiş haftalar; hata / grup / öğrenci / yeni grup / **geri dönen** sayıları; uygulama ve sunucu
dağılımı; sürümler; en çok yaşanan 10 grup. Bir gruba dokununca arkasındaki raporlar açılır
(zaman, sürüm, işlem, istek kimliği, yığın izi; öğrenci yalnızca kısa bir etiketle). **Düzeltildi
olarak işaretle** dediğin grup yeniden görülürse "geri döndü" diye en üste çıkar.

Kurulum tek seferlik, panodan (SQL Editor):

```sql
-- Kendini yönetici yap (uygulamadan kimse kendini yönetici yapamaz):
insert into public.app_admins (user_id)
select id from auth.users where email = 'sen@ornek.com';

-- İsteğe bağlı: özet e-postayla da gelsin (Resend; 'from' doğrulanmış alan adı ister,
-- vermezsen onboarding@resend.dev yalnızca kendi adresine gönderir):
select vault.create_secret('<resend api key>', 'resend_api_key');
select vault.create_secret('sen@ornek.com', 'error_digest_email');
select vault.create_secret('Tekrar <hatalar@alanadin.com>', 'error_digest_from');
```

Push için telefonda tekrar hatırlatmalarının push olarak açık olması (bkz. Tekrar döngüsü) yeterli:
özet, yöneticinin kayıtlı cihazlarına gider. Ham raporlara panodan da bakılabilir:

```sql
select created_at, source, kind, message, detail->>'where', app_version, platform
  from app_error_reports order by created_at desc limit 50;
```

## Çalışma döngüsü

Uygulama, öğrencinin kendi çalışma sistemini bilir ve görevleri ona göre üretir:

| Adım | Etiket | Ne zaman |
|---|---|---|
| 1 | **Concepts** | Konu işlendikten sonra: ünitenin konsept sayfasına bağlantılarıyla ekle |
| 2 | **Feynman** | Aynı gün, hemen ardından: boş kâğıda sıfırdan anlatma |
| 3 | **Sınav** | **Feynman'la aynı gün ya da sonrası**: 10 soruluk otomasyon sınavı (hocanın materyali varsa önce o) |
| 4 | **Sınav · ileri seviye** | "Elimde zor sorular var" işaretliyse, aynı turda dördüncü görev olarak |

Konsept ve Feynman **hep aynı güne** konur, çünkü öğrenci ikisini arka arkaya yapıyor. Sınav
Feynman'dan **önceye asla düşmez**: aynı gün ya da sonraki bir gün olur. Plan, yer varsa önce
aynı günü dener. (Eskiden sınav her zaman ertesi güne itiliyordu.) Haftalık plan, hafta düzenleyici
ve değerlendirmedeki taşımalar aynı kuralı kullanır. İkisi bir güne sığmazsa plan onları ayırır ve
bunu not olarak söyler.

Görevler bu üç etikete göre gruplanır; Görevler ve Hafta ekranlarındaki filtre
çubuğundan etikete göre süzebilirsin. Bir kart, **adımlarının etiketleriyle de** bulunur: öğrenme
kartı hem Concepts hem Feynman süzgecinde görünür (eskiden Feynman süzgeci gruplu Feynman
sayfalarının hiçbirini göstermiyordu).

Adımlar sıra atlamaz: konu çalışılmadan problem seti gelmez. Aynı gün art arda da
planlanabilir, günlere de yayılabilir — kapasiteye bağlı.

Tekrar (aralıklı tekrar) zamanı gelen konu kısa döngüyü alır: **Feynman sayfası + sıradaki sınav.**

İleri seviye bayrağı iki yerden açılır: ders sayfasındaki konu satırındaki anahtardan ya da
günlük değerlendirmede "bu konudan elimde zor sorular var" demekle. Kendiliğinden hiç açılmaz.

## Ders programı

Dersler → **Ders programı**: haftalık ders saatlerini gün gün girersin. Program sen
değiştirmedikçe aynı kalır. Planlayıcı bunu iki şekilde kullanır:

- **Görevler dersin işlendiği günlere dağıtılır.** Çarşamba–cuma dersinin konuları çarşamba ve
  cumaya yayılır; adımlar sırasını bozmaz, geriye gitmez.
- Ders saati olan günün çalışma bütçesi kısılır; dolu günlere daha az iş düşer.
- **Laboratuvar saatleri planlamaya hiç girmez.** Programda "Laboratuvar" işaretlersen o saat
  yalnızca günü dolu sayar; ders günü sayılmaz ve o konuda görev üretilmez.
- **Okul quizleri de planlamaya girmez.** Onları kendin yürütürsün.
- Ders programını telefon takviminden içe aktarabilirsin (Ders programı → Takvimi tara).
  Yalnızca adı veya kodu bir dersle eşleşen kayıtlar eklenir, eşleşmeyenler listelenir.

## Yapay zekâ akışları

| Fonksiyon | Ne yapar |
|---|---|
| `ingest-syllabus` | PDF metnini çıkarır, ders/konu/sınav bilgisini yapılandırılmış çıktı olarak alır, tek transaction'da yazar. Sınav yalnızca hafta numarasıyla verilmişse (izlencede tarih yoksa) o haftanın pazarına konur |
| `daily-checkin` | Günlük raporu ve eklenen dosyaları okur; ne yapıldığını sınıflandırır, planı deterministik kodla günceller |
| `generate-weekly-plan` | Sınav yakınlığı, tekrar zamanı ve zayıf konulara göre haftalık planı üretir |
| `llm-models` | Kullanılabilir modelleri listeler ve seçilen modeli gerçek bir çağrıyla dener |

Ortak kural: **model yalnızca sınıflandırır ve yazar; tarih, durum ve planlama kararlarını
deterministik kod verir.** Model erişilemezse haftalık plan şablon metinlerle yine oluşur.

### Değerlendirme modelinin gördüğü

- **İki okuyucu, aynı anda.** Rapor iki modele paralel okunur: biri **ne oldu** (bitenler, takılmalar,
  süre, plan dışı çalışma, sınav sonucu), öbürü **ne değişsin** (silme, taşıma, yeni iş, günler, dersler,
  sınav takvimi, hatırlatma, sorular). Her biri şemanın yarısını ve yalnızca kendi kurallarını alır;
  cevaplar birleştirilir, sonrası aynıdır. Tek şema her yeni cümleyle büyüyordu ve ucuz modeller otuz
  listeyi birden doldururken hepsinde kötüleşiyordu; tek şema bugün 887 düğüm olurdu, iki okuyucu 306
  ve 586. Paralel oldukları için süre uzamaz; istem iki kez gönderildiği için girdi maliyeti artar.

- **Kısa tutamaçlar, UUID yok.** Görevler T1, T2…, konular K1…, dersler D1…, sınavlar S1…, hata
  defteri H1… olarak listelenir. Model yüz satırlık listeden 36 karakterlik kimliği kopyalarken tek
  harfi şaşırdığında o cümle sessizce düşüyordu; "T12" yarım kopyalanamaz ve on kat daha az yer
  kaplar. Cevaptaki tutamaçlar planlayıcıya gitmeden gerçek kimliklere çevrilir
  (`daily-checkin/aliases.ts`); tanınmayan her şey eskisi gibi reddedilir.
- **Takvim tablosu.** İstemde rapor gününün on gün öncesinden on dört gün sonrasına her gün, o güne
  karşılık gelen sayıyla yazılıdır (`daysAhead 3 = Cuma 2 Eki`). Model "cumaya" için saymaz, bakar.
  Görev satırları da günlerini aynı sayılarla söyler, "dünkü set" doğrudan eşleşir.
- **Kartın bütünlüğü.** Bir adım satırı hangi kartın adımı olduğunu söyler (`step of T1`), kart
  satırları listede yan yana durur.
- **Bozuk tek madde bütün raporu düşürmez.** Cevap şemadan bütün olarak geçemezse madde madde
  doğrulanır: geçen her madde tutulur, geçmeyen atılır ve sayılır (`llm_output_salvaged` olayı).
  Eskiden yirmi listeden birindeki tek yanlış değer, yarım sayfalık raporu hata ekranına çevirirdi.

### Giden ve gelen JSON'a konan sınırlar

Model çağrıları iki yönde de doğrulanır (`supabase/functions/_shared/llm/guards.ts`):

| Nerede | Ne yapılır |
|---|---|
| Şema (giden) | `$ref`, `allOf`, `oneOf` gibi sağlayıcılar arasında taşınmayan anahtarlar reddedilir; derinlik ve düğüm sayısı sınırlanır |
| İstem (giden) | İzlence metni, rapor ve dosya içerikleri kontrol karakterlerinden temizlenir, kırpılır; toplam istem 60.000 karakteri aşamaz |
| Yanıt (gelen) | 200.000 karakteri aşan gövde okunmadan reddedilir; JSON nesne olmak zorundadır, derinlik ve düğüm sayısı sınırlıdır, sonra Zod şemasından geçer |
| Reddedilen çıktı | İlk 400 karakteri `llm_output_rejected` olayıyla loglanır; telefona ham model çıktısı hiç inmez |

Şema sınırları (derinlik 14, 1200 düğüm) gerçek şemaların üstünde pay bırakır ve
`_shared/llm/real-schemas.test.ts` bu payı ölçer. Sınırların gerçek şemalara teğet geçmesi bir
kez tüm yapay zekâ çağrılarını sessizce durdurdu: koruma, koruduğu şeyle birlikte test edilir.

Sayısal alanlarda şemaya sınır yazılmaz (bazı sağlayıcılar reddediyor); değerler kod
tarafında kırpılır. Sınav modunda ise SM-2 değerleri hiç istemciden gelmez: veritabanı
`sm2_next` ile kendisi hesaplar.
