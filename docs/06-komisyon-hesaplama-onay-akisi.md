# 06 — Komisyon Hesaplama ve Onay Akışı

Durum: **Taslak — sözleşme örnekleri bekliyor** · Sahibi: Finans müdürü

## 1. Kapsam ve ayrım

- Finans modülü çağrı merkezi ekranlarından ve raporlarından **tamamen ayrıdır**: ayrı menü, ayrı sayfa düzeni, ayrı veritabanı şeması (`finance`), yalnız `finance.*` izinleri.
- Finans dışındaki hiçbir sorgu `finance` şemasına erişmez (veritabanı kullanıcı yetkisiyle de sınırlandırılır).
- Her finans ekranında “Finansal veri — erişiminiz kaydediliyor” şeridi bulunur. Her görüntüleme ve export `FinanceAccessLog`’a yazılır.

## 2. Aşamalar

| Aşama | Ne yapılır |
|---|---|
| **1–2** | Sözleşme ve kural **kaydı**, trip ve oyun sonuçlarının girişi/importu, komisyon tutarının **elle** girilmesi veya casino ekstresinden alınması, onay akışı, dönem kilidi, düzeltmeler. Otomatik hesap yok. |
| **3** | Kural motoru. Önce **gölge modda** (elle girilen tutarlarla paralel hesaplar, farkları raporlar). Fark oranı kabul edilebilir düzeye inince otomatik hesap devreye alınır. **Uygulandı:** §7a (motor), §8 (ekstre ve mutabakat), §8a (bulgular). |

## 3. Veri modeli

```
Partner/Casino ─┬─ Contract ─── ContractVersion (geçerlilik başlangıç/bitiş) ─── CommissionRule[] (bileşenler)
                │
                └─ Trip ─── TripGuest ─── GamingResult (kaynak: manuel | import batch | casino ekstresi)
                                │
                                └─ TravelBooking (uçuş, otel, transfer, maliyet)

CommissionPeriod (casino + ay, OPEN/LOCKED)
  └─ CommissionCalculation (sürüm n, durum, snapshot, hazırlayan, onaylayan)
       ├─ CommissionLine[] (misafir/trip kırılımı)
       └─ CommissionAdjustment[] (düzeltme/iptal, gerekçe)
```

## 4. Kademeli/karma kural modeli

Bir `ContractVersion` birden çok `CommissionRule` bileşeni içerir.

| Alan | Değerler | Açıklama |
|---|---|---|
| `basis` | `NET_LOSS`, `ROLLING`, `GUEST_COUNT`, `TRIP_COUNT` | Neyin üzerinden hesaplanacağı |
| `scope` | `PER_GUEST`, `PER_TRIP`, `PERIOD_TOTAL` | Hesabın hangi birimde yapılacağı |
| `tiers[]` | `{from, to, rate | amount}` | Kademeler |
| `tierMode` | `MARGINAL`, `WHOLE` | Marjinal: her dilime kendi oranı. Bütün: ulaşılan kademenin oranı tüm tutara |
| `min` / `max` | tutar | Bileşenin taban/tavanı |
| `currency` | ISO 4217 | Bileşenin para birimi |
| `priority` | sayı | `PRIORITY` birleştirmede sıra |
| `netWinBehavior` | `ZERO`, `CARRY_OVER`, `NEGATIVE` | Misafir net kazandıysa |

Sözleşme düzeyinde `combine`: `SUM` (bileşenler toplanır), `MAX` (en yüksek bileşen), `PRIORITY` (ilk uygulanabilen bileşen).

### Örnek (varsayımsal)

Casino A, 2026 sözleşmesi, `combine = SUM`:
- Bileşen 1: `NET_LOSS`, `PERIOD_TOTAL`, `MARGINAL`: 0–1M TL %10, 1M–5M TL %12, 5M+ %15. `netWinBehavior = CARRY_OVER`.
- Bileşen 2: `GUEST_COUNT`, `PER_GUEST`: misafir başı 5.000 TL, yalnız rolling ≥ 500k TL olan misafirler için.

