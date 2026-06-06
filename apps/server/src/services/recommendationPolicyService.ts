import type {
  AppMode,
  NeteaseProfileSummary,
  RecommendationTuning,
  SongDetail
} from "@ai-music-companion/shared";

import { ProfileService } from "./profileService.js";
import type { PlaybackFeedbackSignals } from "./historyService.js";
import { RecommendationPortraitService } from "./recommendationPortraitService.js";

interface ModePolicy {
  seedQueries: string[];
  refillThreshold: number;
  targetQueueSize: number;
  continuityHint: string;
}

interface RecommendationQueryContext {
  mode: AppMode;
  primaryQuery?: string;
  queueQueries?: string[];
  currentSong?: SongDetail | null;
  tuning?: RecommendationTuning;
}

interface RecommendationRankingContext {
  mode: AppMode;
  currentSong?: SongDetail | null;
  currentQueue?: SongDetail[];
  tuning?: RecommendationTuning;
}

type LocalPlaylistsProfile = {
  favorites?: string[];
  avoid?: string[];
  scenes?: Record<string, string[]>;
};

const MODE_SCENE_KEYS: Record<AppMode, string[]> = {
  companion: ["commute_night"],
  focus: ["coding_focus"],
  discover: ["commute_night"],
  sleep: ["before_sleep", "commute_night"]
};

// Shapes recommendation queries and queue order using local profile data.
export class RecommendationPolicyService {
  private readonly policies: Record<AppMode, ModePolicy> = {
    companion: {
      seedQueries: ["华语 流行 温柔", "R&B 中文 放松", "indie 华语 夜晚"],
      refillThreshold: 55,
      targetQueueSize: 60,
      continuityHint: "温柔 陪伴"
    },
    focus: {
      seedQueries: ["纯音乐 专注", "lofi chill", "ambient piano", "轻电子 工作"],
      refillThreshold: 55,
      targetQueueSize: 60,
      continuityHint: "稳定 纯音乐"
    },
    discover: {
      seedQueries: ["华语 indie 温柔", "小众 华语 流行", "城市民谣 放松"],
      refillThreshold: 55,
      targetQueueSize: 60,
      continuityHint: "新鲜 但不突兀"
    },
    sleep: {
      seedQueries: ["夜晚 轻柔 助眠", "钢琴 安静", "温柔 女声", "ambient sleep"],
      refillThreshold: 55,
      targetQueueSize: 60,
      continuityHint: "慢速 夜晚"
    }
  };

  constructor(
    private readonly profileService: ProfileService,
    private readonly recommendationPortraitService: RecommendationPortraitService
  ) {}

  getModeQueries(mode: AppMode) {
    return this.policies[mode].seedQueries;
  }

  shouldRefill(mode: AppMode, queueSize: number) {
    return queueSize < this.policies[mode].refillThreshold;
  }

  getTargetQueueSize(mode: AppMode) {
    return this.policies[mode].targetQueueSize;
  }

  buildCandidateQueries(context: RecommendationQueryContext) {
    const profile = this.profileService.getProfile();
    const neteaseProfile = this.asNeteaseProfile(profile.neteaseProfile);
    const localPlaylists = this.asLocalPlaylists(profile.playlists);
    const modePolicy = this.policies[context.mode];
    const portrait = this.recommendationPortraitService.build({
      mode: context.mode,
      currentSong: context.currentSong,
      currentUserInput: [context.primaryQuery ?? "", ...(context.queueQueries ?? [])].join(" ")
    });
    const tuning = this.mergeTuning(
      portrait.suggestedTuning,
      context.tuning
    );
    const explicitQueries = [
      context.primaryQuery ?? "",
      ...(context.queueQueries ?? [])
    ]
      .map((query) => this.normalizeQuery(query))
      .filter(Boolean);
    const sceneQueries = this.getSceneQueries(localPlaylists, context.mode);
    const playlistQueries = this.getPlaylistQueries(neteaseProfile, context.mode);
    const artistQueries = this.getPreferredArtistQueries(
      neteaseProfile,
      context.mode,
      context.currentSong
    );
    const tuningQueries = this.buildTuningQueries(tuning, context.mode);
    const continuityQueries = this.getContinuityQueries(
      context.currentSong,
      modePolicy.continuityHint
    );
    const portraitQueries =
      tuning.familiarity === "explore"
        ? [...portrait.exploreQueries, ...portrait.anchorQueries]
        : [...portrait.anchorQueries, ...portrait.exploreQueries];

    return [
      ...explicitQueries,
      ...tuningQueries,
      ...portraitQueries,
      ...continuityQueries,
      ...sceneQueries,
      ...artistQueries,
      ...playlistQueries,
      ...modePolicy.seedQueries
    ]
      .map((query) => this.normalizeQuery(query))
      .filter(Boolean)
      .filter((query, index, queries) => queries.indexOf(query) === index)
      .slice(0, 18);
  }

