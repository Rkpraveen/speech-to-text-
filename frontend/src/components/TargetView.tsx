import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Smartphone, Wifi, WifiOff, Copy, Maximize2, Volume2, Clock } from "lucide-react";
import { useWebSocket, type ConnectionState } from "@/hooks/useWebSocket";
import { formatTime } from "@/lib/utils";

// Auto-detect WebSocket URL from current page (works with ngrok proxy)
const WS_BASE = import.meta.env.VITE_WS_URL || "wss://speech-to-text-mdof.onrender.com";

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
  const [sourceConnected, setSourceConnected] = useState(false);
  const [, setIsFullscreen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [sessionEnded, setSessionEnded] = useState(false);
  const [joinSessionId, setJoinSessionId] = useState("");
  const navigate = useNavigate();

  // WebSocket connection to receive transcripts
  const handleMessage = useCallback((data: TranscriptMessage) => {
    if (data.type === "transcript" && data.text) {
      setTranscripts((prev) => [...prev, data]);
    } else if (data.type === "end_session") {
      setSessionEnded(true);
      setSourceConnected(false);
    } else if (data.type === "status") {
      if (data.status === "source_connected") {
        setSourceConnected(true);
      } else if (data.status === "source_disconnected") {
        setSourceConnected(false);
      } else if (data.status === "connected" && data.has_source !== undefined) {
        setSourceConnected(data.has_source as boolean);
      }
    }
  }, []);

  const { connectionState, connect } = useWebSocket({
    url: sessionId ? `${WS_BASE}/ws/target/${sessionId}` : "",
    onMessage: handleMessage,
  });

  // Auto-connect on mount if sessionId is present
  useEffect(() => {
    if (sessionId) {
      connect();
    }
  }, [connect, sessionId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [transcripts]);

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Copy all text
  const copyAll = () => {
    const text = transcripts
      .filter((t) => t.type === "transcript")
      .map((t) => t.text)
      .join(" ");
    navigator.clipboard.writeText(text);
  };

  const lastTranscript = transcripts.filter((t) => t.type === "transcript").at(-1);

  if (!sessionId) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-6 text-white relative overflow-hidden">
        {/* Background accents */}
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[120px] pointer-events-none" />
        
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-sm flex flex-col items-center text-center max-w-md w-full relative z-10 shadow-2xl">
          <div className="w-20 h-20 bg-purple-500/20 text-purple-400 rounded-full flex items-center justify-center mb-6">
            <Radio size={40} />
          </div>
          <h2 className="text-2xl font-bold mb-3">Join a Live Stream</h2>
          <p className="text-gray-400 mb-8 text-sm">
            Enter the 6-character session code provided by the host to view the live transcription.
          </p>
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              if (joinSessionId.trim()) navigate(`/live?session=${joinSessionId.trim().toUpperCase()}`);
            }} 
            className="w-full"
          >
            <div className="flex flex-col gap-3">
              <input
                type="text"
                placeholder="e.g. M9ARWM"
                value={joinSessionId}
                onChange={(e) => setJoinSessionId(e.target.value.toUpperCase())}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-4 text-white uppercase text-center text-lg focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 transition-all"
                maxLength={6}
              />
              <button
                type="submit"
                disabled={joinSessionId.length < 2}
                className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-4 rounded-xl transition-all disabled:opacity-50"
              >
                Connect to Stream
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full flex flex-col"
      style={{ background: "var(--color-bg-primary)" }}
    >
      {/* Top Bar — Minimal for mobile */}
      <header
        className="flex items-center justify-between px-4 py-3 border-b shrink-0"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-2">
          <Smartphone className="w-4 h-4" style={{ color: "var(--color-accent)" }} />
          <span className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
            Live
          </span>
          <span
            className="text-xs font-mono px-1.5 py-0.5 rounded"
            style={{ background: "var(--color-bg-card)", color: "var(--color-text-muted)" }}
          >
            {sessionId}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Source status */}
          <div className="flex items-center gap-1.5 text-xs" style={{ color: sourceConnected ? "var(--color-success)" : "var(--color-text-muted)" }}>
            <Volume2 className="w-3.5 h-3.5" />
            {sourceConnected ? "Source live" : "No source"}
          </div>

          {/* Connection status */}
          <TargetConnectionBadge state={connectionState} />

          {/* Actions */}
          <button onClick={copyAll} className="p-1.5 rounded-md hover:bg-white/5 transition-colors" title="Copy all">
            <Copy className="w-4 h-4" style={{ color: "var(--color-text-muted)" }} />
          </button>
          <button onClick={toggleFullscreen} className="p-1.5 rounded-md hover:bg-white/5 transition-colors" title="Fullscreen">
            <Maximize2 className="w-4 h-4" style={{ color: "var(--color-text-muted)" }} />
          </button>
        </div>
      </header>

      {/* Main Text Display Area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6"
        style={{ scrollBehavior: "smooth" }}
      >
        {transcripts.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{
                background: "var(--color-bg-card)",
                border: "2px solid var(--color-border)",
              }}
            >
              <Volume2 className="w-7 h-7" style={{ color: "var(--color-text-muted)" }} />
            </div>
            <div className="text-center">
              <p className="text-lg font-medium" style={{ color: "var(--color-text-secondary)" }}>
                Waiting for speech...
              </p>
              <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
                {connectionState === "connected"
                  ? sourceConnected
                    ? "Source is connected. Speak into the laptop mic."
                    : "Connected. Waiting for source to connect."
                  : "Connecting to server..."}
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto">
            {/* Continuous text display */}
            <div className="target-text-display">
              {transcripts
                .filter((t) => t.type === "transcript" && t.text)
                .map((t, i) => (
                  <span
                    key={i}
                    className={i === transcripts.filter((t) => t.type === "transcript").length - 1 ? "new-word" : ""}
                  >
                    {t.text}{" "}
                  </span>
                ))}
            </div>

            {/* Latest transcript metadata */}
            {lastTranscript && (
              <div className="mt-6 flex items-center gap-4 text-xs" style={{ color: "var(--color-text-muted)" }}>
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {lastTranscript.timestamp && formatTime(lastTranscript.timestamp)}
                </div>
                {lastTranscript.latency_ms && (
                  <div
                    className="font-mono"
                    style={{
                      color: lastTranscript.latency_ms < 300 ? "var(--color-success)" : "var(--color-warning)",
                    }}
                  >
                    ⚡ {lastTranscript.latency_ms}ms
                  </div>
                )}
                <div className="font-mono">
                  {transcripts.filter((t) => t.type === "transcript").length} segments
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom safe area for mobile */}
      <div className="h-2 shrink-0" style={{ background: "var(--color-bg-primary)" }} />
    </div>
  );
}

/* ─── Sub-components ──────────────────────────────────────────────── */

function TargetConnectionBadge({ state }: { state: ConnectionState }) {
  const Icon = state === "connected" ? Wifi : WifiOff;
  return (
    <div className="flex items-center gap-1.5">
      <span className={`status-dot ${state}`} />
      <Icon className="w-3.5 h-3.5" style={{ color: "var(--color-text-muted)" }} />
    </div>
  );
}
