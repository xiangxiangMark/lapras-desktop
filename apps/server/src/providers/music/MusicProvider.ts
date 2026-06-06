import type { SongDetail } from "@ai-music-companion/shared";

export interface MusicProvider {
  searchTracks(query: string, limit?: number): Promise<SongDetail[]>;
  getSongDetail(songId: string): Promise<SongDetail | null>;
}
