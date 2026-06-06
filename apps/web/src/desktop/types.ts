import type { AppMode, SongDetail } from "@ai-music-companion/shared";

export type ShellIconName =
  | "pin"
  | "settings"
  | "hide"
  | "play"
  | "pause"
  | "previous"
  | "next"
  | "volume"
  | "send"
  | "playlist"
  | "chevron"
  | "companion"
  | "focus"
  | "night"
  | "minimize"
  | "favorite"
  | "info";

export type DesktopPlayMode = "companion" | "night" | "focus";
export type BackendPlayMode = Exclude<AppMode, "discover">;

export type ChatBubble = {
  id: string;
  role: "user" | "assistant";
  text: string;
  reasoning?: string;
};

export type PlaylistItem = {
  id: string;
  song: SongDetail;
  status: "played" | "current" | "upcoming";
};

export type ResizeCorner = "nw" | "ne" | "sw" | "se";

export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};
