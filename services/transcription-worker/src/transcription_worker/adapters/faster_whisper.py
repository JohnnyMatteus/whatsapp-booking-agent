"""Transcritor local com faster-whisper. Importado só quando o extra `whisper` está instalado."""

from __future__ import annotations

import io

from ..domain import Transcript


class FasterWhisperTranscriber:
    def __init__(self, model_size: str = "small", device: str = "cpu", compute_type: str = "int8") -> None:
        from faster_whisper import WhisperModel  # import tardio: dependência opcional e pesada

        self._model = WhisperModel(model_size, device=device, compute_type=compute_type)

    def transcribe(self, audio: bytes, mime_type: str) -> Transcript:
        segments, info = self._model.transcribe(io.BytesIO(audio), language="pt", vad_filter=True)
        text = " ".join(segment.text.strip() for segment in segments)
        return Transcript(text=text, language=info.language, duration_seconds=info.duration)
