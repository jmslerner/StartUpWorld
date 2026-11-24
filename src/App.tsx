import { Analytics } from "@vercel/analytics/react";

// Placeholder while the turn-based game is built on this branch (see docs/turn-based-design.md).
const App = () => (
  <div className="flex min-h-[100dvh] items-center justify-center px-4">
    <div className="panel-surface w-full max-w-md rounded-xl px-6 py-8 text-center">
      <h1 className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-neon/80">StartUpWorld</h1>
      <p className="mt-3 text-sm text-mist/80">The turn-based game is being built.</p>
    </div>
    <Analytics />
  </div>
);

export default App;
