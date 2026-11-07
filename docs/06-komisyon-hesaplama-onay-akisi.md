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
| **3** | Kural motoru. Önce **gölge modda** (elle girilen tutarlarla paralel hesaplar, farkları raporlar). Fark oranı kabul edilebilir düzeye inince otomatik hesap devreye alınır. |

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

## 8. Mutabakat

- Casino ekstresi (Excel) finans import’u ile alınır; karşılaştırma motoru (bkz. 02 §6) misafir/trip bazında kendi kayıtlarımızla eşleştirir.
- Fark türleri: yalnız bizde, yalnız ekstrede, tutar farkı (tolerans ayarlanabilir, ör. ±1 TL veya %0,5).
- Farklar çözülmeden hesaplama `RECONCILED` olamaz; kabul edilen farklar gerekçeyle kapatılır.

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
