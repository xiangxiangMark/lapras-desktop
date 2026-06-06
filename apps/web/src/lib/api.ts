import type {
  ChatMessage,
  ChatResponse,
  AppMode,
  FavoriteStatusResponse,
  FavoriteTrack,
  LocalProfile,
  MusicProfileStateResponse,
  MusicProfileVersion,
  NeteaseCaptchaRequest,
  NeteaseCellphoneLoginRequest,
  NeteaseCellphoneLoginResponse,
  NeteaseAccountStatus,
  NeteaseProfileSummary,
  NeteaseProfileSyncResponse,
  NeteaseQrLoginCheck,
  NeteaseQrLoginSession,
  NowPlayingState,
  OnboardingStatus,
  PlaybackFeedbackRequest,
  PlayRecord,
  ProfileUpdateJob,
  ProfileListResponse,
  PlayRequest,
  RuntimeSettings,
  RuntimeSettingsUpdate
} from "@ai-music-companion/shared";

function resolveApiBaseUrlFromRuntime() {
  if (typeof window !== "undefined") {
    const desktopApiBaseUrl =
      window.lapras?.desktop.apiBaseUrl?.trim() ||
      window.laprasDesktop?.apiBaseUrl?.trim();

    if (desktopApiBaseUrl) {
      return desktopApiBaseUrl;
    }
  }

  return (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8787";
}

const API_BASE_URL = resolveApiBaseUrlFromRuntime();

export type ApiErrorCategory =
  | "connection"
  | "local-token"
  | "deepseek-key"
  | "netease"
  | "client"
  | "server"
  | "unknown";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly options: {
      path: string;
      statusCode: number;
      isConnectionError: boolean;
      category: ApiErrorCategory;
      rawMessage?: string;
    }
  ) {
    super(message);
    this.name = "ApiError";
  }

  get path() {
    return this.options.path;
  }

  get statusCode() {
    return this.options.statusCode;
  }

  get isConnectionError() {
    return this.options.isConnectionError;
  }

  get category() {
    return this.options.category;
  }

  get rawMessage() {
    return this.options.rawMessage;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

function logApiError(error: ApiError) {
  window.lapras?.desktop?.logRendererError?.({
    level: error.category === "server" ? "error" : "warn",
    message: error.message,
    stack: error.stack,
    source: "api",
    reason: {
      path: error.path,
      statusCode: error.statusCode,
      category: error.category,
      rawMessage: error.rawMessage
    }
  });
}

function classifyApiError(
  path: string,
  statusCode: number,
  rawMessage?: string,
  isConnectionError = false
): ApiErrorCategory {
  const normalized = `${path} ${rawMessage ?? ""}`.toLowerCase();

  if (isConnectionError) {
    return "connection";
  }

  if (statusCode === 401) {
    return "local-token";
  }

  if (/deepseek|api key|apikey|key|unauthorized|invalid key/.test(normalized)) {
    return "deepseek-key";
  }

  if (path.startsWith("/api/netease") || /netease|网易云/.test(normalized)) {
    return "netease";
  }

  if (statusCode >= 500) {
    return "server";
  }

  if (statusCode >= 400) {
    return "client";
  }

  return "unknown";
}

function getFriendlyApiMessage(category: ApiErrorCategory, path: string, rawMessage?: string) {
  switch (category) {
    case "connection":
      return "后端服务暂时不可用，Lapras 正在尝试恢复；如果持续出现，请重启应用。";
    case "local-token":
      return "本地会话认证失效，请重启 Lapras 后再试。";
    case "deepseek-key":
      return "DeepSeek API Key 无效或已失效，请到设置中更新 Key。";
    case "netease":
      return rawMessage?.trim()
        ? `网易云连接暂时不可用：${rawMessage.trim()}。你可以先使用 mock 降级播放，稍后再连接。`
        : "网易云连接暂时不可用，你可以先使用 mock 降级播放，稍后再连接。";
    case "server":
      return "后端服务出现异常，请稍后重试；错误详情已写入日志。";
    case "client":
      return rawMessage?.trim() || `请求失败：${path}`;
    default:
      return rawMessage?.trim() || `请求失败：${path}`;
  }
}

function getLocalToken() {
  if (typeof window !== "undefined") {
    return window.lapras?.desktop.localToken?.trim() ||
      window.laprasDesktop?.localToken?.trim() ||
      "";
  }
  return "";
}

type RequestOptions = RequestInit & {
  logErrors?: boolean;
};

async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  const token = getLocalToken();
  const { logErrors = true, ...fetchInit } = init ?? {};
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...fetchInit,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-Lapras-Token": token } : {}),
        ...(fetchInit.headers as Record<string, string> || {})
      }
    });
  } catch (error) {
    const apiError = new ApiError(getFriendlyApiMessage("connection", path), {
      path,
      statusCode: 0,
      isConnectionError: true,
      category: "connection",
      rawMessage: error instanceof Error ? error.message : String(error)
    });
    if (logErrors) {
      logApiError(apiError);
    }
    throw apiError;
  }

  if (!response.ok) {
    const rawMessage = await response.text();
    let message = rawMessage;

    try {
      const parsed = JSON.parse(rawMessage) as { message?: unknown; error?: unknown };
      message =
        typeof parsed.message === "string"
          ? parsed.message
          : typeof parsed.error === "string"
            ? parsed.error
            : rawMessage;
    } catch {
      // Keep the raw response text.
    }

    const category = classifyApiError(path, response.status, message);
    const apiError = new ApiError(getFriendlyApiMessage(category, path, message), {
      path,
      statusCode: response.status,
      isConnectionError: false,
      category,
      rawMessage: message || `Request failed: ${response.status}`
    });
    if (logErrors) {
      logApiError(apiError);
    }
    throw apiError;
  }

  return (await response.json()) as T;
}

