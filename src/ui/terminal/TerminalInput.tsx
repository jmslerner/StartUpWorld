import { forwardRef, useCallback, useRef, useState } from "react";

const canUseAudio = () => typeof window !== "undefined" && ("AudioContext" in window || "webkitAudioContext" in window);

const createNoiseBuffer = (ctx: AudioContext) => {
  const durationSeconds = 0.018;
  const length = Math.max(1, Math.floor(ctx.sampleRate * durationSeconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    // Softened noise (more "key" than "hiss")
    data[i] = (Math.random() * 2 - 1) * 0.35;
  }
  return buffer;
};

const shouldSoundForKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key === "Enter" || event.key === "Escape" || event.key === "Tab") return false;
  if (event.key === "Backspace" || event.key === "Delete") return true;
  return event.key.length === 1;
};

const useTypingSound = () => {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const noiseRef = useRef<AudioBuffer | null>(null);
  const lastPlayMsRef = useRef(0);

  const ensureContext = async () => {
    if (!canUseAudio()) return null;
    if (!audioCtxRef.current) {
      const Ctx = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
      audioCtxRef.current = new Ctx();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        // Ignore (browser may block); we just won't play.
      }
    }
    if (!noiseRef.current) noiseRef.current = createNoiseBuffer(ctx);
    return ctx;
  };

  const play = async () => {
    const now = performance.now();
    if (now - lastPlayMsRef.current < 18) return;
    lastPlayMsRef.current = now;

    const ctx = await ensureContext();
    if (!ctx || ctx.state !== "running" || !noiseRef.current) return;

    const source = ctx.createBufferSource();
    source.buffer = noiseRef.current;

    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 900 + Math.random() * 400;

    // Gentle envelope to avoid clicks.
    const t0 = ctx.currentTime;
    const base = 0.0001;
    const peak = 0.05 + Math.random() * 0.02;
    gain.gain.setValueAtTime(base, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.004);
    gain.gain.exponentialRampToValueAtTime(base, t0 + 0.03);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    source.start(t0);
    source.stop(t0 + 0.035);
  };

  return { play };
};

interface TerminalInputProps {
  onSubmit: (value: string) => void;
  isTyping?: boolean;
  fastForward?: () => void;
}

export const TerminalInput = forwardRef<HTMLInputElement, TerminalInputProps>(
  ({ onSubmit, isTyping = false, fastForward }, forwardedRef) => {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const lastValueRef = useRef("");
  const { play } = useTypingSound();
  const [sfxEnabled, setSfxEnabled] = useState(() => {
    try {
      if (typeof window === "undefined") return true;
      const raw = window.localStorage.getItem("startupworld:sfx:typing");
      if (raw === null) return true;
      return raw === "1";
    } catch {
      return true;
    }
  });

  const toggleSfx = () => {
    setSfxEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("startupworld:sfx:typing", next ? "1" : "0");
      } catch {
        // Ignore.
      }
      queueMicrotask(() => inputRef.current?.focus());
      return next;
    });
  };

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
    if (isTyping) {
      fastForward?.();
      queueMicrotask(() => inputRef.current?.focus());
      return;
    }
    if (!value.trim()) {
      return;
    }
    onSubmit(value);
    setValue("");
    lastValueRef.current = "";
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
        onKeyDown={(event) => {
          if (event.key === "Enter" && isTyping) {
            event.preventDefault();
            fastForward?.();
            return;
          }
          if (!shouldSoundForKey(event)) return;
          if (!sfxEnabled) return;
          void play();
        }}
        onChange={(event) => {
          const next = event.target.value;
          // Mobile keyboards may not fire keydown reliably; play when text actually changes.
          if (next !== lastValueRef.current) {
            if (sfxEnabled) void play();
          }
          lastValueRef.current = next;
          setValue(next);
        }}
        className="w-full bg-transparent text-base text-slate-100/90 outline-none caret-neon"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        autoFocus
      />
      <button
        type="button"
        aria-label={sfxEnabled ? "Typing sounds on" : "Typing sounds off"}
        aria-pressed={sfxEnabled}
        onMouseDown={(event) => {
          // Keep focus in the terminal input.
          event.preventDefault();
        }}
        onClick={toggleSfx}
        className={
          sfxEnabled
            ? "shrink-0 rounded-lg bg-neon/10 px-2 py-1 text-[0.65rem] font-semibold text-neon"
            : "shrink-0 rounded-lg bg-steel/30 px-2 py-1 text-[0.65rem] text-mist/80"
        }
        title="Typing sound effects"
      >
        SFX {sfxEnabled ? "ON" : "OFF"}
      </button>
    </form>
  );
});

TerminalInput.displayName = "TerminalInput";
