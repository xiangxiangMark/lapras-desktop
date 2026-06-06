import {
  MusicProfileSchema,
  type MusicProfile,
  type MusicProfileStateResponse,
  type MusicProfileVersion,
  type ProfileUpdateJob,
  type ProfileUpdateTriggerType,
  type WeightedTag
} from "@ai-music-companion/shared";

import type { DatabaseClient } from "../db/sqlite.js";
import { extractFirstJsonObject, safeJsonParse } from "../utils/json.js";
import { HistoryService } from "./historyService.js";
import { MemoryScopeService } from "./memoryScopeService.js";
import { PreferenceSignalService } from "./preferenceSignalService.js";
import type { SettingsService } from "./settingsService.js";

type MusicProfileVersionRow = {
  id: string;
  version: number;
  trigger_type: ProfileUpdateTriggerType;
  favorite_count_snapshot: number;
  profile_json: string;
  input_summary_json?: string | null;
  created_at: string;
};

type ProfileUpdateJobRow = {
  id: string;
  trigger_type: ProfileUpdateTriggerType;
  status: "pending" | "running" | "completed" | "failed";
  favorite_count_snapshot: number;
  error_message?: string | null;
  target_version?: number | null;
  input_summary_json?: string | null;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  failed_at?: string | null;
};

const AUTO_UPDATE_THRESHOLD = 50;