  rankTracks(
    tracks: SongDetail[],
    signals: PlaybackFeedbackSignals,
    context: RecommendationRankingContext
  ) {
    const profile = this.profileService.getProfile();
    const neteaseProfile = this.asNeteaseProfile(profile.neteaseProfile);
    const localPlaylists = this.asLocalPlaylists(profile.playlists);
    const artistWeights = this.buildPreferredArtistWeights(neteaseProfile);
    const preferredTerms = this.collectPreferredTerms(
      localPlaylists,
      neteaseProfile,
      context.mode
    );
    const portrait = this.recommendationPortraitService.build({
      mode: context.mode,
      currentSong: context.currentSong
    });
    const tuning = this.mergeTuning(
      portrait.suggestedTuning,
      context.tuning
    );
    const anchorArtists = this.buildArtistKeySet(tuning.anchorArtists ?? []);
    const avoidArtists = this.buildArtistKeySet(tuning.avoidArtists ?? []);
    const moodKeywords = (tuning.moodKeywords ?? []).map((keyword) =>
      keyword.trim().toLowerCase()
    );
    const queueArtists = new Set(
      (context.currentQueue ?? []).flatMap((song) => this.getArtistKeys(song.artist))
    );
    const currentArtists = new Set(
      this.getArtistKeys(context.currentSong?.artist ?? "")
    );

    const scored = tracks.map((track, index) => {
      let score = 240 - index * 2;
      const artistKeys = this.getArtistKeys(track.artist);
      const metadata = this.getTrackMetadata(track);
      const hasPreferredArtist = artistKeys.some((artistKey) =>
        artistWeights.has(artistKey)
      );
      const hasAnchorArtist = artistKeys.some((artistKey) =>
        anchorArtists.has(artistKey)
      );
      const hasAvoidArtist = artistKeys.some((artistKey) =>
        avoidArtists.has(artistKey)
      );
      const hasFreshArtist = artistKeys.every(
        (artistKey) =>
          !artistWeights.has(artistKey) &&
          !queueArtists.has(artistKey) &&
          !currentArtists.has(artistKey)
      );

      if (signals.recentSongIds.has(track.sourceId)) {
        score -= 80;
      }

      if (signals.skippedSongIds.has(track.sourceId)) {
        score -= 150;
      }

      if (this.hasSkippedArtist(track, signals)) {
        score -= 36;
      }

      if (hasAvoidArtist) {
        score -= 64;
      }

      if (hasAnchorArtist) {
        score += 24;
      }

      for (const artistKey of artistKeys) {
        score += artistWeights.get(artistKey) ?? 0;

        if (currentArtists.has(artistKey)) {
          score += 18;
        }

        if (queueArtists.has(artistKey)) {
          score -= 10;
        }
      }

      score += this.scorePreferredTerms(metadata, preferredTerms);
      score += this.scoreMoodKeywords(metadata, moodKeywords);
      score += this.scoreModeAffinity(track, context.mode);
      score += this.scoreEnergyAffinity(metadata, tuning.energy ?? "steady");

      if (tuning.familiarity === "anchor") {
        score += hasPreferredArtist || hasAnchorArtist ? 16 : -8;
      }

      if (tuning.familiarity === "explore") {
        score += hasFreshArtist ? 12 : 0;
        score -= hasAnchorArtist ? 4 : 0;
      }

      return {
        track,
        score
      };
    });

    return scored
      .sort((left, right) => right.score - left.score)
      .map((item) => item.track);
  }

