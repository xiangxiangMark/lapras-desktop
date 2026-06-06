import type { SongDetail } from "@ai-music-companion/shared";

import type { SettingsService } from "../../services/settingsService.js";
import { NeteaseApiClient } from "../../services/neteaseApiClient.js";
import { getNeteaseProxyAudioPath } from "../../utils/song.js";
import type { MusicProvider } from "./MusicProvider.js";
import { MOCK_NETEASE_CATALOG } from "./mockCatalog.js";

export class NeteaseMusicProvider implements MusicProvider {
  private readonly apiClient: NeteaseApiClient;

  constructor(private readonly settingsService: SettingsService) {
    this.apiClient = new NeteaseApiClient(settingsService);
  }

  async searchTracks(query: string, limit = 5): Promise<SongDetail[]> {
    const settings = this.settingsService.getRuntimeSettings();

    if (!settings.neteaseApiBaseUrl) {
      return this.searchMock(query, limit);
    }

    try {
      const payload = await this.apiClient.searchTracks<{
        result?: { songs?: unknown[] };
        songs?: unknown[];
      }>(query, limit);

      const rawSongs = payload.result?.songs ?? payload.songs ?? [];
      const tracks = rawSongs
        .map((item) => this.normalizeTrack(item))
        .slice(0, limit);

      if (tracks.length === 0 && settings.useMockNeteaseOnFailure) {
        return this.searchMock(query, limit);
      }

      return tracks;
    } catch {
      if (settings.useMockNeteaseOnFailure) {
        return this.searchMock(query, limit);
      }

      throw new Error("Netease search failed.");
    }
  }

  async getSongDetail(songId: string): Promise<SongDetail | null> {
    const settings = this.settingsService.getRuntimeSettings();
    const normalizedId = songId.replace("netease:", "");

    if (!settings.neteaseApiBaseUrl) {
      return this.getMockDetail(normalizedId);
    }

    try {
      const payload = await this.apiClient.getSongDetail<{
        songs?: unknown[];
        data?: unknown[];
      }>(normalizedId);

      const rawSong = payload.songs?.[0] ?? payload.data?.[0];

      if (!rawSong) {
        return settings.useMockNeteaseOnFailure ? this.getMockDetail(normalizedId) : null;
      }

      const detail = this.normalizeTrack(rawSong);
      const audioUrl = await this.fetchAudioUrl(normalizedId);

      return {
        ...detail,
        audioUrl: audioUrl ? getNeteaseProxyAudioPath(normalizedId) : null
      };
    } catch {
      if (settings.useMockNeteaseOnFailure) {
        return this.getMockDetail(normalizedId);
      }

      return null;
    }
  }

  async resolveAudioStreamUrl(songId: string) {
    return this.fetchAudioUrl(songId.replace("netease:", ""));
  }

  getAudioRequestHeaders(range?: string | null) {
    const headers = new Headers({
      Accept: "audio/*,*/*;q=0.9",
      Origin: "https://music.163.com",
      Referer: "https://music.163.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
    });
    const cookie = this.settingsService.getNeteaseCookie();

    if (cookie) {
      headers.set("Cookie", cookie);
    }

    if (range) {
      headers.set("Range", range);
    }

    return headers;
  }

  private async fetchAudioUrl(songId: string) {
    try {
      const payload = await this.apiClient.getSongUrl<{
        data?: Array<{ url?: string | null }>;
      }>(songId, "standard");

      return payload.data?.[0]?.url ?? null;
    } catch {
      return null;
    }
  }

  private searchMock(query: string, limit: number) {
    const normalized = query.toLowerCase();
    const matches = MOCK_NETEASE_CATALOG.filter((item) =>
      `${item.name} ${item.artist} ${item.album ?? ""}`
        .toLowerCase()
        .includes(normalized)
    );

    return Promise.resolve((matches.length > 0 ? matches : MOCK_NETEASE_CATALOG).slice(0, limit));
  }

  private getMockDetail(songId: string) {
    return Promise.resolve(
      MOCK_NETEASE_CATALOG.find((item) => item.sourceId === songId) ?? null
    );
  }

  private normalizeTrack(raw: unknown): SongDetail {
    const item = raw as {
      id?: string | number;
      name?: string;
      dt?: number;
      duration?: number;
      al?: { name?: string; picUrl?: string };
      album?: { name?: string; picUrl?: string };
      ar?: Array<{ name?: string }>;
      artists?: Array<{ name?: string }>;
    };

    const sourceId = String(item.id ?? "");
    const artistNames =
      item.ar?.map((artist) => artist.name).filter(Boolean).join(" / ") ||
      item.artists?.map((artist) => artist.name).filter(Boolean).join(" / ") ||
      "Unknown artist";

    return {
      id: `netease:${sourceId}`,
      source: "netease",
      sourceId,
      name: item.name ?? "Untitled track",
      artist: artistNames,
      album: item.al?.name ?? item.album?.name,
      durationMs: item.dt ?? item.duration,
      coverUrl: item.al?.picUrl ?? item.album?.picUrl,
      audioUrl: null,
      sourceUrl: `https://music.163.com/#/song?id=${sourceId}`,
      lyricSnippet: null
    };
  }

}
