import type {
  AppMode,
  NowPlayingState,
  RecommendationTuning,
  SongDetail
} from "@ai-music-companion/shared";

import type { MusicProvider } from "../providers/music/MusicProvider.js";
import { HistoryService } from "./historyService.js";
import { RecommendationPolicyService } from "./recommendationPolicyService.js";
import { RealtimeService } from "./realtimeService.js";
import { StateService } from "./stateService.js";

export class PlaybackService {
  constructor(
    private readonly musicProvider: MusicProvider,
    private readonly historyService: HistoryService,
    private readonly recommendationPolicyService: RecommendationPolicyService,
    private readonly stateService: StateService,
    private readonly realtimeService: RealtimeService
  ) {}

  getState() {
    return this.stateService.getNowPlayingState();
  }

  async enqueueByQuery(query: string, mode: AppMode, reason: string) {
    const currentSong = this.stateService.getCurrentSong();
    const tracks = await this.buildRecommendedTrackPool({
      primaryQuery: query,
      mode,
      targetCount: 5,
      currentSong,
      currentQueue: this.stateService.getQueue()
    });

    if (tracks.length === 0) {
      throw new Error("No tracks found.");
    }

    if (!currentSong) {
      const firstTrack = tracks[0]!;
      const rest = tracks.slice(1);
      this.stateService.setQueue(rest);
      return this.playSong(firstTrack, "ai", reason, mode);
    }

    const queue = this.mergeQueue(this.stateService.getQueue(), tracks, currentSong);
    this.stateService.setQueue(queue);

    return this.syncAndBroadcast();
  }

  async playSongById(
    songId: string,
    trigger: "manual" | "ai" | "system",
    reason: string,
    mode = this.stateService.getMode()
  ) {
    const song = await this.musicProvider.getSongDetail(songId);

    if (!song) {
      throw new Error("Song not found.");
    }

    return this.playSong(song, trigger, reason, mode);
  }

  async playFromQueue(sourceId: string) {
    const queue = this.stateService.getQueue();
    const index = queue.findIndex((s) => s.sourceId === sourceId);

    if (index === -1) {
      throw new Error("Song not in queue.");
    }

    const song = queue[index]!;
    // 从队列中移除被点播的歌，后面的自动补位
    const newQueue = [...queue.slice(0, index), ...queue.slice(index + 1)];
    this.stateService.setQueue(newQueue);

    return this.playSong(song, "manual", "从播放列表中点播", this.stateService.getMode());
  }

  async replayFromPlayed(sourceId: string) {
    const played = this.stateService.getPlayedSongs();
    const song = played.find((s) => s.sourceId === sourceId);

    if (!song) {
      throw new Error("Song not in played history.");
    }

    // 直接播放，不修改 playedSongs 中该歌曲的位置
    return this.playSong(song, "manual", "从已播放中点播", this.stateService.getMode());
  }

  async playFirstByQuery(
    query: string,
    reason: string,
    trigger: "manual" | "ai" | "system" = "manual",
    mode = this.stateService.getMode()
  ) {
    const tracks = await this.buildRecommendedTrackPool({
      primaryQuery: query,
      mode,
      targetCount: 5,
      currentSong: this.stateService.getCurrentSong(),
      currentQueue: this.stateService.getQueue()
    });

    if (tracks.length === 0) {
      throw new Error("No tracks found.");
    }

    const firstTrack = tracks[0]!;
    const rest = tracks.slice(1);
    this.stateService.setQueue(rest);

    return this.playSong(firstTrack, trigger, reason, mode);
  }

  async playRecommendedQueue(
    primaryQuery: string,
    queueQueries: string[],
    tuning: RecommendationTuning | undefined,
    reason: string,
    trigger: "manual" | "ai" | "system" = "ai",
    mode = this.stateService.getMode()
  ) {
    const currentSong = this.stateService.getCurrentSong();
    const tracks = await this.buildRecommendedTrackPool({
      primaryQuery,
      queueQueries,
      tuning,
      mode,
      targetCount: 65,
      currentSong,
      currentQueue: this.stateService.getQueue()
    });

    if (tracks.length === 0) {
      throw new Error("No tracks found.");
    }

    const [firstTrack, ...rest] = await this.promotePlayableTrack(tracks);

    if (!firstTrack) {
      throw new Error("No tracks found.");
    }

    if (currentSong) {
      // 插队：新推荐放入队头，旧队列往后顺延
      const oldQueue = this.stateService.getQueue();
      const combined = this.filterQueueAgainstCurrent(
        [firstTrack, ...rest, ...oldQueue],
        currentSong
      ).slice(0, 60);
      this.stateService.setQueue(combined);
      return this.syncAndBroadcast();
    }

    this.stateService.setQueue(rest);
    return this.playSong(firstTrack, trigger, reason, mode);
  }

