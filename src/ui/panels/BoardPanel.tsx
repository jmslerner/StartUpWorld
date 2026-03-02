import type { GameState } from "../../types/game";
import { PanelCard } from "../components/PanelCard";
import { Tooltip } from "../components/Tooltip";
import { PERSONALITY_PROFILES } from "../../engine/board";

export const BoardPanel = ({ state }: { state: GameState }) => {
  if (state.board.members.length === 0) {
    return (
      <PanelCard title="Board">
        <p className="text-center text-mist/50 text-sm">No board yet. A board forms when you raise VC.</p>
      </PanelCard>
    );
  }

  const hostile = state.board.members.filter(m => m.confidence < 40).length;

  return (
    <PanelCard title="Board">
      <div className="space-y-2">
        {state.board.members.map(m => {
          const profile = PERSONALITY_PROFILES[m.personality];
          const barColor = m.confidence >= 70 ? "bg-emerald-400" : m.confidence >= 40 ? "bg-amber-300" : "bg-red-400";
          return (
            <Tooltip key={m.id} content={`${profile.label}: "${profile.tagline}"`} align="right">
              <div className="flex items-center gap-2 text-xs">
                <span className="w-24 truncate text-slate-100/90">{m.name}</span>
                <span className="w-16 text-mist/50">{m.role}</span>
                <div className="flex-1 h-1.5 rounded bg-white/10">
                  <div className={`h-full rounded ${barColor}`} style={{ width: `${m.confidence}%` }} />
                </div>
                <span className="w-8 text-right tabular-nums text-mist/70">{m.confidence}</span>
              </div>
            </Tooltip>
          );
        })}
      </div>
      {hostile > 0 && (
        <p className="mt-2 text-xs text-red-400 border-t border-white/5 pt-2">
          {hostile} hostile director{hostile > 1 ? "s" : ""}. Risk of board action.
        </p>
      )}
    </PanelCard>
  );
};
