import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE } from "@/lib/config";
import { useMicVAD } from "@ricky0123/vad-react";
import { Mic, MicOff, Radio, Wifi, WifiOff, Copy, Clock } from "lucide-react";
import { useWebSocket, type ConnectionState } from "@/hooks/useWebSocket";
import { float32ToWav, concatFloat32Arrays } from "@/lib/audio-utils";
import { formatTime } from "@/lib/utils";

// Auto-detect WebSocket URL from current page (works with ngrok proxy)
const WS_BASE = import.meta.env.VITE_WS_URL || "wss://speech-to-text-mdof.onrender.com";

// Interim streaming interval: send accumulated audio every ~1 second
const INTERIM_INTERVAL_MS = 1000;

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
  const navigate = useNavigate();
  const { token } = useAuth();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Interim streaming refs
  const speechFramesRef = useRef<Float32Array[]>([]);
  const interimTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const isSpeakingRef = useRef(false);

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

  const { connectionState, connect, disconnect, sendBinary, sendJson } = useWebSocket({
    url: `${WS_BASE}/ws/source/${sessionId}`,
    onMessage: handleMessage,
  });

  /**
   * Send an audio chunk with a signal type prefix.
   * Protocol: send JSON {"signal": type} then binary audio data.
   */
  const sendAudioChunk = useCallback((audioBuffer: ArrayBuffer, signal: "interim" | "final") => {
    if (connectionState !== "connected") return;
    sendJson({ signal });
    sendBinary(audioBuffer);
    setChunksSent((prev) => prev + 1);
  }, [connectionState, sendJson, sendBinary]);

  /**
   * Send the currently accumulated speech frames as an interim chunk.
   */
  const sendInterimChunk = useCallback(() => {
    if (speechFramesRef.current.length === 0) return;
    if (connectionState !== "connected") return;

    // Concatenate all accumulated frames
    const combined = concatFloat32Arrays(speechFramesRef.current);
    const wavBlob = float32ToWav(combined, 16000);
    wavBlob.arrayBuffer().then((buffer) => {
      sendAudioChunk(buffer, "interim");
    });
  }, [connectionState, sendAudioChunk]);

  /**
   * Start the interim streaming timer — fires every INTERIM_INTERVAL_MS
   * while the user is speaking.
   */
  const startInterimTimer = useCallback(() => {
    stopInterimTimer();
    interimTimerRef.current = setInterval(() => {
      if (isSpeakingRef.current) {
        sendInterimChunk();
      }
    }, INTERIM_INTERVAL_MS);
  }, [sendInterimChunk]);

  const stopInterimTimer = useCallback(() => {
    if (interimTimerRef.current !== undefined) {
      clearInterval(interimTimerRef.current);
      interimTimerRef.current = undefined;
    }
  }, []);

  // VAD — Voice Activity Detection
  const vad = useMicVAD({
    startOnLoad: true,
    baseAssetPath: "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/",
    onnxWASMBasePath: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/",

    onSpeechStart: () => {
      // User started speaking — reset the frame buffer and start interim timer
      speechFramesRef.current = [];
      isSpeakingRef.current = true;
      startInterimTimer();
    },

    onFrameProcessed: (probs: { isSpeech: number }, frame: Float32Array) => {
      // Accumulate every speech frame into the buffer
      // (VAD fires this callback ~30x/sec with 512 samples each)
      if (isSpeakingRef.current && probs.isSpeech > 0.3) {
        speechFramesRef.current.push(new Float32Array(frame));
      }
    },

    onSpeechEnd: (audio: Float32Array) => {
      // User stopped speaking — send the full utterance as a "final" chunk
      isSpeakingRef.current = false;
      stopInterimTimer();
      speechFramesRef.current = [];

      if (connectionState !== "connected") return;

      const wavBlob = float32ToWav(audio, 16000);
      wavBlob.arrayBuffer().then((buffer) => {
        sendAudioChunk(buffer, "final");
      });
    },

    positiveSpeechThreshold: 0.8,
    negativeSpeechThreshold: 0.3,
    minSpeechMs: 100,
    redemptionMs: 150,
  });

  // Auto-connect WebSocket on load
  useEffect(() => {
    connect();
    setIsRecording(true);
  }, [connect]);

  // Cleanup interim timer on unmount
  useEffect(() => {
    return () => stopInterimTimer();
  }, [stopInterimTimer]);

  // Start/stop recording (manual toggle still supported)
  const toggleRecording = useCallback(() => {
    if (isRecording) {
      vad.pause();
      disconnect();
      stopInterimTimer();
      setIsRecording(false);
      setInterimText("");
    } else {
      connect();
      vad.start();
      setIsRecording(true);
    }
  }, [isRecording, vad, connect, disconnect, stopInterimTimer]);

  // End Session
  const endSession = async () => {
    try {
      vad.pause();
      disconnect();
      stopInterimTimer();
      
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
      .join(" ");
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--color-bg-primary)" }}>
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex items-center gap-3">
          <Radio className="w-5 h-5" style={{ color: "var(--color-accent)" }} />
          <h1 className="text-lg font-semibold" style={{ color: "var(--color-text-primary)" }}>
            Speech Source
          </h1>
          <span className="text-xs font-mono px-2 py-1 rounded-md" style={{ background: "var(--color-bg-card)", color: "var(--color-text-secondary)" }}>
            {sessionId}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <ConnectionBadge state={connectionState} />
          <button 
            onClick={endSession}
            className="px-4 py-2 bg-red-500/10 text-red-500 text-sm font-medium rounded-md border border-red-500/20 hover:bg-red-500/20 transition-colors"
          >
            End Session
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center gap-8 p-6">
        {/* Waveform Visualizer */}
        <div className="waveform-container" style={{ height: "60px" }}>
          {Array.from({ length: 24 }).map((_, i) => (
            <div
              key={i}
              className={`waveform-bar ${vad.userSpeaking ? "active" : ""}`}
              style={{
                height: vad.userSpeaking
                  ? `${Math.random() * 50 + 10}px`
                  : "6px",
                opacity: vad.userSpeaking ? 1 : 0.3,
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
            <div className="animate-spin w-8 h-8 border-2 border-t-transparent rounded-full" style={{ borderColor: "var(--color-text-muted)", borderTopColor: "transparent" }} />
          ) : isRecording ? (
            <MicOff className="w-8 h-8" />
          ) : (
            <Mic className="w-8 h-8" />
          )}
        </button>

        <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
          {vad.loading
            ? "Loading VAD model..."
            : isRecording
            ? vad.userSpeaking
              ? "🎙️ Streaming live..."
              : "Waiting for speech..."
            : "Click to start recording"}
        </p>

        {/* Stats Row */}
        <div className="flex items-center gap-6">
          <StatBadge icon={<Radio className="w-3.5 h-3.5" />} label="Chunks" value={chunksSent} />
          <StatBadge icon={<Copy className="w-3.5 h-3.5" />} label="Words" value={wordCount} />
        </div>
      </div>

      {/* Transcript Preview (Bottom Panel) */}
      <div className="glass-card mx-4 mb-4" style={{ maxHeight: "35vh" }}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
          <span className="text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>
            Transcript Preview
          </span>
          {transcripts.length > 0 && (
            <button
              onClick={copyTranscripts}
              className="text-xs flex items-center gap-1 px-2 py-1 rounded-md transition-colors hover:bg-white/5"
              style={{ color: "var(--color-text-muted)" }}
            >
              <Copy className="w-3 h-3" /> Copy
            </button>
          )}
        </div>
        <div ref={scrollRef} className="overflow-y-auto p-4" style={{ maxHeight: "calc(35vh - 44px)" }}>
          {transcripts.length === 0 && !interimText ? (
            <p className="text-sm text-center py-4" style={{ color: "var(--color-text-muted)" }}>
              Transcripts will appear here...
            </p>
          ) : (
            <>
              {/* Final transcripts */}
              {transcripts
                .filter((t) => t.type === "final" || t.type === "transcript")
                .map((t, i) => (
                  <div key={i} className="transcript-entry">
                    <div className="flex items-center gap-2 timestamp">
                      <Clock className="w-3 h-3" />
                      {t.timestamp && formatTime(t.timestamp)}
                      {t.latency_ms && (
                        <span style={{ color: t.latency_ms < 300 ? "var(--color-success)" : "var(--color-warning)" }}>
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
                  <div className="flex items-center gap-2 timestamp">
                    <span className="interim-dot" />
                    <span style={{ color: "var(--color-accent)", fontSize: "0.7rem" }}>LIVE</span>
                  </div>
                  <div className="text" style={{ color: "var(--color-text-secondary)", fontStyle: "italic" }}>
                    {interimText}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Sub-components ──────────────────────────────────────────────── */

function ConnectionBadge({ state }: { state: ConnectionState }) {
  const labels: Record<ConnectionState, string> = {
    connected: "Connected",
    connecting: "Connecting...",
    disconnected: "Offline",
    error: "Error",
  };
  const Icon = state === "connected" ? Wifi : WifiOff;

  return (
    <div className="flex items-center gap-2 text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>
      <span className={`status-dot ${state}`} />
      <Icon className="w-3.5 h-3.5" />
      {labels[state]}
    </div>
  );
}

function StatBadge({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
      {icon}
      <span>{label}:</span>
      <span className="font-mono font-medium" style={{ color: "var(--color-text-secondary)" }}>{value}</span>
    </div>
  );
}
