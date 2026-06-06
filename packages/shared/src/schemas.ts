import { z } from "zod";

import { APP_MODES } from "./types.js";

export const AppModeSchema = z.enum(APP_MODES);

export const SongSchema = z.object({
  id: z.string(),
  source: z.literal("netease"),
  sourceId: z.string(),
  name: z.string(),
  artist: z.string(),
  album: z.string().optional(),
  durationMs: z.number().optional(),
  coverUrl: z.string().url().optional()
});

export const SongDetailSchema = SongSchema.extend({
  audioUrl: z.string().min(1).nullable().optional(),
  sourceUrl: z.string().url().nullable().optional(),
  lyricSnippet: z.string().nullable().optional()
});

export const PlayRecordSchema = z.object({
  id: z.string(),
  song: SongDetailSchema,
  playedAt: z.string(),
  reason: z.string(),
  mode: AppModeSchema,
  trigger: z.enum(["manual", "ai", "system"]),
  listenMs: z.number().optional(),
  durationMs: z.number().optional(),
  completedAt: z.string().nullable().optional(),
  skippedAt: z.string().nullable().optional(),
  skipReason: z.string().nullable().optional()
});

export const SearchAndQueueActionSchema = z.object({
  type: z.literal("search_and_queue"),
  query: z.string().min(1),
  queueQueries: z.array(z.string().min(1)).max(12).optional(),
  recommendationTuning: z
    .object({
      familiarity: z.enum(["anchor", "balanced", "explore"]).optional(),
      energy: z.enum(["lower", "steady", "lift"]).optional(),
      anchorArtists: z.array(z.string().min(1)).max(6).optional(),
      avoidArtists: z.array(z.string().min(1)).max(6).optional(),
      moodKeywords: z.array(z.string().min(1)).max(8).optional()
    })
    .optional()
});

export const PlayTrackActionSchema = z.object({
  type: z.literal("play_track"),
  songId: z.string().min(1)
});

export const SkipTrackActionSchema = z.object({
  type: z.literal("skip_track")
});

export const SpeakOnlyActionSchema = z.object({
  type: z.literal("speak_only")
});

export const SwitchModeActionSchema = z.object({
  type: z.literal("switch_mode"),
  nextMode: AppModeSchema
});

export const LLMActionSchema = z.discriminatedUnion("type", [
  SearchAndQueueActionSchema,
  PlayTrackActionSchema,
  SkipTrackActionSchema,
  SpeakOnlyActionSchema,
  SwitchModeActionSchema
]);

export const CompanionReplySchema = z.object({
  text: z.string().min(1),
  mood: z.enum(["soft", "playful", "quiet", "focused"]).optional(),
  displayReason: z.string().min(1).optional()
});

export const CompanionIntentSchema = z.object({
  type: z.enum(["chat", "music_request", "skip", "mode_switch", "feedback"]),
  confidence: z.number().min(0).max(1)
});

export const NoMusicPlanSchema = z.object({
  action: z.literal("none")
});

export const SearchAndQueueMusicPlanSchema = z.object({
  action: z.literal("search_and_queue"),
  query: z.string().min(1),
  queueQueries: z.array(z.string().min(1)).max(12).optional(),
  tuning: SearchAndQueueActionSchema.shape.recommendationTuning
});

export const PlayTrackMusicPlanSchema = z.object({
  action: z.literal("play_track"),
  songId: z.string().min(1)
});

export const SkipTrackMusicPlanSchema = z.object({
  action: z.literal("skip_track")
});

export const SwitchModeMusicPlanSchema = z.object({
  action: z.literal("switch_mode"),
  nextMode: AppModeSchema
});

export const LLMMusicPlanSchema = z.discriminatedUnion("action", [
  NoMusicPlanSchema,
  SearchAndQueueMusicPlanSchema,
  PlayTrackMusicPlanSchema,
  SkipTrackMusicPlanSchema,
  SwitchModeMusicPlanSchema
]);

