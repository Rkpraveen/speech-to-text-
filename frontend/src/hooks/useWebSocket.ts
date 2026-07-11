import { useCallback, useEffect, useRef, useState } from "react";

export type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

interface UseWebSocketOptions {
  url: string;
  onMessage?: (data: any) => void;
  onBinaryMessage?: (data: Blob) => void;
  autoReconnect?: boolean;
  heartbeatInterval?: number;
}

export function useWebSocket({
  url,
  onMessage,
  onBinaryMessage,
  autoReconnect = true,
  heartbeatInterval = 15000,
}: UseWebSocketOptions) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 20;
  const isMountedRef = useRef(true);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      setConnectionState("connecting");
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        if (!isMountedRef.current) return;
        setConnectionState("connected");
        reconnectAttempts.current = 0;
        console.log(`[WS] Connected: ${url}`);

        // Start heartbeat
        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send("ping");
          }
        }, heartbeatInterval);
      };

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return;

        if (event.data instanceof ArrayBuffer) {
          onBinaryMessage?.(new Blob([event.data]));
        } else if (typeof event.data === "string") {
          if (event.data === "pong") return; // heartbeat response
          try {
            const parsed = JSON.parse(event.data);
            onMessage?.(parsed);
          } catch {
            onMessage?.(event.data);
          }
        }
      };

      ws.onclose = () => {
        if (!isMountedRef.current) return;
        setConnectionState("disconnected");
        clearInterval(heartbeatRef.current);
        console.log(`[WS] Disconnected: ${url}`);

        // Auto-reconnect with exponential backoff
        if (autoReconnect && reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 10000);
          reconnectAttempts.current++;
          console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`);
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        if (!isMountedRef.current) return;
        setConnectionState("error");
      };

      wsRef.current = ws;
    } catch (err) {
      console.error("[WS] Connection error:", err);
      setConnectionState("error");
    }
  }, [url, onMessage, onBinaryMessage, autoReconnect, heartbeatInterval]);

  const disconnect = useCallback(() => {
    clearTimeout(reconnectTimeoutRef.current);
    clearInterval(heartbeatRef.current);
    reconnectAttempts.current = maxReconnectAttempts; // prevent reconnect
    wsRef.current?.close();
    wsRef.current = null;
    setConnectionState("disconnected");
  }, []);

  const sendBinary = useCallback((data: Blob | ArrayBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  const sendJson = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
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
    sendBinary,
    sendJson,
    ws: wsRef,
  };
}
