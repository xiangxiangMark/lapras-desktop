import type {
  AppMode,
  ChatMessage,
  LLMDecision,
  PlayRecord,
  RecommendationTuning
} from "@ai-music-companion/shared";

export interface UserProfile {
  taste: string;
  routines: string;
  moodRules: string;
  playlists: unknown;
  neteaseProfile: unknown;
}

export interface MemoryScope {
  key: string;
  profileId: string;
  neteaseUserId?: string | null;
  source: "netease_account" | "profile";
}

export interface LongTermMemorySummary {
  memoryScope: MemoryScope;
  updatedAt: string;
  sourceSignals: {
    neteaseProfileSyncedAt?: string | null;
    preferredArtists: string[];
    recentAcceptedArtists: string[];
    recentSkippedArtists: string[];
    recentPreferenceSignals: string[];
  };
  stablePreferences: {
    preferredArtists: string[];
    preferredKeywords: string[];
    avoidKeywords: string[];
    recurringScenes: string[];
    preferredAlbums: string[];
  };
  modePreferences: {
    companion: string[];
    focus: string[];
    sleep: string[];
  };
  recentPreferenceShift: string[];
  confidence: {
    stablePreferenceLevel: "high" | "medium" | "low";
    reinforcedSignals: string[];
    watchSignals: string[];
    updateReasons: string[];
  };
}

export interface ShortTermConversationSummary {
  summary: string;
  includedMessages: ChatMessage[];
  detectedPreferenceSignals: string[];
}

export interface ShortTermPlaybackSummary {
  summary: string;
  includedHistory: PlayRecord[];
  feedbackHighlights: string[];
}

export interface ContextBudgetMeta {
  targetInputTokens: number;
  hardLimitTokens: number;
  segmentBudgets: Record<
    string,
    {
      targetTokens: number;
      hardChars: number;
    }
  >;
  actualUsage: {
    approxChars: number;
    approxTokens: number;
  };
}

export interface RecommendationPortrait {
  summary: string;
  stableTraits: string[];
  currentNeeds: string[];
  continuationFocus: "current_song" | "mode" | "refresh";
  suggestedTuning: RecommendationTuning;
  anchorQueries: string[];
  exploreQueries: string[];
}

export interface LLMContext {
  systemPersona: string;
  userProfile: UserProfile;
  memoryScope: MemoryScope;
  recentMessages: ChatMessage[];
  recentPlayHistory: PlayRecord[];
  nowPlaying: {
    currentSong: PlayRecord["song"] | null;
    queue: PlayRecord["song"][];
    mode: AppMode;
    isPlaying: boolean;
  };
  playbackFeedback: {
    recentSongIds: string[];
    skippedSongIds: string[];
    skippedArtists: string[];
  };
  longTermMemory: LongTermMemorySummary;
  shortTermConversationSummary: ShortTermConversationSummary;
  shortTermPlaybackSummary: ShortTermPlaybackSummary;
  recommendationPortrait: RecommendationPortrait;
  contextBudgetMeta: ContextBudgetMeta;
  currentMode: AppMode;
  currentUserInput: string;

  /** 用户画像中的已知歌手名列表，每次聊天刷新。
   *  来源：neteaseProfile.topArtists + musicProfile.preferredArtists
   *       + longTermMemory.stablePreferences.preferredArtists
   *       + 当前播放歌曲的歌手 + 种子兜底列表。
   *  用于规则引擎的艺术家名提取和 LLM 提示词参考。 */
  knownArtists: string[];
}

export interface LLMProvider {
  generateDecision(context: LLMContext): Promise<LLMDecision>;
}