export const LLMDecisionSchema = z.object({
  reply: CompanionReplySchema.optional(),
  intentInfo: CompanionIntentSchema.optional(),
  musicPlan: LLMMusicPlanSchema.optional(),
  intent: z.string().min(1),
  say: z.string().min(1),
  action: LLMActionSchema,
  reason: z.string().min(1),
  segue: z.string().min(1),
  mode: AppModeSchema
});

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
  createdAt: z.string(),
  decision: LLMDecisionSchema.nullable().optional()
});

export const NowPlayingStateSchema = z.object({
  currentSong: SongDetailSchema.nullable(),
  playedSongs: z.array(SongDetailSchema),
  queue: z.array(SongDetailSchema),
  mode: AppModeSchema,
  isPlaying: z.boolean(),
  lastDecision: LLMDecisionSchema.nullable(),
  updatedAt: z.string()
});

export const ChatRequestSchema = z.object({
  message: z.string().min(1)
});

export const PlayRequestSchema = z
  .object({
    songId: z.string().optional(),
    query: z.string().optional()
  })
  .refine((value) => Boolean(value.songId || value.query), {
    message: "songId or query is required"
  });

export const PlaybackFeedbackRequestSchema = z.object({
  songId: z.string().min(1),
  listenMs: z.number().min(0),
  durationMs: z.number().min(0).optional(),
  event: z.enum(["progress", "paused", "completed", "skipped"]),
  reason: z.string().max(80).optional()
});

export const WeightedTagSchema = z.object({
  name: z.string().min(1),
  weight: z.number().min(0).max(1),
  evidence: z.string().min(1).optional()
});

export const FavoriteTrackSchema = z.object({
  id: z.string().min(1),
  source: z.literal("netease"),
  sourceTrackId: z.string().min(1),
  title: z.string().min(1),
  artists: z.array(z.string().min(1)).min(1),
  album: z.string().min(1).optional(),
  coverUrl: z.string().url().optional(),
  duration: z.number().min(0).optional(),
  likedAt: z.string().min(1),
  likedMode: AppModeSchema.optional(),
  userPrompt: z.string().optional(),
  assistantReason: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
  moodTags: z.array(z.string().min(1)).optional(),
  sceneTags: z.array(z.string().min(1)).optional(),
  playCountAtLiked: z.number().min(0).optional(),
  removedAt: z.string().nullable().optional()
});

export const PreferenceSignalSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  type: z.enum([
    "artist_preference",
    "genre_preference",
    "mood_preference",
    "scene_preference",
    "negative_preference",
    "feedback"
  ]),
  text: z.string().min(1),
  sourceMessage: z.string().optional(),
  mode: AppModeSchema.optional(),
  relatedTrackId: z.string().min(1).optional(),
  weight: z.number().min(0).max(1)
});

export const MusicProfileSchema = z.object({
  version: z.number().int().min(1),
  updatedAt: z.string().min(1),
  summary: z.string().min(1),
  preferredGenres: z.array(WeightedTagSchema),
  preferredArtists: z.array(WeightedTagSchema),
  preferredMoods: z.array(WeightedTagSchema),
  preferredScenes: z.array(WeightedTagSchema),
  dislikedGenres: z.array(WeightedTagSchema),
  dislikedFeatures: z.array(WeightedTagSchema),
  modeStrategies: z.object({
    companion: z.string().min(1),
    focus: z.string().min(1),
    sleep: z.string().min(1)
  }),
  recommendationRules: z.array(z.string().min(1)),
  evidenceStats: z.object({
    favoriteCount: z.number().int().min(0),
    playHistoryCount: z.number().int().min(0),
    preferenceSignalCount: z.number().int().min(0)
  }),
  confidence: z.number().min(0).max(1)
});

