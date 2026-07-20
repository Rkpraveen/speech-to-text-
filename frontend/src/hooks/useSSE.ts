import { useCallback, useEffect, useRef, useState } from "react";

export type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

interface UseSSEOptions {
  url: string;
  onMessage?: (data: any) => void;
  autoReconnect?: boolean;
}

/**
 * React hook for Server-Sent Events (SSE) connections.
 * Read-only streaming — the server pushes events, the client only listens.
 */
export function useSSE({
  url,
  onMessage,
  autoReconnect = true,
}: UseSSEOptions) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 20;
  const isMountedRef = useRef(true);

  const connect = useCallback(() => {
    if (eventSourceRef.current?.readyState === EventSource.OPEN) return;
    if (!url) return;

    try {
      // Close any existing connection
      eventSourceRef.current?.close();

      setConnectionState("connecting");
      const es = new EventSource(url);

      es.onopen = () => {
        if (!isMountedRef.current) return;
        setConnectionState("connected");
        reconnectAttempts.current = 0;
        console.log(`[SSE] Connected: ${url}`);
      };

      es.onmessage = (event) => {
        if (!isMountedRef.current) return;

        try {
          const parsed = JSON.parse(event.data);
          onMessage?.(parsed);
        } catch {
          // Non-JSON message, pass as-is
          onMessage?.(event.data);
        }
      };

      es.onerror = () => {
        if (!isMountedRef.current) return;

        // EventSource auto-reconnects on its own, but if it fully closes
        // we handle reconnection manually
        if (es.readyState === EventSource.CLOSED) {
          setConnectionState("disconnected");
          console.log(`[SSE] Disconnected: ${url}`);

          // Auto-reconnect with exponential backoff
          if (autoReconnect && reconnectAttempts.current < maxReconnectAttempts) {
            const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 10000);
            reconnectAttempts.current++;
            console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`);
            reconnectTimeoutRef.current = setTimeout(connect, delay);
          }
        } else {
          // Temporary error, EventSource will auto-retry
          setConnectionState("connecting");
        }
      };

      eventSourceRef.current = es;
    } catch (err) {
      console.error("[SSE] Connection error:", err);
      setConnectionState("error");
    }
  }, [url, onMessage, autoReconnect]);

  const disconnect = useCallback(() => {
    clearTimeout(reconnectTimeoutRef.current);
    reconnectAttempts.current = maxReconnectAttempts; // prevent reconnect
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setConnectionState("disconnected");
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      disconnect();
    };
  }, [disconnect]);

  return {
    connectionState,
    connect,
    disconnect,
  };
}
