import asyncio
import os
import io
import wave
from app.groq_client import transcribe

def create_dummy_wav():
    # Create a simple 1-second 16kHz silent WAV file
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(16000)
        wf.writeframes(b'\x00\x00' * 16000)
    return buf.getvalue()

async def main():
    print("Testing Groq API...")
    wav_bytes = create_dummy_wav()
    result = await asyncio.to_thread(transcribe, wav_bytes)
    print("Result:", result)

if __name__ == "__main__":
    asyncio.run(main())