Dönem net kaybı 3,2M TL, nitelikli misafir 12 ise:
- Bileşen 1: 1M × %10 + 2,2M × %12 = 100.000 + 264.000 = 364.000 TL
- Bileşen 2: 12 × 5.000 = 60.000 TL
- Toplam: 424.000 TL

## 5. Hesaplama durumları

```
DRAFT ──► IN_REVIEW ──► APPROVED ──► RECONCILED
  │           │             │
  └───────────┴─────────────┴──► CANCELLED (gerekçe zorunlu)
```

| Geçiş | İzin | Kural |
|---|---|---|
| DRAFT → IN_REVIEW | `finance.calc.prepare` | Tüm girdi satırlarının kaynak referansı olmalı |
| IN_REVIEW → APPROVED | `finance.calc.approve` | **Onaylayan ≠ hazırlayan** (sunucuda zorunlu) |
| IN_REVIEW → DRAFT | `finance.calc.approve` | Ret gerekçesi zorunlu |
| APPROVED → RECONCILED | `finance.calc.approve` | Casino ekstresiyle mutabakat sonucu eklenmeli |
| * → CANCELLED | `finance.adjust` | Gerekçe zorunlu; `APPROVED` sonrası iptal ikinci onay ister |

`APPROVED` ve sonrası kayıtlar değiştirilemez. Değişiklik yalnız yeni sürümle (`version n+1`) veya `CommissionAdjustment` ile yapılır.

## 6. Dönem kilidi

- `finance.period.lock` ile dönem `LOCKED` olur. Kilitli dönemde oyun sonucu, trip ve hesaplama değiştirilemez.
- Kilitli döneme ait düzeltme: yeni bir `CommissionAdjustment` (tutar, gerekçe, referans hesaplama, hazırlayan, onaylayan) **açık bir sonraki dönemde** kaydedilir. Orijinal kayıt aynen kalır.
- Dönem kilidini açmak mümkün değildir.

## 7. Denetlenebilirlik (snapshot)

