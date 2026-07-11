"""
FastAPI application with WebSocket endpoints for real-time speech-to-text.

Architecture:
  Laptop (Source) → WS binary audio → FastAPI → Groq Whisper → WS text → Mobile (Target)
                                                              ↘ async → PostgreSQL
"""

import asyncio
import time
import json
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
import secrets
import string

from app.auth import get_password_hash, verify_password, create_access_token, decode_access_token
from app.database import create_user, get_user_by_username

from app.groq_client import transcribe
from app.session_manager import (
    register_source,
    unregister_source,
    register_target,
    unregister_target,
    broadcast_to_targets,
    notify_source,
    list_active_sessions,
)
from app.database import get_pool, close_pool, save_session, end_session, save_transcript, get_sessions, get_session_transcripts


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
    description="Real-time transcription via Groq Whisper",
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
    # You could optionally verify the user owns the session here
    await end_session(session_id)
    # Broadcast to targets that the session has ended
    await broadcast_to_targets(session_id, {
        "type": "end_session",
        "message": "The host has ended this live session."
    })
    return {"status": "ended"}

@app.get("/api/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    return {"id": current_user["id"], "username": current_user["username"]}

# --- REST Endpoints (History) ---


# ─── WebSocket: Source (Laptop sends audio) ──────────────────────────────────


@app.websocket("/ws/source/{session_id}")
async def ws_source(websocket: WebSocket, session_id: str):
    """
    Laptop connects here to stream audio.
    Receives binary WAV chunks, transcribes via Groq, pushes to targets.
    """
    await websocket.accept()
    session = register_source(session_id, websocket)
    print(f"[Source] Connected: session={session_id}")

    # Create session in DB (async, non-blocking)
    asyncio.create_task(_safe_db_op(save_session(session_id)))

    # Notify targets that source is connected
    await broadcast_to_targets(session_id, {
        "type": "status",
        "status": "source_connected",
        "timestamp": _now(),
    })

    try:
        while True:
            # Receive message from laptop
            message = await websocket.receive()
            
            if "text" in message and message["text"] == "ping":
                await websocket.send_text("pong")
                continue
                
            if "bytes" not in message:
                continue
                
            data = message["bytes"]

            if len(data) < 100:
                # Too small, likely an empty frame
                continue

            # ── HOT PATH: Transcribe + Deliver ──
            t_start = time.perf_counter()

            # Run Groq transcription (blocking but fast ~100-200ms)
            result = await asyncio.to_thread(transcribe, data)

            t_transcribe = time.perf_counter()

            text = result.get("text", "")
            if not text:
                continue

            duration_ms = result.get("duration")
            latency_ms = round((t_transcribe - t_start) * 1000, 1)

            message = {
                "type": "transcript",
                "text": text,
                "timestamp": _now(),
                "latency_ms": latency_ms,
                "audio_duration": duration_ms,
            }

            # Push to all target WebSockets (mobile)
            await broadcast_to_targets(session_id, message)

            # Echo back to source (laptop) for preview
            await notify_source(session_id, message)

            print(f"[Transcribed] ({latency_ms}ms) {text[:80]}")

            # Fire-and-forget: save to DB (NOT in hot path)
            asyncio.create_task(
                _safe_db_op(save_transcript(session_id, text, duration_ms))
            )

    except WebSocketDisconnect:
        print(f"[Source] Disconnected: session={session_id}")
    except Exception as e:
        print(f"[Source] Error: {e}")
    finally:
        unregister_source(session_id)
        await broadcast_to_targets(session_id, {
            "type": "status",
            "status": "source_disconnected",
            "timestamp": _now(),
        })
        asyncio.create_task(_safe_db_op(end_session(session_id)))


# ─── WebSocket: Target (Mobile receives text) ───────────────────────────────


@app.websocket("/ws/target/{session_id}")
async def ws_target(websocket: WebSocket, session_id: str):
    """
    Mobile connects here to receive live transcripts.
    Sends JSON messages with transcript text.
    """
    await websocket.accept()
    session = register_target(session_id, websocket)
    print(f"[Target] Connected: session={session_id}")

    # Send welcome message with session info
    await websocket.send_json({
        "type": "status",
        "status": "connected",
        "session_id": session_id,
        "has_source": session.source_ws is not None,
        "timestamp": _now(),
    })

    try:
        while True:
            # Keep connection alive; targets mostly receive, not send
            msg = await websocket.receive_text()

            # Handle ping/pong for keepalive
            if msg == "ping":
                await websocket.send_text("pong")

    except WebSocketDisconnect:
        print(f"[Target] Disconnected: session={session_id}")
    except Exception as e:
        print(f"[Target] Error: {e}")
    finally:
        unregister_target(session_id, websocket)


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
