import type React from "react";

import { PlaylistPopover } from "../popovers/PlaylistPopover";
import { ShellIcon } from "../primitives";
import type { PlaylistItem } from "../types";

type ChatInputBarProps = {
  message: string;
  busy: boolean;
  playlistItems: PlaylistItem[];
  playlistPopoverOpen: boolean;
  playlistRef: React.RefObject<HTMLDivElement>;
  onMessageChange: (value: string) => void;
  onSubmit: () => void;
  onTogglePlaylistPopover: () => void;
  onPlayFromPlayed: (sourceId: string) => void;
  onPlayFromQueue: (sourceId: string) => void;
};

export function ChatInputBar({
  message,
  busy,
  playlistItems,
  playlistPopoverOpen,
  playlistRef,
  onMessageChange,
  onSubmit,
  onTogglePlaylistPopover,
  onPlayFromPlayed,
  onPlayFromQueue
}: ChatInputBarProps) {
  return (
    <form
      className="desktop-prompt no-drag"
      onSubmit={(event) => {
        event.preventDefault();
        if (!message.trim() || busy) return;
        onSubmit();
      }}
    >
      <textarea
        className="no-drag"
        value={message}
        onChange={(event) => onMessageChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder="告诉 Lapras 你现在想听什么……"
        rows={1}
      />
      <div className="desktop-popover-anchor no-drag" ref={playlistRef}>
        <button
          type="button"
          className={`desktop-prompt-action no-drag ${playlistPopoverOpen ? "is-active" : ""}`}
          title="播放列表"
          onClick={onTogglePlaylistPopover}
        >
          <ShellIcon name="playlist" />
        </button>
        {playlistPopoverOpen ? (
          <PlaylistPopover
            items={playlistItems}
            onPlayFromPlayed={onPlayFromPlayed}
            onPlayFromQueue={onPlayFromQueue}
          />
        ) : null}
      </div>
      <button
        type="submit"
        className="desktop-prompt-submit no-drag"
        disabled={busy || !message.trim()}
        title="发送"
      >
        <ShellIcon name="send" />
      </button>
    </form>
  );
}
