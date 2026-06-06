import type {
  AppMode,
  RecommendationTuning,
  SongDetail,
  WeightedTag
} from "@ai-music-companion/shared";

import type { LongTermMemorySummary } from "../providers/llm/LLMProvider.js";
import { HistoryService } from "./historyService.js";
import { LongTermMemoryService } from "./longTermMemoryService.js";
import { MessageService } from "./messageService.js";
import { MusicProfileService } from "./musicProfileService.js";
import { PreferenceSignalService } from "./preferenceSignalService.js";
import { ProfileService } from "./profileService.js";

export interface RecommendationPortrait {
  summary: string;
  stableTraits: string[];
  currentNeeds: string[];
  continuationFocus: "current_song" | "mode" | "refresh";
  suggestedTuning: RecommendationTuning;
  anchorQueries: string[];
  exploreQueries: string[];
}

type PortraitBuildOptions = {
  mode: AppMode;
  currentSong?: SongDetail | null;
  currentUserInput?: string;
};

export class RecommendationPortraitService {
  constructor(
    private readonly profileService: ProfileService,
    private readonly longTermMemoryService: LongTermMemoryService,
    private readonly messageService: MessageService,
    private readonly historyService: HistoryService,
    private readonly preferenceSignalService: PreferenceSignalService,
    private readonly musicProfileService: MusicProfileService
  ) {}

  build(options: PortraitBuildOptions): RecommendationPortrait {
    const musicProfile = this.musicProfileService.getCurrentProfile();
    const longTermMemory = this.longTermMemoryService.getSummary();
    const recentMessages = this.messageService.getRecentMessages(8);
    const recentHistory = this.historyService.getRecentHistory(10);
    const recentSignals = this.preferenceSignalService.getRecentSignals(12);
    const recentInput = [options.currentUserInput ?? ""]
      .concat(
        recentMessages
          .filter((message) => message.role === "user")
          .slice(-2)
          .map((message) => message.content)
      )
      .join(" ");
    const familiarity = this.resolveFamiliarity(options.mode, recentInput);
    const energy = this.resolveEnergy(options.mode, recentInput);
    const continuationFocus = this.resolveContinuationFocus(
      options.currentSong ?? null,
      recentInput
    );
    const anchorArtists = this.collectAnchorArtists(
      options.currentSong ?? null,
      musicProfile?.preferredArtists,
      longTermMemory,
      familiarity
    );
    const avoidArtists = longTermMemory.sourceSignals.recentSkippedArtists
      .slice(0, 4)
      .map((artist) => artist.trim())
      .filter(Boolean);
    const moodKeywords = this.collectMoodKeywords(
      musicProfile?.preferredMoods,
      musicProfile?.preferredScenes,
      longTermMemory,
      options.mode,
      energy
    );
    const stableTraits = this.collectStableTraits(
      musicProfile?.preferredArtists,
      musicProfile?.preferredGenres,
      musicProfile?.preferredMoods,
      longTermMemory,
      options.mode
    );
    const currentNeeds = this.collectCurrentNeeds(
      musicProfile?.summary,
      longTermMemory,
      familiarity,
      energy,
      continuationFocus,
      recentHistory,
      recentSignals
    );

    return {
      summary: this.buildSummary(musicProfile?.summary, stableTraits, currentNeeds),
      stableTraits,
      currentNeeds,
      continuationFocus,
      suggestedTuning: {
        familiarity,
        energy,
        anchorArtists,
        avoidArtists,
        moodKeywords
      },
      anchorQueries: this.buildAnchorQueries(
        options.mode,
        options.currentSong ?? null,
        anchorArtists,
        moodKeywords
      ),
      exploreQueries: this.buildExploreQueries(
        options.mode,
        moodKeywords,
        longTermMemory,
        musicProfile?.preferredGenres
      )
    };
  }

  private resolveFamiliarity(mode: AppMode, input: string) {
    if (/(熟悉一点|别太新|不要太陌生|稳一点|常听|老一点)/i.test(input)) {
      return "anchor" as const;
    }

    if (mode === "discover" || /(新鲜一点|发现|探索|没听过|新歌)/i.test(input)) {
      return "explore" as const;
    }

    return "balanced" as const;
  }

