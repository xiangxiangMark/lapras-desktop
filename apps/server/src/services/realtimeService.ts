import type { NowPlayingState } from "@ai-music-companion/shared";
import type { WebSocket } from "ws";

export class RealtimeService {
  private readonly sockets = new Set<WebSocket>();

  register(socket: WebSocket, getInitialState: () => NowPlayingState) {
    this.sockets.add(socket);

    socket.send(
      JSON.stringify({
        type: "playback_state",
        payload: getInitialState()
      })
    );

    socket.on("close", () => {
      this.sockets.delete(socket);
    });
  }

  broadcast(state: NowPlayingState) {
    const message = JSON.stringify({
      type: "playback_state",
      payload: state
    });

    for (const socket of this.sockets) {
      if (socket.readyState === 1) {
        socket.send(message);
      }
    }
  }
}
