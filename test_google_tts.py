"""
Google Cloud TTS test (Georgian).

Setup:
  1) Enable Cloud Text-to-Speech API in Google Cloud Console
  2) Create an API key (APIs & Services -> Credentials)
  3) Put it in .env:
       GOOGLE_TTS_API_KEY=AIza...
  4) python test_google_tts.py

Or pass key once:
  python test_google_tts.py AIza...
"""
from __future__ import annotations

import base64
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
TEXT = "გთხოვთ მოუხვიოთ მარჯვნივ."
OUT = ROOT / "output.mp3"


def load_api_key() -> str:
    if len(sys.argv) > 1 and sys.argv[1].strip():
        return sys.argv[1].strip()

    key = os.environ.get("GOOGLE_TTS_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if key:
        return key.strip()

    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() in ("GOOGLE_TTS_API_KEY", "GOOGLE_API_KEY"):
                return v.strip().strip('"').strip("'")

    return ""


def main() -> int:
    api_key = load_api_key()
    if not api_key or api_key.startswith("\u10e8\u10d4\u10dc\u10d8") or api_key in ("YOUR_KEY", "xxx"):
        print("Missing API key.")
        print("")
        print("Add this line to .env:")
        print("  GOOGLE_TTS_API_KEY=AIzaSy...")
        print("")
        print("Or run:")
        print("  python test_google_tts.py AIzaSy...")
        print("")
        print("Also enable: Cloud Text-to-Speech API in Google Cloud Console.")
        return 1

    url = f"https://texttospeech.googleapis.com/v1/text:synthesize?key={api_key}"
    payload = {
        "input": {"text": TEXT},
        "voice": {
            "languageCode": "ka-GE",
            "name": "ka-GE-Standard-A",
        },
        "audioConfig": {
            "audioEncoding": "MP3",
            "speakingRate": 0.9,
        },
    }

    print("Text:", TEXT)
    print("Key starts with:", api_key[:8] + "...")
    response = requests.post(url, json=payload, timeout=60)

    if response.status_code != 200:
        print("Error:", response.status_code)
        print(response.text)
        if "API key not valid" in response.text:
            print("")
            print("Your key is invalid or Text-to-Speech API is not enabled for that project.")
        return 1

    audio = base64.b64decode(response.json()["audioContent"])
    OUT.write_bytes(audio)
    print(f"OK -> {OUT} ({len(audio)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
