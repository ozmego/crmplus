# crmPlus speech-worker — GPU profili (CUDA 12 + cuDNN 9). CPU için WHISPER_DEVICE=cpu ile çalıştırılabilir (yavaş).
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip libsndfile1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Model imaj oluşturulurken indirilir; çalışma anında internet gerekmez
ARG WHISPER_MODEL=large-v3-turbo
ENV WHISPER_MODEL=${WHISPER_MODEL} HF_HUB_OFFLINE=0
RUN python3 -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL}', device='cpu', compute_type='int8')"
ENV HF_HUB_OFFLINE=1

COPY app.py .
RUN useradd -r -u 10001 speech && chown -R speech /app
USER speech
EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
