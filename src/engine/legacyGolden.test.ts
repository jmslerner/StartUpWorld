import { describe, expect, it } from "vitest";
import goldenText from "./__golden__/legacy-v2.json?raw";
import { compareRun, goldenPlan, runFixture, runLegacyBot } from "./__golden__/legacyBots";
import type { GoldenFile } from "./__golden__/legacyBots";
import { withSlices } from "./tycoon/roster";

// Legacy golden master (TYCOON-SPEC §12.2), recorded on the pre-tycoon engine at d641713.
// CI subset: both legacy bots, 16 founder x cofounder pairs x 2 seeds, up to week 60, plus three
// makeState() fixture sessions. `npm run golden:verify` checks the full recording (12 seeds, 200 weeks).
const golden = JSON.parse(goldenText) as GoldenFile;
const CI_SEEDS = 2;
const CI_WEEKS = 60;

describe("legacy golden master", () => {
  it("replays both legacy bots bit-identically on every legacy field", () => {
    const failures: string[] = [];
    for (const p of goldenPlan(["stock", "wide"], CI_SEEDS)) {
      const recorded = golden.runs.find((r) => r.bot === p.bot && r.founder === p.founder && r.cofounder === p.cofounder && r.seed === p.seed);
      if (!recorded) {
        failures.push(`missing recording for ${p.bot} ${p.founder}+${p.cofounder} seed=${p.seed}`);
        continue;
      }
      const diff = compareRun(recorded, runLegacyBot(p.bot, p.founder, p.cofounder, p.seed, CI_WEEKS), CI_WEEKS);
      if (diff) failures.push(diff);
    }
    expect(failures).toEqual([]);
  });

  it("replays the makeState() fixture sessions bit-identically (the third with empty slices attached)", () => {
    for (const rec of golden.fixtures) {
      // "empty-roster": team counts, slices with no records. The first command mints a job-ad roster that must be invisible.
      expect(runFixture(rec.name, rec.name === "empty-roster" ? withSlices : undefined), rec.name).toEqual(rec);
    }
  });
});
