import {
  startTransition,
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
  ChatMessage,
  FavoriteStatusResponse,
  LLMDecision,
  NeteaseAccountStatus,
  NowPlayingState,
  PlayRecord,
  ProfileListResponse,
  RuntimeSettings,
  SongDetail
} from "@ai-music-companion/shared";

import { usePlaybackSocket } from "../hooks/usePlaybackSocket";
import {
  readDesktopAudioPreferences,
  writeDesktopAudioPreferences
} from "../lib/desktopPreferences";
import { api, isApiError, resolveSongAudioUrl } from "../lib/api";
import { publishDesktopSyncEvent, subscribeDesktopSyncEvents } from "../lib/desktopSync";
import { useDesktopPopovers } from "./hooks/useDesktopPopovers";
import { usePlayerControls } from "./hooks/usePlayerControls";
import { ChatSection } from "./sections/ChatSection";
import { PlayerSection } from "./sections/PlayerSection";
import ConnectionBanner from "./ConnectionBanner";
import type { ChatBubble, DesktopPlayMode, PlaylistItem, ResizeCorner, WindowBounds } from "./types";
import {
  asBackendMode,
  asDesktopMode,
  assistantReasoning,
  assistantText,
  getDecisionSignature,
  isDesktopRuntime,
  isLocalDesktopServiceUrl,
  makeLocalId
} from "./utils";

function warnDev(context: string, error: unknown) {
  if (import.meta.env.DEV) {
    console.warn(`[DesktopShell] ${context}:`, error);
  }
}

const DESKTOP_WINDOW_ASPECT_RATIO = 3 / 4;
const DESKTOP_WINDOW_MIN_WIDTH = 480;
const DESKTOP_WINDOW_MIN_HEIGHT = 640;
const COMPACT_WINDOW_ASPECT_RATIO = 4 / 3;
const COMPACT_WINDOW_TARGET_WIDTH = 600;
const COMPACT_WINDOW_TARGET_HEIGHT = 450;

function getCompactWindowMinBounds() {
  const scaleFactor = Math.max(window.devicePixelRatio || 1, 1);

  return {
    width: Math.max(1, Math.round(COMPACT_WINDOW_TARGET_WIDTH / scaleFactor)),
    height: Math.max(1, Math.round(COMPACT_WINDOW_TARGET_HEIGHT / scaleFactor))
  };
}

function describeNeteaseStatus(status: NeteaseAccountStatus | null) {
  if (!status) {
    return "网易云连接中";
  }

  if (status.loggedIn) {
    return `网易云已登录 · ${status.user?.nickname ?? "当前账号"}`;
  }

  if (status.configured) {
    return "网易云待登录";
  }

  return "网易云未配置";
}

function describeModelStatus(settings: RuntimeSettings | null) {
  if (!settings) {
    return "DeepSeek 读取中";
  }

  return settings.deepseekApiKeyConfigured
    ? `DeepSeek 就绪 · ${settings.deepseekModel}`
    : `DeepSeek 未配置 · ${settings.deepseekModel}`;
}