  arrangeTracks(
    tracks: SongDetail[],
    context: RecommendationRankingContext,
    limit: number
  ) {
    const arranged: SongDetail[] = [];
    const deferred: SongDetail[] = [];
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    const artistCounts = new Map<string, number>();
    const currentSong = context.currentSong ?? null;
    const currentSongName = currentSong ? this.getSongNameKey(currentSong) : "";

    for (const track of tracks) {
      const songNameKey = this.getSongNameKey(track);

      if (
        seenIds.has(track.sourceId) ||
        (songNameKey && seenNames.has(songNameKey)) ||
        track.sourceId === currentSong?.sourceId ||
        (currentSongName && songNameKey === currentSongName)
      ) {
        continue;
      }

      if (this.shouldDeferArtist(track, arranged, artistCounts)) {
        deferred.push(track);
        continue;
      }

      this.pushArrangedTrack(track, arranged, seenIds, seenNames, artistCounts);

      if (arranged.length >= limit) {
        return arranged;
      }
    }

    for (const track of deferred) {
      this.pushArrangedTrack(track, arranged, seenIds, seenNames, artistCounts);

      if (arranged.length >= limit) {
        break;
      }
    }

    return arranged;
  }

  private pushArrangedTrack(
    track: SongDetail,
    arranged: SongDetail[],
    seenIds: Set<string>,
    seenNames: Set<string>,
    artistCounts: Map<string, number>
  ) {
    const songNameKey = this.getSongNameKey(track);

    seenIds.add(track.sourceId);

    if (songNameKey) {
      seenNames.add(songNameKey);
    }

    for (const artistKey of this.getArtistKeys(track.artist)) {
      artistCounts.set(artistKey, (artistCounts.get(artistKey) ?? 0) + 1);
    }

    arranged.push(track);
  }

  private getSceneQueries(localPlaylists: LocalPlaylistsProfile, mode: AppMode) {
    const scenes = localPlaylists.scenes ?? {};

    return MODE_SCENE_KEYS[mode]
      .flatMap((sceneKey) => {
        const scene = scenes[sceneKey];

        if (!Array.isArray(scene) || scene.length === 0) {
          return [];
        }

        return [scene.slice(0, 3).join(" ")];
      })
      .filter(Boolean);
  }

  private getPlaylistQueries(
    neteaseProfile: NeteaseProfileSummary | null,
    mode: AppMode
  ) {
    if (!neteaseProfile) {
      return [];
    }

    const modeHint = this.policies[mode].continuityHint;
    const keywords = [
      ...neteaseProfile.tasteSignals.keywords.slice(0, 4),
      ...neteaseProfile.topPlaylists
        .slice(0, 3)
        .flatMap((playlist) => this.extractMeaningfulTerms(playlist.name))
        .slice(0, 4)
    ];

    return keywords.map((keyword) => `${keyword} ${modeHint}`);
  }

  private getPreferredArtistQueries(
    neteaseProfile: NeteaseProfileSummary | null,
    mode: AppMode,
    currentSong?: SongDetail | null
  ) {
    const modeHint = this.policies[mode].continuityHint;
    const currentArtists = this.getArtistKeys(currentSong?.artist ?? "");
    const artistNames = [
      ...currentArtists,
      ...(neteaseProfile?.tasteSignals.topArtists.slice(0, 5).map((artist) => artist.name) ?? [])
    ];

    return artistNames
      .map((artistName) => `${artistName} ${modeHint}`)
      .filter((query, index, queries) => queries.indexOf(query) === index);
  }