async function ensureNeteaseLocalService() {
  await window.lapras?.desktop?.ensureLocalServices?.().catch(() => null);
}

export const api = {
  chat(message: string) {
    return request<ChatResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message })
    });
  },
  getNow() {
    return request<NowPlayingState>("/api/now");
  },
  getMessages(limit = 16) {
    return request<{ messages: ChatMessage[] }>(`/api/messages?limit=${limit}`);
  },
  getHistory(limit = 30) {
    return request<PlayRecord[]>(`/api/history?limit=${limit}`);
  },
  getCurrentFavoriteStatus() {
    return request<FavoriteStatusResponse>("/api/favorites/current-status");
  },
  favoriteCurrentSong() {
    return request<{ favorite: FavoriteTrack; status: FavoriteStatusResponse }>(
      "/api/favorites/current",
      {
        method: "POST",
        body: JSON.stringify({})
      }
    );
  },
  unfavoriteCurrentSong() {
    return request<FavoriteStatusResponse>("/api/favorites/current", {
      method: "DELETE",
      body: JSON.stringify({})
    });
  },
  getFavorites(limit = 100) {
    return request<{ favorites: FavoriteTrack[] }>(`/api/favorites?limit=${limit}`);
  },
  getMusicProfileState() {
    return request<MusicProfileStateResponse>("/api/music-profile");
  },
  getMusicProfileVersions(limit = 10) {
    return request<{ versions: MusicProfileVersion[] }>(
      `/api/music-profile/versions?limit=${limit}`
    );
  },
  triggerMusicProfileUpdate() {
    return request<{
      job: ProfileUpdateJob;
      state: MusicProfileStateResponse;
    }>("/api/music-profile/update", {
      method: "POST",
      body: JSON.stringify({})
    });
  },
  activateMusicProfileVersion(versionId: string) {
    return request<{
      currentVersion: MusicProfileVersion;
      state: MusicProfileStateResponse;
    }>(`/api/music-profile/versions/${encodeURIComponent(versionId)}/activate`, {
      method: "POST",
      body: JSON.stringify({})
    });
  },
  deleteMusicProfileVersion(versionId: string) {
    return request<{
      deleted: boolean;
      state: MusicProfileStateResponse;
    }>(`/api/music-profile/versions/${encodeURIComponent(versionId)}`, {
      method: "DELETE",
      body: JSON.stringify({})
    });
  },
  getLatestMusicProfileJob() {
    return request<{ job: ProfileUpdateJob | null }>("/api/music-profile/jobs/latest");
  },
  play(payload: PlayRequest) {
    return request<NowPlayingState>("/api/play", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  playFromQueue(sourceId: string) {
    return request<NowPlayingState>("/api/play/from-queue", {
      method: "POST",
      body: JSON.stringify({ sourceId })
    });
  },
  playFromPlayed(sourceId: string) {
    return request<NowPlayingState>("/api/play/from-played", {
      method: "POST",
      body: JSON.stringify({ sourceId })
    });
  },
  nextTrack() {
    return request<NowPlayingState>("/api/next", {
      method: "POST",
      body: JSON.stringify({})
    });
  },
  previousTrack() {
    return request<NowPlayingState>("/api/previous", {
      method: "POST",
      body: JSON.stringify({})
    });
  },
  clearQueue() {
    return request<NowPlayingState>("/api/queue/clear", {
      method: "POST",
      body: JSON.stringify({})
    });
  },
  switchMode(mode: AppMode) {
    return request<NowPlayingState>("/api/mode", {
      method: "POST",
      body: JSON.stringify({ mode })
    });
  },
  reportPlaybackFeedback(payload: PlaybackFeedbackRequest) {
    return request<{ ok?: boolean; id?: string; listenMs?: number }>(
      "/api/playback/feedback",
      {
        method: "POST",
        body: JSON.stringify(payload)
      }
    );
  },
  getSettings() {
    return request<RuntimeSettings>("/api/settings");
  },
  updateSettings(payload: RuntimeSettingsUpdate) {
    return request<RuntimeSettings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },
  getNeteaseStatus() {
    return request<NeteaseAccountStatus>("/api/netease/status");
  },
  createNeteaseQrLoginSession() {
    return ensureNeteaseLocalService().then(() =>
      request<NeteaseQrLoginSession>("/api/netease/qr-login", {
        method: "POST",
        body: JSON.stringify({})
      })
    );
  },
  checkNeteaseQrLoginSession(key: string) {
    return ensureNeteaseLocalService().then(() =>
      request<NeteaseQrLoginCheck>(
        `/api/netease/qr-login/${encodeURIComponent(key)}`
      )
    );
  },
  sendNeteaseCaptcha(payload: NeteaseCaptchaRequest) {
    return ensureNeteaseLocalService().then(() =>
      request<{ code: number; message: string }>("/api/netease/captcha", {
        method: "POST",
        body: JSON.stringify(payload)
      })
    );
  },
  loginNeteaseByCellphoneCaptcha(payload: NeteaseCellphoneLoginRequest) {
    return ensureNeteaseLocalService().then(() =>
      request<NeteaseCellphoneLoginResponse>(
        "/api/netease/login/cellphone",
        {
          method: "POST",
          body: JSON.stringify(payload)
        }
      )
    );
  },
  importNeteaseCookie() {
    return ensureNeteaseLocalService().then(() =>
      request<{ cookieSaved: boolean; status: NeteaseAccountStatus }>(
        "/api/netease/import-cookie",
        {
          method: "POST",
          body: JSON.stringify({})
        }
      )
    );
  },
  syncNeteaseProfile() {
    return ensureNeteaseLocalService().then(() =>
      request<NeteaseProfileSyncResponse>("/api/netease/sync-profile", {
        method: "POST",
        body: JSON.stringify({})
      })
    );
  },
  getNeteaseProfileSummary() {
    return request<{ profile: NeteaseProfileSummary | null }>("/api/netease/profile-summary");
  },
  getProfiles() {
    return request<ProfileListResponse>("/api/profiles");
  },
  createProfile(name: string) {
    return request<{ profile: LocalProfile; profiles: ProfileListResponse }>("/api/profiles", {
      method: "POST",
      body: JSON.stringify({ name })
    });
  },
  switchProfile(profileId: string) {
    return request<ProfileListResponse>("/api/profiles/switch", {
      method: "POST",
      body: JSON.stringify({ profileId })
    });
  },
  getOnboardingStatus(options?: Pick<RequestOptions, "logErrors">) {
    return request<OnboardingStatus>("/api/onboarding/status", options);
  },
  completeOnboarding() {
    return request<OnboardingStatus>("/api/onboarding/complete", {
      method: "POST",
      body: JSON.stringify({})
    });
  },
  completeOnboardingStep(step: "apiKey" | "neteaseLogin" | "modeChoice") {
    return request<OnboardingStatus>("/api/onboarding/step", {
      method: "POST",
      body: JSON.stringify({ step })
    });
  },
  validateApiKey() {
    return request<{ valid: boolean; message: string }>("/api/onboarding/validate-key", {
      method: "POST",
      body: JSON.stringify({})
    });
  }
};

export function resolveApiMediaUrl(path?: string | null) {
  if (!path) {
    return null;
  }

  return new URL(path, API_BASE_URL).toString();
}

export function resolveSongAudioUrl(
  song?: Pick<import("@ai-music-companion/shared").SongDetail, "audioUrl" | "source" | "sourceId"> | null
) {
  if (!song?.audioUrl) {
    return null;
  }

  const normalizedUrl = resolveApiMediaUrl(song.audioUrl);

  if (!normalizedUrl) {
    return null;
  }

  try {
    const host = new URL(normalizedUrl).hostname;

    if (
      song.source === "netease" &&
      song.sourceId &&
      (host.endsWith("music.126.net") || host.endsWith("music.163.com"))
    ) {
      return resolveApiMediaUrl(`/api/audio/netease/${encodeURIComponent(song.sourceId)}`);
    }
  } catch {
    return normalizedUrl;
  }

  return normalizedUrl;
}

export function getWebSocketUrl() {
  const explicit = import.meta.env.VITE_WS_URL as string | undefined;

  if (explicit) {
    return explicit;
  }

  try {
    const apiUrl = new URL(API_BASE_URL);
    apiUrl.protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
    apiUrl.pathname = "/ws";
    apiUrl.search = "";
    apiUrl.hash = "";
    return apiUrl.toString();
  } catch {
    return "ws://localhost:8787/ws";
  }
}
