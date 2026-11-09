"""
crmPlus şirket içi Türkçe transkript servisi (docs/09).

POST /transcribe  (multipart: audio, channels, language, vocabulary)
  → {language, model, modelVersion, confidence, segments: [{speaker, start, end, text}]}

- Stereo kayıtta kanal 0 = temsilci (AGENT), kanal 1 = misafir (GUEST); her kanal ayrı tanınır, zamana göre birleştirilir.
- Mono kayıtta konuşmacı ayrımı bu iskelette YOKTUR: tüm bölütler GUEST olarak işaretlenir ve güven düşürülür
  (pyannote entegrasyonu Aşama 2). Mono kayıtlar bu yüzden düşük güven kuyruğuna düşer.
- PII maskeleme ve analiz Node tarafında yapılır (src/lib/redact.ts, src/lib/speech-analysis.ts); bu servis
  ham metni yalnız çağırana döner, diske yazmaz, günlüğe metin basmaz.
- Ses ve metin şirket dışına çıkmaz; model dosyaları imaj oluşturulurken indirilir.
"""

import math
import os
import tempfile

import numpy as np
import soundfile as sf
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from faster_whisper import WhisperModel

MODEL_NAME = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
DEVICE = os.environ.get("WHISPER_DEVICE", "cuda")
COMPUTE = os.environ.get("WHISPER_COMPUTE", "float16" if DEVICE == "cuda" else "int8")
TOKEN = os.environ.get("SPEECH_TOKEN")
MAX_BYTES = int(os.environ.get("SPEECH_MAX_BYTES", str(200 * 1024 * 1024)))

app = FastAPI(title="crmPlus speech", docs_url=None, redoc_url=None)
model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE)


def auth(authorization: str | None = Header(default=None)) -> None:
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="unauthorized")


def _transcribe(samples: np.ndarray, sr: int, speaker: str, prompt: str | None):
    segments, _info = model.transcribe(
        samples if sr == 16000 else _resample(samples, sr),
        language="tr",
        vad_filter=True,
        beam_size=5,
        initial_prompt=prompt,
        condition_on_previous_text=False,
    )
    out = []
    for s in segments:
        text = s.text.strip()
        if not text:
            continue
        # avg_logprob → 0..1 arası kaba güven
        conf = max(0.0, min(1.0, math.exp(s.avg_logprob)))
        out.append({"speaker": speaker, "start": round(s.start, 2), "end": round(s.end, 2), "text": text, "_conf": conf})
    return out


def _resample(x: np.ndarray, sr: int) -> np.ndarray:
    n = int(len(x) * 16000 / sr)
    return np.interp(np.linspace(0, len(x), n, endpoint=False), np.arange(len(x)), x).astype(np.float32)


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME, "device": DEVICE}


@app.post("/transcribe", dependencies=[Depends(auth)])
async def transcribe(
    audio: UploadFile = File(...),
    channels: int = Form(1),
    language: str = Form("tr"),
    vocabulary: str = Form(""),
):
    if language != "tr":
        raise HTTPException(status_code=400, detail="only tr is supported")
    data = await audio.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="audio too large")

    with tempfile.NamedTemporaryFile(suffix=".audio") as tmp:
        tmp.write(data)
        tmp.flush()
        samples, sr = sf.read(tmp.name, dtype="float32", always_2d=True)

    # Kurum sözlüğü (casino, otel, kişi adları) ilk istem olarak verilir
    terms = [t.strip() for t in vocabulary.split(",") if t.strip()][:200]
    prompt = ("Görüşmede geçebilecek adlar: " + ", ".join(terms) + ".") if terms else None

    if samples.shape[1] >= 2 and channels >= 2:
        segs = _transcribe(samples[:, 0], sr, "AGENT", prompt) + _transcribe(samples[:, 1], sr, "GUEST", prompt)
        penalty = 1.0
    else:
        segs = _transcribe(samples.mean(axis=1), sr, "GUEST", prompt)
        penalty = 0.75  # konuşmacı ayrımı yok → inceleme kuyruğuna düşsün

    segs.sort(key=lambda s: s["start"])
    confidence = (sum(s["_conf"] for s in segs) / len(segs) * penalty) if segs else 0.0
    for s in segs:
        s.pop("_conf", None)
    return {
        "language": "tr",
        "model": "faster-whisper",
        "modelVersion": MODEL_NAME,
        "confidence": round(confidence, 3),
        "segments": segs,
    }