  async skipTrack(reason = "Skip current track") {
    await this.ensureQueueDepth(this.stateService.getMode());

    const nextSong = this.stateService.dequeueNextSong();

    if (!nextSong) {
      // 队列已空：把当前歌推入 playedSongs 末尾，清空播放状态
      const current = this.stateService.getCurrentSong();
      if (current) {
        const played = [...this.stateService.getPlayedSongs(), current].slice(-20);
        this.stateService.setPlayedSongs(played);
      }
      this.stateService.setCurrentSong(null);
      this.stateService.setPlaying(false);
      return this.syncAndBroadcast();
    }

    await this.playSong(nextSong, "ai", reason, this.stateService.getMode());
    await this.ensureQueueDepth(this.stateService.getMode());
    return this.stateService.getNowPlayingState();
  }

  async previousTrack(reason = "Return to previous track") {
    const playedSongs = this.stateService.getPlayedSongs();
    if (playedSongs.length === 0) {
      return this.syncAndBroadcast();
    }

    // 最近播放排在末尾
    const previousSong = playedSongs[playedSongs.length - 1]!;
    const rest = playedSongs.slice(0, playedSongs.length - 1);

    // 当前歌放进 played 末尾（紧接上一首上方）
    const currentSong = this.stateService.getCurrentSong();
    if (currentSong) {
      this.stateService.setPlayedSongs([...rest, currentSong]);
    } else {
      this.stateService.setPlayedSongs(rest);
    }

    return this.playSong(previousSong, "manual", reason, this.stateService.getMode());
  }

  clearQueue() {
    this.stateService.setQueue([]);
    return this.syncAndBroadcast();
  }

  switchMode(mode: AppMode) {
    this.stateService.setMode(mode);
    return this.syncAndBroadcast();
  }

  async refreshQueueForMode(mode: AppMode) {
    await this.refreshModeQueue(mode);
    return this.stateService.getNowPlayingState();
  }

  async playSong(
    song: SongDetail,
    trigger: "manual" | "ai" | "system",
    reason: string,
    mode: AppMode
  ): Promise<NowPlayingState> {
    const playableSong = await this.hydrateSongForPlayback(song);

    this.stateService.advanceTrack(playableSong);
    this.historyService.addPlayRecord(playableSong, reason, mode, trigger);

    return this.syncAndBroadcast();
  }

  private async hydrateSongForPlayback(song: SongDetail) {
    const detail = await this.musicProvider.getSongDetail(song.sourceId);

    if (!detail) {
      return song;
    }

    return {
      ...song,
      ...detail,
      coverUrl: detail.coverUrl ?? song.coverUrl,
      lyricSnippet: detail.lyricSnippet ?? song.lyricSnippet
    };
  }

  private async buildRecommendedTrackPool(options: {
    primaryQuery?: string;
    queueQueries?: string[];
    tuning?: RecommendationTuning;
    mode: AppMode;
    targetCount: number;
    currentSong?: SongDetail | null;
    currentQueue?: SongDetail[];
  }) {
    const deduped = new Map<string, SongDetail>();
    const seenSourceIds = new Set<string>();
    const seenSongNames = new Set<string>();
    const signals = this.historyService.getFeedbackSignals();
    const currentSong = options.currentSong ?? null;
    const currentQueue = options.currentQueue ?? [];
    const queries = this.recommendationPolicyService.buildCandidateQueries({
      mode: options.mode,
      primaryQuery: options.primaryQuery,
      queueQueries: options.queueQueries ?? [],
      currentSong,
      tuning: options.tuning
    });

    for (const query of queries) {
      const tracks = await this.musicProvider.searchTracks(query, 8);

      for (const track of tracks) {
        this.addDedupedTrack(track, deduped, seenSourceIds, seenSongNames);
      }
    }

    const ranked = this.recommendationPolicyService.rankTracks(
      [...deduped.values()],
      signals,
      {
        mode: options.mode,
        currentSong,
        currentQueue,
        tuning: options.tuning
      }
    );

    return this.recommendationPolicyService.arrangeTracks(
      ranked,
      {
        mode: options.mode,
        currentSong,
        currentQueue,
        tuning: options.tuning
      },
      Math.max(options.targetCount, 10)
    ).slice(0, options.targetCount);
  }

  private addDedupedTrack(
    track: SongDetail,
    deduped: Map<string, SongDetail>,
    seenSourceIds: Set<string>,
    seenSongNames: Set<string>
  ) {
    const songNameKey = this.getSongNameKey(track);

    if (
      seenSourceIds.has(track.sourceId) ||
      (songNameKey && seenSongNames.has(songNameKey))
    ) {
      return false;
    }

    seenSourceIds.add(track.sourceId);

    if (songNameKey) {
      seenSongNames.add(songNameKey);
    }

    deduped.set(track.sourceId, track);
    return true;
  }

