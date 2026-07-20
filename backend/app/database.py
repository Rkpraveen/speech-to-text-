"""
Database connection and async operations for PostgreSQL on Render.
Uses asyncpg for non-blocking database access.
"""

import asyncpg
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

# Connection pool (initialized on startup)
_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    """Get or create the connection pool."""
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            DATABASE_URL,
            min_size=2,
            max_size=10,
            ssl="require",
        )
    return _pool


async def close_pool():
    """Close the connection pool on shutdown."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def save_session(session_id: str, user_id: int | None = None):
    """Create a new session record."""
    pool = await get_pool()
    await pool.execute(
        """
        INSERT INTO sessions (session_id, user_id, started_at, status)
        VALUES ($1, $2, NOW(), 'active')
        ON CONFLICT (session_id) DO UPDATE SET status = 'active',
            user_id = COALESCE(EXCLUDED.user_id, sessions.user_id)
        """,
        session_id,
        user_id,
    )

async def end_session(session_id: str):
    """Mark a session as ended and set the ended_at timestamp."""
    pool = await get_pool()
    await pool.execute(
        """
        UPDATE sessions
        SET status = 'ended', ended_at = NOW()
        WHERE session_id = $1 AND status != 'ended'
        """,
        session_id,
    )


async def save_transcript(session_id: str, text: str, audio_duration_ms: float | None = None):
    """Save a transcript entry (fire-and-forget from the hot path)."""
    pool = await get_pool()
    await pool.execute(
        """
        INSERT INTO transcripts (session_id, text, timestamp, audio_duration_ms)
        VALUES ($1, $2, NOW(), $3)
        """,
        session_id,
        text,
        audio_duration_ms,
    )


async def get_sessions():
    """List all sessions, most recent first."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT session_id, started_at, ended_at, status
        FROM sessions ORDER BY started_at DESC LIMIT 50
        """
    )
    return [dict(r) for r in rows]


async def get_session_transcripts(session_id: str):
    """Get all transcripts for a session."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT text, timestamp, audio_duration_ms
        FROM transcripts
        WHERE session_id = $1
        ORDER BY timestamp ASC
        """,
        session_id,
    )
    return [dict(r) for r in rows]


async def get_user_by_username(username: str):
    """Fetch user by username."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM users WHERE username = $1", username
    )
    return dict(row) if row else None


async def create_user(username: str, password_hash: str):
    """Create a new user and return user record."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at",
        username, password_hash
    )
    return dict(row)


async def get_session_owner(session_id: str) -> int | None:
    """Get the user_id that owns a session, or None if not found."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT user_id FROM sessions WHERE session_id = $1", session_id
    )
    return row["user_id"] if row else None
