"""
Deepgram Nova-3 streaming client for real-time speech-to-text.

Uses raw WebSocket connection to Deepgram's streaming API.
Audio is streamed as Linear16 PCM (16kHz, mono) and results
arrive as JSON with interim and final transcripts.

Architecture:
  Source audio → Backend WebSocket → Deepgram WebSocket → Transcript results
"""

import os
import json
import asyncio
import websockets
from dotenv import load_dotenv

load_dotenv()

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")
DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen"


async def connect_deepgram(
    on_transcript,
    model: str = "nova-3",
    language: str = "en",
    sample_rate: int = 16000,
):
    """
    Open a streaming WebSocket to Deepgram Nova-3.

    Args:
        on_transcript: async callback(text, is_final, speech_final)
            Called each time Deepgram returns a transcript result.
        model: Deepgram model name (default: nova-3)
        language: Language code (default: en)
        sample_rate: Audio sample rate (default: 16000)

    Returns:
        (deepgram_ws, receive_task)
        - deepgram_ws: WebSocket connection (use .send() for audio)
        - receive_task: asyncio.Task running the receive loop
    """
    params = {
        "model": model,
        "language": language,
        "encoding": "linear16",
        "sample_rate": str(sample_rate),
        "channels": "1",
        "interim_results": "true",
        "endpointing": "300",
        "smart_format": "true",
        "punctuate": "true",
        "vad_events": "true",
    }

    query = "&".join(f"{k}={v}" for k, v in params.items())
    url = f"{DEEPGRAM_WS_URL}?{query}"

    headers = {"Authorization": f"Token {DEEPGRAM_API_KEY}"}

    dg_ws = await websockets.connect(
        url,
        additional_headers=headers,
        ping_interval=20,
        ping_timeout=10,
    )

    async def receive_loop():
        """Read messages from Deepgram and invoke the transcript callback."""
        try:
            async for raw_message in dg_ws:
                try:
                    data = json.loads(raw_message)
                except json.JSONDecodeError:
                    continue

                msg_type = data.get("type", "")

                if msg_type == "Results":
                    channel = data.get("channel", {})
                    alternatives = channel.get("alternatives", [{}])
                    transcript = alternatives[0].get("transcript", "")
                    is_final = data.get("is_final", False)
                    speech_final = data.get("speech_final", False)

                    if transcript:
                        await on_transcript(transcript, is_final, speech_final)

                elif msg_type == "Metadata":
                    print(f"[Deepgram] Metadata: request_id={data.get('request_id')}")

                elif msg_type == "SpeechStarted":
                    print("[Deepgram] Speech started")

                elif msg_type == "UtteranceEnd":
                    print("[Deepgram] Utterance end")

        except websockets.exceptions.ConnectionClosed:
            print("[Deepgram] Connection closed")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[Deepgram] Receive error: {e}")

    receive_task = asyncio.create_task(receive_loop())

    return dg_ws, receive_task


async def close_deepgram(dg_ws, receive_task):
    """Gracefully close the Deepgram streaming connection."""
    try:
        # Tell Deepgram to finalize any pending audio
        await dg_ws.send(json.dumps({"type": "CloseStream"}))
        # Give it a moment to send final results
        await asyncio.sleep(0.5)
    except Exception:
        pass

    # Cancel the receive loop
    receive_task.cancel()
    try:
        await receive_task
    except asyncio.CancelledError:
        pass

    # Close the WebSocket
    try:
        await dg_ws.close()
    except Exception:
        pass
