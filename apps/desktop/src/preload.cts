const { contextBridge, ipcRenderer } = require("electron");

type DesktopState = {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  alwaysOnTop: boolean;
  openAtLogin: boolean;
  settingsWindowOpen: boolean;
  compactMode: boolean;
};

type DesktopWindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type MediaCommand = "playpause" | "next" | "previous";
type RendererErrorPayload = {
  level?: "info" | "warn" | "error";
  message?: string;
  stack?: string;
  source?: string;
  lineno?: number;
  colno?: number;
  reason?: unknown;
};

function readApiBaseUrl() {
  const argument = process.argv.find((item) =>
    item.startsWith("--lapras-api-base-url=")
  );

  if (!argument) {
    return process.env.LAPRAS_API_BASE_URL || "http://127.0.0.1:8790";
  }

  return argument.slice("--lapras-api-base-url=".length);
}

const apiBaseUrl = readApiBaseUrl();

function readLocalToken() {
  const argument = process.argv.find((item) =>
    item.startsWith("--lapras-local-token=")
  );
  if (!argument) {
    return process.env.LAPRAS_LOCAL_TOKEN || "";
  }
  return argument.slice("--lapras-local-token=".length);
}

const localToken = readLocalToken();

const desktopApi = {
  platform: process.platform,
  apiBaseUrl,
  localToken,
  getInfo: () => ipcRenderer.invoke("lapras:desktop-info") as Promise<DesktopState>,
  getVersion: () => ipcRenderer.invoke("lapras:app-version") as Promise<string>,
  openLogsDirectory: () =>
    ipcRenderer.invoke("lapras:logs-directory:open") as Promise<{
      ok: boolean;
      path: string;
      error?: string;
    }>,
  ensureLocalServices: () =>
    ipcRenderer.invoke("lapras:local-services:ensure") as Promise<{
      ok: boolean;
      error?: string;
    }>,
  versions: {
    electron: process.versions.electron || "",
    node: process.versions.node || "",
    chrome: process.versions.chrome || ""
  } as const,
  getWindowBounds: () =>
    ipcRenderer.invoke("lapras:window-bounds:get") as Promise<DesktopWindowBounds | null>,
  setWindowBounds: (bounds: DesktopWindowBounds) =>
    ipcRenderer.invoke("lapras:window-bounds:set", bounds) as Promise<DesktopWindowBounds | null>,
  minimize: () => ipcRenderer.send("lapras:window:minimize"),
  hideToTray: () => ipcRenderer.send("lapras:window:hide-to-tray"),
  showWindow: () => ipcRenderer.send("lapras:window:show"),
  quitApp: () => ipcRenderer.send("lapras:window:quit"),
  openSettingsWindow: () =>
    ipcRenderer.invoke("lapras:settings-window:open") as Promise<DesktopState>,
  focusSettingsWindow: () =>
    ipcRenderer.invoke("lapras:settings-window:focus") as Promise<DesktopState>,
  closeSettingsWindow: () =>
    ipcRenderer.invoke("lapras:settings-window:close") as Promise<DesktopState>,
  toggleAlwaysOnTop: () =>
    ipcRenderer.invoke("lapras:always-on-top:toggle") as Promise<boolean>,
  getAlwaysOnTop: () =>
    ipcRenderer.invoke("lapras:always-on-top:get") as Promise<boolean>,
  setAlwaysOnTop: (enabled: boolean) =>
    ipcRenderer.invoke("lapras:always-on-top:set", enabled) as Promise<boolean>,
  getOpenAtLogin: () =>
    ipcRenderer.invoke("lapras:open-at-login:get") as Promise<boolean>,
  setOpenAtLogin: (enabled: boolean) =>
    ipcRenderer.invoke("lapras:open-at-login:set", enabled) as Promise<boolean>,
  onStateChange: (callback: (state: DesktopState) => void) => {
    const listener = (_event: unknown, state: DesktopState) => callback(state);

    ipcRenderer.on("lapras:desktop-state", listener);

    return () => {
      ipcRenderer.removeListener("lapras:desktop-state", listener);
    };
  },
  onSettingsWindowStateChange: (callback: (isOpen: boolean) => void) => {
    const listener = (_event: unknown, state: DesktopState) =>
      callback(Boolean(state?.settingsWindowOpen));

    ipcRenderer.on("lapras:desktop-state", listener);

    return () => {
      ipcRenderer.removeListener("lapras:desktop-state", listener);
    };
  },
  onBackendUnhealthy: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("lapras:backend-unhealthy", listener);
    return () => {
      ipcRenderer.removeListener("lapras:backend-unhealthy", listener);
    };
  },
  logRendererError: (payload: RendererErrorPayload) => {
    ipcRenderer.send("lapras:renderer-error", payload);
  },
  notifyPlaybackState: (playing: boolean) => {
    ipcRenderer.send("lapras:playback-state-changed", playing);
  },
  bounceDock: () => {
    ipcRenderer.send("lapras:dock-bounce");
  },
  onMediaControl: (callback: (command: MediaCommand) => void) => {
    const listener = (_event: unknown, command: MediaCommand) => callback(command);
    ipcRenderer.on("lapras:media-control", listener);
    return () => {
      ipcRenderer.removeListener("lapras:media-control", listener);
    };
  }
};

contextBridge.exposeInMainWorld("lapras", {
  desktop: desktopApi
});

// Backward-compatible bridge for the previous desktop prototype.
contextBridge.exposeInMainWorld("laprasDesktop", {
  platform: process.platform,
  desktop: true,
  apiBaseUrl: desktopApi.apiBaseUrl,
  localToken: desktopApi.localToken,
  getInfo: desktopApi.getInfo,
  settings: {
    open: desktopApi.openSettingsWindow,
    focus: desktopApi.focusSettingsWindow,
    close: desktopApi.closeSettingsWindow
  },
  window: {
    minimize: desktopApi.minimize,
    hide: desktopApi.hideToTray,
    close: desktopApi.hideToTray,
    quit: desktopApi.quitApp,
    openSettings: desktopApi.openSettingsWindow,
    toggleMaximize: () => undefined
  }
});