  private resolveEnergy(mode: AppMode, input: string) {
    if (
      mode === "sleep" ||
      /(安静一点|轻一点|柔和一点|温柔一点|别太吵|助眠|晚安|睡前)/i.test(input)
    ) {
      return "lower" as const;
    }

    if (/(提神|醒一醒|来点劲|有冲劲|热烈一点|兴奋一点|高能)/i.test(input)) {
      return "lift" as const;
    }

    if (mode === "focus" || /(专注|工作|学习|稳定一点|少人声)/i.test(input)) {
      return "steady" as const;
    }

    return "steady" as const;
  }

  private resolveContinuationFocus(currentSong: SongDetail | null, input: string) {
    if (
      currentSong &&
      /(继续这个感觉|继续这种感觉|保持这个感觉|保持这个氛围|就这样继续)/i.test(input)
    ) {
      return "current_song" as const;
    }

    if (currentSong) {
      return "mode" as const;
    }

    return "refresh" as const;
  }

  private collectAnchorArtists(
    currentSong: SongDetail | null,
    preferredArtists: WeightedTag[] | undefined,
    longTermMemory: LongTermMemorySummary,
    familiarity: NonNullable<RecommendationTuning["familiarity"]>
  ) {
    const currentArtists =
      familiarity === "explore" ? [] : this.splitArtists(currentSong?.artist ?? "");

    return this.uniqueStrings([
      ...currentArtists,
      ...this.tagNames(preferredArtists, 4),
      ...longTermMemory.stablePreferences.preferredArtists,
      ...longTermMemory.sourceSignals.recentAcceptedArtists
    ]).slice(0, familiarity === "anchor" ? 4 : 3);
  }

  private collectMoodKeywords(
    preferredMoods: WeightedTag[] | undefined,
    preferredScenes: WeightedTag[] | undefined,
    longTermMemory: LongTermMemorySummary,
    mode: AppMode,
    energy: NonNullable<RecommendationTuning["energy"]>
  ) {
    const energyHints =
      energy === "lower"
        ? ["柔和", "安静", "夜晚"]
        : energy === "lift"
          ? ["清醒", "明亮", "节奏"]
          : ["稳定", "顺滑", "舒展"];

    return this.uniqueStrings([
      ...this.tagNames(preferredMoods, 3),
      ...this.tagNames(preferredScenes, 2),
      ...this.getModePreferences(longTermMemory, mode),
      ...longTermMemory.stablePreferences.preferredKeywords,
      ...longTermMemory.confidence.reinforcedSignals,
      ...energyHints,
      ...this.extractMeaningfulTerms(this.profileService.getProfile().taste),
      ...this.extractMeaningfulTerms(this.profileService.getProfile().moodRules)
    ]).slice(0, 6);
  }

  private collectStableTraits(
    preferredArtists: WeightedTag[] | undefined,
    preferredGenres: WeightedTag[] | undefined,
    preferredMoods: WeightedTag[] | undefined,
    longTermMemory: LongTermMemorySummary,
    mode: AppMode
  ) {
    return this.uniqueStrings([
      ...this.tagNames(preferredArtists, 2),
      ...this.tagNames(preferredGenres, 2),
      ...this.tagNames(preferredMoods, 2),
      ...longTermMemory.stablePreferences.preferredArtists.slice(0, 3),
      ...longTermMemory.stablePreferences.preferredKeywords.slice(0, 3),
      ...longTermMemory.stablePreferences.recurringScenes.slice(0, 2),
      ...this.getModePreferences(longTermMemory, mode).slice(0, 2)
    ]).slice(0, 8);
  }

