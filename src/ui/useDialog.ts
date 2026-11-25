import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** A click this soon after the screen changed under the pointer was aimed at whatever stood there before. */
export const SETTLE_MS = 400;

/**
 * What every dialog over the game needs: focus moves to its main button without scrolling the
 * dialog down to it, Escape closes it, the page behind stops scrolling while it is open, and focus
 * goes back to where it was when the dialog closes.
 *
 * Returns the close handler for the dialog's own button. It ignores a press in the first moments
 * after opening: the second tap of a double tap on "End quarter" lands where the report's button
 * appears, and would dismiss the report unread.
 */
export const useDialog = (onClose: () => void, focusRef: RefObject<HTMLElement | null>): (() => void) => {
  const openedAt = useRef(0);
  // Where focus was, noted as the dialog first renders: once it is on screen the page behind is inert
  // and has already lost its focus.
  const [before] = useState<Element | null>(() => (typeof document === "undefined" ? null : document.activeElement));
  // The latest handler, so a new one from the parent does not reopen the dialog's bookkeeping.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    openedAt.current = performance.now();
    focusRef.current?.focus({ preventScroll: true });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) close.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true });
    };
  }, [focusRef, before]);

  return useCallback(() => {
    if (performance.now() - openedAt.current >= SETTLE_MS) close.current();
  }, []);
};