export const MusicProfileVersionSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().min(1),
  createdAt: z.string().min(1),
  triggerType: z.enum(["manual", "favorite_threshold"]),
  favoriteCountSnapshot: z.number().int().min(0),
  profile: MusicProfileSchema,
  inputSummary: z.unknown().optional()
});

export const ProfileUpdateJobSchema = z.object({
  id: z.string().min(1),
  triggerType: z.enum(["manual", "favorite_threshold"]),
  status: z.enum(["pending", "running", "completed", "failed"]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  failedAt: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  favoriteCountSnapshot: z.number().int().min(0).optional(),
  targetVersion: z.number().int().nullable().optional()
});

export const FavoriteStatusResponseSchema = z.object({
  songId: z.string().nullable(),
  isFavorited: z.boolean(),
  favorite: FavoriteTrackSchema.nullable()
});

export const MusicProfileStateResponseSchema = z.object({
  currentVersion: MusicProfileVersionSchema.nullable(),
  latestJob: ProfileUpdateJobSchema.nullable(),
  favoritesSinceLastUpdate: z.number().int().min(0),
  pendingThreshold: z.number().int().min(1)
});

export const RuntimeSettingsSchema = z.object({
  deepseekBaseUrl: z.string().url(),
  deepseekModel: z.string().min(1),
  deepseekApiKeyConfigured: z.boolean(),
  neteaseApiBaseUrl: z.string(),
  useMockNeteaseOnFailure: z.boolean(),
  neteaseCookieConfigured: z.boolean()
});

export const RuntimeSettingsUpdateSchema = z
  .object({
    deepseekBaseUrl: z.string().url().optional(),
    deepseekModel: z.string().min(1).optional(),
    deepseekApiKey: z.string().optional(),
    clearDeepseekApiKey: z.boolean().optional(),
    neteaseApiBaseUrl: z.string().optional(),
    useMockNeteaseOnFailure: z.boolean().optional(),
    neteaseCookie: z.string().optional(),
    clearNeteaseCookie: z.boolean().optional()
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one setting must be provided"
  );

export const LocalProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  isDefault: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const ProfileListResponseSchema = z.object({
  currentProfileId: z.string().min(1),
  profiles: z.array(LocalProfileSchema)
});

export const CreateProfileRequestSchema = z.object({
  name: z.string().min(1).max(40)
});

export const SwitchProfileRequestSchema = z.object({
  profileId: z.string().min(1)
});

export const NeteaseAccountStatusSchema = z.object({
  configured: z.boolean(),
  loggedIn: z.boolean(),
  user: z
    .object({
      userId: z.string(),
      nickname: z.string(),
      avatarUrl: z.string().url().optional()
    })
    .optional(),
  message: z.string().optional()
});

export const NeteaseProfileSummarySchema = z.object({
  syncedAt: z.string(),
  account: z.object({
    userId: z.string(),
    nickname: z.string(),
    avatarUrl: z.string().url().optional()
  }),
  playlistCount: z.number(),
  topPlaylists: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      trackCount: z.number(),
      subscribed: z.boolean()
    })
  ),
  recentTracks: z.array(
    z.object({
      song: SongSchema,
      playCount: z.number().optional(),
      score: z.number().optional()
    })
  ),
  tasteSignals: z.object({
    topArtists: z.array(
      z.object({
        name: z.string(),
        count: z.number()
      })
    ),
    topAlbums: z.array(
      z.object({
        name: z.string(),
        count: z.number()
      })
    ),
    keywords: z.array(z.string())
  })
});

export const NeteaseProfileSyncResponseSchema = z.object({
  status: NeteaseAccountStatusSchema,
  profile: NeteaseProfileSummarySchema.nullable()
});

export const NeteaseQrLoginSessionSchema = z.object({
  key: z.string(),
  qrUrl: z.string().optional(),
  qrImg: z.string().optional()
});

