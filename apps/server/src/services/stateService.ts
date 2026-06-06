import {
  AppModeSchema,
  LLMDecisionSchema,
  NowPlayingStateSchema,
  type AppMode,
  type LLMDecision,
  type NowPlayingState,
  type SongDetail
} from "@ai-music-companion/shared";

import type { DatabaseClient } from "../db/sqlite.js";
import { safeJsonParse } from "../utils/json.js";
import { normalizeSongDetailAudio, normalizeSongListAudio } from "../utils/song.js";

type StateKey =
  | "current_mode"
  | "current_song"
  | "played_songs"
  | "queue"
  | "last_decision"
  | "is_playing"
  | "snapshot_updated_at";
const DEFAULT_PROFILE_ID = "default";

interface StateRow {
  value: string;
}

export class StateService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly getProfileId: () => string = () => DEFAULT_PROFILE_ID
  ) {}

  getMode(): AppMode {
    const parsed = AppModeSchema.safeParse(this.readState("current_mode", "companion"));
    return parsed.success ? parsed.data : "companion";
  }

  setMode(mode: AppMode) {
    this.writeState("current_mode", mode);
  }

  getCurrentSong() {
    const song = this.readState<SongDetail | null>("current_song", null);
    return song ? normalizeSongDetailAudio(song) : null;
  }

  setCurrentSong(song: SongDetail | null) {
    this.writeState("current_song", song ? normalizeSongDetailAudio(song) : null);
  }

  getQueue() {
    return normalizeSongListAudio(this.readState<SongDetail[]>("queue", []));
  }

  setQueue(queue: SongDetail[]) {
    this.writeState("queue", normalizeSongListAudio(queue));
  }

  getPlayedSongs() {
    return normalizeSongListAudio(this.readState<SongDetail[]>("played_songs", []));
  }

  setPlayedSongs(songs: SongDetail[]) {
    this.writeState("played_songs", normalizeSongListAudio(songs));
  }

  getLastDecision() {
    const decision = this.readState<Partial<LLMDecision> | null>("last_decision", null);

    if (!decision) {
      return null;
    }

    const parsed = LLMDecisionSchema.safeParse({
      ...decision,
      intent: this.compactRequiredText(decision.intent, "继续聊天"),
      say: this.compactRequiredText(decision.say, "我在，继续说。"),
      reason: this.compactRequiredText(
        decision.reason,
        "根据你的输入继续调整当前推荐。"
      ),
      segue: this.compactRequiredText(decision.segue, "继续按这个方向听。")
    });

    return parsed.success ? parsed.data : null;
  }

  setLastDecision(decision: LLMDecision | null) {
    this.writeState("last_decision", decision);
  }

  isPlaying() {
    return this.readState<boolean>("is_playing", false);
  }

  setPlaying(value: boolean) {
    this.writeState("is_playing", value);
  }

  dequeueNextSong() {
    const queue = this.getQueue();
    const [nextSong, ...rest] = queue;
    this.setQueue(rest);
    return nextSong ?? null;
  }

  advanceTrack(nextSong: SongDetail) {
    const current = this.getCurrentSong();
    if (current) {
      const existing = this.getPlayedSongs();
      const cleaned = existing.filter((s) => s.sourceId !== current.sourceId);
      // 最近播放排末尾，紧挨当前歌曲上方
      const played = [...cleaned, current].slice(-20);
      this.setPlayedSongs(played);
    }
    this.setCurrentSong(nextSong);
    this.setPlaying(true);
  }

  getNowPlayingState(): NowPlayingState {
    return NowPlayingStateSchema.parse({
      currentSong: this.getCurrentSong(),
      playedSongs: this.getPlayedSongs(),
      queue: this.getQueue(),
      mode: this.getMode(),
      isPlaying: this.isPlaying(),
      lastDecision: this.getLastDecision(),
      updatedAt: this.readState("snapshot_updated_at", new Date().toISOString())
    });
  }

  private readState<T>(key: StateKey, fallback: T): T {
    const profileKey = this.getProfileStateKey(key);
    const row = this.db
      .prepare(`SELECT value FROM app_state WHERE key = ?`)
      .get(profileKey) as StateRow | undefined;

    if (row) {
      return safeJsonParse<T>(row.value, fallback);
    }

    if (this.getProfileId() === DEFAULT_PROFILE_ID) {
      const legacyRow = this.db
        .prepare(`SELECT value FROM app_state WHERE key = ?`)
        .get(key) as StateRow | undefined;

      return safeJsonParse<T>(legacyRow?.value, fallback);
    }

    return fallback;
  }

  private writeState(key: StateKey, value: unknown) {
    const updatedAt = new Date().toISOString();
    const profileKey = this.getProfileStateKey(key);
    const upsert = this.db.prepare(`
      INSERT INTO app_state (key, value, updated_at)
      VALUES (@key, @value, @updatedAt)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    const tx = this.db.transaction(() => {
      upsert.run({
        key: profileKey,
        value: JSON.stringify(value),
        updatedAt
      });

      if (key !== "snapshot_updated_at") {
        upsert.run({
          key: this.getProfileStateKey("snapshot_updated_at"),
          value: JSON.stringify(updatedAt),
          updatedAt
        });
      }
    });

    tx();
  }

  private getProfileStateKey(key: StateKey) {
    return `profile:${this.getProfileId()}:${key}`;
  }

  private compactRequiredText(value: unknown, fallback: string) {
    const compacted = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    return compacted || fallback;
  }
}
