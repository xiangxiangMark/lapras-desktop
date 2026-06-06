import type React from "react";

import { MinimalLaprasAvatar } from "../primitives";
import type { ChatBubble as ChatBubbleItem } from "../types";
import { ChatBubble } from "./ChatBubble";

type ChatMessageListProps = {
  messagesRef: React.RefObject<HTMLDivElement>;
  chatBubbles: ChatBubbleItem[];
  currentUserName: string;
  currentUserAvatarUrl?: string;
  expandedReasoningIds: Set<string>;
  busy: boolean;
  onToggleReasoning: (messageId: string) => void;
};

export function ChatMessageList({
  messagesRef,
  chatBubbles,
  currentUserName,
  currentUserAvatarUrl,
  expandedReasoningIds,
  busy,
  onToggleReasoning
}: ChatMessageListProps) {
  return (
    <div className="chat-messages" ref={messagesRef}>
      {chatBubbles.map((item) => (
        <ChatBubble
          key={item.id}
          item={item}
          currentUserName={currentUserName}
          currentUserAvatarUrl={currentUserAvatarUrl}
          expanded={expandedReasoningIds.has(item.id)}
          onToggleReasoning={onToggleReasoning}
        />
      ))}
      {busy ? (
        <article className="desktop-chat-row is-assistant">
          <MinimalLaprasAvatar className="desktop-chat-avatar" />
          <div className="desktop-message-stack">
            <span className="desktop-chat-name">Lapras</span>
            <div className="desktop-chat-bubble">
              <div className="desktop-chat-mainline is-plain">
                <span className="desktop-chat-text">我在整理下一步推荐……</span>
              </div>
            </div>
          </div>
        </article>
      ) : null}
    </div>
  );
}
