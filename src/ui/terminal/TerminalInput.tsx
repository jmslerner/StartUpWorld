import { forwardRef, useCallback, useMemo, useRef, useState } from "react";
import { Tooltip } from "../components/Tooltip";

const INPUT_MAX_CHARS = 160;

type SuggestionKind = "command" | "role" | "founder" | "cofounder" | "raise" | "ship" | "launch";
type Suggestion = {
  kind: SuggestionKind;
  label: string;
  nextValue: string;
  tooltip?: string;
};

const commandNames = [
  "help",
  "clear",
  "cls",
  "status",
  "seed",
  "name",
  "company",
  "founder",
  "cofounder",
  "hire",
  "ship",
  "launch",
  "pitch",
  "raise",
  "end",
  "choose",
] as const;

const commandsWithArgs = new Set([
  "seed",
  "name",
  "company",
  "founder",
  "cofounder",
  "hire",
  "ship",
  "launch",
  "raise",
  "choose",
]);

const hireRoleOptions: Array<{ token: string; label: string; tooltip: string }> = [
  { token: "engineering", label: "engineering (eng)", tooltip: "Builds product faster. Increases burn." },
  { token: "eng", label: "eng → engineering", tooltip: "Alias for engineering." },
  { token: "design", label: "design (ux)", tooltip: "Improves UX and feature quality. Increases burn." },
  { token: "ux", label: "ux → design", tooltip: "Alias for design." },
  { token: "marketing", label: "marketing (gtm)", tooltip: "Drives demand and top-of-funnel. Increases burn." },
  { token: "gtm", label: "gtm → marketing", tooltip: "Alias for marketing." },
  { token: "sales", label: "sales (ae)", tooltip: "Turns demand into revenue. Can outpace delivery if over-hired." },
  { token: "ae", label: "ae → sales", tooltip: "Alias for sales." },
  { token: "ops", label: "ops", tooltip: "Reduces churn/drag and keeps the org running. Increases burn." },
  { token: "hr", label: "hr", tooltip: "Helps scale hiring and reduce people issues. Adds process overhead." },
  { token: "legal", label: "legal", tooltip: "Reduces legal risk and contract friction. Increases burn." },
] as const;

const founderOptions = [
  { token: "visionary", tooltip: "Big bets and narrative. Higher upside, higher variance." },
  { token: "hacker", tooltip: "Executes fast. Strong shipping velocity." },
  { token: "sales-animal", tooltip: "Strong GTM instincts. Watch delivery/ops imbalance." },
  { token: "philosopher", tooltip: "Stable and thoughtful. Lower volatility, slower spikes." },
] as const;

const cofounderOptions = [
  { token: "operator", tooltip: "Execution + org health. Good at keeping chaos down." },
  { token: "builder", tooltip: "Product and engineering output. Strong shipping compounding." },
  { token: "rainmaker", tooltip: "GTM + fundraising lift. Can amplify growth when product is ready." },
  { token: "powderkeg", tooltip: "High-intensity swings. Big weeks, risky weeks." },
] as const;

