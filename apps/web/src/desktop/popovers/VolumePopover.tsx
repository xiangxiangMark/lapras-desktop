import type React from "react";

type VolumePopoverProps = {
  muted: boolean;
  currentVolume: number;
  volumeSliderRef: React.RefObject<HTMLDivElement>;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
};

export function VolumePopover({
  muted,
  currentVolume,
  volumeSliderRef,
  onPointerDown,
  onKeyDown
}: VolumePopoverProps) {
  const volumePercent = Math.round(currentVolume * 100);

  return (
    <div className="volume-popover desktop-floating-panel no-drag">
      <div
        ref={volumeSliderRef}
        className="volume-slider no-drag"
        role="slider"
        tabIndex={0}
        aria-label="音量"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={volumePercent}
        aria-valuetext={muted ? "静音" : `${volumePercent}%`}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        <div className="volume-track">
          <div className="volume-fill" style={{ height: muted ? "0%" : `${volumePercent}%` }} />
          <div className="volume-thumb" style={{ bottom: muted ? "0%" : `${volumePercent}%` }} />
        </div>
      </div>
    </div>
  );
}
