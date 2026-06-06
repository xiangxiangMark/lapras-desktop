import type React from "react";

import { formatDuration } from "../utils";

type ProgressBarProps = {
  progress: number;
  audioTime: number;
  audioDuration: number;
  progressSliderRef: React.RefObject<HTMLDivElement>;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
};

export function ProgressBar({
  progress,
  audioTime,
  audioDuration,
  progressSliderRef,
  onPointerDown,
  onKeyDown
}: ProgressBarProps) {
  return (
    <div className="desktop-progress-row">
      <div
        ref={progressSliderRef}
        className="desktop-progress no-drag"
        role="slider"
        tabIndex={0}
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={Math.round(audioDuration)}
        aria-valuenow={Math.round(audioTime)}
        aria-valuetext={`${formatDuration(audioTime)} / ${formatDuration(audioDuration)}`}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        <span className="desktop-progress-fill" style={{ width: `${progress}%` }} />
        <span className="desktop-progress-thumb" style={{ left: `${progress}%` }} />
      </div>
      <div className="desktop-time">
        <span>{formatDuration(audioTime)}</span>
        <span>{formatDuration(audioDuration)}</span>
      </div>
    </div>
  );
}