  private getContinuityQueries(currentSong: SongDetail | null | undefined, modeHint: string) {
    if (!currentSong) {
      return [];
    }

    return [
      `${currentSong.artist} ${modeHint}`,
      currentSong.artist,
      `${currentSong.name} ${currentSong.artist}`
    ];
  }

  private buildPreferredArtistWeights(neteaseProfile: NeteaseProfileSummary | null) {
    const weights = new Map<string, number>();

    if (!neteaseProfile) {
      return weights;
    }

    for (const artist of neteaseProfile.tasteSignals.topArtists.slice(0, 10)) {
      const artistKey = artist.name.trim().toLowerCase();

      if (!artistKey) {
        continue;
      }

      weights.set(artistKey, Math.min(28, 8 + artist.count * 2));
    }

    for (const record of neteaseProfile.recentTracks.slice(0, 12)) {
      for (const artistKey of this.getArtistKeys(record.song.artist)) {
        weights.set(artistKey, Math.max(weights.get(artistKey) ?? 0, 12));
      }
    }

    return weights;
  }

  private collectPreferredTerms(
    localPlaylists: LocalPlaylistsProfile,
    neteaseProfile: NeteaseProfileSummary | null,
    mode: AppMode
  ) {
    const terms = new Set<string>();

    for (const favorite of localPlaylists.favorites ?? []) {
      for (const term of this.extractMeaningfulTerms(favorite)) {
        terms.add(term);
      }
    }

    for (const sceneQuery of this.getSceneQueries(localPlaylists, mode)) {
      for (const term of this.extractMeaningfulTerms(sceneQuery)) {
        terms.add(term);
      }
    }

    if (neteaseProfile) {
      for (const keyword of neteaseProfile.tasteSignals.keywords.slice(0, 12)) {
        for (const term of this.extractMeaningfulTerms(keyword)) {
          terms.add(term);
        }
      }
    }

    return [...terms];
  }

  private scorePreferredTerms(metadata: string, preferredTerms: string[]) {
    let score = 0;

    for (const term of preferredTerms) {
      if (metadata.includes(term)) {
        score += 6;
      }
    }

    return Math.min(score, 30);
  }

  private scoreMoodKeywords(metadata: string, moodKeywords: string[]) {
    let score = 0;

    for (const keyword of moodKeywords) {
      if (metadata.includes(keyword)) {
        score += 5;
      }
    }

    return Math.min(score, 24);
  }

  private scoreModeAffinity(track: SongDetail, mode: AppMode) {
    const metadata = this.getTrackMetadata(track);

    if (mode === "focus") {
      if (/(lofi|ambient|piano|study|focus|纯音乐|轻音乐|钢琴|器乐)/i.test(metadata)) {
        return 12;
      }

      if (/(live|演唱会|dj|remix|炸|摇滚|说唱)/i.test(metadata)) {
        return -10;
      }
    }

    if (mode === "sleep") {
      if (/(night|sleep|late|晚安|夜晚|轻柔|安静|钢琴|助眠)/i.test(metadata)) {
        return 12;
      }

      if (/(dj|remix|燃|舞曲|高能|炸)/i.test(metadata)) {
        return -12;
      }
    }

    if (mode === "companion") {
      if (/(情歌|夜晚|温柔|chill|indie|r&b|流行)/i.test(metadata)) {
        return 10;
      }
    }

    return 0;
  }

  private scoreEnergyAffinity(
    metadata: string,
    energy: NonNullable<RecommendationTuning["energy"]>
  ) {
    if (energy === "lower") {
      if (/(calm|quiet|sleep|night|soft|piano|ambient|柔和|安静|夜晚|助眠|钢琴)/i.test(metadata)) {
        return 10;
      }

      if (/(dj|remix|live|rock|dance|高能|炸|热烈)/i.test(metadata)) {
        return -12;
      }
    }

    if (energy === "lift") {
      if (/(bright|dance|pop|city|sun|清醒|节奏|明亮|流行)/i.test(metadata)) {
        return 10;
      }

      if (/(sleep|ambient|late|night|助眠|过慢)/i.test(metadata)) {
        return -6;
      }
    }

    return 0;
  }

