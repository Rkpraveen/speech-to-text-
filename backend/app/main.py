"""
FastAPI application with WebSocket + SSE endpoints for real-time speech-to-text.

Architecture:
  Laptop (Source) → WS binary audio → FastAPI → Deepgram Nova-3 (streaming) → SSE → Mobile (Target)
                                                                             ↘ async → PostgreSQL
"""

import asyncio
import json
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
import secrets
import string

from app.auth import get_password_hash, verify_password, create_access_token, decode_access_token
from app.database import create_user, get_user_by_username

from app.deepgram_client import connect_deepgram, close_deepgram
from app.session_manager import (
    register_source,
    unregister_source,
    subscribe_target,
    unsubscribe_target,
    broadcast_to_targets,
    notify_source,
    list_active_sessions,
    get_or_create_session,
    get_session,
)
from app.database import get_pool, close_pool, save_session, end_session, save_transcript, get_sessions, get_session_transcripts, get_session_owner


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle."""
    # Startup: initialize DB pool
    print("🚀 Starting Speech-to-Text server...")
    await get_pool()
    print("✅ Database pool ready")
    yield
    # Shutdown: close DB pool
    await close_pool()
    print("👋 Server shut down")


app = FastAPI(
    title="Speech-to-Text Server",
    description="Real-time transcription via Deepgram Nova-3 Streaming",
    lifespan=lifespan,
)

# CORS for dev + ngrok
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    """Simple health check endpoint."""
    return {"status": "ok", "timestamp": datetime.now(timezone.utc)}


# --- Authentication ---

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/login")

class UserCreate(BaseModel):
    username: str
    password: str

async def get_current_user(token: str = Depends(oauth2_scheme)):
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    user = await get_user_by_username(username)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

@app.post("/api/register")
async def register(user: UserCreate):
    existing = await get_user_by_username(user.username)
    if existing:
        raise HTTPException(status_code=400, detail="Username already registered")
    password_hash = get_password_hash(user.password)
    new_user = await create_user(user.username, password_hash)
    return {"id": new_user["id"], "username": new_user["username"]}

@app.post("/api/login")
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    user = await get_user_by_username(form_data.username)
    if not user or not verify_password(form_data.password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    
    access_token = create_access_token(data={"sub": user["username"], "user_id": user["id"]})
    return {"access_token": access_token, "token_type": "bearer", "username": user["username"]}

@app.post("/api/sessions/create")
async def create_session_endpoint(current_user: dict = Depends(get_current_user)):
    chars = string.ascii_uppercase + string.digits
    session_id = ''.join(secrets.choice(chars) for _ in range(6))
    await save_session(session_id, user_id=current_user["id"])
    return {"session_id": session_id}

@app.post("/api/sessions/{session_id}/end")
async def end_session_endpoint(session_id: str, current_user: dict = Depends(get_current_user)):
    # Verify the user owns the session
    owner_id = await get_session_owner(session_id)
    if owner_id is not None and owner_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own this session")
    await end_session(session_id)
    # Broadcast to targets that the session has ended
    await broadcast_to_targets(session_id, {
        "type": "end_session",
        "message": "The host has ended this live session."
    })
    # Mark the in-memory session as explicitly ended so WS disconnect doesn't re-end it
    session = get_session(session_id)
    if session:
        session.is_recording = False
    return {"status": "ended"}

@app.get("/api/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    return {"id": current_user["id"], "username": current_user["username"]}

# --- REST Endpoints (History) ---


# ─── WebSocket: Source (Laptop streams audio → Deepgram) ─────────────────────


@app.websocket("/ws/source/{session_id}")
async def ws_source(websocket: WebSocket, session_id: str):
    """
    Laptop connects here to stream raw Linear16 PCM audio.
    Audio is proxied to Deepgram Nova-3 streaming WebSocket.
    Deepgram handles VAD, endpointing, and returns interim/final transcripts.
    Results are broadcast to SSE targets in real-time.
    """
    await websocket.accept()

    # Prevent duplicate source connections to the same session
    existing_session = get_session(session_id)
    if existing_session and existing_session.source_ws is not None:
        await websocket.send_json({"type": "error", "message": "Session already has an active source"})
        await websocket.close(code=4001)
        return

    session = register_source(session_id, websocket)
    session_ended_explicitly = False  # Track if session was ended via API
    print(f"[Source] Connected: session={session_id}")

    # Notify targets that source is connected
    await broadcast_to_targets(session_id, {
        "type": "status",
        "status": "source_connected",
        "timestamp": _now(),
    })

    # ── Deepgram transcript callback ──
    # Accumulate is_final segments into a full utterance.
    # speech_final = True means the speaker paused (end of utterance).
    utterance_parts = []

    async def on_transcript(text: str, is_final: bool, speech_final: bool):
        """Called by Deepgram receive loop when a transcript arrives."""
        if not is_final:
            # Interim result — live preview, changes as speaker continues
            transcript_message = {
                "type": "interim",
                "text": text,
                "timestamp": _now(),
            }
            await broadcast_to_targets(session_id, transcript_message)
            await notify_source(session_id, transcript_message)
            print(f"[Interim] {text[:60]}")
        else:
            # Final result for this audio segment
            utterance_parts.append(text)

            if speech_final:
                # Speaker paused — combine all parts into complete utterance
                full_text = " ".join(utterance_parts)
                utterance_parts.clear()

                transcript_message = {
                    "type": "final",
                    "text": full_text,
                    "timestamp": _now(),
                }
                await broadcast_to_targets(session_id, transcript_message)
                await notify_source(session_id, transcript_message)
                print(f"[Final] {full_text[:80]}")

                # Save to DB (fire-and-forget)
                asyncio.create_task(
                    _safe_db_op(save_transcript(session_id, full_text, None))
                )
            else:
                # is_final but speech continues — send as interim preview
                current_text = " ".join(utterance_parts)
                transcript_message = {
                    "type": "interim",
                    "text": current_text,
                    "timestamp": _now(),
                }
                await broadcast_to_targets(session_id, transcript_message)
                await notify_source(session_id, transcript_message)

    # ── Open Deepgram streaming connection ──
    dg_ws = None
    receive_task = None

    try:
        dg_ws, receive_task = await connect_deepgram(on_transcript)
        print(f"[Source] Deepgram stream opened for session={session_id}")

        # ── Main loop: receive audio from browser, forward to Deepgram ──
        while True:
            message = await websocket.receive()

            # Handle text messages (ping/pong keepalive)
            if "text" in message:
                if message["text"] == "ping":
                    await websocket.send_text("pong")
                continue

            # Handle binary messages (raw Linear16 PCM audio)
            if "bytes" not in message:
                continue

            audio_data = message["bytes"]
            if len(audio_data) < 10:
                continue

            # Forward raw audio directly to Deepgram
            await dg_ws.send(audio_data)

    except WebSocketDisconnect:
        print(f"[Source] Disconnected: session={session_id}")
    except Exception as e:
        print(f"[Source] Error: {e}")
    finally:
        # Close Deepgram connection
        if dg_ws and receive_task:
            await close_deepgram(dg_ws, receive_task)
            print(f"[Source] Deepgram stream closed for session={session_id}")

        unregister_source(session_id)
        await broadcast_to_targets(session_id, {
            "type": "status",
            "status": "source_disconnected",
            "timestamp": _now(),
        })
        # Only end session in DB if it wasn't already ended explicitly via API
        if not session.is_recording and session_ended_explicitly is False:
            # Session was stopped by API endpoint already, skip DB end
            pass
        else:
            session_ended_explicitly = True
            asyncio.create_task(_safe_db_op(end_session(session_id)))


# ─── SSE: Target (Mobile receives text via Server-Sent Events) ──────────────


@app.get("/api/stream/{session_id}")
async def sse_target(session_id: str, request: Request):
    """
    Mobile connects here to receive live transcripts via SSE.
    Read-only stream — no data flows back from target.
    """
    session = get_or_create_session(session_id)
    subscriber_id, queue = subscribe_target(session_id)
    print(f"[Target SSE] Connected: session={session_id}, sub={subscriber_id[:8]}")

    async def event_generator():
        # Send welcome event
        welcome = json.dumps({
            "type": "status",
            "status": "connected",
            "session_id": session_id,
            "has_source": session.source_ws is not None,
            "timestamp": _now(),
        })
        yield f"data: {welcome}\n\n"

        try:
            while True:
                # Check if client disconnected
                if await request.is_disconnected():
                    break

                try:
                    # Wait for a message with a timeout (for disconnect checking)
                    message = await asyncio.wait_for(queue.get(), timeout=30.0)
                    payload = json.dumps(message)
                    yield f"data: {payload}\n\n"
                except asyncio.TimeoutError:
                    # Send a keep-alive comment to prevent connection timeout
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            unsubscribe_target(session_id, subscriber_id)
            print(f"[Target SSE] Disconnected: session={session_id}, sub={subscriber_id[:8]}")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )


# ─── REST API: Sessions & History ────────────────────────────────────────────


@app.get("/api/sessions")
async def api_list_sessions():
    """List all sessions (from DB)."""
    try:
        sessions = await get_sessions()
        # Convert datetime objects for JSON serialization
        for s in sessions:
            for key in ("started_at", "ended_at"):
                if s.get(key):
                    s[key] = s[key].isoformat()
        return {"sessions": sessions}
    except Exception as e:
        return {"sessions": [], "error": str(e)}


@app.get("/api/sessions/active")
async def api_active_sessions():
    """List currently active in-memory sessions."""
    return {"sessions": list_active_sessions()}


@app.get("/api/sessions/{session_id}/transcripts")
async def api_session_transcripts(session_id: str):
    """Get all transcripts for a session."""
    try:
        transcripts = await get_session_transcripts(session_id)
        for t in transcripts:
            if t.get("timestamp"):
                t["timestamp"] = t["timestamp"].isoformat()
        return {"session_id": session_id, "transcripts": transcripts}
    except Exception as e:
        return {"session_id": session_id, "transcripts": [], "error": str(e)}


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _safe_db_op(coro):
    """Wrap async DB operations so they don't crash the server on failure."""
    try:
        await coro
    except Exception as e:
        print(f"[DB Error] {e}")
