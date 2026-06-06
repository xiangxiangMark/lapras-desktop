import type React from "react";

import { ChatInputBar } from "../chat/ChatInputBar";
import { ChatMessageList } from "../chat/ChatMessageList";
import type { ChatBubble, PlaylistItem } from "../types";

type ChatSectionProps = {
  messagesRef: React.RefObject<HTMLDivElement>;
  playlistRef: React.RefObject<HTMLDivElement>;
  chatBubbles: ChatBubble[];
  currentUserName: string;
  currentUserAvatarUrl?: string;
  expandedReasoningIds: Set<string>;
  busy: boolean;
  message: string;
  playlistItems: PlaylistItem[];
  playlistPopoverOpen: boolean;
  onToggleReasoning: (messageId: string) => void;
  onMessageChange: (value: string) => void;
  onSubmit: () => void;
  onTogglePlaylistPopover: () => void;
  onPlayFromPlayed: (sourceId: string) => void;
  onPlayFromQueue: (sourceId: string) => void;
};

export function ChatSection({
  messagesRef,
  playlistRef,
  chatBubbles,
  currentUserName,
  currentUserAvatarUrl,
  expandedReasoningIds,
  busy,
  message,
  playlistItems,
  playlistPopoverOpen,
  onToggleReasoning,
  onMessageChange,
  onSubmit,
  onTogglePlaylistPopover,
  onPlayFromPlayed,
  onPlayFromQueue
}: ChatSectionProps) {
  return (
    <section className="chat-section">
      <ChatMessageList
        messagesRef={messagesRef}
        chatBubbles={chatBubbles}
        currentUserName={currentUserName}
        currentUserAvatarUrl={currentUserAvatarUrl}
        expandedReasoningIds={expandedReasoningIds}
        busy={busy}
        onToggleReasoning={onToggleReasoning}
      />
      <ChatInputBar
        message={message}
        busy={busy}
        playlistItems={playlistItems}
        playlistPopoverOpen={playlistPopoverOpen}
        playlistRef={playlistRef}
        onMessageChange={onMessageChange}
        onSubmit={onSubmit}
        onTogglePlaylistPopover={onTogglePlaylistPopover}
        onPlayFromPlayed={onPlayFromPlayed}
        onPlayFromQueue={onPlayFromQueue}
      />
    </section>
  );
}
