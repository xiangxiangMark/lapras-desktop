import { useEffect, useRef, useState } from "react";

import type { NowPlayingState } from "@ai-music-companion/shared";

import { getWebSocketUrl } from "../lib/api";

interface PlaybackEvent {
  type: "playback_state";
  payload: NowPlayingState;
}

interface PlaybackSocketState {
  state: NowPlayingState | null;
  connected: boolean;
}

export function usePlaybackSocket(): PlaybackSocketState {
  const [state, setState] = useState<NowPlayingState | null>(null);
  const [connected, setConnected] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let cancelled = false;

    function connect() {
      if (cancelled) return;

      try {
        socket = new WebSocket(getWebSocketUrl());
      } catch {
        // WebSocket URL is invalid — retry after delay
        scheduleReconnect();
        return;
      }

      socket.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        attempts = 0;
      };

      socket.onmessage = (event) => {
        if (cancelled) return;
        try {
          const payload = JSON.parse(event.data) as PlaybackEvent;
          if (payload.type === "playback_state") {
            setState(payload.payload);
          }
        } catch {
          // Ignore malformed events so the UI can stay responsive.
        }
      };

      socket.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        scheduleReconnect();
      };

      socket.onerror = () => {
        // onclose will fire after onerror, so reconnect is handled there
      };
    }

    function scheduleReconnect() {
      if (cancelled) return;

      // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
      const delay = Math.min(1000 * Math.pow(2, attempts), 30_000);
      attempts++;

      reconnectTimer = setTimeout(() => {
        connect();
      }, delay);
    }

    connect();

    return () => {
      cancelled = true;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
    };
  }, []);

  return { state, connected };
}
