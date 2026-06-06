export interface DesktopAudioPreferences {
  volume: number;
  muted: boolean;
}

const STORAGE_KEY = "lapras.desktop.audio-preferences";

export const DEFAULT_AUDIO_PREFERENCES: DesktopAudioPreferences = {
  volume: 0.74,
  muted: false
};

export function clampVolume(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function readDesktopAudioPreferences(): DesktopAudioPreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return DEFAULT_AUDIO_PREFERENCES;
    }

    const parsed = JSON.parse(raw) as Partial<DesktopAudioPreferences>;

    return {
      volume: clampVolume(
        typeof parsed.volume === "number"
          ? parsed.volume
          : DEFAULT_AUDIO_PREFERENCES.volume
      ),
      muted:
        typeof parsed.muted === "boolean"
          ? parsed.muted
          : DEFAULT_AUDIO_PREFERENCES.muted
    };
  } catch {
    return DEFAULT_AUDIO_PREFERENCES;
  }
}

export function writeDesktopAudioPreferences(
  nextValue: Partial<DesktopAudioPreferences>
) {
  const current = readDesktopAudioPreferences();
  const next: DesktopAudioPreferences = {
    volume: clampVolume(nextValue.volume ?? current.volume),
    muted: nextValue.muted ?? current.muted
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function resetDesktopAudioPreferences() {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(DEFAULT_AUDIO_PREFERENCES)
  );
  return DEFAULT_AUDIO_PREFERENCES;
}
