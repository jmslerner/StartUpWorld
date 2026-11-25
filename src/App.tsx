import { Analytics } from "@vercel/analytics/react";
import { gameStore, useGame } from "./state/useGame";
import { moneyInBillions } from "./ui/format";
import { EndScreen } from "./ui/screens/EndScreen";
import { GameScreen } from "./ui/screens/GameScreen";
import { NewGameScreen } from "./ui/screens/NewGameScreen";

// A career's money reads in billions from $1B; the race's never does. Set before any screen reads the new state.
moneyInBillions(gameStore.getState().config.career !== undefined);
gameStore.subscribe((state) => moneyInBillions(state.config.career !== undefined));

/** Which screen is up: no game yet, a game in progress (with its report after each year or quarter), or a finished one. */
const Screen = () => {
  const playing = useGame((state) => state.game !== null && state.draft !== null);
  const over = useGame((state) => state.over);
  // The last year's or quarter's report is read first; closing it reveals the ending.
  const reading = useGame((state) => state.reportOpen && state.lastLog !== null);
  // A year or quarter that could not be played goes to the crash screen, which can clear the save and start over.
  const failure = useGame((state) => state.failure);
  if (failure !== null) throw failure;
  if (!playing) return <NewGameScreen />;
  if (over && !reading) return <EndScreen />;
  return <GameScreen />;
};

const App = () => (
  <>
    <Screen />
    <Analytics />
  </>
);

export default App;