  private shouldDeferArtist(
    track: SongDetail,
    arranged: SongDetail[],
    artistCounts: Map<string, number>
  ) {
    if (arranged.length === 0) {
      return false;
    }

    const lastTrack = arranged[arranged.length - 1];

    if (lastTrack && this.hasArtistOverlap(track, lastTrack)) {
      return true;
    }

    return this.getArtistKeys(track.artist).some((artistKey) => (artistCounts.get(artistKey) ?? 0) >= 2);
  }

  private hasSkippedArtist(track: SongDetail, signals: PlaybackFeedbackSignals) {
    return this.getArtistKeys(track.artist).some((artist) => signals.skippedArtists.has(artist));
  }

  private hasArtistOverlap(left: SongDetail, right: SongDetail) {
    const rightArtists = new Set(this.getArtistKeys(right.artist));
    return this.getArtistKeys(left.artist).some((artist) => rightArtists.has(artist));
  }

  private getArtistKeys(artistLine: string) {
    return artistLine
      .split("/")
      .map((artist) => artist.trim().toLowerCase())
      .filter(Boolean);
  }

  private buildArtistKeySet(artists: string[]) {
    const keys = new Set<string>();

    for (const artist of artists) {
      for (const key of this.getArtistKeys(artist)) {
        keys.add(key);
      }
    }

    return keys;
  }

  private getTrackMetadata(track: SongDetail) {
    return `${track.name} ${track.artist} ${track.album ?? ""}`.toLowerCase();
  }

  private normalizeQuery(query: string) {
    return query.replace(/\s+/g, " ").trim().slice(0, 40);
  }

  private uniqueStrings(values: string[]) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  private buildTuningQueries(
    tuning: RecommendationTuning,
    mode: AppMode
  ) {
    const modeHint = this.policies[mode].continuityHint;

    return this.uniqueStrings([
      ...(tuning.anchorArtists ?? []).slice(0, 3).map((artist) => `${artist} ${modeHint}`),
      ...(tuning.moodKeywords ?? []).slice(0, 3).map((keyword) => `${keyword} ${modeHint}`)
    ])
      .map((query: string) => this.normalizeQuery(query))
      .filter(Boolean)
      .slice(0, 6);
  }

  private mergeTuning(
    portraitTuning: RecommendationTuning,
    actionTuning?: RecommendationTuning
  ): RecommendationTuning {
    return {
      familiarity: actionTuning?.familiarity ?? portraitTuning.familiarity ?? "balanced",
      energy: actionTuning?.energy ?? portraitTuning.energy ?? "steady",
      anchorArtists: this.uniqueStrings([
        ...(actionTuning?.anchorArtists ?? []),
        ...(portraitTuning.anchorArtists ?? [])
      ]).slice(0, 5),
      avoidArtists: this.uniqueStrings([
        ...(actionTuning?.avoidArtists ?? []),
        ...(portraitTuning.avoidArtists ?? [])
      ]).slice(0, 5),
      moodKeywords: this.uniqueStrings([
        ...(actionTuning?.moodKeywords ?? []),
        ...(portraitTuning.moodKeywords ?? [])
      ]).slice(0, 6)
    };
  }

  private extractMeaningfulTerms(value: string) {
    return value
      .split(/[\s/|·,，、\-_[\]【】()（）]+/)
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length >= 2 && !/^\d+$/.test(part))
      .slice(0, 3);
  }

  private getSongNameKey(song: SongDetail) {
    return song.name
      .toLowerCase()
      .replace(/[\[【(（].*?[\]】)）]/g, "")
      .replace(/\b(live|acoustic|伴奏|纯音乐|remix|版|现场|演唱会)\b/gi, "")
      .replace(/[^\p{Letter}\p{Number}]+/gu, "")
      .trim();
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

    const profile = raw as Partial<NeteaseProfileSummary>;

    if (!Array.isArray(profile.topPlaylists) || !Array.isArray(profile.recentTracks)) {
      return null;
    }

    return profile as NeteaseProfileSummary;
  }
}
