import type React from "react";

import { clampVolume } from "../../lib/desktopPreferences";

type UsePlayerControlsOptions = {
  audioRef: React.RefObject<HTMLAudioElement>;
  volumeSliderRef: React.RefObject<HTMLDivElement>;
  progressSliderRef: React.RefObject<HTMLDivElement>;
  audioTime: number;
  audioDuration: number;
  currentVolume: number;
  setAudioTime: React.Dispatch<React.SetStateAction<number>>;
  setVolume: React.Dispatch<React.SetStateAction<number>>;
  setMuted: React.Dispatch<React.SetStateAction<boolean>>;
};

export function usePlayerControls({
  audioRef,
  volumeSliderRef,
  progressSliderRef,
  audioTime,
  audioDuration,
  currentVolume,
  setAudioTime,
  setVolume,
  setMuted
}: UsePlayerControlsOptions) {
  function updateVolume(nextVolume: number) {
    const clamped = clampVolume(nextVolume);
    setVolume(clamped);
    setMuted(clamped === 0);
  }

  function readVolumeFromPointer(clientY: number) {
    const slider = volumeSliderRef.current;

    if (!slider) {
      return currentVolume;
    }

    const rect = slider.getBoundingClientRect();

    if (rect.height <= 0) {
      return currentVolume;
    }

    const ratio = 1 - (clientY - rect.top) / rect.height;
    return clampVolume(ratio);
  }

  function beginVolumeDrag(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();

    updateVolume(readVolumeFromPointer(event.clientY));

    const onPointerMove = (moveEvent: PointerEvent) => {
      updateVolume(readVolumeFromPointer(moveEvent.clientY));
    };

    const stopDragging = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", stopDragging);
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", stopDragging);
  }

  function handleVolumeSliderKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = 0.05;

    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      event.preventDefault();
      updateVolume(currentVolume + step);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      event.preventDefault();
      updateVolume(currentVolume - step);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      updateVolume(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      updateVolume(1);
    }
  }

  function seekToRatio(nextRatio: number) {
    const audio = audioRef.current;

    if (!audio || !Number.isFinite(audioDuration) || audioDuration <= 0) {
      return;
    }

    const clampedRatio = Math.min(Math.max(nextRatio, 0), 1);
    const nextTime = clampedRatio * audioDuration;
    audio.currentTime = nextTime;
    setAudioTime(nextTime);
  }

  function readProgressFromPointer(clientX: number) {
    const slider = progressSliderRef.current;

    if (!slider) {
      return audioDuration > 0 ? audioTime / audioDuration : 0;
    }

    const rect = slider.getBoundingClientRect();

    if (rect.width <= 0) {
      return audioDuration > 0 ? audioTime / audioDuration : 0;
    }

    return (clientX - rect.left) / rect.width;
  }

  function beginProgressDrag(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    seekToRatio(readProgressFromPointer(event.clientX));

    const onPointerMove = (moveEvent: PointerEvent) => {
      seekToRatio(readProgressFromPointer(moveEvent.clientX));
    };

    const stopDragging = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", stopDragging);
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", stopDragging);
  }

  function handleProgressSliderKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!Number.isFinite(audioDuration) || audioDuration <= 0) {
      return;
    }

    const stepSeconds = Math.min(Math.max(audioDuration * 0.02, 2), 10);

    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      seekToRatio((audioTime + stepSeconds) / audioDuration);
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      seekToRatio((audioTime - stepSeconds) / audioDuration);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      seekToRatio(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      seekToRatio(1);
    }
  }

  return {
    beginVolumeDrag,
    handleVolumeSliderKeyDown,
    beginProgressDrag,
    handleProgressSliderKeyDown
  };
}