  private collectCurrentNeeds(
    profileSummary: string | undefined,
    longTermMemory: LongTermMemorySummary,
    familiarity: NonNullable<RecommendationTuning["familiarity"]>,
    energy: NonNullable<RecommendationTuning["energy"]>,
    continuationFocus: RecommendationPortrait["continuationFocus"],
    recentHistory: ReturnType<HistoryService["getRecentHistory"]>,
    recentSignals: ReturnType<PreferenceSignalService["getRecentSignals"]>
  ) {
    const labels = [
      familiarity === "anchor"
        ? "这一轮更偏熟悉"
        : familiarity === "explore"
          ? "这一轮可以多给新鲜感"
          : "这一轮保持熟悉和新鲜平衡",
      energy === "lower"
        ? "优先降低刺激感"
        : energy === "lift"
          ? "可以稍微提一点精神"
          : "保持稳定不过冲",
      continuationFocus === "current_song"
        ? "尽量延续当前这首的感觉"
        : continuationFocus === "mode"
          ? "围绕当前模式继续铺开"
          : "可以从零开始重新起氛围"
    ];

    if (profileSummary) {
      labels.push("优先沿本地画像延展");
    }

    if (longTermMemory.confidence.watchSignals.length > 0) {
      labels.push(`观察中的偏好：${longTermMemory.confidence.watchSignals[0]}`);
    }

    const recentSkipped = recentHistory.filter((record) => Boolean(record.skippedAt)).length;

    if (recentSkipped >= 2) {
      labels.push("最近跳过偏多，先稳一点");
    }

    const strongestSignal = recentSignals
      .filter((signal) => signal.weight >= 0.7)
      .map((signal) => signal.text)[0];

    if (strongestSignal) {
      labels.push(`最近信号：${strongestSignal}`);
    }

    return labels.slice(0, 5);
  }

  private buildSummary(
    profileSummary: string | undefined,
    stableTraits: string[],
    currentNeeds: string[]
  ) {
    return [
      profileSummary ? `长期画像：${profileSummary}` : "",
      stableTraits.length > 0 ? `稳定口味：${stableTraits.slice(0, 4).join("、")}` : "",
      currentNeeds.length > 0 ? `这一轮：${currentNeeds.slice(0, 3).join("；")}` : ""
    ]
      .filter(Boolean)
      .join("。");
  }

  private buildAnchorQueries(
    mode: AppMode,
    currentSong: SongDetail | null,
    anchorArtists: string[],
    moodKeywords: string[]
  ) {
    const modeHint = this.getModeHint(mode);

    return this.uniqueStrings([
      currentSong ? `${currentSong.name} ${currentSong.artist}` : "",
      ...anchorArtists.map((artist) => `${artist} ${modeHint}`),
      ...moodKeywords.slice(0, 3).map((keyword) => `${keyword} ${modeHint}`)
    ])
      .map((query) => this.normalizeQuery(query))
      .filter(Boolean)
      .slice(0, 6);
  }

  private buildExploreQueries(
    mode: AppMode,
    moodKeywords: string[],
    longTermMemory: LongTermMemorySummary,
    preferredGenres: WeightedTag[] | undefined
  ) {
    const modeHint = this.getExploreHint(mode);

    return this.uniqueStrings([
      ...moodKeywords.slice(0, 4).map((keyword) => `${keyword} ${modeHint}`),
      ...this.tagNames(preferredGenres, 2).map((genre) => `${genre} ${modeHint}`),
      ...longTermMemory.stablePreferences.preferredKeywords
        .slice(0, 2)
        .map((keyword) => `${keyword} ${modeHint}`)
    ])
      .map((query) => this.normalizeQuery(query))
      .filter(Boolean)
      .slice(0, 5);
  }

  private getModeHint(mode: AppMode) {
    const hints: Record<AppMode, string> = {
      companion: "温柔 陪伴",
      focus: "专注 稳定",
      discover: "新鲜 顺滑",
      sleep: "夜晚 轻柔"
    };

    return hints[mode];
  }

  private getExploreHint(mode: AppMode) {
    const hints: Record<AppMode, string> = {
      companion: "同气质延展",
      focus: "低打扰延展",
      discover: "相近但更新鲜",
      sleep: "更轻更慢"
    };

    return hints[mode];
  }

  private splitArtists(artistLine: string) {
    return artistLine
      .split("/")
      .map((artist) => artist.trim())
      .filter(Boolean);
  }

  private getModePreferences(longTermMemory: LongTermMemorySummary, mode: AppMode) {
    if (mode === "discover") {
      return longTermMemory.modePreferences.companion;
    }

    return longTermMemory.modePreferences[mode];
  }

  private normalizeQuery(query: string) {
    return query.replace(/\s+/g, " ").trim().slice(0, 40);
  }

  private uniqueStrings(values: string[]) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  private extractMeaningfulTerms(value: string) {
    return value
      .split(/[\s,，。|:：、]+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2)
      .slice(0, 4);
  }

  private tagNames(tags: WeightedTag[] | undefined, limit: number) {
    return (tags ?? [])
      .slice(0, limit)
      .map((tag) => tag.name.trim())
      .filter(Boolean);
  }
}
