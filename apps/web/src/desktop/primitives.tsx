import type { DesktopPlayMode, ShellIconName } from "./types";
import laprasBrandAvatarUrl from "../assets/lapras-brand-avatar.png";
import laprasChatAvatarUrl from "../assets/lapras-chat-avatar.png";

export const modeMeta: Record<DesktopPlayMode, { label: string; icon: ShellIconName }> = {
  companion: { label: "陪伴", icon: "companion" },
  night: { label: "夜间", icon: "night" },
  focus: { label: "专注", icon: "focus" }
};

export function ShellIcon({ name }: { name: ShellIconName }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };

  switch (name) {
    case "pin":
      return (
        <svg {...common}>
          <path d="M8.5 4.5h7" />
          <path d="M10 4.5l.8 6.2-3.2 3.1v1.7h8.8v-1.7l-3.2-3.1.8-6.2" />
          <path d="M12 15.5v4" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19 12a7.7 7.7 0 0 0-.1-1.2l2-1.5-2-3.4-2.4 1a7.2 7.2 0 0 0-2-1.1L14.2 3h-4.4l-.3 2.8a7.2 7.2 0 0 0-2 1.1l-2.4-1-2 3.4 2 1.5A7.7 7.7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.4-1a7.2 7.2 0 0 0 2 1.1l.3 2.8h4.4l.3-2.8a7.2 7.2 0 0 0 2-1.1l2.4 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" />
        </svg>
      );
    case "hide":
      return (
        <svg {...common}>
          <path d="M7 7l10 10" />
          <path d="M17 7L7 17" />
        </svg>
      );
    case "play":
      return (
        <svg {...common}>
          <path d="M9 6v12l9-6z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "pause":
      return (
        <svg {...common}>
          <path d="M9 7v10" />
          <path d="M15 7v10" />
        </svg>
      );
    case "previous":
      return (
        <svg {...common}>
          <path d="M17 7l-7 5 7 5V7z" fill="currentColor" stroke="none" />
          <path d="M7 7v10" />
        </svg>
      );
    case "next":
      return (
        <svg {...common}>
          <path d="M7 7l7 5-7 5V7z" fill="currentColor" stroke="none" />
          <path d="M17 7v10" />
        </svg>
      );
    case "volume":
      return (
        <svg {...common}>
          <path d="M4 10v4h4l5 4V6l-5 4H4z" />
          <path d="M16 9.5a4 4 0 0 1 0 5" />
        </svg>
      );
    case "send":
      return (
        <svg {...common}>
          <path d="M5 12h13" />
          <path d="M13 7l5 5-5 5" />
        </svg>
      );
    case "playlist":
      return (
        <svg {...common}>
          <path d="M5 7h14" />
          <path d="M5 12h10" />
          <path d="M5 17h14" />
        </svg>
      );
    case "chevron":
      return (
        <svg {...common}>
          <path d="M9 6l6 6-6 6" />
        </svg>
      );
    case "focus":
      return (
        <svg {...common}>
          <path d="M8 15h8l1-7H7l1 7z" />
          <path d="M9 19h6" />
          <circle cx="12" cy="5" r="2" />
        </svg>
      );
    case "night":
      return (
        <svg {...common}>
          <path d="M17.7 15.5A7 7 0 0 1 8.5 6.3 7.5 7.5 0 1 0 17.7 15.5z" />
        </svg>
      );
    case "minimize":
      return (
        <svg {...common}>
          <path d="M6 12h12" />
        </svg>
      );
    case "favorite":
      return (
        <svg {...common}>
          <path d="M12 20.2 5.7 14.1a4.5 4.5 0 0 1 6.3-6.4L12 8.1l.1-.4a4.5 4.5 0 0 1 6.2 6.4z" />
        </svg>
      );
    case "info":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <circle cx="12" cy="8" r="0.5" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M8 20v-1.5a4 4 0 0 1 8 0V20" />
          <circle cx="12" cy="9" r="3" />
        </svg>
      );
  }
}

export function MinimalLaprasAvatar({ className = "" }: { className?: string }) {
  return (
    <span className={`minimal-lapras-avatar ${className}`.trim()} aria-hidden="true">
      <img src={laprasChatAvatarUrl} alt="" draggable={false} />
    </span>
  );
}

export function BrandLaprasAvatar({ className = "" }: { className?: string }) {
  return (
    <span className={`minimal-lapras-avatar ${className}`.trim()} aria-hidden="true">
      <img src={laprasBrandAvatarUrl} alt="" draggable={false} />
    </span>
  );
}
