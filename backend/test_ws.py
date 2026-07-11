import asyncio
import websockets
import wave
import io
import json

def create_dummy_wav():
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(16000)
        wf.writeframes(b'\x00\x00' * 16000 * 3) # 3 seconds of silence
    return buf.getvalue()

async def test_websocket_flow():
    session_id = "test_123"
    
    print(f"Connecting to target WS for session {session_id}...")
    try:
        async with websockets.connect(f"ws://localhost:8000/ws/target/{session_id}") as target_ws:
            print("Target connected.")
            
            print(f"Connecting to source WS for session {session_id}...")
            async with websockets.connect(f"ws://localhost:8000/ws/source/{session_id}") as source_ws:
                print("Source connected.")
                
                # Send heartbeat
                await source_ws.send(json.dumps({"text": "ping"}))
                print("Sent ping.")
                
                # Send binary data
                print("Sending binary wav...")
                await source_ws.send(create_dummy_wav())
                
                print("Waiting for transcription on target...")
                # Wait for target responses
                for i in range(3):
                    response = await target_ws.recv()
                    print(f"Received on target: {response}")
                
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_websocket_flow())
