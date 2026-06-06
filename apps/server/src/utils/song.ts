import type { SongDetail } from "@ai-music-companion/shared";

export function getNeteaseProxyAudioPath(sourceId: string) {
  return `/api/audio/netease/${encodeURIComponent(sourceId.replace("netease:", ""))}`;
}

export function normalizeSongDetailAudio(song: SongDetail): SongDetail {
  if (song.source !== "netease" || !song.sourceId || !song.audioUrl) {
    return song;
  }

  try {
    const hostname = new URL(song.audioUrl).hostname;

    if (
      hostname.endsWith("music.126.net") ||
      hostname.endsWith("music.163.com")
    ) {
      return {
        ...song,
        audioUrl: getNeteaseProxyAudioPath(song.sourceId)
      };
    }
  } catch {
    return song;
  }

  return song;
}

export function normalizeSongListAudio(songs: SongDetail[]) {
  return songs.map(normalizeSongDetailAudio);
}
