import type {
  AppMode,
  PlayRecord,
  PlaybackFeedbackRequest,
  SongDetail
} from "@ai-music-companion/shared";

import type { DatabaseClient } from "../db/sqlite.js";
import { createId } from "../utils/id.js";
import { safeJsonParse } from "../utils/json.js";
import { normalizeSongDetailAudio } from "../utils/song.js";
import { MemoryScopeService } from "./memoryScopeService.js";

interface PlayRow {
  id: string;
  memory_scope_key?: string | null;
  song_json: string;
  reason: string;
  mode: AppMode;
  trigger: "manual" | "ai" | "system";
  played_at: string;
  listen_ms?: number;
  duration_ms?: number | null;
  completed_at?: string | null;
  skipped_at?: string | null;
  skip_reason?: string | null;
}

export interface PlaybackFeedbackSignals {
  recentSongIds: Set<string>;
  skippedSongIds: Set<string>;
  skippedArtists: Set<string>;
}

export class HistoryService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly getProfileId: () => string = () => "default",
    private readonly memoryScopeService?: MemoryScopeService
  ) {}

  addPlayRecord(
    song: SongDetail,
    reason: string,
    mode: AppMode,
    trigger: "manual" | "ai" | "system"
  ): PlayRecord {
    const scope = this.memoryScopeService?.getMemoryScope();
    const normalizedSong = normalizeSongDetailAudio(song);
    const record: PlayRecord = {
      id: createId(),
      song: normalizedSong,
      playedAt: new Date().toISOString(),
      reason,
      mode,
      trigger
    };

    this.db
      .prepare(
        `
          INSERT INTO plays (
            id,
            profile_id,
            memory_scope_key,
            netease_user_id,
            song_id,
            song_json,
            reason,
            mode,
            trigger,
            played_at
          )
          VALUES (
            @id,
            @profile_id,
            @memory_scope_key,
            @netease_user_id,
            @song_id,
            @song_json,
            @reason,
            @mode,
            @trigger,
            @played_at
          )
        `
      )
      .run({
        id: record.id,
        profile_id: this.getProfileId(),
        memory_scope_key: scope?.key ?? null,
        netease_user_id: scope?.neteaseUserId ?? null,
        song_id: normalizedSong.sourceId,
        song_json: JSON.stringify(normalizedSong),
        reason: record.reason,
        mode: record.mode,
        trigger: record.trigger,
        played_at: record.playedAt
      });

    this.pruneHistoryForCurrentScope();

    return record;
  }

  getRecentHistory(limit = 12): PlayRecord[] {
    const scope = this.memoryScopeService?.getMemoryScope();
    const rows = this.db
      .prepare(
        `
          SELECT id, memory_scope_key, song_json, reason, mode, trigger, played_at
               , listen_ms, duration_ms, completed_at, skipped_at, skip_reason
          FROM plays
          WHERE profile_id = ?
          ORDER BY datetime(played_at) DESC
          LIMIT ?
        `
      )
      .all([this.getProfileId(), Math.max(limit * 4, 48)]) as PlayRow[];

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
        song: normalizeSongDetailAudio(
          safeJsonParse<SongDetail>(row.song_json, {
            id: "netease:unknown",
            source: "netease",
            sourceId: "unknown",
            name: "Unknown track",
            artist: "Unknown artist"
          })
        ),
        reason: row.reason,
        mode: row.mode,
        trigger: row.trigger,
        playedAt: row.played_at,
        listenMs: row.listen_ms ?? 0,
        durationMs: row.duration_ms ?? undefined,
        completedAt: row.completed_at ?? null,
        skippedAt: row.skipped_at ?? null,
        skipReason: row.skip_reason ?? null
      }));
  }

  updatePlaybackFeedback(feedback: PlaybackFeedbackRequest) {
    const sourceId = feedback.songId.replace("netease:", "");
    const scope = this.memoryScopeService?.getMemoryScope();
    const rows = this.db
      .prepare(
        `
          SELECT id, memory_scope_key, song_json, reason, mode, trigger, played_at
               , listen_ms, duration_ms, completed_at, skipped_at, skip_reason
          FROM plays
          WHERE profile_id = ? AND song_id = ?
          ORDER BY datetime(played_at) DESC
          LIMIT 12
        `
      )
      .all([this.getProfileId(), sourceId]) as PlayRow[];
    const row = rows.find((candidate) =>
      scope ? this.memoryScopeService?.matchesScope(candidate.memory_scope_key) : true
    );

    if (!row) {
      return null;
    }

    const listenMs = Math.max(feedback.listenMs, row.listen_ms ?? 0);
    const now = new Date().toISOString();
    const completedAt = feedback.event === "completed" ? now : null;
    const skippedAt = feedback.event === "skipped" ? now : null;

    this.db
      .prepare(
        `
          UPDATE plays
          SET
            listen_ms = @listen_ms,
            duration_ms = COALESCE(@duration_ms, duration_ms),
            completed_at = COALESCE(@completed_at, completed_at),
            skipped_at = COALESCE(@skipped_at, skipped_at),
            skip_reason = COALESCE(@skip_reason, skip_reason),
            feedback_updated_at = @feedback_updated_at
          WHERE id = @id
        `
      )
      .run({
        id: row.id,
        listen_ms: listenMs,
        duration_ms: feedback.durationMs ?? null,
        completed_at: completedAt,
        skipped_at: skippedAt,
        skip_reason: feedback.event === "skipped" ? (feedback.reason ?? "user_skip") : null,
        feedback_updated_at: now
      });

    const updated = this.getRecentHistory(30).find((record) => record.id === row.id);

    return {
      id: row.id,
      listenMs,
      record: updated ?? null
    };
  }

  getFeedbackSignals(limit = 40): PlaybackFeedbackSignals {
    const records = this.getRecentHistory(limit);
    const recentSongIds = new Set<string>();
    const skippedSongIds = new Set<string>();
    const skippedArtists = new Set<string>();

    for (const record of records) {
      recentSongIds.add(record.song.sourceId);

      if (this.isNegativeFeedback(record)) {
        skippedSongIds.add(record.song.sourceId);
        record.song.artist
          .split("/")
          .map((artist) => artist.trim().toLowerCase())
          .filter(Boolean)
          .forEach((artist) => skippedArtists.add(artist));
      }
    }

    return {
      recentSongIds,
      skippedSongIds,
      skippedArtists
    };
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

  countSongPlays(sourceTrackId: string) {
    const normalizedId = sourceTrackId.replace("netease:", "");
    return this.getRecentHistory(1000).filter(
      (record) => record.song.sourceId === normalizedId
    ).length;
  }

  countRecentHistory(limit = 1000) {
    return this.getRecentHistory(limit).length;
  }

  getHistorySince(sinceIso: string | null | undefined, limit = 1000) {
    if (!sinceIso) {
      return this.getRecentHistory(limit);
    }

    return this.getRecentHistory(limit).filter((record) => record.playedAt > sinceIso);
  }

  private pruneHistoryForCurrentScope() {
    const scope = this.memoryScopeService?.getMemoryScope();

    if (!scope) {
      return;
    }

    const rows = this.db
      .prepare<{ id: string; memory_scope_key?: string | null }>(
        `
          SELECT id, memory_scope_key
          FROM plays
          WHERE profile_id = ?
          ORDER BY datetime(played_at) DESC
          LIMIT 1500
        `
      )
      .all([this.getProfileId()]);
    const overflowIds = rows
      .filter((row) => this.memoryScopeService?.matchesScope(row.memory_scope_key))
      .slice(1000)
      .map((row) => row.id);

    if (overflowIds.length === 0) {
      return;
    }

    const statement = this.db.prepare(`DELETE FROM plays WHERE id = ?`);

    for (const id of overflowIds) {
      statement.run([id]);
    }
  }
}
