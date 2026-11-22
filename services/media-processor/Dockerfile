# syntax=docker/dockerfile:1.7
FROM python:3.13.9-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN useradd --create-home --uid 10001 worker
COPY pyproject.toml ./
COPY src ./src
# Imagem sem o modelo por padrão; WITH_WHISPER=1 instala faster-whisper (CPU).
ARG WITH_WHISPER=0
RUN pip install --no-cache-dir ".[runtime]" && if [ "$WITH_WHISPER" = "1" ]; then pip install --no-cache-dir ".[whisper]"; fi
USER worker
CMD ["python", "-m", "media_processor.main"]
