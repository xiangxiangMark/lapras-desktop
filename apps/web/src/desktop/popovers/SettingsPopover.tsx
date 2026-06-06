type SettingsPopoverProps = {
  lines: string[];
};

export function SettingsPopover({ lines }: SettingsPopoverProps) {
  return (
    <div className="settings-popover desktop-floating-panel no-drag">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}
