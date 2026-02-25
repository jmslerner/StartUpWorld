import { forwardRef, useCallback, useRef, useState } from "react";

interface TerminalInputProps {
  onSubmit: (value: string) => void;
}

export const TerminalInput = forwardRef<HTMLInputElement, TerminalInputProps>(({ onSubmit }, forwardedRef) => {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const setRefs = useCallback(
    (el: HTMLInputElement | null) => {
      inputRef.current = el;
      if (!forwardedRef) return;
      if (typeof forwardedRef === "function") {
        forwardedRef(el);
        return;
      }
      forwardedRef.current = el;
    },
    [forwardedRef]
  );

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!value.trim()) {
      return;
    }
    onSubmit(value);
    setValue("");
    // Keep the terminal input "always first" even after state updates.
    queueMicrotask(() => inputRef.current?.focus());
  };

  return (
    <form onSubmit={handleSubmit} className="panel-surface flex items-center gap-2 rounded-t-xl rounded-b-none border-b-0 px-3 py-2.5">
      <span className="select-none text-neon" aria-hidden>
        &gt;
      </span>
      <input
        ref={setRefs}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="w-full bg-transparent text-base text-slate-100/90 outline-none caret-neon"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        autoFocus
      />
    </form>
  );
});

TerminalInput.displayName = "TerminalInput";
