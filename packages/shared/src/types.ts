export const APP_MODES = ["companion", "focus", "discover", "sleep"] as const;

export type AppMode = (typeof APP_MODES)[number];
export type ChatRole = "system" | "user" | "assistant";
export type ActionType =
  | "search_and_queue"
  | "play_track"
  | "skip_track"
  | "speak_only"
  | "switch_mode";
export type CompanionIntentType =
  | "chat"
  | "music_request"
  | "skip"
  | "mode_switch"
  | "feedback";
export type ReplyMood = "soft" | "playful" | "quiet" | "focused";

export interface Song {
  id: string;
  source: "netease";
  sourceId: string;
  name: string;
  artist: string;
  album?: string;
  durationMs?: number;
  coverUrl?: string;
}

export interface SongDetail extends Song {
  audioUrl?: string | null;
  sourceUrl?: string | null;
  lyricSnippet?: string | null;
}

export interface PlayRecord {
  id: string;
  song: SongDetail;
  playedAt: string;
  reason: string;
  mode: AppMode;
  trigger: "manual" | "ai" | "system";
  listenMs?: number;
  durationMs?: number;
  completedAt?: string | null;
  skippedAt?: string | null;
  skipReason?: string | null;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  decision?: LLMDecision | null;
}

export type LLMAction =
  | {
      type: "search_and_queue";
      query: string;
      queueQueries?: string[];
      recommendationTuning?: RecommendationTuning;
    }
  | {
      type: "play_track";
      songId: string;
    }
  | {
      type: "skip_track";
    }
  | {
      type: "speak_only";
    }
  | {
      type: "switch_mode";
      nextMode: AppMode;
    };

export interface RecommendationTuning {
  familiarity?: "anchor" | "balanced" | "explore";
  energy?: "lower" | "steady" | "lift";
  anchorArtists?: string[];
  avoidArtists?: string[];
  moodKeywords?: string[];
}

export interface CompanionReply {
  text: string;
  mood?: ReplyMood;
  displayReason?: string;
}

export interface CompanionIntent {
  type: CompanionIntentType;
  confidence: number;
}

export type LLMMusicPlan =
  | {
      action: "none";
    }
  | {
      action: "search_and_queue";
      query: string;
      queueQueries?: string[];
      tuning?: RecommendationTuning;
    }
  | {
      action: "play_track";
      songId: string;
    }
  | {
      action: "skip_track";
    }
  | {
      action: "switch_mode";
      nextMode: AppMode;
    };

export type PreferenceSignalType =
  | "artist_preference"
  | "genre_preference"
  | "mood_preference"
  | "scene_preference"
  | "negative_preference"
  | "feedback";

export type ProfileUpdateTriggerType = "manual" | "favorite_threshold";
export type ProfileUpdateJobStatus = "pending" | "running" | "completed" | "failed";

export interface WeightedTag {
  name: string;
  weight: number;
  evidence?: string;
}

export interface FavoriteTrack {
  id: string;
  source: "netease";
  sourceTrackId: string;
  title: string;
  artists: string[];
  album?: string;
  coverUrl?: string;
  duration?: number;
  likedAt: string;
  likedMode?: AppMode;
  userPrompt?: string;
  assistantReason?: string;
  tags?: string[];
  moodTags?: string[];
  sceneTags?: string[];
  playCountAtLiked?: number;
  removedAt?: string | null;
}

export interface PreferenceSignal {
  id: string;
  createdAt: string;
  type: PreferenceSignalType;
  text: string;
  sourceMessage?: string;
  mode?: AppMode;
  relatedTrackId?: string;
  weight: number;
}

export interface MusicProfile {
  version: number;
  updatedAt: string;
  summary: string;
  preferredGenres: WeightedTag[];
  preferredArtists: WeightedTag[];
  preferredMoods: WeightedTag[];
  preferredScenes: WeightedTag[];
  dislikedGenres: WeightedTag[];
  dislikedFeatures: WeightedTag[];
  modeStrategies: {
    companion: string;
    focus: string;
    sleep: string;
  };
  recommendationRules: string[];
  evidenceStats: {
    favoriteCount: number;
    playHistoryCount: number;
    preferenceSignalCount: number;
  };
  confidence: number;
}

export interface MusicProfileVersion {
  id: string;
  version: number;
  createdAt: string;
  triggerType: ProfileUpdateTriggerType;
  favoriteCountSnapshot: number;
  profile: MusicProfile;
  inputSummary?: unknown;
}

