"""
In-memory session manager.
Source (laptop) connects via WebSocket (write access).
Targets (mobile) subscribe via asyncio.Queue (read access via SSE).
"""

import asyncio
import json
import uuid
from fastapi import WebSocket
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class Session:
    session_id: str
    source_ws: WebSocket | None = None
    # Each SSE subscriber gets a unique queue keyed by subscriber_id
    target_queues: dict[str, asyncio.Queue] = field(default_factory=dict)
    transcripts: list = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
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


def subscribe_target(session_id: str) -> tuple[str, asyncio.Queue]:
    """
    Subscribe a target (mobile) to a session via an asyncio.Queue.
    Returns (subscriber_id, queue) — the SSE endpoint reads from this queue.
    """
    session = get_or_create_session(session_id)
    subscriber_id = str(uuid.uuid4())
    queue: asyncio.Queue = asyncio.Queue()
    session.target_queues[subscriber_id] = queue
    return subscriber_id, queue


def unsubscribe_target(session_id: str, subscriber_id: str):
    """Remove a target subscriber when SSE connection closes."""
    session = _sessions.get(session_id)
    if session:
        session.target_queues.pop(subscriber_id, None)


async def broadcast_to_targets(session_id: str, message: dict):
    """Put a message into all target subscriber queues for a session."""
    session = _sessions.get(session_id)
    if not session:
        return

    # Only store non-interim messages in transcript history
    # (interim messages are ephemeral live previews)
    if message.get("type") != "interim":
        session.transcripts.append(message)

    # Push to all subscriber queues (non-blocking)
    dead_subscribers = []
    for sub_id, queue in session.target_queues.items():
        try:
            queue.put_nowait(message)
        except asyncio.QueueFull:
            # Queue is full — subscriber is too slow, drop it
            dead_subscribers.append(sub_id)

    # Clean up dead subscribers
    for sub_id in dead_subscribers:
        session.target_queues.pop(sub_id, None)


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
            "target_count": len(s.target_queues),
            "transcript_count": len(s.transcripts),
            "is_recording": s.is_recording,
            "created_at": s.created_at.isoformat(),
        }
        for s in _sessions.values()
    ]
