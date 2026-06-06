import type {
  AppMode,
  FavoriteTrack,
  PlayRecord,
  PreferenceSignal,
  PreferenceSignalType
} from "@ai-music-companion/shared";

import type { DatabaseClient } from "../db/sqlite.js";
import { createId } from "../utils/id.js";
import { MemoryScopeService } from "./memoryScopeService.js";

type PreferenceSignalRow = {
  id: string;
  memory_scope_key?: string | null;
  created_at: string;
  type: PreferenceSignalType;
  text: string;
  source_message?: string | null;
  mode?: AppMode | null;
  related_track_id?: string | null;
  weight: number;
};

type CreateSignalInput = {
  type: PreferenceSignalType;
  text: string;
  sourceMessage?: string;
  mode?: AppMode;
  relatedTrackId?: string;
  weight: number;
};

export class PreferenceSignalService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly getProfileId: () => string = () => "default",
    private readonly memoryScopeService?: MemoryScopeService
  ) {}

  createSignal(input: CreateSignalInput): PreferenceSignal {
    const scope = this.memoryScopeService?.getMemoryScope();
    const signal: PreferenceSignal = {
      id: createId(),
      createdAt: new Date().toISOString(),
      type: input.type,
      text: input.text.trim(),
      sourceMessage: input.sourceMessage?.trim() || undefined,
      mode: input.mode,
      relatedTrackId: input.relatedTrackId,
      weight: input.weight
    };

    this.db
      .prepare(
        `
          INSERT INTO preference_signals (
            id,
            profile_id,
            memory_scope_key,
            netease_user_id,
            created_at,
            updated_at,
            type,
            text,
            source_message,
            mode,
            related_track_id,
            weight
          )
          VALUES (
            @id,
            @profile_id,
            @memory_scope_key,
            @netease_user_id,
            @created_at,
            @updated_at,
            @type,
            @text,
            @source_message,
            @mode,
            @related_track_id,
            @weight
          )
        `
      )
      .run({
        id: signal.id,
        profile_id: this.getProfileId(),
        memory_scope_key: scope?.key ?? null,
        netease_user_id: scope?.neteaseUserId ?? null,
        created_at: signal.createdAt,
        updated_at: signal.createdAt,
        type: signal.type,
        text: signal.text,
        source_message: signal.sourceMessage ?? null,
        mode: signal.mode ?? null,
        related_track_id: signal.relatedTrackId ?? null,
        weight: signal.weight
      });

    return signal;
  }

  getRecentSignals(limit = 40) {
    const scope = this.memoryScopeService?.getMemoryScope();
    const rows = this.db
      .prepare<PreferenceSignalRow>(
        `
          SELECT
            id,
            memory_scope_key,
            created_at,
            type,
            text,
            source_message,
            mode,
            related_track_id,
            weight
          FROM preference_signals
          WHERE profile_id = ?
          ORDER BY datetime(created_at) DESC
          LIMIT ?
        `
      )
      .all([this.getProfileId(), Math.max(limit * 4, 80)]);

    return rows
      .filter((row) => {
        if (!scope) {
          return true;
        }

        return this.memoryScopeService?.matchesScope(row.memory_scope_key) ?? true;
      })
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        type: row.type,
        text: row.text,
        sourceMessage: row.source_message ?? undefined,
        mode: row.mode ?? undefined,
        relatedTrackId: row.related_track_id ?? undefined,
        weight: row.weight
      }));
  }

  getSignalsSince(sinceIso: string | null | undefined, limit = 120) {
    const signals = this.getRecentSignals(limit);

    if (!sinceIso) {
      return signals;
    }

    return signals.filter((signal) => signal.createdAt > sinceIso);
  }

  recordSignalsFromUserInput(
    content: string,
    mode?: AppMode,
    relatedTrackId?: string
  ) {
    const normalized = content.trim();

    if (!normalized) {
      return [];
    }

    const candidates: CreateSignalInput[] = [];
    const artistMatch = normalized.match(
      /(?:来点|想听|给我|放点)([\p{Script=Han}A-Za-z0-9·&.\s]{2,20})的歌/u
    );

    if (artistMatch?.[1]) {
      candidates.push({
        type: "artist_preference",
        text: `偏好歌手：${artistMatch[1].trim()}`,
        sourceMessage: normalized,
        mode,
        relatedTrackId,
        weight: 0.82
      });
    }

    const moodMappings: Array<[RegExp, string, number]> = [
      [/(温柔|柔和)/i, "偏好温柔氛围", 0.74],
      [/(安静|不吵|低干扰)/i, "偏好安静低干扰", 0.78],
      [/(陪伴|有人声陪着)/i, "偏好陪伴感", 0.7],
      [/(提神|醒一醒|来点劲)/i, "需要提神抬能量", 0.66],
      [/(夜晚|睡前|晚安|助眠)/i, "偏好夜间放松", 0.76]
    ];

    for (const [pattern, text, weight] of moodMappings) {
      if (pattern.test(normalized)) {
        candidates.push({
          type: "mood_preference",
          text,
          sourceMessage: normalized,
          mode,
          relatedTrackId,
          weight
        });
      }
    }

    const sceneMappings: Array<[RegExp, string, number]> = [
      [/(写论文|写作|学习|复习)/i, "场景：写作学习", 0.76],
      [/(工作|办公|开会前|码代码|coding)/i, "场景：工作专注", 0.72],
      [/(通勤|路上|下班)/i, "场景：通勤路上", 0.64],
      [/(夜里|晚间|深夜)/i, "场景：夜间陪伴", 0.68]
    ];

    for (const [pattern, text, weight] of sceneMappings) {
      if (pattern.test(normalized)) {
        candidates.push({
          type: "scene_preference",
          text,
          sourceMessage: normalized,
          mode,
          relatedTrackId,
          weight
        });
      }
    }

    const negativeMappings: Array<[RegExp, string, number]> = [
      [/(不要太吵|别太炸|太吵了)/i, "避雷：高刺激高噪声", 0.82],
      [/(不要太电子|别太电子)/i, "避雷：电子感过强", 0.74],
      [/(不要太新|别太陌生)/i, "偏好更熟悉的歌", 0.66]
    ];

    for (const [pattern, text, weight] of negativeMappings) {
      if (pattern.test(normalized)) {
        candidates.push({
          type: "negative_preference",
          text,
          sourceMessage: normalized,
          mode,
          relatedTrackId,
          weight
        });
      }
    }

    const seen = new Set<string>();
    const created: PreferenceSignal[] = [];

    for (const candidate of candidates) {
      const signature = `${candidate.type}::${candidate.text}`;

      if (seen.has(signature)) {
        continue;
      }

      seen.add(signature);
      created.push(this.createSignal(candidate));
    }

    return created;
  }

  recordFavoriteSignals(favorite: FavoriteTrack) {
    const signals: PreferenceSignal[] = [];

    signals.push(
      this.createSignal({
        type: "feedback",
        text: `收藏正反馈：${favorite.title} / ${favorite.artists.join("/")}`,
        sourceMessage: favorite.userPrompt,
        mode: favorite.likedMode,
        relatedTrackId: favorite.sourceTrackId,
        weight: 0.9
      })
    );

    for (const moodTag of favorite.moodTags ?? []) {
      signals.push(
        this.createSignal({
          type: "mood_preference",
          text: `收藏时情绪：${moodTag}`,
          sourceMessage: favorite.userPrompt,
          mode: favorite.likedMode,
          relatedTrackId: favorite.sourceTrackId,
          weight: 0.72
        })
      );
    }

    for (const sceneTag of favorite.sceneTags ?? []) {
      signals.push(
        this.createSignal({
          type: "scene_preference",
          text: `收藏时场景：${sceneTag}`,
          sourceMessage: favorite.userPrompt,
          mode: favorite.likedMode,
          relatedTrackId: favorite.sourceTrackId,
          weight: 0.74
        })
      );
    }

    return signals;
  }

  recordPlaybackFeedbackSignal(
    event: "paused" | "completed" | "skipped",
    record: PlayRecord | null,
    reason?: string
  ) {
    if (!record) {
      return null;
    }

    const baseText =
      event === "completed"
        ? `完整听完：${record.song.name} / ${record.song.artist}`
        : event === "skipped"
          ? `跳过：${record.song.name} / ${record.song.artist}`
          : `中断：${record.song.name} / ${record.song.artist}`;

    const weight =
      event === "completed" ? 0.64 : event === "skipped" ? 0.72 : 0.42;

    return this.createSignal({
      type: "feedback",
      text: reason ? `${baseText}（${reason}）` : baseText,
      mode: record.mode,
      relatedTrackId: record.song.sourceId,
      weight
    });
  }
}
