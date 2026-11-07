# 02 — Excel Şablonu ve Alan Sözlüğü

Durum: **Taslak** · Sahibi: Veri sorumlusu

Şablon dosyası: `docs/templates/misafir-import.xlsx` (Aşama 1’in ilk adımında üretilir; sayfalar: `Misafirler`, `Açıklamalar`, `Değer listeleri`).

## 1. Dosya kuralları

| Kural | Değer |
|---|---|
| Biçimler | `.xlsx`, `.csv` (UTF-8, `;` veya `,` ayraç otomatik algılanır) |
| Reddedilenler | `.xlsm`, `.xls`, makro, harici bağlantı, şifreli dosya |
| Boyut | ≤ 50 MB |
| Satır | ≤ 500.000 veri satırı |
| Sayfa | İlk sayfa okunur; birden fazla sayfa varsa kullanıcı seçer |
| Başlık | İlk satır başlık satırıdır; boş başlıklı sütunlar yok sayılır |
| Tarama | ClamAV + yapı kontrolü; başarısız dosya işlenmez |
| Saklama | Orijinal dosya şifreli olarak 30 gün tutulur, sonra silinir; SHA-256 özeti ve meta bilgisi kalıcıdır |

## 2. Hassasiyet sınıfları

| Sınıf | Anlamı | Yükleyici görür mü? |
|---|---|---|
| `G` Genel | İş tanımlayıcıları, tercih | Evet |
| `K` Kişisel | Ad, dil, ülke | Evet |
| `İ` İletişim | Telefon, e-posta | Maskeli |
| `KM` Kimlik | Doğum tarihi, belge no | Kısmi maskeli |
| `F` Finansal | Tutarlar, limitler | Hayır — sütun sistem tarafından finans şemasına aktarılır, önizlemede `•••` |
| `N` Not | Serbest metin | Hayır |

## 3. Alan sözlüğü — Misafir

| CRM alanı | Excel başlık eşanlamlıları | Tür | Zorunlu | Sınıf | Doğrulama / normalizasyon |
|---|---|---|---|---|---|
| `crmId` | CRM ID, Misafir No, Guest ID | metin | Güncellemede önerilir | G | Sistemde mevcut olmalı; yoksa satır hatası |
| `externalId` | Casino ID, Player ID, Oyuncu No | metin | Hayır | G | `externalSource` ile birlikte benzersiz |
| `externalSource` | Kaynak, Casino | metin | `externalId` varsa evet | G | Tanımlı casino/iş ortağı listesinden |
| `firstName` | Ad, İsim, First Name | metin | **Evet** | K | Trim, çoklu boşluk temizliği, baş harf büyük (Türkçe yerel ayarıyla: i→İ) |
| `lastName` | Soyad, Soyadı, Last Name, Surname | metin | **Evet** | K | Aynı |
| `phone1` | Telefon, Cep, GSM, Phone, Mobile | telefon | **Evet** (phone1 veya email) | İ | Bkz. §5 |
| `phone2` | Telefon 2, Ev Tel, İş Tel | telefon | Hayır | İ | Bkz. §5 |
| `email` | E-posta, Email, Mail | e-posta | Hayır | İ | RFC biçimi, küçük harf |
| `language` | Dil, Language | kod | Hayır (vars. `tr`) | K | ISO 639-1 (`tr`, `en`, `ru`, `ar`, `fa`, `de`…); “Türkçe”, “Turkish” gibi adlar koda çevrilir |
| `country` | Ülke, Uyruk, Country, Nationality | kod | Hayır | K | ISO 3166-1 alpha-2; ad → kod eşlemesi |
| `city` | Şehir, City | metin | Hayır | K | — |
| `birthYear` | Doğum Yılı | sayı | Hayır | KM | 1920–(bugün−18) |
| `birthDate` | Doğum Tarihi, DOB | tarih | Hayır | KM | `GG.AA.YYYY`, `YYYY-MM-DD`, Excel seri tarih; 18 yaş altı → hata |
| `documentNo` | Pasaport No, TC No, Kimlik No | metin | Hayır | KM | TC ise 11 hane + sağlama algoritması |
| `vipLevel` | VIP, Seviye, Segment | liste | Hayır | G | `STANDARD`, `SILVER`, `GOLD`, `PLATINUM`, `DIAMOND` (eşlemeler ayarlanabilir) |
| `tags` | Etiket, Tags | liste | Hayır | G | `,` veya `;` ile ayrılmış |
| `ownerAgent` | Temsilci, Sorumlu, Agent | kullanıcı | Hayır | G | Kullanıcı adı veya e-posta; bulunamazsa uyarı (hata değil) |
| `notes` | Not, Açıklama, Notes | metin | Hayır | N | ≤ 2.000 karakter; PII uyarısı |

