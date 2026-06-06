import { modeMeta, ShellIcon } from "../primitives";
import type { DesktopPlayMode } from "../types";

type ModePopoverProps = {
  currentMode: DesktopPlayMode;
  onSwitchMode: (mode: DesktopPlayMode) => void;
};

export function ModePopover({ currentMode, onSwitchMode }: ModePopoverProps) {
  return (
    <div className="mode-popover desktop-floating-panel no-drag">
      {(Object.keys(modeMeta) as DesktopPlayMode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          className={currentMode === mode ? "is-active" : ""}
          onClick={() => onSwitchMode(mode)}
        >
          <ShellIcon name={modeMeta[mode].icon} />
          <span>{modeMeta[mode].label}</span>
        </button>
      ))}
    </div>
  );
}