export interface ProfileUpdateJob {
  id: string;
  triggerType: ProfileUpdateTriggerType;
  status: ProfileUpdateJobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  failedAt?: string | null;
  errorMessage?: string | null;
  favoriteCountSnapshot?: number;
  targetVersion?: number | null;
}

export interface FavoriteStatusResponse {
  songId: string | null;
  isFavorited: boolean;
  favorite: FavoriteTrack | null;
}

export interface MusicProfileStateResponse {
  currentVersion: MusicProfileVersion | null;
  latestJob: ProfileUpdateJob | null;
  favoritesSinceLastUpdate: number;
  pendingThreshold: number;
}

export interface LLMDecision {
  reply?: CompanionReply;
  intentInfo?: CompanionIntent;
  musicPlan?: LLMMusicPlan;
  intent: string;
  say: string;
  action: LLMAction;
  reason: string;
  segue: string;
  mode: AppMode;
}

export interface NowPlayingState {
  currentSong: SongDetail | null;
  playedSongs: SongDetail[];
  queue: SongDetail[];
  mode: AppMode;
  isPlaying: boolean;
  lastDecision: LLMDecision | null;
  updatedAt: string;
}

export interface ChatRequest {
  message: string;
}

export interface ChatResponse {
  reply: ChatMessage;
  decision: LLMDecision;
  state: NowPlayingState;
}

export interface PlayRequest {
  songId?: string;
  query?: string;
}

export interface PlaybackFeedbackRequest {
  songId: string;
  listenMs: number;
  durationMs?: number;
  event: "progress" | "paused" | "completed" | "skipped";
  reason?: string;
}

export interface RuntimeSettings {
  deepseekBaseUrl: string;
  deepseekModel: string;
  deepseekApiKeyConfigured: boolean;
  neteaseApiBaseUrl: string;
  useMockNeteaseOnFailure: boolean;
  neteaseCookieConfigured: boolean;
}

export interface RuntimeSettingsUpdate {
  deepseekBaseUrl?: string;
  deepseekModel?: string;
  deepseekApiKey?: string;
  clearDeepseekApiKey?: boolean;
  neteaseApiBaseUrl?: string;
  useMockNeteaseOnFailure?: boolean;
  neteaseCookie?: string;
  clearNeteaseCookie?: boolean;
}

export interface LocalProfile {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileListResponse {
  currentProfileId: string;
  profiles: LocalProfile[];
}

export interface CreateProfileRequest {
  name: string;
}

export interface SwitchProfileRequest {
  profileId: string;
}

export interface NeteaseAccountStatus {
  configured: boolean;
  loggedIn: boolean;
  user?: {
    userId: string;
    nickname: string;
    avatarUrl?: string;
  };
  message?: string;
}

export interface NeteaseProfileSummary {
  syncedAt: string;
  account: {
    userId: string;
    nickname: string;
    avatarUrl?: string;
  };
  playlistCount: number;
  topPlaylists: Array<{
    id: string;
    name: string;
    trackCount: number;
    subscribed: boolean;
  }>;
  recentTracks: Array<{
    song: Song;
    playCount?: number;
    score?: number;
  }>;
  tasteSignals: {
    topArtists: Array<{
      name: string;
      count: number;
    }>;
    topAlbums: Array<{
      name: string;
      count: number;
    }>;
    keywords: string[];
  };
}

export interface NeteaseProfileSyncResponse {
  status: NeteaseAccountStatus;
  profile: NeteaseProfileSummary | null;
}

export interface NeteaseQrLoginSession {
  key: string;
  qrUrl?: string;
  qrImg?: string;
}

export type NeteaseQrLoginState =
  | "expired"
  | "waiting_scan"
  | "waiting_confirm"
  | "authorized"
  | "unknown";

export interface NeteaseQrLoginCheck {
  key: string;
  code: number;
  state: NeteaseQrLoginState;
  message: string;
  cookieSaved: boolean;
  status?: NeteaseAccountStatus;
}

export interface NeteaseCaptchaRequest {
  phone: string;
  countryCode?: string;
}

export interface NeteaseCellphoneLoginRequest {
  phone: string;
  captcha: string;
  countryCode?: string;
}

export interface NeteaseCellphoneLoginResponse {
  cookieSaved: boolean;
  status: NeteaseAccountStatus;
}

export interface OnboardingStepStatus {
  apiKey: boolean;
  neteaseLogin: boolean;
  modeChoice: boolean;
}

export interface OnboardingStatus {
  completed: boolean;
  steps: OnboardingStepStatus;
}
