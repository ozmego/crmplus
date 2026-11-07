# 03 — Çağrı Sonuç Kodları ve Görev Durumları

Durum: **Taslak** · Sahibi: Çağrı merkezi müdürü

## 1. Çağrı yaşam döngüsü

```
[Ara] ──► DIALING ──► (Bağlandı) ──► CONNECTED ──► (Bitir) ──► WRAP_UP ──► (Sonuç kodu + Kaydet) ──► CLOSED
              │                                                     ▲
              └──────────── (Bitir, bağlanmadı) ────────────────────┘
```

| Zaman damgası | Ne zaman yazılır | Kaynak (Aşama 1 / Aşama 2) |
|---|---|---|
| `startedAt` | “Ara” tıklandığında | Sunucu saati / santral webhook |
| `answeredAt` | “Bağlandı” tıklandığında | Temsilci / santral webhook |
| `endedAt` | “Bitir” tıklandığında | Temsilci / santral webhook |
| `closedAt` | Sonuç kodu kaydedildiğinde | Sunucu |

Hesaplanan süreler:
- `ringSec = answeredAt − startedAt` (bağlanmadıysa `endedAt − startedAt`)
- `talkSec = endedAt − answeredAt` (bağlanmadıysa 0)
- `wrapSec = closedAt − endedAt`

Kurallar:
- Sonuç kodu seçilmeden çağrı kapanmaz, kuyruktaki sıradaki kayda geçilemez (sunucu doğrulaması).
- Bir temsilcinin aynı anda tek açık çağrısı olabilir.
- `talkSec` 0 olup sonuç “Ulaşıldı” ise uyarı gösterilir (“Bağlandı” tıklanmamış).
- 4 saatten uzun açık kalan çağrı otomatik olarak `endedAt = startedAt + 4 saat` ile kapatılır, `autoClosed` işaretlenir ve raporlarda veri kalitesi sorunu olarak sayılır.
- Aşama 2’de santral süresi ile temsilci süresi farklıysa santral esas alınır, fark raporlanır.

## 2. Sonuç kodları

| Kod | Etiket (TR) | Kategori | Ulaşıldı sayılır mı | Zorunlu ek veri | Otomatik etki |
|---|---|---|---|---|---|
| `REACHED` | Ulaşıldı | Ulaşıldı | Evet | Not (≥ 10 karakter) | Telefon: olumlu erişim kanıtı; görev `DONE` |
| `NO_ANSWER` | Cevap yok | Ulaşılamadı | Hayır | — | Yeniden deneme planlanır (§4) |
| `BUSY` | Meşgul | Ulaşılamadı | Hayır | — | Yeniden deneme (kısa aralık) |
| `INVALID_NUMBER` | Numara hatalı/ulaşılamıyor | Ulaşılamadı | Hayır | Alt neden: `kullanılmıyor`, `kapalı`, `hatalı numara` | Telefon: olumsuz kanıt; 2. kez aynı kod → numara `UNREACHABLE`, misafirin başka numarası varsa ona geçilir |
| `CALLBACK_REQUESTED` | Geri arama istedi | Ulaşıldı | Evet | Geri arama tarihi/saati (zorunlu) | `Callback` oluşur, görev `OPEN` kalır |
| `WRONG_PERSON` | Yanlış kişi | Ulaşıldı (kişiye değil) | Hayır | Not | Telefon misafirden ayrılır (`ownership = DISPUTED`), inceleme kaydı oluşur |
| `DO_NOT_CONTACT` | İletişim istemiyor | Ulaşıldı | Evet | Kanal kapsamı (yalnız arama / tüm kanallar) | **Anında** `ContactBlock`; misafirin açık görevleri ve kampanya girişleri iptal |
| `LANGUAGE_SUPPORT` | Dil desteği gerekli | Ulaşıldı | Evet | Dil | Misafirin `language` alanı güncellenir, görev o dili konuşan temsilciye yeniden atanmak üzere lidere düşer |
| `ESCALATE` | İnceleme/yönetici desteği gerekli | Ulaşıldı | Evet | Not (zorunlu) | Lidere görev oluşur |

