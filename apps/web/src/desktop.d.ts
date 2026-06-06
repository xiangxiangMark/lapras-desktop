export {};

declare global {
  type LaprasDesktopState = {
    platform: string;
    isPackaged: boolean;
    alwaysOnTop: boolean;
    openAtLogin: boolean;
    settingsWindowOpen: boolean;
    compactMode: boolean;
  };

  type LaprasDesktopWindowBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  type LaprasMediaCommand = "playpause" | "next" | "previous";
  type LaprasRendererErrorPayload = {
    level?: "info" | "warn" | "error";
    message?: string;
    stack?: string;
    source?: string;
    lineno?: number;
    colno?: number;
    reason?: unknown;
  };

  interface Window {
    lapras?: {
      desktop: {
        platform: string;
        apiBaseUrl: string;
        localToken: string;
        getInfo: () => Promise<LaprasDesktopState>;
        getVersion: () => Promise<string>;
        openLogsDirectory: () => Promise<{
          ok: boolean;
          path: string;
          error?: string;
        }>;
        ensureLocalServices: () => Promise<{
          ok: boolean;
          error?: string;
        }>;
        versions: {
          readonly electron: string;
          readonly node: string;
          readonly chrome: string;
        };
        getWindowBounds: () => Promise<LaprasDesktopWindowBounds | null>;
        setWindowBounds: (
          bounds: LaprasDesktopWindowBounds
        ) => Promise<LaprasDesktopWindowBounds | null>;
        minimize: () => void;
        hideToTray: () => void;
        toggleAlwaysOnTop: () => Promise<boolean>;
        getAlwaysOnTop: () => Promise<boolean>;
        setAlwaysOnTop: (enabled: boolean) => Promise<boolean>;
        setOpenAtLogin: (enabled: boolean) => Promise<boolean>;
        getOpenAtLogin: () => Promise<boolean>;
        openSettingsWindow: () => Promise<LaprasDesktopState>;
        focusSettingsWindow: () => Promise<LaprasDesktopState>;
        closeSettingsWindow: () => Promise<LaprasDesktopState>;
        quitApp: () => void;
        showWindow: () => void;
        onStateChange: (callback: (state: LaprasDesktopState) => void) => () => void;
        onSettingsWindowStateChange: (callback: (isOpen: boolean) => void) => () => void;
        onBackendUnhealthy: (callback: () => void) => () => void;
        logRendererError: (payload: LaprasRendererErrorPayload) => void;
        notifyPlaybackState: (playing: boolean) => void;
        bounceDock: () => void;
        onMediaControl: (callback: (command: LaprasMediaCommand) => void) => () => void;
      };
    };
    laprasDesktop?: {
      desktop: boolean;
      platform: string;
      apiBaseUrl?: string;
      localToken?: string;
      getInfo: () => Promise<LaprasDesktopState>;
      settings: {
        open: () => Promise<LaprasDesktopState>;
        focus: () => Promise<LaprasDesktopState>;
        close: () => Promise<LaprasDesktopState>;
      };
      window: {
        minimize: () => void;
        toggleMaximize: () => void;
        hide: () => void;
        close: () => void;
        quit: () => void;
        openSettings: () => Promise<LaprasDesktopState>;
      };
    };
  }
}
