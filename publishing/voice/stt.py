"""Writer's owned offline CPU speech recognition. No Hoard services or text LLM.

Uses SYSTRAN faster-whisper (MIT); its installed PyAV decodes local audio.
Only prepare_model may download the official model, after an explicit setup action.
"""
from __future__ import annotations
import importlib.util
import os
from pathlib import Path
import time

MODEL = "tiny"
REPOSITORY = "Systran/faster-whisper-tiny"


def find_model(models_dir: str) -> str | None:
    explicit = os.environ.get("WH_VOICE_MODEL_DIR", "").strip()
    roots = [Path(explicit)] if explicit else []
    roots += [Path(models_dir), Path(os.environ.get("HF_HUB_CACHE", "") or Path(os.environ.get("HF_HOME", "") or Path.home() / ".cache" / "huggingface") / "hub")]
    for root in roots:
        if (root / "model.bin").is_file() and (root / "config.json").is_file():
            return str(root)
        folder = root / "models--Systran--faster-whisper-tiny" / "snapshots"
        if folder.is_dir():
            for snapshot in sorted(folder.iterdir(), reverse=True):
                if (snapshot / "model.bin").is_file() and (snapshot / "config.json").is_file():
                    return str(snapshot)
    return None


def status(models_dir: str) -> dict:
    installed = importlib.util.find_spec("faster_whisper") is not None
    present = bool(find_model(models_dir))
    return {"ready": installed and present, "runtime": installed, "model": present, "device": "cpu", "modelName": MODEL,
            "error": "" if installed and present else "voice_runtime_missing" if not installed else "voice_model_missing"}


def prepare_model(models_dir: str) -> dict:
    if not find_model(models_dir):
        from faster_whisper.utils import download_model
        download_model(MODEL, cache_dir=models_dir, local_files_only=False)
    return status(models_dir)


def transcribe(audio: str, models_dir: str, language: str | None, prompt: str, emit) -> dict:
    # Never perform an implicit download during inference.
    model_path = find_model(models_dir)
    if not model_path:
        raise RuntimeError("voice_model_missing")
    from faster_whisper import WhisperModel
    model = WhisperModel(model_path, device="cpu", compute_type="int8", cpu_threads=4, local_files_only=True)
    raw, info = model.transcribe(audio, language=None if language in (None, "", "auto") else language,
                                 initial_prompt=prompt or None, word_timestamps=True, vad_filter=True,
                                 condition_on_previous_text=False, beam_size=5)
    segments = []
    duration = float(info.duration)
    for segment in raw:
        text = segment.text.strip()
        # Decoder uncertainty/silence rejection; no text model rewrites the words.
        if not text or segment.no_speech_prob > .6 and segment.avg_logprob < -1:
            continue
        sid = f"segment-{len(segments)}"
        words = [{"id": f"{sid}-word-{index}", "start": max(0., float(word.start)), "end": max(0., float(word.end)),
                  "text": word.word, "probability": float(word.probability)} for index, word in enumerate(segment.words or [])]
        segments.append({"id": sid, "start": max(0., float(segment.start)), "end": max(0., float(segment.end)),
                         "originalText": text, "text": text, "words": words})
        emit({"event": "progress", "progress": min(.99, float(segment.end) / duration) if duration else 0., "segment": segments[-1]})
    return {"version": 1, "language": info.language, "model": MODEL, "device": "cpu", "duration": duration,
            "prompt": prompt, "createdAt": int(time.time() * 1000), "segments": segments}
