import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useSSE, type ConnectionState } from "@/hooks/useSSE";
import { API_BASE } from "@/lib/config";

import { Wifi, WifiOff, Copy, Maximize2 } from "lucide-react";

interface TranscriptMessage {
  type: string;
  text?: string;
  timestamp?: string;
  latency_ms?: number;
  status?: string;
  has_source?: boolean;
}

interface TargetViewProps {
  sessionId: string;
}

export default function TargetView({ sessionId }: TargetViewProps) {
  const [transcripts, setTranscripts] = useState<TranscriptMessage[]>([]);
  const [interimText, setInterimText] = useState("");
  const [sourceConnected, setSourceConnected] = useState(false);
  const [, setIsFullscreen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const [sessionEnded, setSessionEnded] = useState(false);
  const [joinSessionId, setJoinSessionId] = useState("");
  const [copyFeedback, setCopyFeedback] = useState(false);

  // Store disconnect ref so handleMessage can call it without circular deps
  const disconnectRef = useRef<() => void>(() => {});

  const handleMessage = useCallback((data: TranscriptMessage) => {
    if (data.type === "interim" && data.text) {
      setInterimText(data.text);
    } else if (data.type === "final" && data.text) {
      setInterimText("");
      setTranscripts((prev) => [...prev, data]);
    } else if (data.type === "transcript" && data.text) {
      setInterimText("");
      setTranscripts((prev) => [...prev, data]);
    } else if (data.type === "end_session") {
      setSessionEnded(true);
      setSourceConnected(false);
      setInterimText("");
      // Stop SSE — prevent reconnection loop after session ends
      disconnectRef.current();
    } else if (data.type === "status") {
      if (data.status === "source_connected") setSourceConnected(true);
      else if (data.status === "source_disconnected") {
        setSourceConnected(false);
        setInterimText("");
      } else if (data.status === "connected" && data.has_source !== undefined) {
        setSourceConnected(data.has_source as boolean);
      }
    }
  }, []);

  const { connectionState, connect, disconnect } = useSSE({
    url: sessionId ? `${API_BASE}/api/stream/${sessionId}` : "",
    onMessage: handleMessage,
  });

  // Keep disconnect ref in sync
  useEffect(() => {
    disconnectRef.current = disconnect;
  }, [disconnect]);

  // Load existing transcripts from DB on mount (survives reload)
  useEffect(() => {
    if (!sessionId) return;
    fetch(`${API_BASE}/api/sessions/${sessionId}/transcripts`)
      .then((res) => res.json())
      .then((data) => {
        if (data.transcripts && data.transcripts.length > 0) {
          const restored = data.transcripts.map(
            (t: { text: string; timestamp?: string }) => ({
              type: "final",
              text: t.text,
              timestamp: t.timestamp,
            })
          );
          setTranscripts(restored);
        }
      })
      .catch((err) => console.error("[TargetView] Failed to load history:", err));
  }, [sessionId]);

  useEffect(() => {
    if (sessionId) connect();
  }, [connect, sessionId]);

  // Instant scroll to bottom — no smooth animation for real-time feel
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "instant" });
    }
  }, [transcripts, interimText]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const copyAll = () => {
    const text = transcripts
      .map((t) => t.text)
      .filter(Boolean)
      .join(" ");
    navigator.clipboard.writeText(text);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  // ─── No session: join form ───
  if (!sessionId) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
        }}
      >
        <div
          style={{
            background: "#050505",
            border: "1px solid #1a1a1a",
            padding: "40px",
            maxWidth: "400px",
            width: "100%",
          }}
        >
          <h2
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "1rem",
              fontWeight: 500,
              color: "#e0e0e0",
              marginBottom: "24px",
            }}
          >
            Join Stream
          </h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (joinSessionId.trim())
                navigate(`/live?session=${joinSessionId.trim().toUpperCase()}`);
            }}
          >
            <input
              type="text"
              placeholder="Session code"
              value={joinSessionId}
              onChange={(e) => setJoinSessionId(e.target.value.toUpperCase())}
              maxLength={6}
              style={{
                width: "100%",
                background: "#000",
                border: "1px solid #1a1a1a",
                padding: "12px 16px",
                color: "#e0e0e0",
                fontFamily: "var(--font-mono)",
                fontSize: "1.1rem",
                textTransform: "uppercase",
                textAlign: "center",
                letterSpacing: "0.15em",
                outline: "none",
                marginBottom: "12px",
              }}
            />
            <button
              type="submit"
              disabled={joinSessionId.length < 2}
              style={{
                width: "100%",
                background: "transparent",
                border: "1px solid var(--color-accent)",
                color: "var(--color-accent)",
                fontFamily: "var(--font-mono)",
                fontSize: "0.85rem",
                fontWeight: 500,
                padding: "12px",
                cursor: "pointer",
                opacity: joinSessionId.length < 2 ? 0.3 : 1,
                transition: "opacity 0.15s",
              }}
            >
              Connect
            </button>
          </form>
        </div>
      </div>
    );
  }

  const hasInterim = interimText.length > 0;
  const hasContent = transcripts.length > 0 || hasInterim;

  return (
    <div
      ref={containerRef}
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#000",
        color: "#e0e0e0",
        fontFamily: "var(--font-mono)",
        position: "relative",
      }}
    >
      {/* ─── Header ─── */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          borderBottom: "1px solid #1a1a1a",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span
            style={{
              fontSize: "0.7rem",
              fontWeight: 500,
              color: "#e0e0e0",
              letterSpacing: "0.08em",
            }}
          >
            LIVE
          </span>
          <span
            style={{
              fontSize: "0.75rem",
              padding: "2px 8px",
              border: "1px solid #1a1a1a",
              color: "#777",
              letterSpacing: "0.1em",
            }}
          >
            {sessionId}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {/* Source status */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "0.65rem",
              color: sourceConnected ? "var(--color-accent)" : "#444",
            }}
          >
            <div
              style={{
                width: "6px",
                height: "6px",
                background: sourceConnected ? "var(--color-accent)" : "#444",
                boxShadow: sourceConnected
                  ? "0 0 6px var(--color-accent-glow)"
                  : "none",
              }}
            />
            {sourceConnected ? "SRC" : "NO SRC"}
          </div>

          {/* Connection badge */}
          <TargetConnectionBadge state={connectionState} />

          {/* Actions */}
          <button
            onClick={copyAll}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px",
              color: "#444",
            }}
          >
            <Copy style={{ width: "14px", height: "14px" }} />
            {copyFeedback && (
              <span style={{ fontSize: "0.6rem", color: "var(--color-accent)" }}>Copied!</span>
            )}
          </button>
          <button
            onClick={toggleFullscreen}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px",
              color: "#444",
            }}
          >
            <Maximize2 style={{ width: "14px", height: "14px" }} />
          </button>
        </div>
      </header>

      {/* ─── Scrollable transcript area ─── */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px 24px",
        }}
      >
        {!hasContent ? (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#333",
              fontSize: "0.8rem",
            }}
          >
            Waiting for speech…
          </div>
        ) : (
          <>
            {/* Finalized transcripts — same style as interim for seamless flow */}
            {transcripts.map((t, i) => (
              <p
                key={i}
                style={{
                  fontSize: "clamp(1rem, 3vw, 1.5rem)",
                  lineHeight: 1.7,
                  fontWeight: 400,
                  color: "#e0e0e0",
                  margin: "0 0 2px 0",
                }}
              >
                {t.text}
              </p>
            ))}

            {/* Interim text — SAME STYLE as final, just has a cursor */}
            {hasInterim && (
              <p
                style={{
                  fontSize: "clamp(1rem, 3vw, 1.5rem)",
                  lineHeight: 1.7,
                  fontWeight: 400,
                  color: "#e0e0e0",
                  margin: "0 0 2px 0",
                }}
              >
                {interimText}
                <span className="typing-cursor" />
              </p>
            )}

            {/* Scroll anchor */}
            <div ref={bottomRef} style={{ height: "1px" }} />
          </>
        )}
      </div>

      {/* ─── Session ended overlay ─── */}
      {sessionEnded && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.9)",
          }}
        >
          <div
            style={{
              border: "1px solid var(--color-error)",
              padding: "40px",
              textAlign: "center",
              background: "#050505",
            }}
          >
            <WifiOff
              style={{
                width: "32px",
                height: "32px",
                color: "var(--color-error)",
                margin: "0 auto 16px",
                display: "block",
              }}
            />
            <h2
              style={{
                fontSize: "1rem",
                fontWeight: 500,
                color: "#e0e0e0",
                marginBottom: "16px",
              }}
            >
              Session Ended
            </h2>
            <button
              onClick={() => navigate("/live")}
              style={{
                background: "transparent",
                border: "1px solid #1a1a1a",
                color: "#777",
                fontFamily: "var(--font-mono)",
                fontSize: "0.8rem",
                padding: "8px 24px",
                cursor: "pointer",
              }}
            >
              Return Home
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TargetConnectionBadge({ state }: { state: ConnectionState }) {
  const Icon = state === "connected" ? Wifi : WifiOff;
  const color =
    state === "connected"
      ? "var(--color-accent)"
      : state === "connecting"
      ? "var(--color-warning)"
      : "#444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <div
        style={{
          width: "6px",
          height: "6px",
          background: color,
          boxShadow:
            state === "connected"
              ? "0 0 6px var(--color-accent-glow)"
              : "none",
        }}
      />
      <Icon style={{ width: "12px", height: "12px", color: "#444" }} />
    </div>
  );
}