## 4. Alan sözlüğü — İzin (aynı satırda veya ayrı izin dosyasında)

| CRM alanı | Excel başlık | Tür | Zorunlu | Doğrulama |
|---|---|---|---|---|
| `consentCall` | Arama İzni | liste | Hayır | `EVET/HAYIR/BİLİNMİYOR` → `GRANTED/DENIED/UNKNOWN`; boş = `UNKNOWN` |
| `consentSms` | SMS İzni | liste | Hayır | Aynı |
| `consentWhatsapp` | WhatsApp İzni | liste | Hayır | Aynı |
| `consentEmail` | E-posta İzni | liste | Hayır | Aynı |
| `consentDate` | İzin Tarihi | tarih | `GRANTED` ise **evet** | Gelecek tarih olamaz |
| `consentSource` | İzin Kaynağı | metin | `GRANTED` ise **evet** | Ör. “Casino üyelik formu”, “Web form”, “İYS” |
| `consentProofRef` | İzin Kanıtı | metin | Hayır | Belge no/URL/form ID |

Kurallar:
- Dosyada izin sütunu yoksa tüm satırlar `UNKNOWN` sayılır ve önizlemede “izin durumu eksik” olarak listelenir.
- `GRANTED` için tarih veya kaynak eksikse izin **kaydedilmez**, satır `UNKNOWN` kalır ve uyarı verilir.
- Dosyadaki `GRANTED`, sistemde mevcut `DENIED` ya da aktif durdurma kaydını **ezemez**. Bu durum inceleme kuyruğuna gider (bkz. 04).

## 5. Telefon normalizasyonu

Sırayla uygulanır:
1. Boşluk, tire, nokta, parantez, `/` temizlenir. Baştaki `'` (Excel metin işareti) silinir.
2. Bilimsel gösterim (`9.05E+11`) → satır hatası “Hücre sayı olarak biçimlenmiş, numara bozulmuş olabilir”.
3. Önek kuralları:
   - `+` ile başlıyorsa olduğu gibi.
   - `00` ile başlıyorsa `+` yapılır.
   - `0` ile başlıyor ve 11 haneyse → TR: `+90` + kalan 10 hane.
   - 10 hane ve `5` ile başlıyorsa → TR mobil: `+90` eklenir.
   - `90` ile başlıyor ve 12 haneyse → `+` eklenir.
   - Diğer durumlarda sütun için seçilen varsayılan ülke (vars. TR) uygulanır.
4. `libphonenumber-js/max` ile doğrulanır: `isValid`, ülke, hat türü (`MOBILE`, `FIXED_LINE`, `FIXED_LINE_OR_MOBILE`, `VOIP`, …).
5. Sonuç E.164 biçiminde saklanır (`+905321234567`).
6. Önizlemede “önce → sonra” gösterilir; değiştirilen numaralar ayrıca sayılır.
7. Geçersiz numara satırı düşürmez: numara `formatStatus = INVALID` olarak işaretlenir, diğer alanlar alınır. Misafirin başka geçerli iletişim bilgisi yoksa satır “iletişim bilgisi yok” uyarısıyla alınır, kuyruğa giremez.

