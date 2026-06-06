import type { LLMDecision, SongDetail } from "@ai-music-companion/shared";

import type { BackendPlayMode, DesktopPlayMode } from "./types";

export function isDesktopRuntime() {
  return Boolean(
    window.lapras?.desktop ||
      window.laprasDesktop?.desktop ||
      /electron/i.test(navigator.userAgent)
  );
}

export function isLocalDesktopServiceUrl(rawUrl?: string | null) {
  if (!rawUrl) {
    return false;
  }

  try {
    const parsed = new URL(rawUrl);
    return new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0"]).has(
      parsed.hostname.toLowerCase()
    );
  } catch {
    return false;
  }
}

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatClock(date: Date) {
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function formatDate(date: Date) {
  return date.toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short"
  });
}

export function songTitle(song?: SongDetail | null) {
  return song?.name || "等待一首歌";
}

export function songArtist(song?: SongDetail | null) {
  return song?.artist || "Lapras";
}

export function songMeta(song?: SongDetail | null) {
  return `${songArtist(song)}${song?.album ? ` · ${song.album}` : ""}`;
}

export function assistantText(decision?: LLMDecision | null) {
  return decision?.reply?.text?.trim() || decision?.say?.trim() || "我在这里。";
}

export function assistantReasoning(decision?: LLMDecision | null) {
  return decision?.reply?.displayReason?.trim() || decision?.reason?.trim() || undefined;
}

export function makeLocalId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getDecisionSignature(decision?: LLMDecision | null) {
  const currentDecision = decision ?? undefined;
  const text = currentDecision?.reply?.text?.trim() || currentDecision?.say?.trim();

  if (!currentDecision || !text) {
    return "";
  }

  return JSON.stringify({
    intent: currentDecision.intent,
    text,
    reason:
      currentDecision.reply?.displayReason?.trim() ||
      currentDecision.reason?.trim() ||
      "",
    segue: currentDecision.segue,
    mode: currentDecision.mode,
    actionType: currentDecision.musicPlan?.action || currentDecision.action.type
  });
}

export function asDesktopMode(mode?: string): DesktopPlayMode {
  if (mode === "focus") {
    return "focus";
  }

  if (mode === "sleep" || mode === "night") {
    return "night";
  }

  return "companion";
}

export function asBackendMode(mode: DesktopPlayMode): BackendPlayMode {
  return mode === "night" ? "sleep" : mode;
}