export const NeteaseQrLoginCheckSchema = z.object({
  key: z.string(),
  code: z.number(),
  state: z.enum(["expired", "waiting_scan", "waiting_confirm", "authorized", "unknown"]),
  message: z.string(),
  cookieSaved: z.boolean(),
  status: NeteaseAccountStatusSchema.optional()
});

export const NeteaseCaptchaRequestSchema = z.object({
  phone: z.string().min(5),
  countryCode: z.string().default("86").optional()
});

export const NeteaseCellphoneLoginRequestSchema = z.object({
  phone: z.string().min(5),
  captcha: z.string().min(4),
  countryCode: z.string().default("86").optional()
});

export const NeteaseCellphoneLoginResponseSchema = z.object({
  cookieSaved: z.boolean(),
  status: NeteaseAccountStatusSchema
});

export type AppModeValue = z.infer<typeof AppModeSchema>;
export type SongValue = z.infer<typeof SongSchema>;
export type SongDetailValue = z.infer<typeof SongDetailSchema>;
export type PlayRecordValue = z.infer<typeof PlayRecordSchema>;
export type PlaybackFeedbackRequestValue = z.infer<
  typeof PlaybackFeedbackRequestSchema
>;
export type ChatMessageValue = z.infer<typeof ChatMessageSchema>;
export type LLMActionValue = z.infer<typeof LLMActionSchema>;
export type CompanionReplyValue = z.infer<typeof CompanionReplySchema>;
export type CompanionIntentValue = z.infer<typeof CompanionIntentSchema>;
export type LLMMusicPlanValue = z.infer<typeof LLMMusicPlanSchema>;
export type LLMDecisionValue = z.infer<typeof LLMDecisionSchema>;
export type NowPlayingStateValue = z.infer<typeof NowPlayingStateSchema>;
export type WeightedTagValue = z.infer<typeof WeightedTagSchema>;
export type FavoriteTrackValue = z.infer<typeof FavoriteTrackSchema>;
export type PreferenceSignalValue = z.infer<typeof PreferenceSignalSchema>;
export type MusicProfileValue = z.infer<typeof MusicProfileSchema>;
export type MusicProfileVersionValue = z.infer<typeof MusicProfileVersionSchema>;
export type ProfileUpdateJobValue = z.infer<typeof ProfileUpdateJobSchema>;
export type FavoriteStatusResponseValue = z.infer<typeof FavoriteStatusResponseSchema>;
export type MusicProfileStateResponseValue = z.infer<typeof MusicProfileStateResponseSchema>;
export type RuntimeSettingsValue = z.infer<typeof RuntimeSettingsSchema>;
export type RuntimeSettingsUpdateValue = z.infer<typeof RuntimeSettingsUpdateSchema>;
export type LocalProfileValue = z.infer<typeof LocalProfileSchema>;
export type ProfileListResponseValue = z.infer<typeof ProfileListResponseSchema>;
export type CreateProfileRequestValue = z.infer<typeof CreateProfileRequestSchema>;
export type SwitchProfileRequestValue = z.infer<typeof SwitchProfileRequestSchema>;
export type NeteaseAccountStatusValue = z.infer<typeof NeteaseAccountStatusSchema>;
export type NeteaseProfileSummaryValue = z.infer<typeof NeteaseProfileSummarySchema>;
export type NeteaseProfileSyncResponseValue = z.infer<
  typeof NeteaseProfileSyncResponseSchema
>;
export type NeteaseQrLoginSessionValue = z.infer<typeof NeteaseQrLoginSessionSchema>;
export type NeteaseQrLoginCheckValue = z.infer<typeof NeteaseQrLoginCheckSchema>;
export type NeteaseCaptchaRequestValue = z.infer<typeof NeteaseCaptchaRequestSchema>;
export type NeteaseCellphoneLoginRequestValue = z.infer<
  typeof NeteaseCellphoneLoginRequestSchema
>;
export type NeteaseCellphoneLoginResponseValue = z.infer<
  typeof NeteaseCellphoneLoginResponseSchema
>;