export default function DesktopShell() {
  const { state: socketState } = usePlaybackSocket();
  const desktopApi = window.lapras?.desktop;

  const audioRef = useRef<HTMLAudioElement>(null);
  const feedbackRef = useRef<{
    songId: string | null;
    lastProgressMs: number;
    completed: boolean;
  }>({
    songId: null,
    lastProgressMs: 0,
    completed: false
  });
  const lastRenderedDecisionSignatureRef = useRef("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const volumeSliderRef = useRef<HTMLDivElement>(null);
  const progressSliderRef = useRef<HTMLDivElement>(null);

  const {
    modeRef,
    volumeRef,
    playlistRef,
    modePopoverOpen,
    volumePopoverOpen,
    playlistPopoverOpen,
    setModePopoverOpen,
    toggleModePopover,
    toggleVolumePopover,
    togglePlaylistPopover
  } = useDesktopPopovers();

  const [state, setState] = useState<NowPlayingState | null>(null);
  const [history, setHistory] = useState<PlayRecord[]>([]);
  const [favoriteStatus, setFavoriteStatus] = useState<FavoriteStatusResponse | null>(null);
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings | null>(null);
  const [neteaseStatus, setNeteaseStatus] = useState<NeteaseAccountStatus | null>(null);
  const [profileState, setProfileState] = useState<ProfileListResponse | null>(null);
  const [desktopState, setDesktopState] = useState<LaprasDesktopState>({
    platform: window.lapras?.desktop?.platform ?? window.laprasDesktop?.platform ?? "web",
    isPackaged: false,
    alwaysOnTop: false,
    openAtLogin: false,
    settingsWindowOpen: false,
    compactMode: false
  });
  const [message, setMessage] = useState("");
  const [chatBubbles, setChatBubbles] = useState<ChatBubble[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "我在，今天想听点什么？",
      reasoning: "可以告诉我情绪、场景、歌手或者一首歌，我会接着帮你排队。"
    }
  ]);
  const [expandedReasoningIds, setExpandedReasoningIds] = useState<Set<string>>(
    () => new Set()
  );
  const [clock, setClock] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioTime, setAudioTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioIssue, setAudioIssue] = useState<string | null>(null);
  const initialAudioPrefs = readDesktopAudioPreferences();
  const [volume, setVolume] = useState(initialAudioPrefs.volume);
  const [muted, setMuted] = useState(initialAudioPrefs.muted);
  const [optimisticMode, setOptimisticMode] = useState<DesktopPlayMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "unhealthy"
  >("connecting");

  const currentSong = state?.currentSong ?? null;
  const lastDecisionSignature = getDecisionSignature(state?.lastDecision);
  const currentMode = optimisticMode ?? asDesktopMode(state?.mode);
  const currentVolume = muted ? 0 : volume;
  const progress = audioDuration > 0 ? Math.min(100, (audioTime / audioDuration) * 100) : 0;
  const coverStyle = currentSong?.coverUrl
    ? ({
        "--desktop-cover": `url("${currentSong.coverUrl}")`
      } as CSSProperties)
    : undefined;
  const currentProfileName =
    profileState?.profiles.find((profile) => profile.id === profileState.currentProfileId)?.name ??
    "默认档案";
  const currentUserName = neteaseStatus?.loggedIn
    ? neteaseStatus.user?.nickname ?? currentProfileName
    : currentProfileName;
  const currentUserAvatarUrl = neteaseStatus?.loggedIn ? neteaseStatus.user?.avatarUrl : undefined;

  const statusSummary = useMemo(
    () => [
      `档案 · ${currentProfileName}`,
      describeNeteaseStatus(neteaseStatus),
      describeModelStatus(runtimeSettings)
    ],
    [currentProfileName, neteaseStatus, runtimeSettings]
  );

  const playlistItems = useMemo<PlaylistItem[]>(() => {
    const played = (state?.playedSongs ?? []).slice(0, 15).map((song, index) => ({
      id: `played-${song.id}-${index}`,
      song,
      status: "played" as const
    }));
    const current = currentSong
      ? [
          {
            id: `current-${currentSong.id}`,
            song: currentSong,
            status: "current" as const
          }
        ]
      : [];
    const upcoming = (state?.queue ?? []).slice(0, 20).map((song, index) => ({
      id: `upcoming-${song.id}-${index}`,
      song,
      status: "upcoming" as const
    }));

    return [...played, ...current, ...upcoming];
  }, [state?.playedSongs, currentSong, state?.queue]);

  const {
    beginVolumeDrag,
    handleVolumeSliderKeyDown,
    beginProgressDrag,
    handleProgressSliderKeyDown
  } = usePlayerControls({
    audioRef,
    volumeSliderRef,
    progressSliderRef,
    audioTime,
    audioDuration,
    currentVolume,
    setAudioTime,
    setVolume,
    setMuted
  });

  async function refreshNow() {
    const nextState = await api.getNow();
    setState(nextState);
    return nextState;
  }

  async function refreshHistory() {
    const nextHistory = await api.getHistory(30);
    setHistory(nextHistory);
    return nextHistory;
  }

  async function refreshMessages() {
    try {
      const result = await api.getMessages(16);
      if (result.messages.length === 0) {
        return;
      }

      const bubbles: ChatBubble[] = result.messages.map((msg: ChatMessage) => ({
        id: msg.id,
        role: msg.role as "user" | "assistant",
        text: msg.content,
        reasoning: assistantReasoning(msg.decision)
      }));

      setChatBubbles(bubbles);
    } catch {
      // 后端可能还没有 /api/messages 路由，静默跳过
    }
  }

  async function refreshSettings() {
    const nextSettings = await api.getSettings();
    setRuntimeSettings(nextSettings);
    return nextSettings;
  }

  async function refreshFavoriteStatus() {
    try {
      const nextFavoriteStatus = await api.getCurrentFavoriteStatus();
      setFavoriteStatus(nextFavoriteStatus);
      return nextFavoriteStatus;
    } catch (refreshError) {
      if (
        isApiError(refreshError) &&
        refreshError.path === "/api/favorites/current-status" &&
        refreshError.statusCode === 404
      ) {
        return null;
      }

      throw refreshError;
    }
  }

  async function refreshNeteaseStatus() {
    const status = await api.getNeteaseStatus();
    setNeteaseStatus(status);
    return status;
  }

  async function refreshProfiles() {
    const nextProfiles = await api.getProfiles();
    setProfileState(nextProfiles);
    return nextProfiles;
  }

  async function refreshShellData() {
    await Promise.all([
      refreshNow(),
      refreshHistory(),
      refreshFavoriteStatus(),
      refreshSettings(),
      refreshNeteaseStatus(),
      refreshProfiles(),
      refreshMessages()
    ]);
  }

  useEffect(() => {
    if (!isDesktopRuntime()) {
      return;
    }

    document.documentElement.classList.add("lapras-desktop-runtime");
    document.body.classList.add("lapras-desktop-runtime");

    return () => {
      document.documentElement.classList.remove("lapras-desktop-runtime");
      document.body.classList.remove("lapras-desktop-runtime");
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void refreshShellData().catch((err) => warnDev("bootstrap", err));
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeDesktopSyncEvents((event) => {
      if (event.type === "desktop-preferences-updated") {
        const next = readDesktopAudioPreferences();
        setVolume(next.volume);
        setMuted(next.muted);
        return;
      }

      if (event.type === "settings-updated") {
        void refreshSettings().catch((err) => warnDev("sync:settings", err));
        return;
      }

      if (event.type === "netease-updated") {
        void refreshNeteaseStatus().catch((err) => warnDev("sync:netease", err));
        return;
      }

      if (event.type === "profiles-updated") {
        void Promise.all([
          refreshProfiles(),
          refreshNow(),
          refreshHistory(),
          refreshFavoriteStatus(),
          refreshNeteaseStatus()
        ]).catch((err) => warnDev("sync:profiles", err));
        return;
      }

      if (event.type === "favorites-updated") {
        void refreshFavoriteStatus().catch((err) => warnDev("sync:favorites", err));
        return;
      }

      if (event.type === "music-profile-updated") {
        void refreshFavoriteStatus().catch((err) => warnDev("sync:music-profile", err));
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const onFocus = () => {
      void Promise.all([
        refreshSettings(),
        refreshNeteaseStatus(),
        refreshProfiles(),
        refreshFavoriteStatus()
      ]).catch((err) => warnDev("focus:refresh", err));
    };

    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    if (
      !isLocalDesktopServiceUrl(runtimeSettings?.neteaseApiBaseUrl) ||
      neteaseStatus?.loggedIn
    ) {
      return;
    }

    let cancelled = false;
    let timer = 0;
    let attempts = 0;

    const pollNeteaseStatus = async () => {
      if (cancelled) {
        return;
      }

      attempts += 1;

      try {
        const status = await refreshNeteaseStatus();

        if (status.loggedIn) {
          publishDesktopSyncEvent({ type: "netease-updated" });
          return;
        }
      } catch {
        // Local desktop service may still be booting.
      }

      try {
        const settings = await refreshSettings();

        if (!isLocalDesktopServiceUrl(settings.neteaseApiBaseUrl)) {
          return;
        }
      } catch {
        // Backend settings may still be settling during startup.
      }

      if (!cancelled) {
        // 前 12 轮每 2.5s，之后每 8s，最多 60 轮后停止
        if (attempts >= 60) {
          return;
        }
        const delay = attempts < 12 ? 2_500 : 8_000;
        timer = window.setTimeout(pollNeteaseStatus, delay);
      }
    };

    timer = window.setTimeout(pollNeteaseStatus, 1_500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [runtimeSettings?.neteaseApiBaseUrl, neteaseStatus?.loggedIn]);

  useEffect(() => {
    if (socketState) {
      setState(socketState);
    }
  }, [socketState]);

  useEffect(() => {
    if (optimisticMode && asDesktopMode(state?.mode) === optimisticMode) {
      setOptimisticMode(null);
    }
  }, [optimisticMode, state?.mode]);

  useEffect(() => {
    feedbackRef.current = {
      songId: currentSong?.sourceId ?? null,
      lastProgressMs: 0,
      completed: false
    };
    void refreshFavoriteStatus().catch((err) => warnDev("song:refreshFavorite", err));
  }, [currentSong?.sourceId]);

  useEffect(() => {
    if (!state?.lastDecision?.say || !lastDecisionSignature) {
      return;
    }

    if (lastRenderedDecisionSignatureRef.current === lastDecisionSignature) {
      return;
    }

    // New AI reply — bounce the macOS Dock icon once to alert the user
    if (desktopApi?.bounceDock) {
      desktopApi.bounceDock();
    }

    const nextText = assistantText(state.lastDecision);
    const nextReasoning = assistantReasoning(state.lastDecision);

    setChatBubbles((items) => {
      const last = items[items.length - 1];

      if (
        last?.role === "assistant" &&
        last.text === nextText &&
        last.reasoning === nextReasoning
      ) {
        lastRenderedDecisionSignatureRef.current = lastDecisionSignature;
        return items;
      }

      lastRenderedDecisionSignatureRef.current = lastDecisionSignature;

      return [
        ...items,
        {
          id: makeLocalId("assistant"),
          role: "assistant" as const,
          text: nextText,
          reasoning: nextReasoning
        }
      ].slice(-6);
    });
  }, [lastDecisionSignature, state?.lastDecision]);

  useEffect(() => {
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [chatBubbles, busy]);

  useEffect(() => {
    if (!desktopApi) {
      return;
    }

    void desktopApi.getInfo().then(setDesktopState).catch(() => undefined);
    const unsubscribeState = desktopApi.onStateChange((nextState) => setDesktopState(nextState));
    const unsubscribeHealth = desktopApi.onBackendUnhealthy(() => {
      setConnectionStatus("unhealthy");
    });

    return () => {
      unsubscribeState();
      unsubscribeHealth();
    };
  }, [desktopApi]);

  useEffect(() => {
    if (!desktopApi?.onMediaControl) {
      return;
    }

    return desktopApi.onMediaControl((command) => {
      if (command === "playpause") {
        void toggleAudio();
      } else if (command === "next") {
        void nextTrack({ reason: "system_media_key" });
      } else if (command === "previous") {
        void previousTrack();
      }
    });
  }, [audioPlaying, currentSong?.audioUrl, currentSong?.id, desktopApi]);

  // Report playback state to main process so Windows taskbar thumbnail
  // buttons can toggle between play and pause icons.
  useEffect(() => {
    if (desktopApi?.notifyPlaybackState) {
      desktopApi.notifyPlaybackState(audioPlaying);
    }
  }, [audioPlaying, desktopApi]);

  useEffect(() => {
    if (!error) {
      return;
    }

    const timer = window.setTimeout(() => {
      setError((current) => (current === error ? null : current));
    }, 2_000);

    return () => window.clearTimeout(timer);
  }, [error]);

  // Health check: poll settings every 5s, degrade after consecutive failures
  useEffect(() => {
    let failures = 0;
    let cancelled = false;

    async function check() {
      if (cancelled) return;
      try {
        await api.getSettings();
        // succeeded — backend is healthy
        failures = 0;
        setConnectionStatus("connected");
      } catch {
        failures++;
        if (failures === 1) {
          setConnectionStatus("connecting");
        } else if (failures >= 3) {
          setConnectionStatus("unhealthy");
        }
      }

      if (!cancelled) {
        setTimeout(check, 5_000);
      }
    }

    // Initial delay to let backend boot
    const initialTimer = setTimeout(check, 3_000);

    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
    };
  }, []);

  useEffect(() => {
    if (!audioIssue) {
      return;
    }

    const timer = window.setTimeout(() => {
      setAudioIssue((current) => (current === audioIssue ? null : current));
    }, 2_000);

    return () => window.clearTimeout(timer);
  }, [audioIssue]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.volume = muted ? 0 : volume;
    writeDesktopAudioPreferences({ volume, muted });
    publishDesktopSyncEvent({ type: "desktop-preferences-updated" });
  }, [volume, muted]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || !currentSong?.audioUrl) {
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }

      setAudioTime(0);
      setAudioDuration(currentSong?.durationMs ? currentSong.durationMs / 1000 : 0);
      setAudioPlaying(false);
      return;
    }

    void syncAudioToTrack(currentSong, Boolean(state?.isPlaying));
  }, [currentSong?.id, currentSong?.audioUrl, state?.isPlaying]);

  async function syncAudioToTrack(track: SongDetail | null, shouldPlay: boolean) {
    const audio = audioRef.current;
    const playableUrl = resolveSongAudioUrl(track);
    const fallbackDuration = track?.durationMs ? track.durationMs / 1000 : 0;

    if (!audio) {
      return;
    }

    if (!playableUrl) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      setAudioTime(0);
      setAudioDuration(fallbackDuration);
      setAudioPlaying(false);
      return;
    }

    const shouldReplaceSource = audio.getAttribute("src") !== playableUrl;

    if (shouldReplaceSource) {
      audio.pause();
      audio.src = playableUrl;
      audio.currentTime = 0;
      setAudioTime(0);
      setAudioDuration(fallbackDuration);
      audio.load();
    }

    if (!shouldPlay) {
      audio.pause();
      setAudioPlaying(false);
      return;
    }

    try {
      await audio.play();
      setAudioPlaying(true);
      setAudioIssue(null);
    } catch {
      setAudioPlaying(false);
      setAudioIssue("这首歌暂时没有可播放音频，可以切到下一首。");
    }
  }

  async function toggleAudio() {
    const audio = audioRef.current;

    if (!audio || !currentSong?.audioUrl) {
      setAudioIssue("当前歌曲暂时没有可播放音频。");
      return;
    }

    try {
      if (audio.paused) {
        await audio.play();
        setAudioPlaying(true);
        setAudioIssue(null);
        return;
      }

      audio.pause();
      setAudioPlaying(false);
    } catch {
      setAudioIssue("播放失败，请尝试下一首。");
      setAudioPlaying(false);
    }
  }

  async function reportPlaybackFeedback(
    event: "progress" | "paused" | "completed" | "skipped",
    reason?: string
  ) {
    if (!currentSong) {
      return;
    }

    const audio = audioRef.current;
    const listenMs = Math.max(0, Math.round((audio?.currentTime ?? audioTime) * 1000));
    const durationMs = Math.round(
      (Number.isFinite(audio?.duration) && audio?.duration ? audio.duration * 1000 : 0) ||
        audioDuration * 1000 ||
        currentSong.durationMs ||
        0
    );

    if (
      event !== "skipped" &&
      currentSong.audioUrl &&
      audio?.currentSrc &&
      audio.currentSrc !== resolveSongAudioUrl(currentSong)
    ) {
      return;
    }

    if (feedbackRef.current.songId !== currentSong.sourceId) {
      feedbackRef.current = {
        songId: currentSong.sourceId,
        lastProgressMs: 0,
        completed: false
      };
    }

    if (event === "progress") {
      if (listenMs < 10_000 || listenMs - feedbackRef.current.lastProgressMs < 30_000) {
        return;
      }

      feedbackRef.current.lastProgressMs = listenMs;
    }

    if (event === "paused" && listenMs < 5_000) {
      return;
    }

    if (event === "completed") {
      if (feedbackRef.current.completed) {
        return;
      }

      feedbackRef.current.completed = true;
    }

    try {
      await api.reportPlaybackFeedback({
        songId: currentSong.sourceId,
        listenMs,
        durationMs: durationMs > 0 ? durationMs : undefined,
        event,
        reason
      });
    } catch {
      // Feedback should never block playback controls.
    }
  }

  async function nextTrack(options: { reportSkip?: boolean; reason?: string } = {}) {
    try {
      setError(null);
      if (options.reportSkip ?? true) {
        await reportPlaybackFeedback("skipped", options.reason ?? "next_button");
      }
      const nextState = await api.nextTrack();
      setState(nextState);
      await syncAudioToTrack(nextState.currentSong, true);
      await refreshHistory();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "切歌失败。");
    }
  }

  async function previousTrack() {
    try {
      setError(null);
      await reportPlaybackFeedback("skipped", "previous_button");
      const nextState = await api.previousTrack();
      setState(nextState);
      await syncAudioToTrack(nextState.currentSong, true);
      await refreshHistory();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "返回上一首失败。");
    }
  }

  async function playFromQueue(sourceId: string) {
    try {
      setError(null);
      const nextState = await api.playFromQueue(sourceId);
      setState(nextState);
      await syncAudioToTrack(nextState.currentSong, true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "切换歌曲失败。");
    }
  }

  async function playFromPlayed(sourceId: string) {
    try {
      setError(null);
      const nextState = await api.playFromPlayed(sourceId);
      setState(nextState);
      await syncAudioToTrack(nextState.currentSong, true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "切换歌曲失败。");
    }
  }

  async function switchMode(mode: DesktopPlayMode) {
    setOptimisticMode(mode);
    setModePopoverOpen(false);

    try {
      const nextState = await api.switchMode(asBackendMode(mode));
      setState(nextState);
      setError(null);
    } catch (switchError) {
      setOptimisticMode(null);
      setError(switchError instanceof Error ? switchError.message : "切换模式失败。");
    }
  }

  async function sendMessage() {
    const trimmed = message.trim();

    if (!trimmed || busy) {
      return;
    }

    setChatBubbles((items) =>
      [
        ...items,
        {
          id: makeLocalId("user"),
          role: "user" as const,
          text: trimmed
        }
      ].slice(-6)
    );
    setBusy(true);
    setMessage("");

    try {
      const response = await api.chat(trimmed);
      startTransition(() => {
        setState(response.state);
      });
      setError(null);
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : "发送失败。");
    } finally {
      setBusy(false);
    }
  }

  async function toggleFavorite() {
    if (!currentSong) {
      return;
    }

    try {
      setError(null);

      if (favoriteStatus?.isFavorited) {
        const nextStatus = await api.unfavoriteCurrentSong();
        setFavoriteStatus(nextStatus);
      } else {
        const response = await api.favoriteCurrentSong();
        setFavoriteStatus(response.status);
      }

      publishDesktopSyncEvent({ type: "music-profile-updated" });
    } catch (favoriteError) {
      const favoriteMessage =
        favoriteError instanceof Error ? favoriteError.message : "收藏更新失败。";

      if (
        isApiError(favoriteError) &&
        favoriteError.path === "/api/favorites/current" &&
        favoriteError.statusCode === 404
      ) {
        setError("当前桌面端还连着旧后端，重启一次 Lapras 后就能正常收藏。");
        return;
      }

      setError(favoriteMessage);
    }
  }

  async function toggleAlwaysOnTop() {
    try {
      const next = await desktopApi?.toggleAlwaysOnTop();

      if (typeof next === "boolean") {
        setDesktopState((value) => ({ ...value, alwaysOnTop: next }));
      }
    } catch (desktopError) {
      setError(desktopError instanceof Error ? desktopError.message : "置顶切换失败。");
    }
  }

  async function openSettingsWindow() {
    try {
      const nextState = desktopState.settingsWindowOpen
        ? await desktopApi?.focusSettingsWindow()
        : await desktopApi?.openSettingsWindow();

      if (nextState) {
        setDesktopState(nextState);
      }
    } catch (desktopError) {
      setError(desktopError instanceof Error ? desktopError.message : "打开设置窗口失败。");
    }
  }

  function toggleReasoning(messageId: string) {
    setExpandedReasoningIds((ids) => {
      const next = new Set(ids);

      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }

      return next;
    });
  }

  async function beginCornerResize(
    corner: ResizeCorner,
    event: React.PointerEvent<HTMLButtonElement>
  ) {
    if (!desktopApi) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);

    const initialBounds = await desktopApi.getWindowBounds();

    if (!initialBounds) {
      handle.releasePointerCapture(event.pointerId);
      return;
    }

    const startScreenX = event.screenX;
    const startScreenY = event.screenY;
    let lastAppliedBounds = initialBounds;
    const resizeAspectRatio = desktopState.compactMode
      ? COMPACT_WINDOW_ASPECT_RATIO
      : DESKTOP_WINDOW_ASPECT_RATIO;
    const minBounds = desktopState.compactMode
      ? getCompactWindowMinBounds()
      : {
          width: DESKTOP_WINDOW_MIN_WIDTH,
          height: DESKTOP_WINDOW_MIN_HEIGHT
        };

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.screenX - startScreenX;
      const deltaY = moveEvent.screenY - startScreenY;
      const widthFromX = corner === "nw" || corner === "sw" ? -deltaX : deltaX;
      const widthFromY =
        (corner === "nw" || corner === "ne" ? -deltaY : deltaY) * resizeAspectRatio;
      const widthDelta =
        Math.abs(widthFromX) >= Math.abs(widthFromY) ? widthFromX : widthFromY;
      const nextWidth = Math.max(minBounds.width, Math.round(initialBounds.width + widthDelta));
      const nextHeight = Math.max(minBounds.height, Math.round(nextWidth / resizeAspectRatio));
      const nextBounds: WindowBounds = {
        width: nextWidth,
        height: nextHeight,
        x:
          corner === "nw" || corner === "sw"
            ? initialBounds.x + (initialBounds.width - nextWidth)
            : initialBounds.x,
        y:
          corner === "nw" || corner === "ne"
            ? initialBounds.y + (initialBounds.height - nextHeight)
            : initialBounds.y
      };

      if (
        nextBounds.x === lastAppliedBounds.x &&
        nextBounds.y === lastAppliedBounds.y &&
        nextBounds.width === lastAppliedBounds.width &&
        nextBounds.height === lastAppliedBounds.height
      ) {
        return;
      }

      lastAppliedBounds = nextBounds;
      void desktopApi.setWindowBounds(nextBounds).catch(() => undefined);
    };

    const stopResize = () => {
      handle.releasePointerCapture(event.pointerId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }

  return (
    <main
      className={`desktop-window-root ${desktopState.compactMode ? "is-compact" : ""}`.trim()}
      data-status-summary={statusSummary.join(" | ")}
    >
      <ConnectionBanner status={connectionStatus} />

      {desktopApi ? (
        <>
          <button
            type="button"
            className="desktop-resize-handle is-nw"
            tabIndex={-1}
            aria-label="左上角缩放"
            onPointerDown={(event) => void beginCornerResize("nw", event)}
          />
          <button
            type="button"
            className="desktop-resize-handle is-ne"
            tabIndex={-1}
            aria-label="右上角缩放"
            onPointerDown={(event) => void beginCornerResize("ne", event)}
          />
          <button
            type="button"
            className="desktop-resize-handle is-sw"
            tabIndex={-1}
            aria-label="左下角缩放"
            onPointerDown={(event) => void beginCornerResize("sw", event)}
          />
          <button
            type="button"
            className="desktop-resize-handle is-se"
            tabIndex={-1}
            aria-label="右下角缩放"
            onPointerDown={(event) => void beginCornerResize("se", event)}
          />
        </>
      ) : null}

      <audio
        ref={audioRef}
        onPlay={() => setAudioPlaying(true)}
        onPause={() => {
          setAudioPlaying(false);
          void reportPlaybackFeedback("paused", "audio_pause");
        }}
        onTimeUpdate={(event) => {
          setAudioTime(event.currentTarget.currentTime);
          void reportPlaybackFeedback("progress", "time_update");
        }}
        onLoadedMetadata={(event) => setAudioDuration(event.currentTarget.duration)}
        onEnded={async () => {
          await reportPlaybackFeedback("completed", "audio_ended");
          await nextTrack({ reportSkip: false, reason: "audio_ended" });
        }}
      />

      <section className={`desktop-card mode-${currentMode}`} style={coverStyle}>
        <div className="desktop-cover-layer" />
        <div className="desktop-card-noise" />

        <PlayerSection
          currentSong={currentSong}
          currentMode={currentMode}
          desktopState={desktopState}
          clock={clock}
          audioPlaying={audioPlaying}
          favoriteStatus={favoriteStatus}
          currentVolume={currentVolume}
          muted={muted}
          progress={progress}
          audioTime={audioTime}
          audioDuration={audioDuration}
          modePopoverOpen={modePopoverOpen}
          volumePopoverOpen={volumePopoverOpen}
          modeRef={modeRef}
          volumeRef={volumeRef}
          volumeSliderRef={volumeSliderRef}
          progressSliderRef={progressSliderRef}
          onToggleModePopover={toggleModePopover}
          onSwitchMode={(mode) => void switchMode(mode)}
          onToggleAlwaysOnTop={() => void toggleAlwaysOnTop()}
          onOpenSettingsWindow={() => void openSettingsWindow()}
          onMinimize={() => desktopApi?.minimize()}
          onHideToTray={() => desktopApi?.hideToTray()}
          onToggleFavorite={() => void toggleFavorite()}
          onPreviousTrack={() => void previousTrack()}
          onToggleAudio={() => void toggleAudio()}
          onNextTrack={() => void nextTrack()}
          onToggleVolumePopover={toggleVolumePopover}
          onVolumePointerDown={beginVolumeDrag}
          onVolumeKeyDown={handleVolumeSliderKeyDown}
          onProgressPointerDown={beginProgressDrag}
          onProgressKeyDown={handleProgressSliderKeyDown}
        />

        <ChatSection
          messagesRef={messagesRef}
          playlistRef={playlistRef}
          chatBubbles={chatBubbles}
          currentUserName={currentUserName}
          currentUserAvatarUrl={currentUserAvatarUrl}
          expandedReasoningIds={expandedReasoningIds}
          busy={busy}
          message={message}
          playlistItems={playlistItems}
          playlistPopoverOpen={playlistPopoverOpen}
          onToggleReasoning={toggleReasoning}
          onMessageChange={setMessage}
          onSubmit={() => void sendMessage()}
          onTogglePlaylistPopover={togglePlaylistPopover}
          onPlayFromPlayed={(sourceId) => void playFromPlayed(sourceId)}
          onPlayFromQueue={(sourceId) => void playFromQueue(sourceId)}
        />
      </section>

      {error ? <div className="desktop-inline-error">{error}</div> : null}
      {audioIssue ? <div className="desktop-inline-error">{audioIssue}</div> : null}

    </main>
  );
}
