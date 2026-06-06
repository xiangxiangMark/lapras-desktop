import { MinimalLaprasAvatar, ShellIcon } from "../primitives";
import type { ChatBubble as ChatBubbleItem } from "../types";

type ChatBubbleProps = {
  item: ChatBubbleItem;
  currentUserName: string;
  currentUserAvatarUrl?: string;
  expanded: boolean;
  onToggleReasoning: (messageId: string) => void;
};

export function ChatBubble({
  item,
  currentUserName,
  currentUserAvatarUrl,
  expanded,
  onToggleReasoning
}: ChatBubbleProps) {
  if (item.role === "assistant") {
    return (
      <article className="desktop-chat-row is-assistant">
        <MinimalLaprasAvatar className="desktop-chat-avatar" />
        <div className="desktop-message-stack">
          <span className="desktop-chat-name">Lapras</span>
          <div className="desktop-chat-bubble">
            <div className={`desktop-chat-mainline ${item.reasoning ? "" : "is-plain"}`.trim()}>
              {item.reasoning ? (
                <button
                  type="button"
                  className={`desktop-chat-expand no-drag ${expanded ? "is-open" : ""}`.trim()}
                  aria-label={expanded ? "收起思考过程" : "展开思考过程"}
                  aria-expanded={expanded}
                  onClick={() => onToggleReasoning(item.id)}
                >
                  <ShellIcon name="chevron" />
                </button>
              ) : null}
              {item.reasoning ? <span className="desktop-chat-divider" aria-hidden="true" /> : null}
              <span className="desktop-chat-text">{item.text}</span>
            </div>
            {item.reasoning && expanded ? (
              <p className="desktop-chat-reasoning">{item.reasoning}</p>
            ) : null}
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="desktop-chat-row is-user">
      <div className="desktop-message-stack">
        <span className="desktop-chat-name">{currentUserName}</span>
        <div className="desktop-chat-bubble">{item.text}</div>
      </div>
      <span className={`desktop-chat-avatar is-user ${currentUserAvatarUrl ? "has-image" : ""}`.trim()}>
        <span className="desktop-chat-avatar-fallback">{currentUserName.slice(0, 1)}</span>
        {currentUserAvatarUrl ? (
          <img
            src={currentUserAvatarUrl}
            alt=""
            draggable={false}
            referrerPolicy="no-referrer"
            onError={(event) => {
              event.currentTarget.parentElement?.classList.remove("has-image");
              event.currentTarget.remove();
            }}
          />
        ) : null}
      </span>
    </article>
  );
}
