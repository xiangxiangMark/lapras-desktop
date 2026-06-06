import { useCallback, useRef, useState } from "react";

import { useClickOutside } from "./useClickOutside";

export function useDesktopPopovers() {
  const modeRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef<HTMLDivElement>(null);
  const playlistRef = useRef<HTMLDivElement>(null);

  const [modePopoverOpen, setModePopoverOpen] = useState(false);
  const [volumePopoverOpen, setVolumePopoverOpen] = useState(false);
  const [playlistPopoverOpen, setPlaylistPopoverOpen] = useState(false);

  const closeAllPopovers = useCallback(() => {
    setModePopoverOpen(false);
    setVolumePopoverOpen(false);
    setPlaylistPopoverOpen(false);
  }, []);

  const toggleModePopover = useCallback(() => {
    setPlaylistPopoverOpen(false);
    setVolumePopoverOpen(false);
    setModePopoverOpen((value) => !value);
  }, []);

  const toggleVolumePopover = useCallback(() => {
    setModePopoverOpen(false);
    setPlaylistPopoverOpen(false);
    setVolumePopoverOpen((value) => !value);
  }, []);

  const togglePlaylistPopover = useCallback(() => {
    setModePopoverOpen(false);
    setVolumePopoverOpen(false);
    setPlaylistPopoverOpen((value) => !value);
  }, []);

  useClickOutside(modePopoverOpen, modeRef, closeAllPopovers);
  useClickOutside(volumePopoverOpen, volumeRef, closeAllPopovers);
  useClickOutside(playlistPopoverOpen, playlistRef, closeAllPopovers);

  return {
    modeRef,
    volumeRef,
    playlistRef,
    modePopoverOpen,
    volumePopoverOpen,
    playlistPopoverOpen,
    setModePopoverOpen,
    setVolumePopoverOpen,
    setPlaylistPopoverOpen,
    closeAllPopovers,
    toggleModePopover,
    toggleVolumePopover,
    togglePlaylistPopover
  };
}
