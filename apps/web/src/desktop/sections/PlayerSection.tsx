import type React from "react";
import type { FavoriteStatusResponse, SongDetail } from "@ai-music-companion/shared";

import { PlayerControls } from "../player/PlayerControls";
import { ProgressBar } from "../player/ProgressBar";
import { TrackInfo } from "../player/TrackInfo";
import { TopBar } from "./TopBar";
import type { DesktopPlayMode } from "../types";

type PlayerSectionProps = {
  currentSong: SongDetail | null;
  currentMode: DesktopPlayMode;
  desktopState: LaprasDesktopState;
  clock: Date;
  audioPlaying: boolean;
  favoriteStatus: FavoriteStatusResponse | null;
  currentVolume: number;
  muted: boolean;
  progress: number;
  audioTime: number;
  audioDuration: number;
  modePopoverOpen: boolean;
  volumePopoverOpen: boolean;
  modeRef: React.RefObject<HTMLDivElement>;
  volumeRef: React.RefObject<HTMLDivElement>;
  volumeSliderRef: React.RefObject<HTMLDivElement>;
  progressSliderRef: React.RefObject<HTMLDivElement>;
  onToggleModePopover: () => void;
  onSwitchMode: (mode: DesktopPlayMode) => void;
  onToggleAlwaysOnTop: () => void;
  onOpenSettingsWindow: () => void;
  onMinimize: () => void;
  onHideToTray: () => void;
  onToggleFavorite: () => void;
  onPreviousTrack: () => void;
  onToggleAudio: () => void;
  onNextTrack: () => void;
  onToggleVolumePopover: () => void;
  onVolumePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onVolumeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onProgressPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onProgressKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
};

export function PlayerSection({
  currentSong,
  currentMode,
  desktopState,
  clock,
  audioPlaying,
  favoriteStatus,
  currentVolume,
  muted,
  progress,
  audioTime,
  audioDuration,
  modePopoverOpen,
  volumePopoverOpen,
  modeRef,
  volumeRef,
  volumeSliderRef,
  progressSliderRef,
  onToggleModePopover,
  onSwitchMode,
  onToggleAlwaysOnTop,
  onOpenSettingsWindow,
  onMinimize,
  onHideToTray,
  onToggleFavorite,
  onPreviousTrack,
  onToggleAudio,
  onNextTrack,
  onToggleVolumePopover,
  onVolumePointerDown,
  onVolumeKeyDown,
  onProgressPointerDown,
  onProgressKeyDown
}: PlayerSectionProps) {
  return (
    <section className="player-section">
      <TopBar
        currentSong={currentSong}
        currentMode={currentMode}
        desktopState={desktopState}
        modePopoverOpen={modePopoverOpen}
        modeRef={modeRef}
        onToggleModePopover={onToggleModePopover}
        onSwitchMode={onSwitchMode}
        onToggleAlwaysOnTop={onToggleAlwaysOnTop}
        onOpenSettingsWindow={onOpenSettingsWindow}
        onMinimize={onMinimize}
        onHideToTray={onHideToTray}
      />

      <TrackInfo clock={clock} currentSong={currentSong} />

      <PlayerControls
        currentSong={currentSong}
        audioPlaying={audioPlaying}
        favoriteStatus={favoriteStatus}
        volumePopoverOpen={volumePopoverOpen}
        volumeRef={volumeRef}
        volumeSliderRef={volumeSliderRef}
        currentVolume={currentVolume}
        muted={muted}
        onToggleFavorite={onToggleFavorite}
        onPreviousTrack={onPreviousTrack}
        onToggleAudio={onToggleAudio}
        onNextTrack={onNextTrack}
        onToggleVolumePopover={onToggleVolumePopover}
        onVolumePointerDown={onVolumePointerDown}
        onVolumeKeyDown={onVolumeKeyDown}
      />

      <ProgressBar
        progress={progress}
        audioTime={audioTime}
        audioDuration={audioDuration}
        progressSliderRef={progressSliderRef}
        onPointerDown={onProgressPointerDown}
        onKeyDown={onProgressKeyDown}
      />
    </section>
  );
}
