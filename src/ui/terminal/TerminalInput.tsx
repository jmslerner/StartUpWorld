import { useState } from "react";

interface TerminalInputProps {
  onSubmit: (value: string) => void;
}

export const TerminalInput = ({ onSubmit }: TerminalInputProps) => {
  const [value, setValue] = useState("");

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!value.trim()) {
      return;
    }
    onSubmit(value);
    setValue("");
  };

  return (
    <form onSubmit={handleSubmit} className="panel-surface rounded-xl px-3 py-2">
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="w-full bg-transparent text-sm text-slate-100/90 outline-none placeholder:text-mist/60"
        placeholder="Type a command..."
        autoFocus
      />
    </form>
  );
};
