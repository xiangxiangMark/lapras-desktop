import type {
  ChatMessage,
  NeteaseProfileSummary,
  PlayRecord
} from "@ai-music-companion/shared";

import type { DatabaseClient } from "../db/sqlite.js";
import type {
  LongTermMemorySummary,
  MemoryScope
} from "../providers/llm/LLMProvider.js";
import { safeJsonParse } from "../utils/json.js";
import { HistoryService } from "./historyService.js";
import { MemoryScopeService } from "./memoryScopeService.js";
import { MessageService } from "./messageService.js";
import { ProfileService } from "./profileService.js";

type LocalPlaylistsProfile = {
  favorites?: string[];
  avoid?: string[];
  scenes?: Record<string, string[]>;
};

type MemoryConfidence = LongTermMemorySummary["confidence"];

type MemorySummaryRow = {
  scope_key: string;
  summary_json: string;
  source_signature: string;
  updated_at: string;
};

export class LongTermMemoryService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly profileService: ProfileService,
    private readonly messageService: MessageService,
    private readonly historyService: HistoryService,
    private readonly memoryScopeService: MemoryScopeService,
    private readonly getProfileId: () => string = () => "default"
  ) {}

  getMemoryScope(): MemoryScope {
    return this.memoryScopeService.getMemoryScope();
  }

  getSummary() {
    const scope = this.getMemoryScope();
    const profile = this.profileService.getProfile();
    const neteaseProfile = this.asNeteaseProfile(profile.neteaseProfile);
    const recentMessages = this.messageService.getRecentMessages(18);
    const recentHistory = this.historyService.getRecentHistory(30);
    const existing = this.readSummaryRow(scope.key);
    const existingSummary = this.hydrateSummary(
      safeJsonParse<LongTermMemorySummary | null>(
        existing?.summary_json,
        null
      )
    );
    const signature = this.buildSourceSignature(
      scope,
      neteaseProfile,
      recentMessages,
      recentHistory,
      existingSummary
    );

    if (existing?.source_signature === signature) {
      return (
        existingSummary ??
        this.buildSummary(
          scope,
          neteaseProfile,
          recentMessages,
          recentHistory,
          profile.playlists
        )
      );
    }

    const nextSummary = this.buildSummary(
      scope,
      neteaseProfile,
      recentMessages,
      recentHistory,
      profile.playlists,
      existingSummary
    );

    if (existingSummary && !this.hasMeaningfulSummaryChanges(existingSummary, nextSummary)) {
      return existingSummary;
    }

    this.writeSummaryRow(scope, nextSummary, signature);
    return nextSummary;
  }

  private buildSummary(
    scope: MemoryScope,
    neteaseProfile: NeteaseProfileSummary | null,
    recentMessages: ChatMessage[],
    recentHistory: PlayRecord[],
    rawPlaylists: unknown,
    existingSummary?: LongTermMemorySummary | null
  ): LongTermMemorySummary {
    const localPlaylists = this.asLocalPlaylists(rawPlaylists);
    const recentPreferenceSignals = this.detectPreferenceSignals(recentMessages);
    const acceptedArtistWeights = this.collectAcceptedArtistWeights(recentHistory);
    const skippedArtistWeights = this.collectSkippedArtistWeights(recentHistory);
    const recentAcceptedArtists = this.sortWeightedArtists(acceptedArtistWeights, 1, 6);
    const recentSkippedArtists = this.sortWeightedArtists(skippedArtistWeights, 1, 6);
    const stableAcceptedArtists = this.sortWeightedArtists(acceptedArtistWeights, 2, 6);
    const stableSkippedArtists = this.sortWeightedArtists(skippedArtistWeights, 2, 6);
    const confidence = this.buildConfidence(
      recentPreferenceSignals,
      existingSummary,
      neteaseProfile,
      localPlaylists,
      stableAcceptedArtists,
      stableSkippedArtists
    );

    return {
      memoryScope: scope,
      updatedAt: new Date().toISOString(),
      sourceSignals: {
        neteaseProfileSyncedAt: neteaseProfile?.syncedAt ?? null,
        preferredArtists: (neteaseProfile?.tasteSignals.topArtists ?? [])
          .slice(0, 6)
          .map((artist) => artist.name),
        recentAcceptedArtists,
        recentSkippedArtists,
        recentPreferenceSignals
      },
      stablePreferences: {
        preferredArtists: this.uniqueStrings([
          ...(neteaseProfile?.tasteSignals.topArtists ?? [])
            .slice(0, 8)
            .map((artist) => artist.name),
          ...stableAcceptedArtists
        ]).slice(0, 8),
        preferredKeywords: this.uniqueStrings([
          ...(localPlaylists.favorites ?? []),
          ...(neteaseProfile?.tasteSignals.keywords ?? []).slice(0, 10)
        ]).slice(0, 10),
        avoidKeywords: this.uniqueStrings([
          ...(localPlaylists.avoid ?? []),
          ...stableSkippedArtists
        ]).slice(0, 8),
        recurringScenes: this.uniqueStrings(
          Object.values(localPlaylists.scenes ?? {})
            .flatMap((scene) => scene)
            .concat(this.extractRoutineHints(recentMessages))
        ).slice(0, 8),
        preferredAlbums: (neteaseProfile?.tasteSignals.topAlbums ?? [])
          .slice(0, 5)
          .map((album) => album.name)
      },
      modePreferences: {
        companion: this.uniqueStrings([
          ...(localPlaylists.scenes?.commute_night ?? []),
          "温柔陪伴",
          "华语流行"
        ]).slice(0, 6),
        focus: this.uniqueStrings([
          ...(localPlaylists.scenes?.coding_focus ?? []),
          "少人声",
          "稳定节拍"
        ]).slice(0, 6),
        sleep: this.uniqueStrings([
          ...(localPlaylists.scenes?.before_sleep ?? []),
          "低刺激",
          "轻柔夜晚"
        ]).slice(0, 6)
      },
      recentPreferenceShift: confidence.reinforcedSignals.slice(0, 6),
      confidence
    };
  }

  private readSummaryRow(scopeKey: string) {
    return this.db
      .prepare<MemorySummaryRow>(
        `
          SELECT scope_key, summary_json, source_signature, updated_at
          FROM memory_summaries
          WHERE scope_key = ?
        `
      )
      .get([scopeKey]);
  }

  private writeSummaryRow(
    scope: MemoryScope,
    summary: LongTermMemorySummary,
    sourceSignature: string
  ) {
    this.db
      .prepare(
        `
          INSERT INTO memory_summaries (
            scope_key,
            profile_id,
            netease_user_id,
            source_signature,
            summary_json,
            updated_at
          )
          VALUES (
            @scope_key,
            @profile_id,
            @netease_user_id,
            @source_signature,
            @summary_json,
            @updated_at
          )
          ON CONFLICT(scope_key) DO UPDATE SET
            profile_id = excluded.profile_id,
            netease_user_id = excluded.netease_user_id,
            source_signature = excluded.source_signature,
            summary_json = excluded.summary_json,
            updated_at = excluded.updated_at
        `
      )
      .run({
        scope_key: scope.key,
        profile_id: scope.profileId,
        netease_user_id: scope.neteaseUserId ?? null,
        source_signature: sourceSignature,
        summary_json: JSON.stringify(summary),
        updated_at: summary.updatedAt
      });
  }

  private buildSourceSignature(
    scope: MemoryScope,
    neteaseProfile: NeteaseProfileSummary | null,
    recentMessages: ChatMessage[],
    recentHistory: PlayRecord[],
    existingSummary?: LongTermMemorySummary | null
  ) {
    const recentPreferenceSignals = this.detectPreferenceSignals(recentMessages);
    const stableAcceptedArtists = this.sortWeightedArtists(
      this.collectAcceptedArtistWeights(recentHistory),
      2,
      4
    );
    const stableSkippedArtists = this.sortWeightedArtists(
      this.collectSkippedArtistWeights(recentHistory),
      2,
      4
    );
    const reinforcedSignals = recentPreferenceSignals.filter((signal) =>
      (existingSummary?.confidence?.reinforcedSignals ?? []).includes(signal) ||
      existingSummary?.recentPreferenceShift.includes(signal)
    );

    return JSON.stringify({
      scope: scope.key,
      syncedAt: neteaseProfile?.syncedAt ?? null,
      topArtists: (neteaseProfile?.tasteSignals.topArtists ?? [])
        .slice(0, 5)
        .map((artist) => artist.name),
      acceptedArtists: stableAcceptedArtists,
      skippedArtists: stableSkippedArtists,
      reinforcedSignals: reinforcedSignals.slice(0, 4)
    });
  }

  private buildConfidence(
    recentPreferenceSignals: string[],
    existingSummary: LongTermMemorySummary | null | undefined,
    neteaseProfile: NeteaseProfileSummary | null,
    localPlaylists: LocalPlaylistsProfile,
    stableAcceptedArtists: string[],
    stableSkippedArtists: string[]
  ): MemoryConfidence {
    const previousSignals = new Set([
      ...(existingSummary?.recentPreferenceShift ?? []),
      ...(existingSummary?.confidence?.reinforcedSignals ?? [])
    ]);
    const reinforcedSignals = recentPreferenceSignals.filter((signal) =>
      previousSignals.has(signal)
    );
    const watchSignals = recentPreferenceSignals.filter(
      (signal) => !reinforcedSignals.includes(signal)
    );
    const confidenceSources = [
      neteaseProfile?.tasteSignals.topArtists.length ? 1 : 0,
      (localPlaylists.favorites?.length ?? 0) > 0 ? 1 : 0,
      Object.keys(localPlaylists.scenes ?? {}).length > 0 ? 1 : 0,
      stableAcceptedArtists.length > 0 ? 1 : 0,
      stableSkippedArtists.length > 0 ? 1 : 0
    ].reduce((sum, value) => sum + value, 0);

    const stablePreferenceLevel =
      confidenceSources >= 4
        ? "high"
        : confidenceSources >= 2
          ? "medium"
          : "low";
    const updateReasons: string[] = [];

    if (neteaseProfile?.syncedAt) {
      updateReasons.push("profile_sync");
    }

    if (stableAcceptedArtists.length > 0 || stableSkippedArtists.length > 0) {
      updateReasons.push("feedback_reinforced");
    }

    if (reinforcedSignals.length > 0) {
      updateReasons.push("conversation_reinforced");
    }

    if (updateReasons.length === 0) {
      updateReasons.push("baseline_profile");
    }

    return {
      stablePreferenceLevel,
      reinforcedSignals: reinforcedSignals.slice(0, 6),
      watchSignals: watchSignals.slice(0, 6),
      updateReasons
    };
  }

  private hasMeaningfulSummaryChanges(
    previous: LongTermMemorySummary,
    next: LongTermMemorySummary
  ) {
    return JSON.stringify({
      ...previous,
      updatedAt: ""
    }) !==
      JSON.stringify({
        ...next,
        updatedAt: ""
      });
  }

  private hydrateSummary(summary: LongTermMemorySummary | null) {
    if (!summary) {
      return null;
    }

    return {
      ...summary,
      confidence: summary.confidence ?? {
        stablePreferenceLevel: "medium",
        reinforcedSignals: summary.recentPreferenceShift ?? [],
        watchSignals: [],
        updateReasons: ["legacy_upgrade"]
      }
    };
  }

  private detectPreferenceSignals(messages: ChatMessage[]) {
    const counts = new Map<string, number>();

    for (const message of messages) {
      if (message.role !== "user") {
        continue;
      }

      const content = message.content.trim();

      this.bumpSignal(counts, /太吵|安静一点|轻一点|柔和一点|温柔一点|别太炸/i, content, "偏好更柔和");
      this.bumpSignal(counts, /熟悉一点|熟一点|别太陌生|不要太新/i, content, "偏好更熟悉");
      this.bumpSignal(counts, /继续这个感觉|继续这种感觉|保持这个感觉|保持这个氛围/i, content, "希望延续当前氛围");
      this.bumpSignal(counts, /专注|focus|少人声|工作|学习/i, content, "偏好专注模式");
      this.bumpSignal(counts, /睡眠|助眠|晚安|夜间/i, content, "偏好夜间模式");
    }

    return [...counts.entries()]
      .filter(([, count]) => count >= 1)
      .sort((left, right) => right[1] - left[1])
      .map(([label]) => label);
  }

  private bumpSignal(
    counts: Map<string, number>,
    pattern: RegExp,
    content: string,
    label: string
  ) {
    if (!pattern.test(content)) {
      return;
    }

    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  private collectAcceptedArtistWeights(history: PlayRecord[]) {
    const accepted = new Map<string, number>();

    for (const record of history) {
      if (this.isNegativeFeedback(record)) {
        continue;
      }

      const weight = this.isPositiveFeedback(record) ? 2 : 1;

      for (const artist of this.splitArtists(record.song.artist)) {
        accepted.set(artist, (accepted.get(artist) ?? 0) + weight);
      }
    }

    return accepted;
  }

  private collectSkippedArtistWeights(history: PlayRecord[]) {
    const skipped = new Map<string, number>();

    for (const record of history) {
      if (!this.isNegativeFeedback(record)) {
        continue;
      }

      for (const artist of this.splitArtists(record.song.artist)) {
        skipped.set(artist, (skipped.get(artist) ?? 0) + 1);
      }
    }

    return skipped;
  }

  private sortWeightedArtists(weights: Map<string, number>, minimumWeight: number, limit: number) {
    return [...weights.entries()]
      .filter(([, weight]) => weight >= minimumWeight)
      .sort((left, right) => right[1] - left[1])
      .map(([artist]) => artist)
      .slice(0, limit);
  }

  private extractRoutineHints(messages: ChatMessage[]) {
    return messages
      .filter((message) => message.role === "user")
      .flatMap((message) => {
        const hints: string[] = [];

        if (/通勤|下班|路上/i.test(message.content)) {
          hints.push("通勤场景");
        }

        if (/工作|写代码|学习|专注/i.test(message.content)) {
          hints.push("工作学习");
        }

        if (/夜里|晚上|睡前|晚安/i.test(message.content)) {
          hints.push("夜晚放松");
        }

        return hints;
      });
  }

  private isNegativeFeedback(record: PlayRecord) {
    if (!record.skippedAt) {
      return false;
    }

    const durationMs = record.durationMs ?? record.song.durationMs ?? 0;

    if (!durationMs) {
      return (record.listenMs ?? 0) < 30_000;
    }

    return (record.listenMs ?? 0) < Math.min(45_000, durationMs * 0.28);
  }

  private isPositiveFeedback(record: PlayRecord) {
    if (record.completedAt) {
      return true;
    }

    const durationMs = record.durationMs ?? record.song.durationMs ?? 0;

    if (!durationMs) {
      return (record.listenMs ?? 0) >= 90_000;
    }

    return (record.listenMs ?? 0) >= durationMs * 0.55;
  }

  private splitArtists(artistLine: string) {
    return artistLine
      .split("/")
      .map((artist) => artist.trim())
      .filter(Boolean);
  }

  private uniqueStrings(values: string[]) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  private asLocalPlaylists(raw: unknown): LocalPlaylistsProfile {
    if (!raw || typeof raw !== "object") {
      return {};
    }

    return raw as LocalPlaylistsProfile;
  }

  private asNeteaseProfile(raw: unknown): NeteaseProfileSummary | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }

    const candidate = raw as Partial<NeteaseProfileSummary>;

    if (!candidate.account?.userId || !Array.isArray(candidate.topPlaylists)) {
      return null;
    }

    return candidate as NeteaseProfileSummary;
  }
}