Not alanı uyarısı (her zaman görünür):
> Notlara yalnızca iş için gerekli bilgiyi yazın. Kimlik numarası, kart bilgisi, sağlık veya finansal ayrıntı yazmayın.

Sistem, not kaydedilirken telefon, IBAN, kart ve TC kimlik kalıplarını algılarsa kaydı engellemez, maskeleyerek kaydeder ve kullanıcıyı uyarır.

## 3. Görev durumları

| Durum | Anlamı | Geçişler |
|---|---|---|
| `OPEN` | Atanmış, aranmayı bekliyor | → `IN_PROGRESS`, `CANCELLED`, `BLOCKED` |
| `IN_PROGRESS` | Açık çağrı var | → `OPEN` (yeniden deneme), `DONE`, `CANCELLED` |
| `DONE` | Hedefe ulaşıldı | Son durum |
| `CANCELLED` | İptal (neden zorunlu: durdurma, yanlış kişi, kampanya bitti, manuel) | Son durum |
| `BLOCKED` | Uygunluk kontrolünden geçemiyor (izin yok/değişti) | → `OPEN` (izin düzelirse), `CANCELLED` |
| `EXHAUSTED` | Deneme limiti doldu | Son durum (lider yeniden açabilir) |

Görev alanları: tip (`CALL`, `FOLLOW_UP`, `DOCUMENT`, `OTHER`), neden (serbest + kampanya referansı), atanan, atanma tarihi, son tarih, öncelik (1–3), deneme sayısı, son sonuç.

## 4. Yeniden deneme kuralları (varsayılan, kampanya bazında değiştirilebilir)

| Son sonuç | Sonraki deneme |
|---|---|
| `NO_ANSWER` | 4 saat sonra; 2. denemeden sonra ertesi gün |
| `BUSY` | 30 dakika sonra |
| `INVALID_NUMBER` | Başka numara varsa hemen; yoksa yok |
| En fazla deneme | 5 deneme / 7 gün → `EXHAUSTED` |

## 5. Geri arama durumları

| Durum | Anlamı |
|---|---|
| `PENDING` | Planlanan zaman gelmedi |
| `DUE` | Zamanı geldi (planlanan ± 15 dk) |
| `LATE` | Zamanından 15 dk–24 saat geçti, aranmadı |
| `MISSED` | 24 saati geçti, aranmadı |
| `DONE` | Geri arama yapıldı (bağlı `Call` var) |
| `CANCELLED` | İptal (durdurma vb.) |

“Zamanında tamamlandı” = `DONE` ve ilk deneme planlanan zamanın −15/+15 dk penceresinde.

Geri arama, sahibi temsilci izinliyse/pasifse ekip liderine düşer.

## 6. Kuyruk sıralaması

1. `DUE` geri aramalar (planlanan zamana göre)
2. `LATE` geri aramalar
3. Yüksek öncelikli görevler (son tarihe göre)
4. Diğer görevler (atanma tarihine göre, en eski önce)

Her satır gösterirken uygunluk yeniden kontrol edilir; uygun olmayan satır `BLOCKED` olur ve listeden düşer.

## Açık sorular

1. Sonuç kodu listesi yeterli mi? Ör. “Trip ilgisi var / teklif gönderildi” gibi iş sonucu kodları ayrı bir “sonuç alt kodu” olarak mı eklenmeli?
2. Deneme limiti (5 deneme / 7 gün) uygun mu?
3. “Yanlış kişi” durumunda numara misafirden tamamen silinmeli mi, yoksa “tartışmalı” olarak mı kalmalı? (Taslak: tartışmalı.)
4. Not minimum uzunluğu (10 karakter) “Ulaşıldı” için zorunlu olmalı mı?
