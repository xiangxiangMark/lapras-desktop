import type { SongDetail } from "@ai-music-companion/shared";

import { formatClock, formatDate, songMeta, songTitle } from "../utils";

type TrackInfoProps = {
  clock: Date;
  currentSong: SongDetail | null;
};

export function TrackInfo({ clock, currentSong }: TrackInfoProps) {
  return (
    <>
      <div className="desktop-clock">
        <strong>{formatClock(clock)}</strong>
        <span>{formatDate(clock)}</span>
      </div>

      <div className="desktop-now-row">
        <div className="desktop-song">
          <h1>{songTitle(currentSong)}</h1>
          <p>{songMeta(currentSong)}</p>
        </div>
      </div>
    </>
  );
}