## 6. Eşleştirme kuralları (import ve karşılaştırma)

Öncelik sırası:
1. `crmId` → kesin eşleşme.
2. `externalSource + externalId` → kesin eşleşme.
3. Telefon (`phoneHash`) **ve** en az bir doğrulayıcı:
   - ad + soyad benzerliği ≥ 0,85 (trigram, Türkçe karakter ve büyük/küçük harf normalize edilerek), **veya**
   - doğum yılı eşit, **veya**
   - e-posta eşit.
   → “güçlü muhtemel eşleşme”, kullanıcı önizlemede toplu onaylayabilir.
4. Yalnız telefon eşit, doğrulayıcı yok veya çelişiyor → **inceleme kuyruğu** (aynı numara farklı kişiye ait olabilir).
5. Yalnız ad + soyad eşit (telefon farklı) → yeni kayıt olarak önerilir, “olası mükerrer” uyarısıyla.
6. Birden fazla adayla eşleşme → inceleme kuyruğu.

Dosya içi mükerrer: aynı dosyada aynı `crmId` veya aynı telefon + ad iki kez geçiyorsa ikinci satır “dosya içi mükerrer” olarak işaretlenir ve kullanıcı seçer.

## 7. Güncelleme politikası (sessiz ezme yok)

| Mevcut değer | Dosyadaki değer | Varsayılan davranış |
|---|---|---|
| Boş | Dolu | Doldur |
| Dolu | Boş | Koru (dosyadaki boşluk silme anlamına gelmez) |
| Dolu | Aynı | Değişiklik yok |
| Dolu | Farklı | **Kullanıcı seçer**: alan bazında “mevcut değeri koru / yeni değeri kullan / incelemeye gönder”. Seçim yapılmadan uygulanmaz. |
| Telefon farklı | — | Eski numara silinmez; yeni numara ek numara olarak eklenir, birincil numara seçimi kullanıcıya bırakılır |

Her değişiklik `FieldHistory`’ye (eski, yeni, import batch, kullanıcı, zaman) yazılır.

## 8. Satır hata kodları

| Kod | Anlamı |
|---|---|
| `E_REQUIRED` | Zorunlu alan boş |
| `E_PHONE_INVALID` | Telefon geçersiz (satır alınır, numara işaretlenir) |
| `E_PHONE_SCIENTIFIC` | Telefon bilimsel gösterime dönüşmüş |
| `E_DATE_INVALID` | Tarih okunamadı |
| `E_UNDERAGE` | 18 yaş altı |
| `E_ENUM` | Değer listede yok |
| `E_CRMID_NOT_FOUND` | CRM ID sistemde yok |
| `E_DUP_IN_FILE` | Dosya içi mükerrer |
| `E_CONSENT_INCOMPLETE` | İzin `EVET` ama tarih/kaynak eksik |
| `E_CONSENT_CONFLICT` | Dosyadaki izin, sistemdeki ret/durdurmayla çelişiyor |
| `E_TOO_LONG` | Alan uzunluk sınırını aşıyor |

Hata raporu: orijinal satırlar + `Satır No`, `Hata Kodu`, `Açıklama` sütunlarıyla Excel olarak indirilir. Kullanıcı düzeltip aynı import kaydına “düzeltme dosyası” olarak yükleyebilir.

## Açık sorular

1. Casino/iş ortağı dosyalarında ortak bir oyuncu kimliği var mı? (Varsa `externalId` birincil eşleştirme anahtarı olur.)
2. VIP seviyeleri casinoya göre değişiyor mu? Ortak bir ölçek mi kullanılmalı?
3. Dosyalarda finansal sütunlar (kayıp, rolling vb.) geliyor mu? Geliyorsa bu dosyaları yalnız Finans mı yüklemeli?
4. Kimlik/pasaport numarası tutulmalı mı? (Tutulmazsa veri minimizasyonu açısından daha iyi; bkz. 07.)
5. Orijinal dosyanın 30 gün saklanması yeterli mi?
