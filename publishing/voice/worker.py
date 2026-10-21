"""One private action per process, newline JSON output; packaging entry point."""
from __future__ import annotations
import json
import os
import sys
from stt import prepare_model, status, transcribe


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    request = json.loads(sys.stdin.readline())
    action, models = request["action"], request["modelsDir"]
    if action == "status":
        result = status(models)
    elif action == "setup":
        result = prepare_model(models)
    elif action == "transcribe":
        # These process-local variables stop the Hub client from even being consulted.
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        result = transcribe(request["audio"], models, request.get("language"), request.get("initialPrompt", ""), emit)
    else:
        raise ValueError("unknown_voice_action")
    emit({"event": "result", "result": result})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({"event": "error", "error": str(error)})
        raise SystemExit(1)
