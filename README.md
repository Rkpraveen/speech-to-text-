# speech-to-text
# Switch Model to Turbo + Replace Target WebSocket with SSE

The source (laptop) has **write access** — it streams audio via WebSocket and triggers transcription. The target (mobile) has **read access** — it only consumes transcripts. Currently both sides use WebSocket, but the target never sends meaningful data back. This change:

1. Switches the STT model from `whisper-large-v3` → `whisper-large-v3-turbo` for faster inference
2. Replaces the target WebSocket with **SSE (Server-Sent Events)** — a unidirectional, read-only streaming protocol that matches the target's actual role

## Proposed Changes

### Backend — Groq Client

#### [MODIFY] [groq_client.py](file:///c:/Users/prave/project/speech%20to%20text/backend/app/groq_client.py)
- Change model from `whisper-large-v3` → `whisper-large-v3-turbo`
- One-line change on line 36

---

### Backend — Session Manager (SSE Queue Architecture)

#### [MODIFY] [session_manager.py](file:///c:/Users/prave/project/speech%20to%20text/backend/app/session_manager.py)
- Remove `target_ws_set` (WebSocket connections for targets)
- Add `target_queues: dict[str, asyncio.Queue]` — each SSE subscriber gets a queue
- `broadcast_to_targets()` → puts messages into all subscriber queues instead of sending via WebSocket
- Add `subscribe_target(session_id) → queue` and `unsubscribe_target(session_id, queue_id)` functions
- Remove `register_target()` and `unregister_target()` (WebSocket-based)

---

### Backend — Main API

#### [MODIFY] [main.py](file:///c:/Users/prave/project/speech%20to%20text/backend/app/main.py)
- Remove `@app.websocket("/ws/target/{session_id}")` endpoint
- Add `@app.get("/api/stream/{session_id}")` SSE endpoint using `StreamingResponse` with `text/event-stream` content type
- The SSE endpoint reads from a subscriber queue and yields `data: {json}\n\n` events
- Update imports: remove `unregister_target`/`register_target`, add `subscribe_target`/`unsubscribe_target`
- Source WebSocket endpoint stays unchanged

---

### Frontend — New SSE Hook

#### [NEW] [useSSE.ts](file:///c:/Users/prave/project/speech%20to%20text/frontend/src/hooks/useSSE.ts)
- New React hook using `EventSource` API
- Auto-reconnect with exponential backoff (same behavior as current WebSocket hook)
- Returns `{ connectionState, connect, disconnect }`
- Parses incoming SSE `data` field as JSON and calls `onMessage` callback

---

### Frontend — Target View

#### [MODIFY] [TargetView.tsx](file:///c:/Users/prave/project/speech%20to%20text/frontend/src/components/TargetView.tsx)
- Replace `useWebSocket` with `useSSE`
- Change URL from `wss://…/ws/target/{sessionId}` → `https://…/api/stream/{sessionId}`
- All message handling logic (`handleMessage`) stays identical
- Remove unused WebSocket imports

---

### Documentation

#### [MODIFY] [system design.md](file:///c:/Users/prave/project/speech%20to%20text/system%20design.md)
- Update architecture diagram: WebSocket → SSE for target leg
- Update component table: Transport → "WebSocket (source) + SSE (target)"
- Update model reference: `whisper-large-v3` → `whisper-large-v3-turbo`

---

## Architecture After Changes

```text
              Source System (WRITE)
             (React/Web App)
                   │
          Web Audio API + VAD
                   │
              WebSocket (binary audio)
                   │
             FastAPI Server
                   │
         ┌─────────┴─────────┐
         │                   │
  Whisper v3-turbo    Session Manager
         │                   │
         └─────────┬─────────┘
                   │
         asyncio.Queue (in-memory)
                   │
              SSE (text/event-stream)
                   │
          Target System (READ)
```

## Verification Plan

### Manual Verification
- Start the backend, connect source and target
- Verify source still streams audio via WebSocket
- Verify target receives transcripts via SSE
- Verify interim + final messages both work
- Verify session end notification reaches target via SSE
- Verify auto-reconnect works on the target side