Her `CommissionCalculation` şunları değişmez biçimde saklar:
- Kullanılan `ContractVersion` kimliği ve tüm kuralların o anki tam kopyası
- Girdi `GamingResult` kimlikleri ve değerlerinin kopyası, her birinin kaynak dosyası (import batch #, dosya adı, SHA-256, yüklenme tarihi, yükleyen)
- Kullanılan döviz kurları ve kaynağı
- Hesaplama motoru sürümü (Aşama 3)
- Bileşen → kademe → tutar kırılımı (satır satır)
- Devreden bakiye (carry-over) giriş ve çıkışı

“Bu tutar nasıl hesaplandı?” ekranı yalnız bu snapshot’tan üretilir. Sözleşme sonradan değişse de geçmiş hesap aynı görünür.

## 7a. Kural motoru (Aşama 3 — uygulandı)

- **Hesap:** `src/lib/commission.ts` (saf, birim testli). Tutarlar kuruş cinsinden tam sayı; §4 örneği (3,2M net kayıp + 12 nitelikli misafir = 424.000 TL) testle doğrulanır.
- **Kademe anlamı:** oran kademesi dilime (`MARGINAL`) veya ulaşılan kademeyle tüm değere (`WHOLE`) uygulanır. Tutar kademesi adet tabanında “adet başı tutar”, tutar tabanında “kademeye ulaşınca sabit tutar”dır.
- **Nitelikli misafir filtresi** (`filter`): `countries` (ülke bazlı kural; ülke, misafir tripe eklendiği anki değerle anlık görüntüden okunur), `minRollingPerGuest`, `minNetLossPerGuest`. Serbest metin `condition` hesaba girmez.
- **Net kazanç:** `ZERO` → 0 · `NEGATIVE` → ilk kademe oranıyla negatif komisyon · `CARRY_OVER` → bu dönem 0; kazanç bir sonraki dönemin aynı birimine (dönem/misafir/trip) devreder. Devir önceki dönemin **onaylı veya mutabık** son hesabından okunur; anahtar sözleşme bazındadır, yeni sözleşme sürümünde kaybolmaz.
- **Ay ortası sürüm değişikliği:** her sonuç oynanma tarihine göre geçerli sürüme düşer; sürümler ayrı hesaplanıp toplanır. Hiçbir sürüme düşmeyen sonuç ve casino para birimiyle uyuşmayan kural (kur dönüşümü yok) uyarı olarak gösterilir.
- **Modlar** (`Finans → Komisyon motoru`, gerekçeli değişiklik):
  - **Gölge (varsayılan):** tutar elle girilir; motor aynı anda hesaplanır ve anlık görüntüye yazılır (`engineAmount`). Fark varsa **onay, fark gerekçesi ister**.
  - **Birincil:** tutar boş bırakılırsa motor sonucu kullanılır (`method = ENGINE`); elle tutar girilirse yine fark gerekçesi gerekir.
- Her hesabın anlık görüntüsünde motorun kural/birim bazında açıklama satırları (ör. “1.000.000 TL × %10 = 100.000 TL”) saklanır; dönem sayfasında “Komisyon motoru · ayrıntı” olarak görünür.

## 8. Mutabakat

- **Ekstre yükleme:** xlsx/csv; sütunlar başlıktan tanınır (CRM no veya casino oyuncu no, ad, tarih, net kayıp — ör. “House Win” —, rolling). Türkçe/İngilizce sayı biçimi ve Excel tarihi okunur; işaret yönü seçilebilir. Dosya **şifreli saklanır**, SHA-256 özeti kaynak kanıtıdır; aynı dosya iki kez yüklenemez.
- **Eşleme:** CRM no (veya dış kimlik → CRM no) → bu casinonun dönem triplerindeki misafir. Durumlar: eşleşti · misafir bulunamadı · dönem tripinde yok · geçersiz satır.
- **Sonuç olarak işleme:** eşleşen satırlar `GamingResult` olur, `sourceRef = ekstre:<id>#<satır>`; **yükleyen kişi işleyemez** (iki kişili kontrol). Dönem henüz yoksa ekstre ayrıntısından işlenir ve dönemi açar.
- **Karşılaştırma:** misafir bazında ekstre ↔ girilen sonuç (o ekstreden işlenenler hariç): uyumlu · fark · yalnız ekstrede · yalnız girilen.
- **`RECONCILED`:** onaylı hesap ekstre seçilerek mutabık yapılır; özet (sayılar, toplam fark, dosya özeti) hesaba yazılır. **Fark varsa gerekçe zorunlu**; hazırlayan mutabakat yapamaz.

## 8a. Kontrol bulguları ve operasyon anomalileri

- Dönem sayfasında (inceleme için): kaynak referansı olmayan sonuç · aynı misafir+gün birden fazla sonuç · dönem medyanının 10 katından büyük tutar · oyun tarihinden 30 gün sonra girilen sonuç · motorla farklı hesaplar.
- `Raporlar → Operasyon anomalileri`: ekip + gün bazında “ulaşıldı ama 0 sn”, otomatik kapanan çağrı, yayınlanmış vardiya dışı çağrı (en az 3 ve %10). Kişi bazlı değildir; puan, sıralama veya yaptırım için kullanılmaz.

## 9. Erişim ve kayıt

- Finans export’u: `finance.export`, gerekçe zorunlu, FinanceAccessLog.
- Hassas kayıt görüntüleme (misafir bazlı kayıp/kazanç detayı): FinanceAccessLog.
- Denetçi: durum geçişleri ve onay geçmişini görür; tutarları görmez (ayrıca `finance.view` verilmedikçe).

## Açık sorular

1. Örnek 2–3 gerçek sözleşme (kişisel veriler çıkarılmış) paylaşılabilir mi? Kural modeli bunlarla doğrulanmalı.
2. Komisyon casino ekstresinden mi hesaplanıyor, yoksa sizin kayıtlarınızdan mı? Hangisi esas?
3. Hangi para birimleri kullanılıyor? Kur kaynağı ne (TCMB, casino kuru, sözleşmede sabit)?
4. Komisyonun bir kısmı temsilcilere/alt acentelere prim olarak dağıtılıyor mu? (Ayrı bir hak ediş modülü gerekebilir.)
5. Dönem ay mı, trip mi, başka bir periyot mu?
6. Misafir net kazandığında sözleşmelerde hangi davranış geçerli (sıfırlama, devretme, negatif)?
