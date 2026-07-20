"""
Groq Whisper client for ultra-fast speech-to-text transcription.
Uses whisper-large-v3 model via Groq Cloud API.

Groq processes at ~299x real-time speed, so a 3-second audio clip
transcribes in ~10-50ms on the API side.
"""

import os
import io
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

# Initialize client once (reuse across requests)
client = Groq(api_key=GROQ_API_KEY)


def transcribe(audio_bytes: bytes, language: str = "en") -> dict:
    """
    Transcribe audio bytes using Groq Whisper API.

    Args:
        audio_bytes: WAV audio data (16kHz mono PCM)
        language: Language code (default: "en")

    Returns:
        dict with 'text' and 'duration' keys
    """
    try:
        transcription = client.audio.transcriptions.create(
            file=("audio.wav", audio_bytes),
            model="whisper-large-v3-turbo",
            temperature=0,
            language=language,
            response_format="verbose_json",
        )

        text = transcription.text.strip() if transcription.text else ""
        duration = getattr(transcription, "duration", None)

        return {
            "text": text,
            "duration": duration,
        }
    except Exception as e:
        print(f"[Groq Error] {e}")
        return {
            "text": "",
            "duration": None,
            "error": str(e),
        }
