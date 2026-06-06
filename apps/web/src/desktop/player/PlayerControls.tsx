import type React from "react";
import type { FavoriteStatusResponse, SongDetail } from "@ai-music-companion/shared";

import { ShellIcon } from "../primitives";
import { VolumePopover } from "../popovers/VolumePopover";

type PlayerControlsProps = {
  currentSong: SongDetail | null;
  audioPlaying: boolean;
  favoriteStatus: FavoriteStatusResponse | null;
  volumePopoverOpen: boolean;
  volumeRef: React.RefObject<HTMLDivElement>;
  volumeSliderRef: React.RefObject<HTMLDivElement>;
  currentVolume: number;
  muted: boolean;
  onToggleFavorite: () => void;
  onPreviousTrack: () => void;
  onToggleAudio: () => void;
  onNextTrack: () => void;
  onToggleVolumePopover: () => void;
  onVolumePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onVolumeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
};

export function PlayerControls({
  currentSong,
  audioPlaying,
  favoriteStatus,
  volumePopoverOpen,
  volumeRef,
  volumeSliderRef,
  currentVolume,
  muted,
  onToggleFavorite,
  onPreviousTrack,
  onToggleAudio,
  onNextTrack,
  onToggleVolumePopover,
  onVolumePointerDown,
  onVolumeKeyDown
}: PlayerControlsProps) {
  return (
    <div className="desktop-player no-drag">
      <button
        type="button"
        className={`desktop-player-button no-drag desktop-favorite-button ${
          favoriteStatus?.isFavorited ? "is-active" : ""
        }`}
        title={favoriteStatus?.isFavorited ? "取消收藏" : "收藏当前歌曲"}
        aria-pressed={favoriteStatus?.isFavorited ?? false}
        onClick={onToggleFavorite}
        disabled={!currentSong}
      >
        <ShellIcon name="favorite" />
      </button>
      <button
        type="button"
        className="desktop-player-button no-drag"
        title="上一首"
        onClick={onPreviousTrack}
      >
        <ShellIcon name="previous" />
      </button>
      <button
        type="button"
        className="desktop-player-button no-drag"
        title={audioPlaying ? "暂停" : "播放"}
        onClick={onToggleAudio}
      >
        <ShellIcon name={audioPlaying ? "pause" : "play"} />
      </button>
      <button
        type="button"
        className="desktop-player-button no-drag"
        title="下一首"
        onClick={onNextTrack}
      >
        <ShellIcon name="next" />
      </button>
      <div className="desktop-popover-anchor no-drag" ref={volumeRef}>
        <button
          type="button"
          className={`desktop-player-button no-drag ${volumePopoverOpen ? "is-active" : ""}`}
          title="音量"
          onClick={onToggleVolumePopover}
        >
          <ShellIcon name="volume" />
        </button>
        {volumePopoverOpen ? (
          <VolumePopover
            muted={muted}
            currentVolume={currentVolume}
            volumeSliderRef={volumeSliderRef}
            onPointerDown={onVolumePointerDown}
            onKeyDown={onVolumeKeyDown}
          />
        ) : null}
      </div>
    </div>
  );
}
