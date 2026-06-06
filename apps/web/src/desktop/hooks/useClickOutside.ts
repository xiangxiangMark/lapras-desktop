import { useEffect, type RefObject } from "react";

export function useClickOutside<T extends HTMLElement>(
  active: boolean,
  ref: RefObject<T | null>,
  onOutside: () => void
) {
  useEffect(() => {
    if (!active) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;

      if (target && ref.current && !ref.current.contains(target)) {
        onOutside();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [active, onOutside, ref]);
}