const raiseOptions = ["vc", "friends", "cards", "loan", "preseed", "mortgage"] as const;

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
  const [isFocused, setIsFocused] = useState(false);
  const [dismissedSuggestions, setDismissedSuggestions] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [shipHistory, setShipHistory] = useState<string[]>([]);
  const [launchHistory, setLaunchHistory] = useState<string[]>([]);
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
    const trimmed = value.trim();
    const lower = trimmed.toLowerCase();
    const isClear = lower === "clear" || lower === "cls";

    if (isTyping) {
      // Normally, Enter fast-forwards typing. But `clear` should work immediately.
      if (!isClear) {
        fastForward?.();
        queueMicrotask(() => inputRef.current?.focus());
        return;
      }
    }
    if (!trimmed) {
      return;
    }

    // Record ship/launch names for optional autocomplete later.
    // This does not change gameplay requirements: players can always type new names.
    if (lower.startsWith("ship ")) {
      const name = trimmed.slice(5).trim();
      if (name) {
        setShipHistory((prev) => [name, ...prev.filter((x) => x !== name)].slice(0, 12));
      }
    }
    if (lower.startsWith("launch ")) {
      const name = trimmed.slice(7).trim();
      if (name) {
        setLaunchHistory((prev) => [name, ...prev.filter((x) => x !== name)].slice(0, 12));
      }
    }

    onSubmit(value);
    setValue("");
    lastValueRef.current = "";
    // Keep the terminal input "always first" even after state updates.
    queueMicrotask(() => inputRef.current?.focus());
  };

  const suggestions = useMemo<Suggestion[]>(() => {
    const raw = value;
    const trimmedLeft = raw.replace(/^\s+/, "");
    const endsWithSpace = /\s$/.test(raw);
    const tokens = trimmedLeft.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];

    const cmd = (tokens[0] ?? "").toLowerCase();

    const parts = trimmedLeft.match(/^(\S+)\s*(.*)$/);
    const remainder = (parts?.[2] ?? "").replace(/\s+$/, "");
    const remainderLower = remainder.toLowerCase();

    // Command name suggestions.
    if (tokens.length === 1 && !endsWithSpace) {
      const prefix = cmd;
      return commandNames
        .filter((c) => c.startsWith(prefix) && c !== prefix)
        .slice(0, 8)
        .map((c) => ({
          kind: "command",
          label: c,
          nextValue: commandsWithArgs.has(c) ? `${c} ` : c,
        }));
    }

    // Token suggestions for known commands.
    const argPrefix = (tokens[1] ?? "").toLowerCase();
    if (cmd === "hire") {
      const prefix = tokens.length >= 2 ? argPrefix : "";
      return hireRoleOptions
        .filter((r) => r.token.startsWith(prefix) && r.token !== prefix)
        .slice(0, 10)
        .map((r) => ({
          kind: "role",
          label: r.label,
          nextValue: `hire ${r.token} `,
          tooltip: r.tooltip,
        }));
    }
    if (cmd === "founder") {
      const prefix = tokens.length >= 2 ? argPrefix : "";
      return founderOptions
        .filter((f) => f.token.startsWith(prefix) && f.token !== prefix)
        .slice(0, 8)
        .map((f) => ({
          kind: "founder",
          label: f.token,
          nextValue: `founder ${f.token} `,
          tooltip: f.tooltip,
        }));
    }
    if (cmd === "cofounder") {
      const prefix = tokens.length >= 2 ? argPrefix : "";
      return cofounderOptions
        .filter((c) => c.token.startsWith(prefix) && c.token !== prefix)
        .slice(0, 8)
        .map((c) => ({
          kind: "cofounder",
          label: c.token,
          nextValue: `cofounder ${c.token} `,
          tooltip: c.tooltip,
        }));
    }
    if (cmd === "raise") {
      const prefix = tokens.length >= 2 ? argPrefix : "";
      return raiseOptions
        .filter((r) => r.startsWith(prefix) && r !== prefix)
        .slice(0, 8)
        .map((r) => ({
          kind: "raise",
          label: r,
          nextValue: r === "vc" ? "raise vc " : `raise ${r}`,
          tooltip: r === "vc" ? "Raise from investors (then type an amount)." : "Bootstrap option.",
        }));
    }

    if (cmd === "ship") {
      // Suggest recently shipped feature names (optional convenience).
      if (tokens.length === 1 && !endsWithSpace) return [];
      return shipHistory
        .filter((name) => name.toLowerCase().startsWith(remainderLower) && name.toLowerCase() !== remainderLower)
        .slice(0, 8)
        .map((name) => ({
          kind: "ship",
          label: name,
          nextValue: `ship ${name}`,
          tooltip: "Recent shipped feature (optional suggestion).",
        }));
    }

    if (cmd === "launch") {
      // Suggest recently launched campaign names (optional convenience).
      if (tokens.length === 1 && !endsWithSpace) return [];
      return launchHistory
        .filter((name) => name.toLowerCase().startsWith(remainderLower) && name.toLowerCase() !== remainderLower)
        .slice(0, 8)
        .map((name) => ({
          kind: "launch",
          label: name,
          nextValue: `launch ${name}`,
          tooltip: "Recent launched campaign (optional suggestion).",
        }));
    }

    return [];
  }, [value, shipHistory, launchHistory]);

  const showSuggestions = isFocused && !dismissedSuggestions && suggestions.length > 0;

  const applySuggestion = (suggestion: Suggestion) => {
    setValue(suggestion.nextValue);
    lastValueRef.current = suggestion.nextValue;
    setDismissedSuggestions(false);
    setActiveSuggestionIndex(0);
    queueMicrotask(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const end = suggestion.nextValue.length;
      try {
        el.setSelectionRange(end, end);
      } catch {
        // Ignore.
      }
    });
  };

  return (
    <div className="relative">
      <form onSubmit={handleSubmit} className="panel-surface flex items-center gap-2 rounded-t-xl rounded-b-none border-b-0 px-3 py-2.5">
        <span className="select-none text-neon" aria-hidden>
          &gt;
        </span>
        <input
          ref={setRefs}
          value={value}
          maxLength={INPUT_MAX_CHARS}
          placeholder="help or clear"
          onFocus={() => {
            setIsFocused(true);
            setDismissedSuggestions(false);
          }}
          onBlur={() => {
            setIsFocused(false);
            setDismissedSuggestions(false);
          }}
          onKeyDown={(event) => {
            if (showSuggestions) {
              if (event.key === "Escape") {
                event.preventDefault();
                setDismissedSuggestions(true);
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveSuggestionIndex((prev) => (prev + 1) % suggestions.length);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveSuggestionIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
                return;
              }
              if (event.key === "Tab") {
                event.preventDefault();
                const picked = suggestions[activeSuggestionIndex];
                if (picked) applySuggestion(picked);
                return;
              }
            }

          if (event.key === "Enter" && isTyping) {
            const lower = value.trim().toLowerCase();
            const isClear = lower === "clear" || lower === "cls";
            if (!isClear) {
              event.preventDefault();
              fastForward?.();
              return;
            }
          }
          if (!shouldSoundForKey(event)) return;
          if (!sfxEnabled) return;
          void play();
        }}
          onChange={(event) => {
            const next = event.target.value.slice(0, INPUT_MAX_CHARS);
          // Mobile keyboards may not fire keydown reliably; play when text actually changes.
          if (next !== lastValueRef.current) {
            if (sfxEnabled) void play();
          }
          lastValueRef.current = next;
          setValue(next);
            setDismissedSuggestions(false);
            setActiveSuggestionIndex(0);
        }}
          className="w-full bg-transparent text-base text-slate-100/90 outline-none caret-neon"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
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

      {showSuggestions ? (
        <div className="panel-surface border-t-0 border-b-0 rounded-none px-1 py-1">
          {suggestions.map((s, idx) => {
            const active = idx === activeSuggestionIndex;
            return (
              <button
                key={`${s.kind}:${s.label}:${s.nextValue}`}
                type="button"
                onMouseDown={(event) => {
                  // Keep focus in the input (so mobile keyboard stays up).
                  event.preventDefault();
                }}
                onClick={() => applySuggestion(s)}
                className={
                  active
                    ? "flex w-full items-center justify-between rounded-lg bg-neon/10 px-2 py-1 text-left text-sm text-neon"
                    : "flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-sm text-slate-100/80 hover:bg-white/5"
                }
              >
                {s.tooltip ? (
                  <Tooltip content={s.tooltip} align="right" widthClassName="w-80" className="min-w-0 flex-1">
                    <span className="truncate">{s.label}</span>
                  </Tooltip>
                ) : (
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                )}
                <span className="ml-3 shrink-0 text-[0.7rem] text-mist/60">Tab</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});

TerminalInput.displayName = "TerminalInput";
