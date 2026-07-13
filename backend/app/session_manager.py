"""
In-memory session manager for WebSocket connections.
Tracks source (laptop) and target (mobile) connections per session.
"""

from fastapi import WebSocket
from dataclasses import dataclass, field
from datetime import datetime
import json


@dataclass
class Session:
    session_id: str
    source_ws: WebSocket | None = None
    target_ws_set: set = field(default_factory=set)
    transcripts: list = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    is_recording: bool = False


# Global session store
_sessions: dict[str, Session] = {}


def get_or_create_session(session_id: str) -> Session:
    """Get existing session or create a new one."""
    if session_id not in _sessions:
        _sessions[session_id] = Session(session_id=session_id)
    return _sessions[session_id]


def get_session(session_id: str) -> Session | None:
    """Get session by ID, returns None if not found."""
    return _sessions.get(session_id)


def register_source(session_id: str, ws: WebSocket) -> Session:
    """Register a source (laptop) WebSocket for a session."""
    session = get_or_create_session(session_id)
    session.source_ws = ws
    session.is_recording = True
    return session


def unregister_source(session_id: str):
    """Remove source WebSocket when laptop disconnects."""
    session = _sessions.get(session_id)
    if session:
        session.source_ws = None
        session.is_recording = False


def register_target(session_id: str, ws: WebSocket) -> Session:
    """Register a target (mobile) WebSocket for a session."""
    session = get_or_create_session(session_id)
    session.target_ws_set.add(ws)
    return session


def unregister_target(session_id: str, ws: WebSocket):
    """Remove target WebSocket when mobile disconnects."""
    session = _sessions.get(session_id)
    if session:
        session.target_ws_set.discard(ws)


async def broadcast_to_targets(session_id: str, message: dict):
    """Send a message to all target WebSockets for a session."""
    session = _sessions.get(session_id)
    if not session:
        return

    # Only store non-interim messages in transcript history
    # (interim messages are ephemeral live previews)
    if message.get("type") != "interim":
        session.transcripts.append(message)

    # Broadcast to all connected targets
    dead_targets = set()
    payload = json.dumps(message)

    for ws in session.target_ws_set:
        try:
            await ws.send_text(payload)
        except Exception:
            dead_targets.add(ws)

    # Clean up dead connections
    session.target_ws_set -= dead_targets


async def notify_source(session_id: str, message: dict):
    """Send a message back to the source (e.g., echo transcript)."""
    session = _sessions.get(session_id)
    if session and session.source_ws:
        try:
            await session.source_ws.send_json(message)
        except Exception:
            session.source_ws = None


def list_active_sessions() -> list[dict]:
    """List all active sessions."""
    return [
        {
            "session_id": s.session_id,
            "has_source": s.source_ws is not None,
            "target_count": len(s.target_ws_set),
            "transcript_count": len(s.transcripts),
            "is_recording": s.is_recording,
            "created_at": s.created_at.isoformat(),
        }
        for s in _sessions.values()
    ]
