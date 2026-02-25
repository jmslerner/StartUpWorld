import type { GameState } from "../../types/game";
import { clamp } from "../utils";
import { impactMultiplier } from "../volatility";
import type { EventDef } from "./types";

const scaleEventDelta = (s: GameState, delta: number): number => {
  const m = impactMultiplier(s.volatility);
  return Math.round(delta * m);
};

const addCash = (s: GameState, delta: number): GameState => ({ ...s, cash: Math.max(0, s.cash + scaleEventDelta(s, delta)) });
const addUsers = (s: GameState, delta: number): GameState => ({ ...s, users: Math.max(0, s.users + scaleEventDelta(s, delta)) });
const addRep = (s: GameState, delta: number): GameState => ({
  ...s,
  reputation: clamp(s.reputation + scaleEventDelta(s, delta), 0, 100),
});
const addVcRep = (s: GameState, delta: number): GameState => ({
  ...s,
  vcReputation: clamp(s.vcReputation + scaleEventDelta(s, delta), 0, 100),
});

const addTrust = (s: GameState, delta: number): GameState => ({
  ...s,
  cofounder: { ...s.cofounder, trust: clamp(s.cofounder.trust + scaleEventDelta(s, delta), 0, 100) },
});
const addEgo = (s: GameState, delta: number): GameState => ({
  ...s,
  cofounder: { ...s.cofounder, ego: clamp(s.cofounder.ego + scaleEventDelta(s, delta), 0, 100) },
});
const addCohesion = (s: GameState, delta: number): GameState => ({
  ...s,
  culture: { ...s.culture, cohesion: clamp(s.culture.cohesion + scaleEventDelta(s, delta), 0, 100) },
});
const addMorale = (s: GameState, delta: number): GameState => ({
  ...s,
  culture: { ...s.culture, morale: clamp(s.culture.morale + scaleEventDelta(s, delta), 0, 100) },
});

const gameOver = (s: GameState, ending: GameState["gameOver"]): GameState => ({ ...s, gameOver: ending });

