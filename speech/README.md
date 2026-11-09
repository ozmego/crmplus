# crmPlus speech-worker (iskelet)

> **Durum:** iskelet — bu ortamda GPU olmadığı için çalıştırılıp test **edilmedi**. Geliştirme ve E2E testleri `TRANSCRIBER=mock` ile yapılır.

Şirket içi Türkçe transkript servisi. Uygulama `TRANSCRIBER=remote`, `SPEECH_URL=http://speech:8000`, `SPEECH_TOKEN=…` ile bağlanır.

```bash
docker build -t crmplus-speech speech/
docker run --gpus all -e SPEECH_TOKEN=… -p 8000:8000 crmplus-speech
curl localhost:8000/health
```

| Ayar | Varsayılan | Not |
|---|---|---|
| `WHISPER_MODEL` | `large-v3-turbo` | imaj oluşturulurken indirilir |
| `WHISPER_DEVICE` | `cuda` | `cpu` → yalnız örneklem çağrılar için |
| `WHISPER_COMPUTE` | `float16` (GPU) / `int8` (CPU) | |
| `SPEECH_TOKEN` | — | uygulamayla paylaşılan erişim belirteci |

Sınırlar (Aşama 2'de tamamlanacak):
- Mono kayıtta konuşmacı ayrımı yok (pyannote); güven 0,75 ile çarpılır ve kayıt düşük güven kuyruğuna düşer.
- PII maskeleme Node tarafında yapılır; NER tabanlı ad maskeleme eklenmedi.
- WER ölçümü için 30–50 rol yapma kaydından oluşan Türkçe test seti hazırlanmalı (plan §Doğrulama).
