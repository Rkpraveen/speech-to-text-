"""
Database initialization script.
Run this once to create the required tables in PostgreSQL.

Usage (in WSL conda py3_13):
    python init_db.py
"""

import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

CREATE_TABLES_SQL = """
-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(64) UNIQUE NOT NULL,
    user_id INTEGER REFERENCES users(id),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'active'
);

-- Add user_id column if sessions table already existed
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);

-- Transcripts table
CREATE TABLE IF NOT EXISTS transcripts (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL REFERENCES sessions(session_id),
    text TEXT NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    audio_duration_ms FLOAT
);

-- Index for fast lookups by session
CREATE INDEX IF NOT EXISTS idx_transcripts_session_id ON transcripts(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
"""


async def init_database():
    print(f"Connecting to PostgreSQL...")
    conn = await asyncpg.connect(DATABASE_URL, ssl="require")

    try:
        print("Creating tables...")
        await conn.execute(CREATE_TABLES_SQL)
        print("✅ Tables created successfully!")

        # Verify tables exist
        tables = await conn.fetch(
            """
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name IN ('users', 'sessions', 'transcripts')
            """
        )
        for t in tables:
            print(f"  ✓ Table: {t['table_name']}")

    finally:
        await conn.close()
        print("Connection closed.")


if __name__ == "__main__":
    asyncio.run(init_database())