export class MusicProfileService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly memoryScopeService: MemoryScopeService,
    private readonly historyService: HistoryService,
    private readonly preferenceSignalService: PreferenceSignalService,
    private readonly settingsService: SettingsService,
    private readonly getProfileId: () => string = () => "default"
  ) {}

  getCurrentVersion(): MusicProfileVersion | null {
    const scope = this.memoryScopeService.getMemoryScope();
    const currentIdRow = this.db
      .prepare<{ value: string }>(`SELECT value FROM app_state WHERE key = ?`)
      .get([this.getCurrentVersionStateKey(scope.key)]);
    const currentId = safeJsonParse<string | null>(currentIdRow?.value, null);

    if (currentId) {
      const row = this.db
        .prepare<MusicProfileVersionRow>(
          `
            SELECT id, version, trigger_type, favorite_count_snapshot, profile_json,
                   input_summary_json, created_at
            FROM music_profile_versions
            WHERE id = ?
          `
        )
        .get([currentId]);

      if (row) {
        return this.mapVersionRow(row);
      }
    }

    return this.getVersions(1)[0] ?? null;
  }

  getCurrentProfile(): MusicProfile | null {
    return this.getCurrentVersion()?.profile ?? null;
  }

  activateVersion(versionId: string) {
    // 版本 id 全局唯一，scope 校验非必需
    const row = this.db
      .prepare<MusicProfileVersionRow>(
        `SELECT id FROM music_profile_versions WHERE id = ? AND profile_id = ?`
      )
      .get([versionId, this.getProfileId()]);

    if (!row) {
      throw new Error("版本不存在。");
    }

    this.writeCurrentVersionPointer(versionId);
    return this.getCurrentVersion();
  }

  deleteVersion(versionId: string) {
    const currentVersion = this.getCurrentVersion();

    if (currentVersion?.id === versionId) {
      throw new Error("不能删除当前正在使用的版本。");
    }

    const allVersions = this.getVersions(100);

    if (allVersions.length <= 1) {
      throw new Error("至少保留一个版本。");
    }

    this.db
      .prepare(
        `DELETE FROM music_profile_versions WHERE id = ? AND profile_id = ?`
      )
      .run([versionId, this.getProfileId()]);

    return { deleted: true };
  }

  getVersions(limit = 10) {
    const scope = this.memoryScopeService.getMemoryScope();

    // 先按当前 scope 查
    const rows = this.db
      .prepare<MusicProfileVersionRow>(
        `
          SELECT id, version, trigger_type, favorite_count_snapshot, profile_json,
                 input_summary_json, created_at
          FROM music_profile_versions
          WHERE profile_id = ? AND memory_scope_key = ?
          ORDER BY version DESC
          LIMIT ?
        `
      )
      .all([this.getProfileId(), scope.key, Math.max(limit, 1)]);

    if (rows.length > 0) {
      return rows.map((row) => this.mapVersionRow(row));
    }

    // scope 不匹配时（如网易云登录态变更），回退为按 profile_id 全量查询
    const fallbackRows = this.db
      .prepare<MusicProfileVersionRow>(
        `
          SELECT id, version, trigger_type, favorite_count_snapshot, profile_json,
                 input_summary_json, created_at
          FROM music_profile_versions
          WHERE profile_id = ?
          ORDER BY version DESC
          LIMIT ?
        `
      )
      .all([this.getProfileId(), Math.max(limit, 1)]);

    return fallbackRows.map((row) => this.mapVersionRow(row));
  }

  getLatestJob(): ProfileUpdateJob | null {
    const scope = this.memoryScopeService.getMemoryScope();
    const row = this.db
      .prepare<ProfileUpdateJobRow>(
        `
          SELECT id, trigger_type, status, favorite_count_snapshot, error_message,
                 target_version, input_summary_json, created_at, updated_at,
                 started_at, completed_at, failed_at
          FROM profile_update_jobs
          WHERE profile_id = ? AND memory_scope_key = ?
          ORDER BY datetime(created_at) DESC
          LIMIT 1
        `
      )
      .get([this.getProfileId(), scope.key]);

    return row ? this.mapJobRow(row) : null;
  }

  getState(): MusicProfileStateResponse {
    return {
      currentVersion: this.getCurrentVersion(),
      latestJob: this.getLatestJob(),
      favoritesSinceLastUpdate: this.countFavoritesSinceLastUpdate(),
      pendingThreshold: AUTO_UPDATE_THRESHOLD
    };
  }

  countFavoritesSinceLastUpdate() {
    const currentVersion = this.getCurrentVersion();
    const scope = this.memoryScopeService.getMemoryScope();
    const row = this.db
      .prepare<{ count: number }>(
        `
          SELECT COUNT(*) as count
          FROM favorite_tracks
          WHERE profile_id = ?
            AND memory_scope_key = ?
            AND removed_at IS NULL
            AND liked_at > COALESCE(?, '')
        `
      )
      .get([
        this.getProfileId(),
        scope.key,
        currentVersion?.createdAt ?? null
      ]);

    return row?.count ?? 0;
  }

  async requestUpdate(triggerType: ProfileUpdateTriggerType) {
    const scope = this.memoryScopeService.getMemoryScope();
    const existing = this.getLatestJob();

    if (existing && (existing.status === "pending" || existing.status === "running")) {
      return existing;
    }

    const now = new Date().toISOString();
    const job: ProfileUpdateJob = {
      id: `profile-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      triggerType,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      favoriteCountSnapshot: this.countActiveFavorites(),
      targetVersion: null
    };

    this.db
      .prepare(
        `
          INSERT INTO profile_update_jobs (
            id,
            profile_id,
            memory_scope_key,
            netease_user_id,
            trigger_type,
            status,
            favorite_count_snapshot,
            created_at,
            updated_at
          )
          VALUES (
            @id,
            @profile_id,
            @memory_scope_key,
            @netease_user_id,
            @trigger_type,
            @status,
            @favorite_count_snapshot,
            @created_at,
            @updated_at
          )
        `
      )
      .run({
        id: job.id,
        profile_id: this.getProfileId(),
        memory_scope_key: scope.key,
        netease_user_id: scope.neteaseUserId ?? null,
        trigger_type: job.triggerType,
        status: job.status,
        favorite_count_snapshot: job.favoriteCountSnapshot ?? 0,
        created_at: job.createdAt,
        updated_at: job.updatedAt
      });

    queueMicrotask(() => {
      void this.processJob(job.id);
    });

    return job;
  }

  scheduleUpdateIfNeeded() {
    if (this.countFavoritesSinceLastUpdate() < AUTO_UPDATE_THRESHOLD) {
      return null;
    }

    const latestJob = this.getLatestJob();

    if (latestJob && (latestJob.status === "pending" || latestJob.status === "running")) {
      return latestJob;
    }

    return this.requestUpdate("favorite_threshold");
  }

  private async processJob(jobId: string) {
    const runningAt = new Date().toISOString();

    this.db
      .prepare(
        `
          UPDATE profile_update_jobs
          SET status = 'running', started_at = @started_at, updated_at = @updated_at
          WHERE id = @id
        `
      )
      .run({
        id: jobId,
        started_at: runningAt,
        updated_at: runningAt
      });

    try {
      const currentVersion = this.getCurrentVersion();
      const nextVersionNumber = (currentVersion?.version ?? 0) + 1;
      const inputSummary = this.buildInputSummary(currentVersion?.createdAt ?? null);
      const profile = await this.generateProfile(nextVersionNumber, inputSummary, currentVersion?.profile ?? null);
      const savedVersion = this.writeProfileVersion(
        nextVersionNumber,
        profile,
        this.getJobTriggerType(jobId),
        inputSummary
      );
      const completedAt = new Date().toISOString();

      this.writeCurrentVersionPointer(savedVersion.id);
      this.db
        .prepare(
          `
            UPDATE profile_update_jobs
            SET
              status = 'completed',
              target_version = @target_version,
              input_summary_json = @input_summary_json,
              completed_at = @completed_at,
              updated_at = @updated_at
            WHERE id = @id
          `
        )
        .run({
          id: jobId,
          target_version: savedVersion.version,
          input_summary_json: JSON.stringify(inputSummary),
          completed_at: completedAt,
          updated_at: completedAt
        });
    } catch (error) {
      const failedAt = new Date().toISOString();

      this.db
        .prepare(
          `
            UPDATE profile_update_jobs
            SET
              status = 'failed',
              error_message = @error_message,
              failed_at = @failed_at,
              updated_at = @updated_at
            WHERE id = @id
          `
        )
        .run({
          id: jobId,
          error_message: error instanceof Error ? error.message : String(error),
          failed_at: failedAt,
          updated_at: failedAt
        });
    }
  }

  private writeProfileVersion(
    version: number,
    profile: MusicProfile,
    triggerType: ProfileUpdateTriggerType,
    inputSummary: unknown
  ) {
    const scope = this.memoryScopeService.getMemoryScope();
    const now = new Date().toISOString();
    const row: MusicProfileVersion = {
      id: `music-profile-${scope.profileId}-${version}-${Date.now()}`,
      version,
      createdAt: now,
      triggerType,
      favoriteCountSnapshot: this.countActiveFavorites(),
      profile: {
        ...profile,
        version,
        updatedAt: now
      },
      inputSummary
    };

    this.db
      .prepare(
        `
          INSERT INTO music_profile_versions (
            id,
            profile_id,
            memory_scope_key,
            netease_user_id,
            version,
            trigger_type,
            favorite_count_snapshot,
            profile_json,
            input_summary_json,
            created_at,
            updated_at
          )
          VALUES (
            @id,
            @profile_id,
            @memory_scope_key,
            @netease_user_id,
            @version,
            @trigger_type,
            @favorite_count_snapshot,
            @profile_json,
            @input_summary_json,
            @created_at,
            @updated_at
          )
        `
      )
      .run({
        id: row.id,
        profile_id: this.getProfileId(),
        memory_scope_key: scope.key,
        netease_user_id: scope.neteaseUserId ?? null,
        version: row.version,
        trigger_type: row.triggerType,
        favorite_count_snapshot: row.favoriteCountSnapshot,
        profile_json: JSON.stringify(row.profile),
        input_summary_json: JSON.stringify(row.inputSummary ?? null),
        created_at: row.createdAt,
        updated_at: row.createdAt
      });

    return row;
  }

  private writeCurrentVersionPointer(versionId: string) {
    const scope = this.memoryScopeService.getMemoryScope();
    const updatedAt = new Date().toISOString();

    this.db
      .prepare(
        `
          INSERT INTO app_state (key, value, updated_at)
          VALUES (@key, @value, @updated_at)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        `
      )
      .run({
        key: this.getCurrentVersionStateKey(scope.key),
        value: JSON.stringify(versionId),
        updated_at: updatedAt
      });
  }

  private getCurrentVersionStateKey(scopeKey: string) {
    return `music_profile_current:${scopeKey}`;
  }

  private getJobTriggerType(jobId: string): ProfileUpdateTriggerType {
    const row = this.db
      .prepare<{ trigger_type: ProfileUpdateTriggerType }>(
        `SELECT trigger_type FROM profile_update_jobs WHERE id = ?`
      )
      .get([jobId]);

    return row?.trigger_type ?? "manual";
  }

  private countActiveFavorites() {
    const scope = this.memoryScopeService.getMemoryScope();
    const row = this.db
      .prepare<{ count: number }>(
        `
          SELECT COUNT(*) as count
          FROM favorite_tracks
          WHERE profile_id = ? AND memory_scope_key = ? AND removed_at IS NULL
        `
      )
      .get([this.getProfileId(), scope.key]);

    return row?.count ?? 0;
  }

  private buildInputSummary(sinceIso: string | null) {
    const scope = this.memoryScopeService.getMemoryScope();
    const favoriteRows = this.db
      .prepare<{
        title: string;
        artists_json: string;
        liked_mode?: string | null;
        user_prompt?: string | null;
        assistant_reason?: string | null;
        liked_at: string;
      }>(
        `
          SELECT title, artists_json, liked_mode, user_prompt, assistant_reason, liked_at
          FROM favorite_tracks
          WHERE profile_id = ?
            AND memory_scope_key = ?
            AND removed_at IS NULL
            AND liked_at > COALESCE(?, '')
          ORDER BY datetime(liked_at) DESC
          LIMIT 80
        `
      )
      .all([this.getProfileId(), scope.key, sinceIso ?? null]);
    const recentFavorites = favoriteRows.map((row) => ({
      title: row.title,
      artists: safeJsonParse<string[]>(row.artists_json, []),
      mode: row.liked_mode ?? undefined,
      userPrompt: row.user_prompt ?? undefined,
      assistantReason: row.assistant_reason ?? undefined,
      likedAt: row.liked_at
    }));
    const recentHistory = this.historyService.getHistorySince(sinceIso, 240);
    const preferenceSignals = this.preferenceSignalService.getSignalsSince(sinceIso, 120);
    const completedTracks = recentHistory.filter((record) => Boolean(record.completedAt)).length;
    const skippedTracks = recentHistory.filter((record) => Boolean(record.skippedAt)).length;
    const repeatedArtists = new Map<string, number>();
    const modeCounts = new Map<string, number>();

    for (const record of recentHistory) {
      modeCounts.set(record.mode, (modeCounts.get(record.mode) ?? 0) + 1);

      for (const artist of record.song.artist.split("/").map((item) => item.trim()).filter(Boolean)) {
        repeatedArtists.set(artist, (repeatedArtists.get(artist) ?? 0) + 1);
      }
    }

    const topRepeatedArtists = [...repeatedArtists.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([artist]) => artist);
    const commonModes = [...modeCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([mode]) => mode);

    return {
      oldProfile: this.getCurrentProfile(),
      newEvidence: {
        recentFavorites,
        playHistorySummary: {
          completedTracks,
          skippedTracks,
          topRepeatedArtists,
          commonModes
        },
        preferenceSignals: preferenceSignals.map((signal) => ({
          type: signal.type,
          text: signal.text,
          weight: signal.weight
        }))
      },
      stats: {
        favoriteCount: this.countActiveFavorites(),
        playHistoryCount: this.historyService.countRecentHistory(),
        preferenceSignalCount: this.preferenceSignalService.getRecentSignals(200).length
      },
      task: "请基于旧画像和新增证据，生成合并更新后的音乐画像。不要让短期偏好完全覆盖长期偏好。"
    };
  }

  private async generateProfile(
    version: number,
    inputSummary: ReturnType<MusicProfileService["buildInputSummary"]>,
    oldProfile: MusicProfile | null
  ) {
    const settings = this.settingsService.getRuntimeSettings();
    const apiKey = this.settingsService.getDeepseekApiKey();

    if (!apiKey) {
      return this.buildFallbackProfile(version, inputSummary, oldProfile);
    }

    try {
      const response = await fetch(`${settings.deepseekBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: settings.deepseekModel,
          temperature: 0.4,
          messages: [
            {
              role: "system",
              content: [
                "你是 Lapras 的音乐画像分析器，只输出一个 JSON 对象。",
                "你负责把旧画像和新增证据合并成新的长期音乐画像。",
                "不要把短期兴趣直接覆盖长期偏好，要做平滑更新。",
                "输出字段必须包含 summary、preferredGenres、preferredArtists、preferredMoods、preferredScenes、dislikedGenres、dislikedFeatures、modeStrategies、recommendationRules、evidenceStats、confidence。",
                "weight 必须是 0 到 1 之间的小数。",
                "modeStrategies 只包含 companion、focus、sleep。"
              ].join("\n")
            },
            {
              role: "user",
              content: JSON.stringify(inputSummary, null, 2)
            }
          ],
          response_format: {
            type: "json_object"
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Music profile request failed: ${response.status}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string | Array<{ text?: string }>;
          };
        }>;
      };
      const rawContent = payload.choices?.[0]?.message?.content;
      const contentText = Array.isArray(rawContent)
        ? rawContent.map((item) => item.text ?? "").join("").trim()
        : (rawContent ?? "").trim();
      const parsed = MusicProfileSchema.parse(
        JSON.parse(extractFirstJsonObject(contentText))
      );

      return {
        ...parsed,
        version,
        updatedAt: new Date().toISOString()
      };
    } catch {
      return this.buildFallbackProfile(version, inputSummary, oldProfile);
    }
  }

  private buildFallbackProfile(
    version: number,
    inputSummary: ReturnType<MusicProfileService["buildInputSummary"]>,
    oldProfile: MusicProfile | null
  ): MusicProfile {
    const weightedArtists = new Map<string, number>();
    const preferredMoods = new Map<string, number>();
    const preferredScenes = new Map<string, number>();
    const dislikedFeatures = new Map<string, number>();

    for (const favorite of inputSummary.newEvidence.recentFavorites) {
      for (const artist of favorite.artists) {
        weightedArtists.set(artist, (weightedArtists.get(artist) ?? 0) + 2.4);
      }
    }

    for (const signal of inputSummary.newEvidence.preferenceSignals) {
      if (signal.type === "mood_preference") {
        preferredMoods.set(signal.text, Math.max(preferredMoods.get(signal.text) ?? 0, signal.weight));
      }

      if (signal.type === "scene_preference") {
        preferredScenes.set(signal.text, Math.max(preferredScenes.get(signal.text) ?? 0, signal.weight));
      }

      if (signal.type === "negative_preference") {
        dislikedFeatures.set(signal.text, Math.max(dislikedFeatures.get(signal.text) ?? 0, signal.weight));
      }

      if (signal.type === "feedback" && /跳过/.test(signal.text)) {
        dislikedFeatures.set(signal.text, Math.max(dislikedFeatures.get(signal.text) ?? 0, signal.weight));
      }
    }

    for (const artist of inputSummary.newEvidence.playHistorySummary.topRepeatedArtists) {
      weightedArtists.set(artist, (weightedArtists.get(artist) ?? 0) + 1.2);
    }

    const preferredArtistTags = this.toWeightedTags(weightedArtists, oldProfile?.preferredArtists ?? []);
    const moodTags = this.toWeightedTags(preferredMoods, oldProfile?.preferredMoods ?? []);
    const sceneTags = this.toWeightedTags(preferredScenes, oldProfile?.preferredScenes ?? []);
    const dislikedFeatureTags = this.toWeightedTags(dislikedFeatures, oldProfile?.dislikedFeatures ?? []);
    const preferredGenreTags =
      oldProfile?.preferredGenres.length
        ? oldProfile.preferredGenres
        : this.makeDefaultGenres(preferredArtistTags);

    return {
      version,
      updatedAt: new Date().toISOString(),
      summary:
        oldProfile?.summary ??
        "用户整体偏好柔和、低打扰、可连续陪伴的音乐，正在逐步形成更稳定的本地音乐画像。",
      preferredGenres: preferredGenreTags.slice(0, 6),
      preferredArtists: preferredArtistTags.slice(0, 8),
      preferredMoods: moodTags.slice(0, 8),
      preferredScenes: sceneTags.slice(0, 8),
      dislikedGenres: oldProfile?.dislikedGenres ?? [],
      dislikedFeatures: dislikedFeatureTags.slice(0, 8),
      modeStrategies: {
        companion:
          oldProfile?.modeStrategies.companion ??
          "优先推荐温柔、陪伴感、旋律顺滑的人声与华语流行/R&B。",
        focus:
          oldProfile?.modeStrategies.focus ??
          "优先推荐低干扰、节奏稳定、歌词密度更低的专注向音乐。",
        sleep:
          oldProfile?.modeStrategies.sleep ??
          "优先推荐慢速、柔和、低刺激的夜间放松与助眠氛围音乐。"
      },
      recommendationRules: this.mergeRecommendationRules(oldProfile?.recommendationRules ?? [], [
        "当用户收藏后，提高同歌手与相近情绪标签的短期权重。",
        "当用户连续跳过高刺激歌曲时，降低强节奏和强电子感推荐权重。",
        "没有明确点歌时，优先沿当前模式与当前情绪延展。"
      ]),
      evidenceStats: {
        favoriteCount: inputSummary.stats.favoriteCount,
        playHistoryCount: inputSummary.stats.playHistoryCount,
        preferenceSignalCount: inputSummary.stats.preferenceSignalCount
      },
      confidence: Math.min(
        0.92,
        Math.max(
          oldProfile?.confidence ?? 0.45,
          0.45 +
            Math.min(inputSummary.newEvidence.recentFavorites.length, 12) * 0.015 +
            Math.min(inputSummary.newEvidence.preferenceSignals.length, 20) * 0.01
        )
      )
    };
  }

  private toWeightedTags(weightMap: Map<string, number>, previous: WeightedTag[]) {
    const merged = new Map<string, number>();

    for (const item of previous) {
      merged.set(item.name, Math.max(item.weight * 0.92, merged.get(item.name) ?? 0));
    }

    for (const [name, rawWeight] of weightMap.entries()) {
      const normalized = Math.min(0.95, Math.max(0.3, rawWeight / 3));
      merged.set(name, Math.max(normalized, merged.get(name) ?? 0));
    }

    return [...merged.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([name, weight]) => ({
        name,
        weight: Number(weight.toFixed(2))
      }));
  }

  private makeDefaultGenres(preferredArtists: WeightedTag[]) {
    if (preferredArtists.length === 0) {
      return [
        { name: "华语流行", weight: 0.56 },
        { name: "陪伴向人声", weight: 0.52 }
      ];
    }

    return [
      { name: "华语流行", weight: 0.62, evidence: "近期收藏与重复播放以华语人声为主。" },
      { name: "情绪陪伴向", weight: 0.58, evidence: "收藏与偏好信号偏向陪伴、温柔、低打扰。" }
    ];
  }

  private mergeRecommendationRules(existing: string[], defaults: string[]) {
    return [...new Set([...existing, ...defaults])].slice(0, 8);
  }

  private mapVersionRow(row: MusicProfileVersionRow): MusicProfileVersion {
    return {
      id: row.id,
      version: row.version,
      createdAt: row.created_at,
      triggerType: row.trigger_type,
      favoriteCountSnapshot: row.favorite_count_snapshot,
      profile: MusicProfileSchema.parse(
        safeJsonParse(row.profile_json, {})
      ),
      inputSummary: safeJsonParse(row.input_summary_json, undefined)
    };
  }

  private mapJobRow(row: ProfileUpdateJobRow): ProfileUpdateJob {
    return {
      id: row.id,
      triggerType: row.trigger_type,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at ?? null,
      completedAt: row.completed_at ?? null,
      failedAt: row.failed_at ?? null,
      errorMessage: row.error_message ?? null,
      favoriteCountSnapshot: row.favorite_count_snapshot,
      targetVersion: row.target_version ?? null
    };
  }
}
