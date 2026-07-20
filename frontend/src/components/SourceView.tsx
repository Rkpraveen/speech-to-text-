import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE } from "@/lib/config";
import { useMicVAD } from "@ricky0123/vad-react";
import { Mic, MicOff, Wifi, WifiOff, Copy, Clock } from "lucide-react";
import { useWebSocket, type ConnectionState } from "@/hooks/useWebSocket";
import { float32ToLinear16, concatFloat32Arrays } from "@/lib/audio-utils";
import { formatTime } from "@/lib/utils";

// Auto-detect WebSocket URL from current page (works with ngrok proxy)
const WS_BASE = import.meta.env.VITE_WS_URL || "wss://speech-to-text-mdof.onrender.com";

// Stream audio to backend every N ms (continuous streaming for Deepgram)
const STREAM_INTERVAL_MS = 250;

interface TranscriptMessage {
  type: string;
  text?: string;
  timestamp?: string;
  latency_ms?: number;
  status?: string;
}

interface SourceViewProps {
  sessionId: string;
}

export default function SourceView({ sessionId }: SourceViewProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptMessage[]>([]);
  const [interimText, setInterimText] = useState("");
  const [wordCount, setWordCount] = useState(0);
  const [chunksSent, setChunksSent] = useState(0);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const navigate = useNavigate();
  const { token } = useAuth();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Audio streaming refs
  const audioFramesRef = useRef<Float32Array[]>([]);
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // WebSocket connection to backend
  const handleMessage = useCallback((data: TranscriptMessage) => {
    if (data.type === "final" && data.text) {
      // Final transcript — add to permanent history
      setTranscripts((prev) => [...prev, data]);
      setWordCount((prev) => prev + (data.text?.split(/\s+/).length || 0));
      setInterimText(""); // Clear interim preview
    } else if (data.type === "interim" && data.text) {
      // Interim transcript — update live preview (replaces, doesn't append)
      setInterimText(data.text);
    } else if (data.type === "transcript" && data.text) {
      // Backward compatibility with old format
      setTranscripts((prev) => [...prev, data]);
      setWordCount((prev) => prev + (data.text?.split(/\s+/).length || 0));
    }
  }, []);

  const { connectionState, connect, disconnect, sendBinary } = useWebSocket({
    url: `${WS_BASE}/ws/source/${sessionId}`,
    onMessage: handleMessage,
  });

  /**
   * Send accumulated audio frames as raw Linear16 PCM to the backend.
   * The backend forwards this directly to Deepgram's streaming WebSocket.
   * No signal protocol needed — Deepgram handles interim/final distinction.
   */
  const flushAudioFrames = useCallback(() => {
    if (audioFramesRef.current.length === 0) return;
    if (connectionState !== "connected") return;

    // Grab and clear the accumulated frames
    const frames = audioFramesRef.current;
    audioFramesRef.current = [];

    // Concatenate and convert to Linear16 PCM
    const combined = concatFloat32Arrays(frames);
    const pcmBuffer = float32ToLinear16(combined);

    // Send raw PCM bytes to backend (no WAV header, no signal prefix)
    sendBinary(pcmBuffer);
    setChunksSent((prev) => prev + 1);
  }, [connectionState, sendBinary]);

  /**
   * Start the continuous audio streaming timer.
   * Fires every STREAM_INTERVAL_MS to flush accumulated audio frames.
   */
  const startStreamTimer = useCallback(() => {
    stopStreamTimer();
    streamTimerRef.current = setInterval(() => {
      flushAudioFrames();
    }, STREAM_INTERVAL_MS);
  }, [flushAudioFrames]);

  const stopStreamTimer = useCallback(() => {
    if (streamTimerRef.current !== undefined) {
      clearInterval(streamTimerRef.current);
      streamTimerRef.current = undefined;
    }
  }, []);

  // VAD — Voice Activity Detection (used for UI indicators only)
  // Audio is streamed continuously regardless of speech detection.
  // Deepgram's own VAD handles endpointing on the server side.
  const vad = useMicVAD({
    startOnLoad: true,
    baseAssetPath: "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/",
    onnxWASMBasePath: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/",

    onSpeechStart: () => {
      // UI indicator only — streaming is already happening
    },

    onFrameProcessed: (_probs: { isSpeech: number }, frame: Float32Array) => {
      // Accumulate EVERY frame (speech or silence) for continuous streaming.
      // Deepgram handles VAD on its side — we just send everything.
      audioFramesRef.current.push(new Float32Array(frame));
    },

    onSpeechEnd: () => {
      // Flush any remaining frames immediately when speech ends
      // for slightly faster final delivery
      flushAudioFrames();
    },

    positiveSpeechThreshold: 0.8,
    negativeSpeechThreshold: 0.3,
    minSpeechMs: 100,
    redemptionMs: 150,
  });

  // Load existing transcripts from DB on mount (survives reload)
  useEffect(() => {
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
          setWordCount(
            restored.reduce(
              (sum: number, r: { text?: string }) =>
                sum + (r.text?.split(/\s+/).length || 0),
              0
            )
          );
        }
      })
      .catch((err) => console.error("[SourceView] Failed to load history:", err));
  }, [sessionId]);

  // Auto-connect WebSocket and start streaming on load
  useEffect(() => {
    connect();
    setIsRecording(true);
    startStreamTimer();
  }, [connect, startStreamTimer]);

  // Cleanup stream timer on unmount
  useEffect(() => {
    return () => stopStreamTimer();
  }, [stopStreamTimer]);

  // Start/stop recording (manual toggle still supported)
  const toggleRecording = useCallback(() => {
    if (isRecording) {
      vad.pause();
      flushAudioFrames(); // Send any remaining audio
      stopStreamTimer();
      disconnect();
      setIsRecording(false);
      setInterimText("");
    } else {
      connect();
      startStreamTimer();
      vad.start();
      setIsRecording(true);
    }
  }, [isRecording, vad, connect, disconnect, startStreamTimer, stopStreamTimer, flushAudioFrames]);

  // End Session
  const endSession = async () => {
    try {
      vad.pause();
      flushAudioFrames();
      stopStreamTimer();
      disconnect();
      
      await fetch(`${API_BASE}/api/sessions/${sessionId}/end`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      
      navigate("/");
    } catch (e) {
      console.error("Failed to end session:", e);
    }
  };

  // Auto-scroll transcript
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [transcripts, interimText]);

  // Copy all transcripts
  const copyTranscripts = () => {
    const text = transcripts
      .filter((t) => t.type === "final" || t.type === "transcript")
      .map((t) => t.text)
      .filter(Boolean)
      .join(" ");
    navigator.clipboard.writeText(text);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  return (
    <>
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#000",
        fontFamily: "var(--font-mono)",
        color: "#e0e0e0",
      }}
    >
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 20px",
          borderBottom: "1px solid #1a1a1a",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span
            style={{
              fontSize: "0.85rem",
              fontWeight: 500,
              color: "#e0e0e0",
            }}
          >
            Source
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
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <ConnectionBadge state={connectionState} />
          <button
            onClick={() => setShowEndConfirm(true)}
            style={{
              background: "transparent",
              border: "1px solid var(--color-error)",
              color: "var(--color-error)",
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              fontWeight: 500,
              padding: "6px 16px",
              cursor: "pointer",
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-error-dim)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            End Session
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "32px",
          padding: "24px",
        }}
      >
        {/* Waveform Visualizer */}
        <div className="waveform-container" style={{ height: "48px" }}>
          {Array.from({ length: 24 }).map((_, i) => (
            <div
              key={i}
              className={`waveform-bar ${vad.userSpeaking ? "active" : ""}`}
              style={{
                height: vad.userSpeaking
                  ? `${(Math.sin(i * 0.7 + Date.now() * 0.005) * 0.5 + 0.5) * 40 + 8}px`
                  : "4px",
                opacity: vad.userSpeaking ? 1 : 0.2,
                transition: "height 0.08s ease, opacity 0.3s ease",
              }}
            />
          ))}
        </div>

        {/* Mic Button */}
        <button
          onClick={toggleRecording}
          className={`mic-button ${isRecording ? (vad.userSpeaking ? "speaking" : "active") : ""}`}
          disabled={vad.loading}
        >
          {vad.loading ? (
            <div
              style={{
                width: "24px",
                height: "24px",
                border: "2px solid #333",
                borderTopColor: "transparent",
                animation: "pulse 1s linear infinite",
              }}
            />
          ) : isRecording ? (
            <MicOff style={{ width: "28px", height: "28px" }} />
          ) : (
            <Mic style={{ width: "28px", height: "28px" }} />
          )}
        </button>

        <p
          style={{
            fontSize: "0.75rem",
            color: vad.userSpeaking ? "var(--color-accent)" : "#555",
          }}
        >
          {vad.loading
            ? "Loading…"
            : isRecording
            ? vad.userSpeaking
              ? "Streaming"
              : "Listening"
            : "Stopped"}
        </p>

        {/* Stats Row */}
        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          <StatBadge label="Chunks" value={chunksSent} />
          <StatBadge label="Words" value={wordCount} />
        </div>
      </div>

      {/* Transcript Preview (Bottom Panel) */}
      <div
        className="flat-card"
        style={{ margin: "0 16px 16px", maxHeight: "35vh" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 12px",
            borderBottom: "1px solid #1a1a1a",
          }}
        >
          <span style={{ fontSize: "0.7rem", color: "#555" }}>
            Transcript
          </span>
          {transcripts.length > 0 && (
            <button
              onClick={copyTranscripts}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "0.65rem",
                color: "#444",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "2px 6px",
              }}
            >
               <Copy style={{ width: "10px", height: "10px" }} />
               {copyFeedback ? "Copied!" : "Copy"}
            </button>
          )}
        </div>
        <div
          ref={scrollRef}
          style={{
            overflowY: "auto",
            padding: "8px 12px",
            maxHeight: "calc(35vh - 36px)",
          }}
        >
          {transcripts.length === 0 && !interimText ? (
            <p
              style={{
                fontSize: "0.75rem",
                textAlign: "center",
                padding: "16px 0",
                color: "#333",
              }}
            >
              Transcripts will appear here
            </p>
          ) : (
            <>
              {/* Final transcripts */}
              {transcripts
                .filter((t) => t.type === "final" || t.type === "transcript")
                .map((t, i) => (
                  <div key={i} className="transcript-entry">
                    <div
                      className="timestamp"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <Clock style={{ width: "10px", height: "10px" }} />
                      {t.timestamp && formatTime(t.timestamp)}
                      {t.latency_ms && (
                        <span
                          style={{
                            color:
                              t.latency_ms < 300
                                ? "var(--color-accent)"
                                : "var(--color-warning)",
                          }}
                        >
                          {t.latency_ms}ms
                        </span>
                      )}
                    </div>
                    <div className="text">{t.text}</div>
                  </div>
                ))}

              {/* Live interim preview */}
              {interimText && (
                <div className="transcript-entry interim-entry">
                  <div
                    className="timestamp"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span className="interim-dot" />
                    <span
                      style={{
                        color: "var(--color-accent)",
                        fontSize: "0.6rem",
                      }}
                    >
                      LIVE
                    </span>
                  </div>
                  <div
                    className="text"
                    style={{ color: "#777", fontStyle: "normal" }}
                  >
                    {interimText}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>

      {/* End Session Confirmation Overlay */}
      {showEndConfirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.85)",
          }}
        >
          <div
            style={{
              border: "1px solid var(--color-error)",
              padding: "32px 40px",
              textAlign: "center",
              background: "#050505",
              maxWidth: "360px",
            }}
          >
            <h3
              style={{
                fontSize: "0.95rem",
                fontWeight: 500,
                color: "#e0e0e0",
                marginBottom: "12px",
              }}
            >
              End this session?
            </h3>
            <p
              style={{
                fontSize: "0.75rem",
                color: "#777",
                marginBottom: "24px",
                lineHeight: 1.6,
              }}
            >
              This will disconnect all targets and stop transcription. This action cannot be undone.
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              <button
                onClick={() => setShowEndConfirm(false)}
                style={{
                  background: "transparent",
                  border: "1px solid #1a1a1a",
                  color: "#777",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.75rem",
                  padding: "8px 20px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowEndConfirm(false);
                  endSession();
                }}
                style={{
                  background: "var(--color-error-dim)",
                  border: "1px solid var(--color-error)",
                  color: "var(--color-error)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  padding: "8px 20px",
                  cursor: "pointer",
                }}
              >
                End Session
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
/* ─── Sub-components ──────────────────────────────────────────────── */

function ConnectionBadge({ state }: { state: ConnectionState }) {
  const labels: Record<ConnectionState, string> = {
    connected: "Connected",
    connecting: "Connecting",
    disconnected: "Offline",
    error: "Error",
  };
  const Icon = state === "connected" ? Wifi : WifiOff;
  const color =
    state === "connected"
      ? "var(--color-accent)"
      : state === "connecting"
      ? "var(--color-warning)"
      : "#444";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "0.7rem",
        color: "#777",
      }}
    >
      <span className={`status-dot ${state}`} />
      <Icon style={{ width: "12px", height: "12px", color: "#555" }} />
      <span style={{ color }}>{labels[state]}</span>
    </div>
  );
}

function StatBadge({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "0.7rem",
        color: "#444",
      }}
    >
      <span>{label}</span>
      <span style={{ color: "#777", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
    </div>
  );
}
