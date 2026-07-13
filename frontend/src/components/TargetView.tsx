import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Smartphone, Wifi, WifiOff, Maximize2, Volume2, Copy } from "lucide-react";
import { useWebSocket, type ConnectionState } from "@/hooks/useWebSocket";

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
  const [interimText, setInterimText] = useState("");
  const [sourceConnected, setSourceConnected] = useState(false);
  const [, setIsFullscreen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [sessionEnded, setSessionEnded] = useState(false);
  const [joinSessionId, setJoinSessionId] = useState("");
  const navigate = useNavigate();

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

  const { connectionState, connect } = useWebSocket({
    url: sessionId ? `${WS_BASE}/ws/target/${sessionId}` : "",
    onMessage: handleMessage,
  });

  useEffect(() => {
    if (sessionId) connect();
  }, [connect, sessionId]);

  // Auto-scroll to top when new stream arrives
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: 0,
        behavior: "smooth",
      });
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
    const text = transcripts.map((t) => t.text).join(" ");
    navigator.clipboard.writeText(text);
  };

  if (!sessionId) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-6 text-white relative">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 max-w-md w-full relative z-10 shadow-2xl">
          <h2 className="text-2xl font-bold mb-3 text-center">Join Stream</h2>
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              if (joinSessionId.trim()) navigate(`/live?session=${joinSessionId.trim().toUpperCase()}`);
            }} 
            className="w-full"
          >
            <input
              type="text"
              placeholder="Session Code"
              value={joinSessionId}
              onChange={(e) => setJoinSessionId(e.target.value.toUpperCase())}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-4 text-white uppercase text-center text-lg mb-3"
              maxLength={6}
            />
            <button
              type="submit"
              disabled={joinSessionId.length < 2}
              className="w-full bg-purple-600 text-white font-semibold py-4 rounded-xl disabled:opacity-50"
            >
              Connect
            </button>
          </form>
        </div>
      </div>
    );
  }

  const hasInterim = interimText.length > 0;

  return (
    <div
      ref={containerRef}
      className="h-full flex flex-col relative"
      style={{ background: "var(--color-bg-primary)" }}
    >
      {/* ─── Header ─── */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-medium text-white">Live</span>
          <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-white/10 text-gray-400">
            {sessionId}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <Volume2 className="w-3.5 h-3.5" />
            <span style={{ color: sourceConnected ? "#10b981" : "inherit" }}>
              {sourceConnected ? "Source live" : "No source"}
            </span>
          </div>
          <TargetConnectionBadge state={connectionState} />
          <button onClick={copyAll} className="p-1.5 hover:bg-white/10 rounded">
            <Copy className="w-4 h-4 text-gray-400" />
          </button>
          <button onClick={toggleFullscreen} className="p-1.5 hover:bg-white/10 rounded">
            <Maximize2 className="w-4 h-4 text-gray-400" />
          </button>
        </div>
      </header>

      {/* ─── Scrollable Continuous Text Area ─── */}
      <div 
        ref={scrollRef} 
        className="flex-1 overflow-y-auto p-4 md:p-8 flex flex-col gap-4 pb-32"
      >
        {transcripts.length === 0 && !hasInterim ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center opacity-50 mt-20">
            <Volume2 className="w-12 h-12 mb-4" />
            <p className="text-lg">Waiting for speech...</p>
          </div>
        ) : (
          <>
            {/* 1. LATEST STREAM AT THE VERY TOP (Large Font) */}
            <div className="shrink-0 mb-4 transition-all duration-300">
              {hasInterim ? (
                <div className="text-3xl md:text-5xl text-white font-medium leading-tight italic">
                  {interimText}
                  <span className="typing-cursor ml-2" />
                </div>
              ) : (
                transcripts.length > 0 && (
                  <div className="text-3xl md:text-5xl text-white font-medium leading-tight">
                    {transcripts[transcripts.length - 1].text}
                  </div>
                )
              )}
            </div>

            {/* 2. HISTORY AT THE BOTTOM (Small Font, Reverse Chronological) */}
            <div className="flex flex-col gap-3 opacity-60">
              {[...transcripts]
                .slice(0, hasInterim ? transcripts.length : transcripts.length - 1)
                .reverse()
                .map((t, i) => (
                  <div 
                    key={i} 
                    className="text-base md:text-xl text-gray-300 leading-relaxed"
                  >
                    {t.text}
                  </div>
                ))}
            </div>
          </>
        )}
      </div>

      {sessionEnded && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="bg-white/10 p-8 rounded-2xl text-center border border-white/20">
            <WifiOff size={48} className="text-red-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-white mb-2">Session Ended</h2>
            <button onClick={() => navigate("/")} className="mt-4 px-6 py-2 bg-white/20 rounded-lg text-white">
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
  const color = state === "connected" ? "#10b981" : state === "connecting" ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      <Icon className="w-3.5 h-3.5 text-gray-400" />
    </div>
  );
}
