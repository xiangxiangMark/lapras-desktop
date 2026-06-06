import type {
  FavoriteStatusResponse,
  FavoriteTrack
} from "@ai-music-companion/shared";

import type { DatabaseClient } from "../db/sqlite.js";
import { createId } from "../utils/id.js";
import { safeJsonParse } from "../utils/json.js";
import { MemoryScopeService } from "./memoryScopeService.js";
import { MusicProfileService } from "./musicProfileService.js";
import { PreferenceSignalService } from "./preferenceSignalService.js";
import { HistoryService } from "./historyService.js";
import { MessageService } from "./messageService.js";
import { StateService } from "./stateService.js";

type FavoriteTrackRow = {
  id: string;
  source: "netease";
  source_track_id: string;
  title: string;
  artists_json: string;
  album?: string | null;
  cover_url?: string | null;
  duration?: number | null;
  liked_at: string;
  liked_mode?: string | null;
  user_prompt?: string | null;
  assistant_reason?: string | null;
  tags_json?: string | null;
  mood_tags_json?: string | null;
  scene_tags_json?: string | null;
  play_count_at_liked?: number | null;
  removed_at?: string | null;
};

export class FavoriteService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly stateService: StateService,
    private readonly messageService: MessageService,
    private readonly historyService: HistoryService,
    private readonly memoryScopeService: MemoryScopeService,
    private readonly preferenceSignalService: PreferenceSignalService,
    private readonly musicProfileService: MusicProfileService,
    private readonly getProfileId: () => string = () => "default"
  ) {}

  getCurrentSongStatus(): FavoriteStatusResponse {
    const song = this.stateService.getCurrentSong();

    if (!song) {
      return {
        songId: null,
        isFavorited: false,
        favorite: null
      };
    }

    const favorite = this.findActiveFavoriteBySongId(song.sourceId);

    return {
      songId: song.sourceId,
      isFavorited: Boolean(favorite),
      favorite
    };
  }

  listFavorites(limit = 100) {
    const scope = this.memoryScopeService.getMemoryScope();
    const rows = this.db
      .prepare<FavoriteTrackRow>(
        `
          SELECT
            id,
            source,
            source_track_id,
            title,
            artists_json,
            album,
            cover_url,
            duration,
            liked_at,
            liked_mode,
            user_prompt,
            assistant_reason,
            tags_json,
            mood_tags_json,
            scene_tags_json,
            play_count_at_liked,
            removed_at
          FROM favorite_tracks
          WHERE profile_id = ?
            AND memory_scope_key = ?
            AND removed_at IS NULL
          ORDER BY datetime(liked_at) DESC
          LIMIT ?
        `
      )
      .all([this.getProfileId(), scope.key, Math.max(limit, 1)]);

    return rows.map((row) => this.mapFavoriteRow(row));
  }

  async favoriteCurrentSong() {
    const currentSong = this.stateService.getCurrentSong();

    if (!currentSong) {
      throw new Error("No current song to favorite.");
    }

    const existing = this.findActiveFavoriteBySongId(currentSong.sourceId);

    if (existing) {
      return {
        favorite: existing,
        status: this.getCurrentSongStatus()
      };
    }

    const scope = this.memoryScopeService.getMemoryScope();
    const latestUserMessage = this.messageService.getLatestUserMessage();
    const currentDecision = this.stateService.getLastDecision();
    const likedAt = new Date().toISOString();
    const mode = this.stateService.getMode();
    const moodTags = this.extractMoodTags(
      latestUserMessage?.content ?? "",
      currentDecision?.reason ?? ""
    );
    const sceneTags = this.extractSceneTags(latestUserMessage?.content ?? "", mode);
    const tags = [...new Set([...moodTags, ...sceneTags])];
    const favorite: FavoriteTrack = {
      id: createId(),
      source: "netease",
      sourceTrackId: currentSong.sourceId,
      title: currentSong.name,
      artists: currentSong.artist
        .split("/")
        .map((artist) => artist.trim())
        .filter(Boolean),
      album: currentSong.album,
      coverUrl: currentSong.coverUrl,
      duration: currentSong.durationMs,
      likedAt,
      likedMode: mode,
      userPrompt: latestUserMessage?.content,
      assistantReason: currentDecision?.reason,
      tags,
      moodTags,
      sceneTags,
      playCountAtLiked: this.historyService.countSongPlays(currentSong.sourceId),
      removedAt: null
    };

    this.db
      .prepare(
        `
          INSERT INTO favorite_tracks (
            id,
            profile_id,
            memory_scope_key,
            netease_user_id,
            source,
            source_track_id,
            title,
            artists_json,
            album,
            cover_url,
            duration,
            liked_at,
            liked_mode,
            user_prompt,
            assistant_reason,
            tags_json,
            mood_tags_json,
            scene_tags_json,
            play_count_at_liked,
            removed_at,
            updated_at
          )
          VALUES (
            @id,
            @profile_id,
            @memory_scope_key,
            @netease_user_id,
            @source,
            @source_track_id,
            @title,
            @artists_json,
            @album,
            @cover_url,
            @duration,
            @liked_at,
            @liked_mode,
            @user_prompt,
            @assistant_reason,
            @tags_json,
            @mood_tags_json,
            @scene_tags_json,
            @play_count_at_liked,
            @removed_at,
            @updated_at
          )
        `
      )
      .run({
        id: favorite.id,
        profile_id: this.getProfileId(),
        memory_scope_key: scope.key,
        netease_user_id: scope.neteaseUserId ?? null,
        source: favorite.source,
        source_track_id: favorite.sourceTrackId,
        title: favorite.title,
        artists_json: JSON.stringify(favorite.artists),
        album: favorite.album ?? null,
        cover_url: favorite.coverUrl ?? null,
        duration: favorite.duration ?? null,
        liked_at: favorite.likedAt,
        liked_mode: favorite.likedMode ?? null,
        user_prompt: favorite.userPrompt ?? null,
        assistant_reason: favorite.assistantReason ?? null,
        tags_json: JSON.stringify(favorite.tags ?? []),
        mood_tags_json: JSON.stringify(favorite.moodTags ?? []),
        scene_tags_json: JSON.stringify(favorite.sceneTags ?? []),
        play_count_at_liked: favorite.playCountAtLiked ?? 0,
        removed_at: null,
        updated_at: likedAt
      });

    this.preferenceSignalService.recordFavoriteSignals(favorite);
    void this.musicProfileService.scheduleUpdateIfNeeded();

    return {
      favorite,
      status: this.getCurrentSongStatus()
    };
  }

  async unfavoriteCurrentSong() {
    const currentSong = this.stateService.getCurrentSong();

    if (!currentSong) {
      return this.getCurrentSongStatus();
    }

    const favorite = this.findActiveFavoriteBySongId(currentSong.sourceId);

    if (!favorite) {
      return this.getCurrentSongStatus();
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `
          UPDATE favorite_tracks
          SET removed_at = @removed_at, updated_at = @updated_at
          WHERE id = @id
        `
      )
      .run({
        id: favorite.id,
        removed_at: now,
        updated_at: now
      });

    return this.getCurrentSongStatus();
  }

  private findActiveFavoriteBySongId(songId: string) {
    const scope = this.memoryScopeService.getMemoryScope();
    const normalizedSongId = songId.replace("netease:", "");
    const row = this.db
      .prepare<FavoriteTrackRow>(
        `
          SELECT
            id,
            source,
            source_track_id,
            title,
            artists_json,
            album,
            cover_url,
            duration,
            liked_at,
            liked_mode,
            user_prompt,
            assistant_reason,
            tags_json,
            mood_tags_json,
            scene_tags_json,
            play_count_at_liked,
            removed_at
          FROM favorite_tracks
          WHERE profile_id = ?
            AND memory_scope_key = ?
            AND source_track_id = ?
            AND removed_at IS NULL
          ORDER BY datetime(liked_at) DESC
          LIMIT 1
        `
      )
      .get([this.getProfileId(), scope.key, normalizedSongId]);

    return row ? this.mapFavoriteRow(row) : null;
  }

  private mapFavoriteRow(row: FavoriteTrackRow): FavoriteTrack {
    return {
      id: row.id,
      source: row.source,
      sourceTrackId: row.source_track_id,
      title: row.title,
      artists: safeJsonParse<string[]>(row.artists_json, []),
      album: row.album ?? undefined,
      coverUrl: row.cover_url ?? undefined,
      duration: row.duration ?? undefined,
      likedAt: row.liked_at,
      likedMode: (row.liked_mode as FavoriteTrack["likedMode"]) ?? undefined,
      userPrompt: row.user_prompt ?? undefined,
      assistantReason: row.assistant_reason ?? undefined,
      tags: safeJsonParse<string[]>(row.tags_json, []),
      moodTags: safeJsonParse<string[]>(row.mood_tags_json, []),
      sceneTags: safeJsonParse<string[]>(row.scene_tags_json, []),
      playCountAtLiked: row.play_count_at_liked ?? undefined,
      removedAt: row.removed_at ?? null
    };
  }

  private extractMoodTags(...parts: string[]) {
    const source = parts.join(" ");
    const tags = new Set<string>();

    if (/(温柔|柔和)/i.test(source)) {
      tags.add("温柔");
    }

    if (/(安静|不吵|低干扰)/i.test(source)) {
      tags.add("安静");
    }

    if (/(陪伴|有人声陪着)/i.test(source)) {
      tags.add("陪伴");
    }

    if (/(夜晚|睡前|晚安|助眠)/i.test(source)) {
      tags.add("夜晚");
    }

    return [...tags];
  }

  private extractSceneTags(content: string, mode: FavoriteTrack["likedMode"]) {
    const tags = new Set<string>();

    if (/(工作|学习|写论文|写作)/i.test(content)) {
      tags.add("工作学习");
    }

    if (/(通勤|路上|下班)/i.test(content)) {
      tags.add("通勤");
    }

    if (/(夜晚|深夜|睡前|晚安)/i.test(content) || mode === "sleep") {
      tags.add("夜间放松");
    }

    if (mode === "companion") {
      tags.add("陪伴");
    }

    if (mode === "focus") {
      tags.add("专注");
    }

    return [...tags];
  }
}