export const eventPool: EventDef[] = [
  {
    id: "employee-complaint",
    title: "Employee Complaint",
    prompt: () =>
      "An anonymous report alleges abusive behavior inside the team. People are shaken. A screenshot is one step from becoming a headline.",
    when: (s, ctx) => ctx.teamSize >= 6 && (s.stress >= 55 || s.culture.cohesion <= 62),
    weight: (s, ctx) => {
      const hr = s.team.hr;
      const pressure = (s.stress - 50) / 10 + (65 - s.culture.cohesion) / 10 + (65 - s.culture.morale) / 12;
      const hiringChaos = ctx.hiresThisWeek >= 2 ? 2 : 0;
      const noHrPenalty = hr > 0 ? 0 : 3;
      return 3 + pressure + hiringChaos + noHrPenalty;
    },
    choices: [
      {
        id: "investigate",
        text: "Run a real investigation. Reset expectations. Protect the team.",
        apply: (s) => {
          const hasHr = s.team.hr > 0;
          if (hasHr) {
            const state = addCash(
              addCohesion(addMorale(addRep({ ...s, stress: clamp(s.stress - 4, 0, 100) }, 1), 4), 3),
              -1800
            );
            return {
              state,
              logs: [
                "HR runs the process. It’s uncomfortable. It’s clean.",
                "Cash -$1,800. Morale +4. Cohesion +3. Stress -4. Reputation +1.",
              ],
            };
          }

          const state = addCohesion(
            addMorale(addRep({ ...s, stress: clamp(s.stress + 3, 0, 100) }, -1), -4),
            -3
          );
          return {
            state,
            logs: [
              "You try to DIY the process. It’s messy and everyone notices.",
              "Morale -4. Cohesion -3. Stress +3. Reputation -1.",
            ],
          };
        },
      },
      {
        id: "ignore",
        text: "Ignore it. Velocity > feelings.",
        apply: (s) => ({
          state: addCohesion(addMorale(addRep({ ...s, stress: clamp(s.stress + 6, 0, 100) }, -3), -7), -6),
          logs: [
            "People stop talking in public. They start talking in DMs.",
            "Morale -7. Cohesion -6. Stress +6. Reputation -3.",
          ],
        }),
      },
      {
        id: "statement",
        text: "Make a public statement. Suspend someone. Take the hit now.",
        apply: (s) => ({
          state: addCash(addMorale(addRep({ ...s, stress: clamp(s.stress - 1, 0, 100) }, 1), -1), -4500),
          logs: [
            "You move fast and loudly. Half the internet applauds. Half remembers.",
            "Cash -$4,500. Morale -1. Stress -1. Reputation +1.",
          ],
        }),
      },
    ],
  },

  {
    id: "cease-and-desist",
    title: "Cease & Desist",
    prompt: () =>
      "A law firm sends a letter: they claim you’re infringing on their client. They want you to rebrand or pay. Your inbox is suddenly very quiet.",
    when: (s) => s.week >= 3 && s.users >= 80 && s.reputation >= 18,
    weight: (s) => {
      const legal = s.team.legal;
      const risk = 2 + s.reputation / 18 + s.volatility / 22;
      return risk + (legal > 0 ? 0.8 : 3.2);
    },
    choices: [
      {
        id: "lawyer-up",
        text: "Respond properly. Don’t wing it.",
        apply: (s) => {
          const hasLegal = s.team.legal > 0;
          if (hasLegal) {
            const state = addCash(addRep({ ...s, stress: clamp(s.stress + 1, 0, 100) }, 1), -1200);
            return {
              state,
              logs: [
                "Your legal hire drafts a clean response and buys you breathing room.",
                "Cash -$1,200. Reputation +1. Stress +1.",
              ],
            };
          }

          const state = addCash(addRep({ ...s, stress: clamp(s.stress + 5, 0, 100) }, -2), -6500);
          return {
            state,
            logs: [
              "You hire outside counsel under pressure. The meter runs like a slot machine.",
              "Cash -$6,500. Reputation -2. Stress +5.",
            ],
          };
        },
      },
      {
        id: "settle",
        text: "Settle and move on.",
        apply: (s) => ({
          state: addCash(addRep({ ...s, stress: clamp(s.stress + 2, 0, 100) }, -1), -9000),
          logs: [
            "You pay to make it go away. The product keeps shipping. Your pride doesn’t.",
            "Cash -$9,000. Reputation -1. Stress +2.",
          ],
        }),
      },
      {
        id: "fight",
        text: "Fight publicly. Turn it into marketing.",
        apply: (s) => ({
          state: addRep({ ...s, volatility: clamp(s.volatility + 6, 0, 100), stress: clamp(s.stress + 4, 0, 100) }, 2),
          logs: [
            "You go loud. Attention spikes. So does risk.",
            "Reputation +2. Volatility +6. Stress +4.",
          ],
        }),
      },
    ],
  },

  {
    id: "influencer-driveby",
    title: "Influencer Drive-By",
    prompt: () => "A founder-influencer tweets your product with a half-true story. Traffic is about to hit like a truck.",
    when: (s) => s.week >= 2,
    weight: (s) => 6 + s.volatility / 12,
    choices: [
      {
        id: "scale-now",
        text: "Spin up infra, eat the cost, survive the spike.",
        apply: (s) => ({
          state: addCash(addUsers(addRep(s, 2), 120), -2500),
          logs: ["You throw money at infra. The site stays up. People stick.", "Users +120. Cash -$2,500. Reputation +2."],
        }),
      },
      {
        id: "ride-it",
        text: "Ride it. If it dies, it dies.",
        apply: (s) => ({
          state: addUsers(addRep(s, -2), 220),
          logs: ["You let it rip. It kind of works. It kind of melts.", "Users +220. Reputation -2 (screenshots live forever)."],
        }),
      },
      {
        id: "shape-narrative",
        text: "DM the influencer. Offer context. Risk the ego hit.",
        apply: (s) => ({
          state: addTrust(addRep(s, 1), 2),
          logs: ["You swallow pride and manage the story. It lands cleaner.", "Reputation +1. Cofounder trust +2."],
        }),
      },
    ],
  },

  {
    id: "outage-2am",
    title: "2AM Outage",
    prompt: () => "Everything is down. Pager screams. Your cofounder is online. So is your ego.",
    when: (s) => s.users >= 80,
    weight: (s, ctx) => 5 + ctx.teamSize / 4 + (1 - s.culture.cohesion / 100) * 8,
    choices: [
      {
        id: "war-room",
        text: "War room. Blameless postmortem. Fix the root cause.",
        apply: (s) => ({
          state: addMorale(addTrust(addRep(s, 1), 3), 2),
          logs: ["You run it like adults. The team trusts the process.", "Trust +3. Morale +2. Reputation +1."],
        }),
      },
      {
        id: "blame",
        text: "Find someone to blame. Make an example.",
        apply: (s) => ({
          state: addMorale(addCohesion(addTrust(addRep(s, -1), -6), -8), -6),
          logs: ["You get your villain. You also get fear.", "Trust -6. Cohesion -8. Morale -6. Reputation -1."],
        }),
      },
    ],
  },

  {
    id: "enterprise-pilot",
    title: "Enterprise Pilot",
    prompt: () => "A Fortune 500 wants a pilot. They also want SOC2 yesterday.",
    when: (s) => s.stage !== "garage" && s.users >= 100,
    weight: (s) => 7 + s.reputation / 15,
    choices: [
      {
        id: "say-yes",
        text: "Say yes. Reprioritize everything.",
        apply: (s) => ({
          state: addCash(addVcRep(addRep(s, 2), 2), 6000),
          logs: ["You say yes and your roadmap screams.", "Cash +$6,000 (pilot). Reputation +2. VC rep +2."],
        }),
      },
      {
        id: "say-no",
        text: "Say no. Stay product-led.",
        apply: (s) => ({
          state: addRep(addTrust(s, 1), 1),
          logs: ["You walk away. It hurts. It also keeps you focused.", "Reputation +1. Trust +1."],
        }),
      },
    ],
  },

  {
    id: "leak-rumor",
    title: "Leak Rumor",
    prompt: () => "A screenshot of an internal doc shows up on a competitor’s deck. Coincidence?",
    when: (s) => s.culture.cohesion <= 55,
    weight: (s) => 4 + (60 - s.culture.cohesion) / 4,
    choices: [
      {
        id: "lockdown",
        text: "Lock everything down. Reduce access.",
        apply: (s) => ({
          state: addCohesion(addMorale(addRep(s, -1), -3), -2),
          logs: ["You clamp down. Security improves. So does resentment.", "Morale -3. Cohesion -2. Reputation -1."],
        }),
      },
      {
        id: "trust-but-verify",
        text: "Audit quietly. Keep trust visible.",
        apply: (s) => ({
          state: addCohesion(addTrust(s, 2), 4),
          logs: ["You investigate without theatrics. People feel seen.", "Cohesion +4. Trust +2."],
        }),
      },
    ],
  },

  {
    id: "coup-whispers",
    title: "Coup Whispers",
    prompt: () => "You overhear it: ‘Maybe we need adult supervision.’ Your cofounder isn’t meeting your eyes.",
    when: (s) => s.cofounder.trust <= 30,
    weight: (s) => 3 + (35 - s.cofounder.trust) / 4 + s.cofounder.ego / 25,
    choices: [
      {
        id: "apologize",
        text: "Own your mistakes. Ask for a reset.",
        apply: (s) => ({
          state: addTrust(addEgo(s, -3), 10),
          logs: ["It’s disgusting. It works.", "Trust +10. Ego -3."],
        }),
      },
      {
        id: "double-down",
        text: "Double down. Remind them who started this.",
        apply: (s) => ({
          state: addTrust(addEgo(s, 6), -12),
          logs: ["You win the argument. You lose the room.", "Trust -12. Ego +6."],
        }),
      },
    ],
  },

  {
    id: "acquihire",
    title: "Acqui-hire Offer",
    prompt: () => "A big tech exec calls. ‘We love the team. We don’t love the product.’",
    when: (s, ctx) => s.stage !== "growth" && (ctx.nearBankruptcy || s.stress >= 70),
    weight: (s) => 4 + s.stress / 15,
    choices: [
      {
        id: "take",
        text: "Take the deal. Live to fight later.",
        apply: (s) => ({
          state: gameOver(addCash(s, 150_000), { ending: "acquisition", week: s.week, headline: "Acqui-hired. Product buried. Team survives." }),
          logs: ["You sign. The price is a sentence, not a number.", "Ending unlocked: Acquisition."],
        }),
      },
      {
        id: "refuse",
        text: "Refuse. You’d rather die than be a footnote.",
        apply: (s) => ({
          state: addRep(addMorale(s, 3), 2),
          logs: ["You hang up. The room exhales. The runway doesn’t care.", "Morale +3. Reputation +2."],
        }),
      },
    ],
  },

  {
    id: "press-villain",
    title: "Press Wants a Villain",
    prompt: () => "A reporter wants ‘color’ for a startup chaos piece. You are the color.",
    when: (s) => s.week >= 3,
    weight: (s) => 5 + s.vcReputation / 18 + s.volatility / 20,
    choices: [
      {
        id: "talk",
        text: "Do the interview. Control the narrative.",
        apply: (s) => ({
          state: addVcRep(addRep(s, 3), 2),
          logs: ["You charm them. They still write what they want.", "Reputation +3. VC rep +2."],
        }),
      },
      {
        id: "decline",
        text: "Decline. No comment.",
        apply: (s) => ({
          state: addRep(s, -1),
          logs: ["They quote someone else. It’s worse.", "Reputation -1."],
        }),
      },
    ],
  },

  {
    id: "key-engineer-quit",
    title: "Key Engineer Threatens to Quit",
    prompt: () => "Your best engineer says: ‘I can’t do this pace anymore.’",
    when: (s) => s.team.engineering >= 2 && s.stress >= 55,
    weight: (s) => 4 + (s.stress - 50) / 8,
    choices: [
      {
        id: "raise-comp",
        text: "Raise comp. Buy time.",
        apply: (s) => ({
          state: addCash(addMorale(s, 3), -4000),
          logs: ["You pay the chaos premium.", "Cash -$4,000. Morale +3."],
        }),
      },
      {
        id: "slow-down",
        text: "Slow down. Cut scope. Protect the team.",
        apply: (s) => ({
          state: addMorale(addCohesion(s, 4), 5),
          logs: ["You choose longevity over velocity. It feels adult.", "Cohesion +4. Morale +5."],
        }),
      },
      {
        id: "ignore",
        text: "Ignore it. Everybody hurts.",
        apply: (s) => ({
          state: addMorale(addCohesion(addRep(s, -1), -6), -8),
          logs: ["They stop talking. That’s worse.", "Cohesion -6. Morale -8. Reputation -1."],
        }),
      },
    ],
  },

  {
    id: "competitor-copies",
    title: "Competitor Copies You",
    prompt: () => "A competitor ships your feature list, word-for-word. Their blog post even has your typos.",
    when: (s) => s.week >= 2,
    weight: () => 6,
    choices: [
      {
        id: "ship-faster",
        text: "Ship faster. Let the market choose.",
        apply: (s) => ({
          state: addRep(addMorale(s, -1), 2),
          logs: ["You turn anger into output.", "Reputation +2. Morale -1."],
        }),
      },
      {
        id: "call-out",
        text: "Call them out publicly.",
        apply: (s) => ({
          state: addRep(addVcRep(s, -1), 1),
          logs: ["The thread goes viral. So does the pettiness.", "Reputation +1. VC rep -1."],
        }),
      },
    ],
  },

  {
    id: "ai-demo-viral",
    title: "AI Demo Goes Viral",
    prompt: (s) => `Your ${s.thesis.toUpperCase()} demo hits the right feed. The internet hallucinates product-market fit for you.`,
    when: (s) => s.thesis === "ai" && s.week >= 2,
    weight: (s) => 3 + s.volatility / 10,
    choices: [
      {
        id: "monetize",
        text: "Monetize immediately. Paywalls up.",
        apply: (s) => {
          const nextArpu = clamp(s.arpu + 2, 2, 99);
          return {
            state: addRep({ ...s, arpu: nextArpu }, -1),
            logs: ["You convert hype into revenue. The community hates it.", `ARPU +2 → $${nextArpu}/user. Reputation -1.`],
          };
        },
      },
      {
        id: "ride-hype",
        text: "Ride the hype. Grow users. Raise later.",
        apply: (s) => ({
          state: addUsers(addVcRep(s, 3), 600),
          logs: ["You let the wave carry you.", "Users +600. VC rep +3."],
        }),
      },
      {
        id: "exit",
        text: "Call bankers. Sell the story at the top.",
        apply: (s) => ({
          state: gameOver(addCash(s, 500_000), { ending: "ai-hype-exit", week: s.week, headline: "AI hype exit. You sold the story, not the product." }),
          logs: ["You manufacture an exit out of attention.", "Ending unlocked: AI hype exit."],
        }),
      },
    ],
  },

  {
    id: "culture-memo",
    title: "Culture Memo",
    prompt: () => "Your team wants clarity. Values. A north star. Not vibes.",
    when: (s) => s.week >= 2 && s.culture.cohesion <= 85,
    weight: (s) => 4 + (90 - s.culture.cohesion) / 10,
    choices: [
      {
        id: "write-it",
        text: "Write it. Make it real.",
        apply: (s) => ({
          state: addCohesion(addMorale(s, 4), 6),
          logs: ["You write the memo. It’s corny. It helps.", "Cohesion +6. Morale +4."],
        }),
      },
      {
        id: "ignore",
        text: "Ignore it. Culture is for Series B.",
        apply: (s) => ({
          state: addCohesion(addMorale(s, -3), -5),
          logs: ["You keep sprinting. People keep quitting quietly.", "Cohesion -5. Morale -3."],
        }),
      },
    ],
  },

  {
    id: "regulatory-letter",
    title: "Regulatory Letter",
    prompt: () => "A regulator sends a friendly letter. It reads like a threat.",
    when: (s) => s.users >= 150,
    weight: (s) => 3 + s.users / 150,
    choices: [
      {
        id: "lawyer-up",
        text: "Lawyer up. Pay the bill.",
        apply: (s) => ({
          state: addCash(addRep(s, 1), -6500),
          logs: ["You buy protection.", "Cash -$6,500. Reputation +1 (professionalism)."],
        }),
      },
      {
        id: "ship-around",
        text: "Ship around it. Move fast.",
        apply: (s) => ({
          state: addRep(addVcRep(s, -2), -2),
          logs: ["You gamble. It works until it doesn’t.", "Reputation -2. VC rep -2."],
        }),
      },
    ],
  },

  {
    id: "founder-burnout",
    title: "Founder Burnout",
    prompt: () => "You can’t sleep. You can’t stop. You can’t admit it.",
    when: (s) => s.stress >= 78,
    weight: (s) => 2 + (s.stress - 70) / 8,
    choices: [
      {
        id: "delegate",
        text: "Delegate. Give your cofounder real power.",
        apply: (s) => ({
          state: addTrust(addEgo(addMorale(s, 2), 2), 8),
          logs: ["You share the load. It’s terrifying.", "Trust +8. Cofounder ego +2. Morale +2."],
        }),
      },
      {
        id: "collapse",
        text: "Keep pushing. You’re fine.",
        apply: (s) => ({
          state: gameOver(addMorale(addCohesion(s, -8), -6), { ending: "founder-removal", week: s.week, headline: "Founder removed. The board calls it ‘stability’." }),
          logs: ["Your body calls the meeting you wouldn’t.", "Ending unlocked: Founder removal."],
        }),
      },
    ],
  },

  {
    id: "zombie-saas",
    title: "Zombie SaaS Temptation",
    prompt: () => "A customer offers predictable revenue—if you stop chasing the dream and just… maintain.",
    when: (s) => s.week >= 6 && s.mrr >= 1500,
    weight: (_s, ctx) => 2 + (ctx.usersGrowthRate < 0.02 ? 5 : 0),
    choices: [
      {
        id: "take",
        text: "Take it. Stabilize. Become profitable-ish.",
        apply: (s) => ({
          state: gameOver(addRep({ ...s, volatility: clamp(s.volatility - 10, 0, 100) }, -1), {
            ending: "zombie-saas",
            week: s.week,
            headline: "Zombie SaaS. Comfortable. Quiet. Forever.",
          }),
          logs: ["You pick stability over legend.", "Ending unlocked: Zombie SaaS."],
        }),
      },
      {
        id: "decline",
        text: "Decline. Keep swinging.",
        apply: (s) => ({
          state: addVcRep(s, 1),
          logs: ["You refuse to die slowly.", "VC rep +1."],
        }),
      },
    ],
  },

  {
    id: "bankruptcy-flash",
    title: "Bankruptcy Flash",
    prompt: () => "Payroll is in 72 hours. You do the math again. The math does not change.",
    when: (_s, ctx) => ctx.runwayWeeks <= 1,
    weight: (_s, ctx) => 10 + (2 - ctx.runwayWeeks) * 4,
    choices: [
      {
        id: "cuts",
        text: "Cut burn now. Freeze hires. Cancel everything.",
        apply: (s) => ({
          state: addMorale(addCohesion(addRep(s, -1), -4), -5),
          logs: ["You pull the emergency brake.", "Cohesion -4. Morale -5. Reputation -1."],
        }),
      },
      {
        id: "ride",
        text: "Ride it. Hope next week saves you.",
        apply: (s) => ({
          state: gameOver(s, { ending: "bankruptcy", week: s.week, headline: "Bankruptcy. The lights go out." }),
          logs: ["You roll the dice with payroll.", "Ending unlocked: Bankruptcy."],
        }),
      },
    ],
  },

  {
    id: "advisor-intro",
    title: "Advisor Intro",
    prompt: () => "A legendary operator offers 30 minutes. They don’t do ‘updates’.",
    when: (s) => s.week >= 2,
    weight: () => 5,
    choices: [
      {
        id: "take-notes",
        text: "Take brutal feedback. Apply it.",
        apply: (s) => ({
          state: addVcRep(addRep(s, 2), 2),
          logs: ["You get torn apart. You get better.", "Reputation +2. VC rep +2."],
        }),
      },
      {
        id: "perform",
        text: "Perform confidence. Don’t show weakness.",
        apply: (s) => ({
          state: addVcRep(addTrust(s, -2), -1),
          logs: ["They see through it.", "VC rep -1. Trust -2."],
        }),
      },
    ],
  },

  {
    id: "poached",
    title: "Poached",
    prompt: () => "A FAANG recruiter pings your teammate. It’s not subtle.",
    when: (s) => Object.values(s.team).some((n) => n >= 2),
    weight: (s) => 4 + (1 - s.culture.morale / 100) * 6,
    choices: [
      {
        id: "counter",
        text: "Counter-offer. Pay them.",
        apply: (s) => ({
          state: addCash(addMorale(s, 2), -3500),
          logs: ["You pay the retention tax.", "Cash -$3,500. Morale +2."],
        }),
      },
      {
        id: "mission",
        text: "Sell the mission.",
        apply: (s) => ({
          state: addMorale(addCohesion(s, 3), 2),
          logs: ["You remind them why this matters.", "Cohesion +3. Morale +2."],
        }),
      },
      {
        id: "let-go",
        text: "Let them go. Protect the runway.",
        apply: (s) => ({
          state: addMorale(addCohesion(addRep(s, -1), -2), -3),
          logs: ["You say the quiet part out loud: no one is irreplaceable.", "Morale -3. Cohesion -2. Reputation -1."],
        }),
      },
    ],
  },

  {
    id: "board-seat-fight",
    title: "Board Seat Fight",
    prompt: () => "An investor offers capital… with a board seat and ‘operational oversight.’",
    when: (s) => s.stage !== "garage" && s.vcReputation >= 15,
    weight: (s) => 3 + s.vcReputation / 20 + s.volatility / 25,
    choices: [
      {
        id: "accept",
        text: "Accept. Take the money and the leash.",
        apply: (s) => ({
          state: addCash(addVcRep(addTrust(s, -4), 2), 80_000),
          logs: ["The wire hits. Your autonomy doesn’t.", "Cash +$80,000. VC rep +2. Trust -4."],
        }),
      },
      {
        id: "refuse",
        text: "Refuse. Keep control.",
        apply: (s) => ({
          state: addVcRep(addEgo(s, 3), -2),
          logs: ["You keep the wheel. You also keep the risk.", "Cofounder ego +3. VC rep -2."],
        }),
      },
    ],
  },

  {
    id: "numbers-game",
    title: "The Numbers Game",
    prompt: () => "Someone suggests it quietly: ‘We can make the growth chart look… cleaner.’",
    when: (s) => s.stage !== "garage" && s.vcReputation >= 20,
    weight: (s) => 2 + s.vcReputation / 30 + s.stress / 30,
    choices: [
      {
        id: "clean-it",
        text: "Do it. Smooth the metrics. Raise faster.",
        apply: (s) => ({
          state: addVcRep(addRep(addTrust(s, -6), -2), 6),
          logs: ["You polish the story until it lies.", "VC rep +6 (short-term). Reputation -2. Trust -6."],
        }),
      },
      {
        id: "refuse",
        text: "Refuse. Truth only.",
        apply: (s) => ({
          state: addTrust(addCohesion(s, 4), 3),
          logs: ["You choose pain now over ruin later.", "Cohesion +4. Trust +3."],
        }),
      },
    ],
  },

  {
    id: "ipo-window",
    title: "IPO Window",
    prompt: () => "Banks call it a ‘window.’ It feels like a trap door with gold light behind it.",
    when: (s) => s.companyPhase === "public" && s.mrr >= 250_000,
    weight: () => 20,
    choices: [
      {
        id: "go-public",
        text: "File. Go public.",
        apply: (s) => ({
          state: gameOver(s, { ending: "ipo", week: s.week, headline: "IPO. You made it. Now you answer to the market." }),
          logs: ["The bell rings. Your inbox fills with new kinds of fear.", "Ending unlocked: IPO."],
        }),
      },
      {
        id: "hold",
        text: "Hold. Stay private.",
        apply: (s) => ({
          state: addVcRep(addRep(s, 1), -2),
          logs: ["You wait. Sometimes waiting is courage. Sometimes it’s procrastination.", "Reputation +1. VC rep -2."],
        }),
      },
    ],
  },
];
