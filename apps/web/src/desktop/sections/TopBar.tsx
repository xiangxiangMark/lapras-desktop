import type React from "react";
import type { SongDetail } from "@ai-music-companion/shared";

import { ModePopover } from "../popovers/ModePopover";
import { MinimalLaprasAvatar, modeMeta, ShellIcon } from "../primitives";
import type { DesktopPlayMode } from "../types";
import { songTitle } from "../utils";

type TopBarProps = {
  currentSong: SongDetail | null;
  currentMode: DesktopPlayMode;
  desktopState: LaprasDesktopState;
  modePopoverOpen: boolean;
  modeRef: React.RefObject<HTMLDivElement>;
  onToggleModePopover: () => void;
  onSwitchMode: (mode: DesktopPlayMode) => void;
  onToggleAlwaysOnTop: () => void;
  onOpenSettingsWindow: () => void;
  onMinimize: () => void;
  onHideToTray: () => void;
};

export function TopBar({
  currentSong,
  currentMode,
  desktopState,
  modePopoverOpen,
  modeRef,
  onToggleModePopover,
  onSwitchMode,
  onToggleAlwaysOnTop,
  onOpenSettingsWindow,
  onMinimize,
  onHideToTray
}: TopBarProps) {
  return (
    <header className="desktop-topbar drag-region">
      <div className="desktop-brand">
        <span className="track-cover-avatar">
          {currentSong?.coverUrl ? (
            <img src={currentSong.coverUrl} alt={songTitle(currentSong)} />
          ) : (
            <MinimalLaprasAvatar />
          )}
        </span>
        <span>Lapras</span>
      </div>

      <div className="desktop-topbar-drag-spacer" aria-hidden="true" />

      <div className="desktop-actions no-drag">
        <div className="desktop-popover-anchor no-drag" ref={modeRef}>
          <button
            type="button"
            className={`desktop-icon-button no-drag ${modePopoverOpen ? "is-active" : ""}`}
            title="切换模式"
            onClick={onToggleModePopover}
          >
            <ShellIcon name={modeMeta[currentMode].icon} />
          </button>
          {modePopoverOpen ? (
            <ModePopover currentMode={currentMode} onSwitchMode={onSwitchMode} />
          ) : null}
        </div>

        <button
          type="button"
          className={`desktop-icon-button no-drag ${
            desktopState.alwaysOnTop ? "is-active" : ""
          }`}
          title="窗口置顶"
          onClick={onToggleAlwaysOnTop}
        >
          <ShellIcon name="pin" />
        </button>

        <button
          type="button"
          className={`desktop-icon-button no-drag ${
            desktopState.settingsWindowOpen ? "is-active" : ""
          }`}
          title="打开设置"
          onClick={onOpenSettingsWindow}
        >
          <ShellIcon name="settings" />
        </button>

        <button
          type="button"
          className={`desktop-icon-button no-drag ${desktopState.compactMode ? "is-active" : ""}`}
          title="最小化"
          onClick={onMinimize}
        >
          <ShellIcon name="minimize" />
        </button>

        <button
          type="button"
          className="desktop-icon-button no-drag"
          title="隐藏到托盘"
          onClick={onHideToTray}
        >
          <ShellIcon name="hide" />
        </button>
      </div>
    </header>
  );
}
