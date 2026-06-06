export type DesktopSyncEvent =
  | { type: "desktop-preferences-updated" }
  | { type: "settings-updated" }
  | { type: "netease-updated" }
  | { type: "profiles-updated" }
  | { type: "favorites-updated" }
  | { type: "music-profile-updated" };

const CHANNEL_NAME = "lapras-desktop-sync";

function createChannel() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return null;
  }

  return new BroadcastChannel(CHANNEL_NAME);
}

export function publishDesktopSyncEvent(event: DesktopSyncEvent) {
  const channel = createChannel();

  if (!channel) {
    return;
  }

  channel.postMessage(event);
  channel.close();
}

export function subscribeDesktopSyncEvents(
  callback: (event: DesktopSyncEvent) => void
) {
  const channel = createChannel();

  if (!channel) {
    return () => undefined;
  }

  const listener = (message: MessageEvent<DesktopSyncEvent>) => {
    if (message.data?.type) {
      callback(message.data);
    }
  };

  channel.addEventListener("message", listener);

  return () => {
    channel.removeEventListener("message", listener);
    channel.close();
  };
}