  private async promotePlayableTrack(tracks: SongDetail[]) {
    if (tracks.length <= 1) {
      return tracks;
    }

    for (let index = 0; index < Math.min(5, tracks.length); index += 1) {
      const candidate = tracks[index]!;
      const detail = await this.hydrateSongForPlayback(candidate);

      if (detail.audioUrl) {
        return [
          detail,
          ...tracks.slice(0, index),
          ...tracks.slice(index + 1)
        ];
      }
    }

    return tracks;
  }

  private async ensureQueueDepth(mode: AppMode) {
    const currentQueue = this.stateService.getQueue();

    if (!this.recommendationPolicyService.shouldRefill(mode, currentQueue.length)) {
      return;
    }

    const targetQueueSize = this.recommendationPolicyService.getTargetQueueSize(mode);
    const needed = Math.max(targetQueueSize - currentQueue.length, 0);

    if (needed <= 0) {
      return;
    }

    try {
      const existingIds = new Set(currentQueue.map((song) => song.sourceId));
      const existingSongNames = new Set(
        currentQueue.map((song) => this.getSongNameKey(song)).filter(Boolean)
      );
      const refillTracks = await this.buildRecommendedTrackPool({
        mode,
        targetCount: needed + existingIds.size + 4,
        currentSong: this.stateService.getCurrentSong(),
        currentQueue
      });
      const additions = refillTracks
        .filter((song) => {
          const songNameKey = this.getSongNameKey(song);
          return !existingIds.has(song.sourceId) && !existingSongNames.has(songNameKey);
        })
        .slice(0, needed);

      if (additions.length > 0) {
        this.stateService.setQueue([...currentQueue, ...additions]);
        this.syncAndBroadcast();
      }
    } catch {
      // Queue refill is a background comfort feature; playback should never depend on it.
    }
  }

  private async refreshModeQueue(mode: AppMode) {
    try {
      const queue = await this.buildRecommendedTrackPool({
        mode,
        targetCount: this.recommendationPolicyService.getTargetQueueSize(mode),
        currentSong: this.stateService.getCurrentSong(),
        currentQueue: this.stateService.getQueue()
      });
      const currentSong = this.stateService.getCurrentSong();
      this.stateService.setQueue(
        currentSong ? this.filterQueueAgainstCurrent(queue, currentSong) : queue.slice(0, 10)
      );
      this.syncAndBroadcast();
    } catch {
      // Mode queue refresh is best-effort; the mode itself has already switched.
    }
  }

  private filterQueueAgainstCurrent(queue: SongDetail[], currentSong: SongDetail) {
    const currentNameKey = this.getSongNameKey(currentSong);
    const seenNames = new Set<string>(currentNameKey ? [currentNameKey] : []);
    const seenIds = new Set([currentSong.sourceId]);
    const filtered: SongDetail[] = [];

    for (const song of queue) {
      const songNameKey = this.getSongNameKey(song);

      if (seenIds.has(song.sourceId) || (songNameKey && seenNames.has(songNameKey))) {
        continue;
      }

      seenIds.add(song.sourceId);

      if (songNameKey) {
        seenNames.add(songNameKey);
      }

      filtered.push(song);

      if (filtered.length >= 60) {
        break;
      }
    }

    return filtered;
  }

  private mergeQueue(
    currentQueue: SongDetail[],
    additions: SongDetail[],
    currentSong: SongDetail | null
  ) {
    const currentNameKey = currentSong ? this.getSongNameKey(currentSong) : "";
    const seenNames = new Set<string>(currentNameKey ? [currentNameKey] : []);
    const seenIds = new Set<string>(currentSong ? [currentSong.sourceId] : []);
    const merged: SongDetail[] = [];

    // 新推荐插队到前面，旧队列往后排
    for (const song of [...additions, ...currentQueue]) {
      const songNameKey = this.getSongNameKey(song);

      if (seenIds.has(song.sourceId) || (songNameKey && seenNames.has(songNameKey))) {
        continue;
      }

      seenIds.add(song.sourceId);

      if (songNameKey) {
        seenNames.add(songNameKey);
      }

      merged.push(song);

      if (merged.length >= 60) {
        break;
      }
    }

    return merged;
  }

  private getSongNameKey(song: SongDetail) {
    return song.name
      .toLowerCase()
      .replace(/[\[【(（].*?[\]】)）]/g, "")
      .replace(/\b(live|acoustic|伴奏|纯音乐|remix|版|现场|演唱会)\b/gi, "")
      .replace(/[^\p{Letter}\p{Number}]+/gu, "")
      .trim();
  }

  private syncAndBroadcast() {
    const state = this.stateService.getNowPlayingState();
    this.realtimeService.broadcast(state);
    return state;
  }
}
