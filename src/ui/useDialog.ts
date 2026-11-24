import { useEffect, type RefObject } from "react";

/**
 * What every dialog over the game needs: focus moves to its main button, Escape closes it, and
 * the page behind stops scrolling while it is open.
 */
export const useDialog = (onClose: () => void, focusRef: RefObject<HTMLElement | null>): void => {
  useEffect(() => {
    focusRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, focusRef]);
};
