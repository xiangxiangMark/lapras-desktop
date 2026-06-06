import { useEffect, useRef } from "react";

import { songArtist, songTitle } from "../utils";
import type { PlaylistItem } from "../types";

type PlaylistPopoverProps = {
  items: PlaylistItem[];
  onPlayFromPlayed: (sourceId: string) => void;
  onPlayFromQueue: (sourceId: string) => void;
};

export function PlaylistPopover({
  items,
  onPlayFromPlayed,
  onPlayFromQueue
}: PlaylistPopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const current = currentRef.current;
    if (container && current) {
      const containerTop = container.getBoundingClientRect().top;
      const currentTop = current.getBoundingClientRect().top;
      const offset = currentTop - containerTop - container.clientHeight / 3;
      container.scrollTop += offset;
    }
  }, []);

  return (
    <div ref={containerRef} className="playlist-popover desktop-floating-panel no-drag">
      {items.length > 0 ? (
        items.map((item) => (
          <div
            key={item.id}
            ref={item.status === "current" ? currentRef : undefined}
            className={`playlist-row is-${item.status}`}
            onClick={() => {
              if (item.status === "played") {
                onPlayFromPlayed(item.song.sourceId);
              } else if (item.status === "upcoming") {
                onPlayFromQueue(item.song.sourceId);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (item.status === "played") {
                  onPlayFromPlayed(item.song.sourceId);
                } else if (item.status === "upcoming") {
                  onPlayFromQueue(item.song.sourceId);
                }
              }
            }}
            role={item.status === "current" ? undefined : "button"}
            tabIndex={item.status === "current" ? undefined : 0}
          >
            <span className="playlist-row-status">
              {item.status === "played"
                ? "刚刚播放"
                : item.status === "current"
                  ? "正在播放"
                  : "即将播放"}
            </span>
            <div className="playlist-row-copy">
              <strong>{songTitle(item.song)}</strong>
              <small>{songArtist(item.song)}</small>
            </div>
          </div>
        ))
      ) : (
        <div className="playlist-empty">当前还没有待播队列。</div>
      )}
    </div>
  );
}
