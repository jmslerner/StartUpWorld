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
const addStress = (s: GameState, delta: number): GameState => ({ ...s, stress: clamp(s.stress + delta, 0, 100) });
const addVolatility = (s: GameState, delta: number): GameState => ({ ...s, volatility: clamp(s.volatility + delta, 0, 100) });
const addAp = (s: GameState, delta: number): GameState => ({ ...s, ap: clamp(s.ap + delta, 0, 6) });

const ts = (s: GameState): number => Object.values(s.team).reduce((a, n) => a + n, 0);

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
      const risk = 1.5 + s.reputation / 35 + s.volatility / 40;
      return risk + (legal > 0 ? 0.5 : 2);
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
    weight: (s) => 2 + Math.min(s.users / 400, 2),
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
        apply: (s) => {
          let next = addCash(addVcRep(addTrust(s, -4), 2), 80_000);
          // If board exists, the new investor director’s confidence starts moderate
          if (next.board.members.length > 0) {
            const members = next.board.members.map(m =>
              m.role === "investor" ? { ...m, confidence: Math.max(m.confidence, 55) } : m
            );
            next = { ...next, board: { ...next.board, members } };
          }
          return {
            state: next,
            logs: ["The wire hits. Your autonomy doesn’t.", "Cash +$80,000. VC rep +2. Trust -4."],
          };
        },
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
    id: "board-power-play",
    title: "Board Power Play",
    prompt: () =>
      "An investor director calls an off-cycle meeting. They want ‘strategic realignment’ — code for taking control of product decisions.",
    when: (s) => s.board.members.length >= 3 && s.board.members.some(m => m.role === "investor" && m.confidence < 55),
    weight: (s) => {
      const lowConf = s.board.members.filter(m => m.confidence < 50).length;
      return 4 + lowConf * 2 + s.stress / 25;
    },
    choices: [
      {
        id: "comply",
        text: "Comply. Give them what they want.",
        apply: (s) => {
          const members = s.board.members.map(m =>
            m.role !== "founder" ? { ...m, confidence: clamp(m.confidence + 8, 0, 100) } : m
          );
          return {
            state: addRep({ ...s, board: { ...s.board, members }, ap: Math.max(0, s.ap - 1) }, -3),
            logs: ["You cede ground. The board relaxes — for now.", "All board confidence +8. Reputation -3. AP -1."],
          };
        },
      },
      {
        id: "push-back",
        text: "Push back. This is your company.",
        apply: (s) => {
          const members = s.board.members.map(m =>
            m.role === "investor" ? { ...m, confidence: clamp(m.confidence - 10, 0, 100) } : m
          );
          return {
            state: addTrust(addEgo({ ...s, board: { ...s.board, members } }, 4), -3),
            logs: ["You hold your ground. The investors remember.", "Investor confidence -10. Ego +4. Trust -3."],
          };
        },
      },
      {
        id: "compromise",
        text: "Compromise. Offer a quarterly review process.",
        apply: (s) => {
          const members = s.board.members.map(m =>
            m.role !== "founder" ? { ...m, confidence: clamp(m.confidence + 3, 0, 100) } : m
          );
          return {
            state: { ...s, board: { ...s.board, members } },
            logs: ["You agree to more transparency. Everyone saves face.", "All board confidence +3."],
          };
        },
      },
    ],
  },

  {
    id: "board-quarterly-review",
    title: "Quarterly Board Review",
    prompt: (s) => {
      const hostile = s.board.members.filter(m => m.confidence < 40).length;
      return hostile > 0
        ? "The quarterly board meeting arrives. The mood is tense. Directors want answers about performance."
        : "The quarterly board meeting arrives. Time to present results and field questions.";
    },
    when: (s) => s.board.members.length >= 3 && s.week - s.board.lastMeetingWeek >= 8,
    weight: () => 6,
    choices: [
      {
        id: "present-honestly",
        text: "Present honestly. Numbers speak for themselves.",
        apply: (s, ctx) => {
          const good = ctx.mrrGrowthRate > 0.02 && ctx.runwayWeeks > 8;
          const delta = good ? 7 : -10;
          const members = s.board.members.map(m =>
            m.role !== "founder" ? { ...m, confidence: clamp(m.confidence + delta, 0, 100) } : m
          );
          const logs = good
            ? ["The numbers land well. Directors nod approvingly.", `All board confidence +${delta}.`]
            : ["The numbers are ugly. Silence in the room.", `All board confidence ${delta}.`];
          return {
            state: { ...s, board: { ...s.board, members, lastMeetingWeek: s.week } },
            logs,
          };
        },
      },
      {
        id: "spin-the-narrative",
        text: "Spin the narrative. Emphasize the vision.",
        apply: (s) => {
          const members = s.board.members.map(m => {
            if (m.role === "founder") return m;
            // Cheerleaders buy it, activists see through it
            const mod = m.personality === "cheerleader" ? 5 : m.personality === "activist" ? -6 : 0;
            return { ...m, confidence: clamp(m.confidence + mod, 0, 100) };
          });
          return {
            state: addRep({ ...s, board: { ...s.board, members, lastMeetingWeek: s.week } }, -2),
            logs: ["You paint a picture. Some buy it. Some don’t.", "Cheerleader confidence +5. Activist confidence -6. Reputation -2."],
          };
        },
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
    id: "wellness-stipend-arms-race",
    title: "Wellness Stipend Arms Race",
    prompt: () => "Someone proposes a ‘wellness stipend.’ The first link is a $2,000 chair.",
    when: (s, ctx) => ctx.teamSize >= 5 && s.cash >= 6000 && (s.culture.morale <= 82 || s.stress >= 55),
    weight: (s, ctx) => 3 + (85 - s.culture.morale) / 12 + (s.stress - 45) / 18 + ctx.burnIntensity * 2,
    choices: [
      {
        id: "approve",
        text: "Approve it. Happiness-as-a-line-item.",
        apply: (s) => ({
          state: addCash(addMorale(addCohesion(s, 1), 2), -2200),
          logs: ["The team gets shinier gear. You get a shinier burn chart.", "Cash -$2,200. Morale +2. Cohesion +1."],
        }),
      },
      {
        id: "cap",
        text: "Cap it hard. Receipts required.",
        apply: (s) => ({
          state: addMorale(addRep(s, 1), -1),
          logs: ["You turn wellness into paperwork. Extremely calming.", "Morale -1. Reputation +1 (adulting)."],
        }),
      },
      {
        id: "no",
        text: "No. We have ‘mission’ at home.",
        apply: (s) => ({
          state: addMorale(addTrust({ ...s, stress: clamp(s.stress + 2, 0, 100) }, -2), -3),
          logs: ["You say no. Everyone updates their LinkedIn quietly.", "Morale -3. Trust -2. Stress +2."],
        }),
      },
    ],
  },

  {
    id: "swag-palooza",
    title: "Swag Palooza",
    prompt: () => "A pallet of branded hoodies arrives. There are… so many hoodies.",
    when: (s, ctx) => s.week >= 2 && s.cash >= 4500 && ctx.hiresThisWeek >= 1,
    weight: (_s, ctx) => 4 + ctx.teamSize / 6 + ctx.hiresThisWeek * 2,
    choices: [
      {
        id: "hand-out",
        text: "Hand it out. Turn employees into billboards.",
        apply: (s) => ({
          state: addCash(addMorale(addRep(s, 1), 2), -1400),
          logs: ["The office looks like a merch table. Vibes improve.", "Cash -$1,400. Morale +2. Reputation +1."],
        }),
      },
      {
        id: "donate",
        text: "Donate it quietly. Pretend it was intentional.",
        apply: (s) => ({
          state: addCash(addRep(addTrust(s, 1), 2), -700),
          logs: ["You do a good deed and a good PR seed.", "Cash -$700. Reputation +2. Trust +1."],
        }),
      },
      {
        id: "save-for-investors",
        text: "Save it for investors. Nothing says ‘moat’ like fleece.",
        apply: (s) => ({
          state: addCash(addVcRep(s, 1), -900),
          logs: ["You stockpile swag for a future that may never happen.", "Cash -$900. VC rep +1."],
        }),
      },
    ],
  },

  {
    id: "offsite-vineyard",
    title: "Offsite: Vineyard Edition",
    prompt: () => "Someone books an ‘alignment offsite.’ It appears to be mostly wine and slides.",
    when: (s, ctx) => ctx.teamSize >= 6 && s.cash >= 10_000,
    weight: (s, ctx) => 2 + (70 - s.culture.cohesion) / 10 + ctx.burnIntensity * 2,
    choices: [
      {
        id: "go-big",
        text: "Go big. Heal through catered carbs.",
        apply: (s) => ({
          state: addCash(addCohesion(addMorale({ ...s, stress: clamp(s.stress - 3, 0, 100) }, 2), 6), -5200),
          logs: ["You buy alignment in bulk. It works… for a week.", "Cash -$5,200. Cohesion +6. Morale +2. Stress -3."],
        }),
      },
      {
        id: "cheap",
        text: "Do a cheap offsite. Walks and honesty.",
        apply: (s) => ({
          state: addCash(addCohesion(addMorale(s, 1), 3), -900),
          logs: ["You talk like humans. Nobody posts about it, but it helps.", "Cash -$900. Cohesion +3. Morale +1."],
        }),
      },
      {
        id: "cancel",
        text: "Cancel it. Ship instead.",
        apply: (s) => ({
          state: addMorale(addCohesion({ ...s, stress: clamp(s.stress + 2, 0, 100) }, -2), -2),
          logs: ["You pick output over feelings. Feelings notice.", "Morale -2. Cohesion -2. Stress +2."],
        }),
      },
    ],
  },

  {
    id: "reorg-without-headcount",
    title: "Reorg Without Headcount",
    prompt: () => "A calendar invite appears: ‘Org Design Working Session.’ You have eight people and three layers.",
    when: (s, ctx) => ctx.teamSize >= 5 && s.week >= 3,
    weight: (s, ctx) => 3 + (100 - s.culture.cohesion) / 25 + (ctx.hiresThisWeek >= 2 ? 2 : 0),
    choices: [
      {
        id: "titles",
        text: "Hand out titles. Create ‘leverage’.",
        apply: (s) => ({
          state: addCohesion(addEgo(addTrust(s, -3), 4), -4),
          logs: ["Everyone gets a new title. Nobody gets new clarity.", "Cohesion -4. Trust -3. Cofounder ego +4."],
        }),
      },
      {
        id: "roles",
        text: "Define roles and decision rights. Boring, effective.",
        apply: (s) => ({
          state: addCohesion(addTrust(addRep(s, 1), 2), 5),
          logs: ["You write it down. You enforce it. People exhale.", "Cohesion +5. Trust +2. Reputation +1."],
        }),
      },
      {
        id: "ignore",
        text: "Ignore it. Everyone can do everything.",
        apply: (s) => ({
          state: addCohesion(addMorale({ ...s, stress: clamp(s.stress + 4, 0, 100) }, -2), -3),
          logs: ["You keep it ‘flat.’ It becomes ‘chaotic.’", "Cohesion -3. Morale -2. Stress +4."],
        }),
      },
    ],
  },

  {
    id: "founder-podcast-canceled",
    title: "Founder Podcast ‘Hot Take’",
    prompt: () => "You say one spicy sentence on a podcast. A clip goes viral. Context does not.",
    when: (s) => s.week >= 4 && s.reputation >= 10,
    weight: (s) => 2 + s.reputation / 25 + s.volatility / 20,
    choices: [
      {
        id: "apologize",
        text: "Apologize clearly. Own it.",
        apply: (s) => ({
          state: addRep(addTrust({ ...s, stress: clamp(s.stress + 1, 0, 100) }, 1), 1),
          logs: ["You eat crow with a knife and fork. Some people respect it.", "Reputation +1. Trust +1. Stress +1."],
        }),
      },
      {
        id: "double-down",
        text: "Double down. Engagement is engagement.",
        apply: (s) => ({
          state: addUsers(addRep({ ...s, volatility: clamp(s.volatility + 8, 0, 100) }, -6), 60),
          logs: ["Your mentions explode. So does the damage.", "Users +60. Reputation -6. Volatility +8."],
        }),
      },
      {
        id: "go-dark",
        text: "Go dark. No statements.",
        apply: (s) => ({
          state: addRep(addMorale(s, -2), -3),
          logs: ["Silence is a strategy. It is not always a good one.", "Reputation -3. Morale -2."],
        }),
      },
    ],
  },

  {
    id: "growth-hack-backfires",
    title: "Growth Hack Backfires",
    prompt: () => "A ‘viral loop’ ships. It also spams people who did not ask.",
    when: (s) => s.users >= 60 && s.week >= 3,
    weight: (s, ctx) => 4 + ctx.usersGrowthRate * 5 + (s.reputation < 25 ? 2 : 0),
    choices: [
      {
        id: "roll-back",
        text: "Roll it back. Fix it properly.",
        apply: (s) => ({
          state: addUsers(addRep(addTrust(s, 1), 2), -20),
          logs: ["You undo the damage and apologize in-product.", "Users -20. Reputation +2. Trust +1."],
        }),
      },
      {
        id: "keep-it",
        text: "Keep it. Numbers first.",
        apply: (s) => ({
          state: addUsers(addRep({ ...s, stress: clamp(s.stress + 2, 0, 100) }, -5), 120),
          logs: ["The chart goes up. The sentiment goes down.", "Users +120. Reputation -5. Stress +2."],
        }),
      },
      {
        id: "toggle",
        text: "Add an opt-out toggle. Pretend it was always the plan.",
        apply: (s) => ({
          state: addUsers(addRep(s, 1), 40),
          logs: ["You keep some lift and regain some trust.", "Users +40. Reputation +1."],
        }),
      },
    ],
  },

  {
    id: "dark-pattern-debate",
    title: "Dark Pattern Debate",
    prompt: () => "A PM suggests ‘improving conversion’ with a checkbox that is… already checked.",
    when: (s) => s.stage !== "garage" && s.users >= 120,
    weight: (s) => 3 + (30 - s.reputation) / 15 + s.stress / 40,
    choices: [
      {
        id: "ship",
        text: "Ship it. Pretend it’s UX.",
        apply: (s) => ({
          state: addUsers(addRep(addTrust(s, -2), -4), 140),
          logs: ["Conversion pops. So do the angry threads.", "Users +140. Reputation -4. Trust -2."],
        }),
      },
      {
        id: "dont",
        text: "Don’t. Keep it clean.",
        apply: (s) => ({
          state: addRep(addCohesion(s, 2), 2),
          logs: ["You choose long-term trust over short-term graphs.", "Reputation +2. Cohesion +2."],
        }),
      },
    ],
  },

  {
    id: "data-leak-screenshot",
    title: "Screenshot of a Data Leak",
    prompt: () => "A customer posts a screenshot that looks like… someone else’s data.",
    when: (s) => s.users >= 140 && s.week >= 5,
    weight: (s) => 2 + s.users / 120 + (s.team.ops > 0 ? 0 : 3),
    choices: [
      {
        id: "incident",
        text: "Treat it like an incident. Patch, notify, postmortem.",
        apply: (s) => ({
          state: addCash(addRep(addTrust({ ...s, stress: clamp(s.stress + 2, 0, 100) }, 1), 2), -3500),
          logs: ["You do the painful adult thing.", "Cash -$3,500. Reputation +2. Trust +1. Stress +2."],
        }),
      },
      {
        id: "bury",
        text: "Bury it. Say nothing.",
        apply: (s) => ({
          state: addUsers(addRep({ ...s, volatility: clamp(s.volatility + 10, 0, 100) }, -8), -60),
          logs: ["It comes out anyway. It always comes out.", "Users -60. Reputation -8. Volatility +10."],
        }),
      },
    ],
  },

  {
    id: "cloud-bill-surprise",
    title: "Cloud Bill Surprise",
    prompt: () => "The cloud bill arrives. It is… interpretive.",
    when: (s) => s.week >= 3 && s.users >= 80,
    weight: (_s, ctx) => 4 + ctx.usersGrowthRate * 6 + ctx.burnIntensity * 2,
    choices: [
      {
        id: "optimize",
        text: "Optimize ruthlessly. Cost is a feature.",
        apply: (s) => ({
          state: addCash(addRep({ ...s, stress: clamp(s.stress + 2, 0, 100) }, 1), -1800),
          logs: ["You cut spend and ship better discipline.", "Cash -$1,800. Reputation +1. Stress +2."],
        }),
      },
      {
        id: "shrug",
        text: "Shrug and pay. Future-you can cry later.",
        apply: (s) => ({
          state: addCash({ ...s, stress: clamp(s.stress + 3, 0, 100) }, -5200),
          logs: ["You buy time with money.", "Cash -$5,200. Stress +3."],
        }),
      },
    ],
  },

  {
    id: "payments-freeze",
    title: "Payments Processor Freeze",
    prompt: () => "Your payments processor emails: ‘We’ve detected unusual activity.’ Funds are now ‘reviewing.’",
    when: (s) => s.stage !== "garage" && s.week >= 6,
    weight: (s, ctx) => 2 + (ctx.nearBankruptcy ? 4 : 0) + s.volatility / 18,
    choices: [
      {
        id: "comply",
        text: "Comply instantly. Over-document everything.",
        apply: (s) => ({
          state: addCash(addRep({ ...s, stress: clamp(s.stress + 2, 0, 100) }, 1), -1200),
          logs: ["You send receipts, policies, and a small novel.", "Cash -$1,200. Reputation +1. Stress +2."],
        }),
      },
      {
        id: "rant",
        text: "Rant publicly. Tag them.",
        apply: (s) => ({
          state: addRep({ ...s, volatility: clamp(s.volatility + 6, 0, 100), stress: clamp(s.stress + 3, 0, 100) }, -2),
          logs: ["You go viral among founders. The processor is not charmed.", "Reputation -2. Volatility +6. Stress +3."],
        }),
      },
    ],
  },

  {
    id: "ai-pivot-week",
    title: "AI Pivot Week",
    prompt: () => "Investors ask the question: ‘Where is the AI?’ It is suddenly the whole meeting.",
    when: (s) => s.week >= 4,
    weight: (s) => 3 + s.vcReputation / 25 + s.volatility / 30,
    choices: [
      {
        id: "slap-on",
        text: "Slap ‘AI’ on the deck. Ship a demo.",
        apply: (s) => ({
          state: addVcRep(addRep({ ...s, volatility: clamp(s.volatility + 5, 0, 100) }, -1), 3),
          logs: ["The demo works on your laptop and in exactly one pitch meeting.", "VC rep +3. Reputation -1. Volatility +5."],
        }),
      },
      {
        id: "real",
        text: "Do it properly. Slow down.",
        apply: (s) => ({
          state: addVcRep(addRep(addCash({ ...s, stress: clamp(s.stress + 2, 0, 100) }, -1800), 1), 1),
          logs: ["You invest in reality. It’s slower and it sticks.", "Cash -$1,800. Reputation +1. VC rep +1. Stress +2."],
        }),
      },
      {
        id: "nope",
        text: "Say no. We’re not doing theater.",
        apply: (s) => ({
          state: addVcRep(addTrust(s, 1), -2),
          logs: ["You keep focus. You lose some hype.", "VC rep -2. Trust +1."],
        }),
      },
    ],
  },

  {
    id: "press-hit-piece",
    title: "Press Hit Piece",
    prompt: () => "A journalist DMs: ‘Quick questions.’ The next day, your company is a villain in 900 words.",
    when: (s) => s.week >= 5 && s.reputation >= 12,
    weight: (s) => 2 + s.reputation / 20 + s.volatility / 25,
    choices: [
      {
        id: "respond",
        text: "Respond carefully. Receipts, not rage.",
        apply: (s) => ({
          state: addRep(addTrust({ ...s, stress: clamp(s.stress + 2, 0, 100) }, 1), 2),
          logs: ["You correct the record without starting a fire.", "Reputation +2. Trust +1. Stress +2."],
        }),
      },
      {
        id: "quote-tweet",
        text: "Quote-tweet dunk. Go viral.",
        apply: (s) => ({
          state: addUsers(addRep({ ...s, volatility: clamp(s.volatility + 6, 0, 100) }, -3), 90),
          logs: ["You win the timeline. You lose the room.", "Users +90. Reputation -3. Volatility +6."],
        }),
      },
      {
        id: "ignore",
        text: "Ignore it. It’ll pass.",
        apply: (s) => ({
          state: addRep(addMorale(s, -1), -2),
          logs: ["You say nothing. People fill in the blanks.", "Reputation -2. Morale -1."],
        }),
      },
    ],
  },

  {
    id: "talent-poach",
    title: "Talent Poach Attempt",
    prompt: () => "A bigger startup tries to poach your best person with a title that has two commas.",
    when: (s, ctx) => s.week >= 5 && ctx.teamSize >= 5,
    weight: (s) => 3 + (75 - s.culture.morale) / 18 + s.volatility / 30,
    choices: [
      {
        id: "match",
        text: "Match the offer. Spend to keep them.",
        apply: (s) => ({
          state: addCash(addMorale(addCohesion(s, 1), 2), -3200),
          logs: ["You retain them. The budget cries softly.", "Cash -$3,200. Morale +2. Cohesion +1."],
        }),
      },
      {
        id: "growth",
        text: "Offer growth: scope, autonomy, mission.",
        apply: (s) => ({
          state: addMorale(addTrust(addRep(s, 1), 1), 2),
          logs: ["You sell the dream. Sometimes it works.", "Morale +2. Trust +1. Reputation +1."],
        }),
      },
      {
        id: "let-go",
        text: "Let them go. We’ll hire around it.",
        apply: (s) => ({
          state: addCohesion(addMorale({ ...s, stress: clamp(s.stress + 3, 0, 100) }, -3), -3),
          logs: ["You lose a key person and gain a key lesson.", "Cohesion -3. Morale -3. Stress +3."],
        }),
      },
    ],
  },

  {
    id: "union-whisper",
    title: "Union Whisper",
    prompt: () => "Someone mentions ‘collective bargaining’ in a channel. The channel suddenly goes quiet.",
    when: (s, ctx) => ctx.teamSize >= 10 && s.week >= 8 && s.culture.morale <= 55,
    weight: (s) => 1.5 + (60 - s.culture.morale) / 20 + (60 - s.culture.cohesion) / 22,
    choices: [
      {
        id: "listen",
        text: "Listen. Fix root causes.",
        apply: (s) => ({
          state: addCash(addMorale(addCohesion(addTrust(s, 1), 2), 3), -1600),
          logs: ["You treat it as feedback, not betrayal.", "Cash -$1,600. Morale +3. Cohesion +2. Trust +1."],
        }),
      },
      {
        id: "lawyer",
        text: "Call a lawyer. Prepare.",
        apply: (s) => ({
          state: addCash(addCohesion(addMorale(addRep(s, -1), -2), -2), -2200),
          logs: ["You prepare for conflict and manufacture some of it.", "Cash -$2,200. Morale -2. Cohesion -2. Reputation -1."],
        }),
      },
      {
        id: "crackdown",
        text: "Crack down. No more ‘negativity.’",
        apply: (s) => ({
          state: addCohesion(addMorale(addRep({ ...s, stress: clamp(s.stress + 4, 0, 100) }, -2), -6), -6),
          logs: ["You win control and lose the team.", "Morale -6. Cohesion -6. Reputation -2. Stress +4."],
        }),
      },
    ],
  },

  {
    id: "pricing-backlash",
    title: "Pricing Backlash",
    prompt: () => "You change pricing. Customers interpret it as a personal attack.",
    when: (s) => s.stage !== "garage" && s.users >= 120 && s.week >= 5,
    weight: (s) => 3 + s.users / 160 + (s.reputation < 30 ? 2 : 0),
    choices: [
      {
        id: "rollback",
        text: "Rollback and apologize. Eat the pride.",
        apply: (s) => ({
          state: addUsers(addRep(addTrust(s, 1), 2), -40),
          logs: ["You take the L and keep the relationship.", "Users -40. Reputation +2. Trust +1."],
        }),
      },
      {
        id: "hold",
        text: "Hold the line. Let the churn happen.",
        apply: (s) => ({
          state: addUsers(addRep({ ...s, stress: clamp(s.stress + 2, 0, 100) }, -3), -90),
          logs: ["You learn what ‘price elasticity’ feels like in your chest.", "Users -90. Reputation -3. Stress +2."],
        }),
      },
      {
        id: "grandfather",
        text: "Grandfather existing customers. New pricing for new folks.",
        apply: (s) => ({
          state: addUsers(addRep(s, 1), -20),
          logs: ["You keep trust and accept slower growth.", "Users -20. Reputation +1."],
        }),
      },
    ],
  },

  {
    id: "competitor-mega-round",
    title: "Competitor Raises a Mega-Round",
    prompt: () => "A competitor announces a gigantic round at a valuation that feels like performance art.",
    when: (s) => s.stage !== "garage" && s.week >= 5,
    weight: (s) => 2 + s.vcReputation / 20 + (s.reputation < 25 ? 2 : 0),
    choices: [
      {
        id: "panic",
        text: "Panic. Copy their roadmap immediately.",
        apply: (s) => ({
          state: addCohesion(addMorale({ ...s, stress: clamp(s.stress + 4, 0, 100) }, -3), -4),
          logs: ["You chase a ghost. The team feels it.", "Cohesion -4. Morale -3. Stress +4."],
        }),
      },
      {
        id: "focus",
        text: "Focus. Talk to customers.",
        apply: (s) => ({
          state: addRep(addCohesion(addTrust(s, 1), 2), 2),
          logs: ["You do the unsexy thing that works.", "Reputation +2. Cohesion +2. Trust +1."],
        }),
      },
      {
        id: "fundraise",
        text: "Start fundraising. Enter the valuation circus.",
        apply: (s) => ({
          state: addVcRep({ ...s, volatility: clamp(s.volatility + 4, 0, 100), stress: clamp(s.stress + 2, 0, 100) }, 2),
          logs: ["You book meetings. You also lose sleep.", "VC rep +2. Volatility +4. Stress +2."],
        }),
      },
    ],
  },

  {
    id: "regulator-side-quest",
    title: "Regulator Side Quest",
    prompt: () => "A regulator asks friendly questions. They do not feel friendly.",
    when: (s) => s.week >= 8 && s.users >= 300,
    weight: (s) => 1.5 + s.reputation / 40 + (s.team.legal > 0 ? 0 : 1.5),
    choices: [
      {
        id: "prepare",
        text: "Prepare. Document. Comply.",
        apply: (s) => ({
          state: addCash(addRep({ ...s, stress: clamp(s.stress + 2, 0, 100) }, 2), -2400),
          logs: ["You become a temporary compliance company.", "Cash -$2,400. Reputation +2. Stress +2."],
        }),
      },
      {
        id: "wing",
        text: "Wing it. How hard can laws be?",
        apply: (s) => ({
          state: addRep({ ...s, volatility: clamp(s.volatility + 7, 0, 100), stress: clamp(s.stress + 3, 0, 100) }, -4),
          logs: ["You discover laws are, in fact, hard.", "Reputation -4. Volatility +7. Stress +3."],
        }),
      },
    ],
  },

  {
    id: "macro-rate-shock",
    title: "Macro Shock: Rates Jump",
    prompt: () => "Interest rates spike. Everyone on Twitter becomes a macro strategist.",
    when: (s) => s.stage !== "garage" && s.week >= 6,
    weight: (s) => 1.5 + s.volatility / 18,
    choices: [
      {
        id: "cut-burn",
        text: "Cut burn now. Survive the vibe shift.",
        apply: (s) => ({
          state: addRep(addMorale({ ...s, stress: clamp(s.stress + 1, 0, 100) }, -2), 1),
          logs: ["You get disciplined. It’s not fun. It is runway.", "Reputation +1. Morale -2. Stress +1."],
        }),
      },
      {
        id: "pretend",
        text: "Pretend it’s fine. Keep spending.",
        apply: (s) => ({
          state: addVcRep({ ...s, volatility: clamp(s.volatility + 6, 0, 100), stress: clamp(s.stress + 2, 0, 100) }, -3),
          logs: ["You keep the party going. The market stops dancing.", "VC rep -3. Volatility +6. Stress +2."],
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

  // ───── NEW EVENTS: Real-world inspired ─────

  {
    id: "consciousness-retreat",
    title: "The Consciousness Retreat",
    prompt: (s) =>
      `Your cofounder ${s.cofounder.name} proposes a ‘consciousness-raising retreat’ for the leadership team. It involves crystals, a shaman, and a $14,000 invoice. [[beat]] The deck has mantras.`,
    when: (s) => s.week >= 6 && s.cash >= 20_000 && s.cofounder.ego >= 60,
    weight: (s) => 2 + s.cofounder.ego / 30,
    choices: [
      {
        id: "approve",
        text: "Approve it. Who are you to judge?",
        apply: (s) => ({
          state: addEgo(addVolatility(addCohesion(addMorale(addCash(s, -14_000), 3), -2), 4), 3),
          logs: ["The team comes back ‘aligned.’ [[beat]] The invoice comes back real.", "Cash -$14,000. Morale +3. Cohesion -2. Ego +3."],
        }),
      },
      {
        id: "refuse",
        text: "Absolutely not. We’re a company, not a cult.",
        apply: (s) => ({
          state: addMorale(addEgo(addTrust(s, -4), 5), -1),
          logs: [`${s.cofounder.name} takes it personally. [[beat]] The crystals go in a drawer.`, "Trust -4. Ego +5. Morale -1."],
        }),
      },
      {
        id: "counter",
        text: "Counter-offer: team dinner. $200 max.",
        apply: (s) => ({
          state: addEgo(addTrust(addMorale(addCash(s, -200), 1), 2), -2),
          logs: ["You buy tacos instead of transcendence. It works.", "Cash -$200. Morale +1. Trust +2. Ego -2."],
        }),
      },
    ],
  },

  {
    id: "private-jet-question",
    title: "The Private Jet Question",
    prompt: () =>
      "A board member asks why there’s a $22,000 line item for ‘executive travel.’ You were at a conference. [[beat]] In Ibiza.",
    when: (s) => s.stage !== "garage" && s.cash >= 50_000 && s.vcReputation >= 30,
    weight: (s) => 2 + s.vcReputation / 30 + s.volatility / 25,
    choices: [
      {
        id: "deflect",
        text: "It was a business trip. Next question.",
        apply: (s) => ({
          state: addStress(addTrust(addVcRep(s, -4), -3), 3),
          logs: ["They don’t believe you. [[beat]] Neither does LinkedIn.", "VC rep -4. Trust -3. Stress +3."],
        }),
      },
      {
        id: "coach",
        text: "You’re right. I’ll fly coach. I’ll also hate it.",
        apply: (s) => ({
          state: addStress(addMorale(addVcRep(s, 1), -1), 2),
          logs: ["You downgrade. Your knees will never forgive you.", "VC rep +1. Morale -1. Stress +2."],
        }),
      },
      {
        id: "reimburse",
        text: "Reimburse it personally. Apologize.",
        apply: (s) => ({
          state: addStress(addTrust(addVcRep(s, 2), 2), 1),
          logs: ["You eat the cost. The board nods. [[beat]] Respect is expensive.", "VC rep +2. Trust +2. Stress +1."],
        }),
      },
    ],
  },

  {
    id: "faked-demo",
    title: "The Faked Demo",
    prompt: () =>
      "The demo doesn’t work. The investor meeting is in two hours. Your engineer whispers: ‘I can make it look like it works.’ [[beat]] The silence in the room is deafening.",
    when: (s) => s.stage !== "garage" && s.vcReputation >= 15 && s.stress >= 40,
    weight: (s) => 2 + s.stress / 25 + s.vcReputation / 30,
    choices: [
      {
        id: "fake-it",
        text: "Do it. Ship the illusion.",
        apply: (s) => ({
          state: addVolatility(addRep(addTrust(addVcRep(s, 5), -8), -3), 8),
          logs: ["The demo lands. [[beat]] The truth doesn’t.", "VC rep +5. Trust -8. Reputation -3. Volatility +8."],
        }),
      },
      {
        id: "show-broken",
        text: "Show them the broken version. Explain the vision.",
        apply: (s) => ({
          state: addRep(addTrust(addVcRep(s, -1), 4), 2),
          logs: ["They respect the honesty. [[beat]] Some of them.", "VC rep -1. Trust +4. Reputation +2."],
        }),
      },
      {
        id: "cancel",
        text: "Cancel the meeting. Reschedule when it’s real.",
        apply: (s) => ({
          state: addStress(addVcRep(s, -3), 3),
          logs: ["You lose momentum. You keep your soul. [[beat]] Unclear which matters more.", "VC rep -3. Stress +3."],
        }),
      },
    ],
  },

  {
    id: "inflated-metrics",
    title: "Inflated Metrics",
    prompt: () =>
      "Someone on the team has been counting ‘active users’ creatively. By their math, a bot that pinged your API once is a ‘daily active user.’ [[beat]] Your dashboard has never looked better.",
    when: (s) => s.users >= 200 && s.vcReputation >= 20,
    weight: (s) => 2 + s.vcReputation / 25,
    choices: [
      {
        id: "fix",
        text: "Fix the dashboard. Report real numbers.",
        apply: (s) => ({
          state: addRep(addTrust(addVcRep(addUsers(s, -Math.round(s.users * 0.3)), -2), 5), 3),
          logs: ["The real number is 30% lower. [[beat]] The real trust is 100% higher.", `Users adjusted. VC rep -2. Trust +5. Rep +3.`],
        }),
      },
      {
        id: "keep-both",
        text: "Keep both numbers. Show investors the big one.",
        apply: (s) => ({
          state: addVolatility(addRep(addTrust(addVcRep(s, 3), -6), -4), 6),
          logs: ["You choose the number that tells the better story. [[beat]] Stories have endings.", "VC rep +3. Trust -6. Rep -4. Volatility +6."],
        }),
      },
      {
        id: "fire",
        text: "Fire the person who did it. Make an example.",
        apply: (s) => ({
          state: addRep(addMorale(addCohesion(s, -5), -4), 1),
          logs: ["They’re gone by lunch. [[beat]] The office is very quiet that afternoon.", "Cohesion -5. Morale -4. Rep +1."],
        }),
      },
    ],
  },

  {
    id: "hockey-stick-morning",
    title: "Hockey Stick Morning",
    prompt: () =>
      "You check the dashboard before coffee. The graph is vertical. Users are flooding in. This is not a bug. [[beat]] This might be real.",
    when: (s, ctx) => s.week >= 4 && s.users >= 200 && ctx.usersGrowthRate > 0.15,
    weight: (_s, ctx) => 1 + ctx.usersGrowthRate * 8,
    choices: [
      {
        id: "scale",
        text: "Drop everything. Scale infrastructure. Ride the wave.",
        apply: (s) => ({
          state: addRep(addStress(addCash(addUsers(s, 400), -3500), 4), 3),
          logs: ["You throw money at servers and pray. [[beat]] The servers hold. You don’t sleep for three days.", "Users +400. Cash -$3,500. Stress +4. Rep +3."],
        }),
      },
      {
        id: "stay-calm",
        text: "Stay calm. Keep shipping. Let organic growth compound.",
        apply: (s) => ({
          state: addRep(addTrust(addUsers(s, 200), 2), 2),
          logs: ["You resist the temptation to panic-scale. Growth stays real.", "Users +200. Trust +2. Rep +2."],
        }),
      },
      {
        id: "call-investors",
        text: "Call every investor you know. This is the moment.",
        apply: (s) => ({
          state: addVolatility(addVcRep(addUsers(s, 250), 4), 5),
          logs: ["You turn the chart into a pitch deck slide. [[beat]] The phone starts ringing.", "Users +250. VC rep +4. Volatility +5."],
        }),
      },
    ],
  },

  {
    id: "move-fast-break-things",
    title: "Move Fast and Break Things",
    prompt: () =>
      "A new hire pins a note to the #general channel: ‘We should move fast and break things.’ [[beat]] They are not being ironic.",
    when: (s) => ts(s) >= 4 && s.week >= 3,
    weight: (s) => 4 + ts(s) / 5,
    choices: [
      {
        id: "embrace",
        text: "Embrace it. Speed is the only moat.",
        apply: (s) => ({
          state: addMorale(addVolatility(addCohesion(addRep(s, 2), -3), 5), 2),
          logs: ["The team ships three things before lunch. [[beat]] Two of them work.", "Rep +2. Cohesion -3. Volatility +5. Morale +2."],
        }),
      },
      {
        id: "responsibly",
        text: "Move fast and break things... responsibly.",
        apply: (s) => ({
          state: addCohesion(addRep(s, 1), 1),
          logs: ["You add a footnote: ‘with tests.’ [[beat]] Nobody reads the footnote.", "Rep +1. Cohesion +1."],
        }),
      },
      {
        id: "remove",
        text: "Remove the post. We move deliberately.",
        apply: (s) => ({
          state: addRep(addMorale(addCohesion(s, 2), -2), -1),
          logs: ["You delete the message. The new hire learns something about the culture. [[beat]] Or the lack of one.", "Cohesion +2. Morale -2. Rep -1."],
        }),
      },
    ],
  },

  {
    id: "bro-culture-incident",
    title: "Bro Culture Incident",
    prompt: () =>
      "Someone posts a screenshot of a Slack DM. It’s bad. The kind of bad that gets its own hashtag. [[beat]] HR’s inbox is already full.",
    when: (s) => ts(s) >= 6 && s.culture.cohesion <= 60 && s.stress >= 45,
    weight: (s) => 3 + (65 - s.culture.cohesion) / 10 + (s.team.hr === 0 ? 3 : 0),
    choices: [
      {
        id: "investigate",
        text: "Investigate properly. Consequences for real.",
        apply: (s) => {
          const hasHr = s.team.hr > 0;
          return {
            state: hasHr
              ? addTrust(addRep(addMorale(addCohesion(addCash(s, -2500), 5), 3), 2), 2)
              : addRep(addMorale(addCohesion(addCash(s, -5000), 2), 1), 1),
            logs: hasHr
              ? ["HR handles it. The process is painful but real. [[beat]] People exhale.", "Cash -$2,500. Cohesion +5. Morale +3. Rep +2. Trust +2."]
              : ["Without HR, you fumble through it yourself. It costs more. [[beat]] Everything costs more without process.", "Cash -$5,000. Cohesion +2. Morale +1. Rep +1."],
          };
        },
      },
      {
        id: "minimize",
        text: "Minimize. It’s ‘taken out of context.’",
        apply: (s) => ({
          state: addVolatility(addMorale(addCohesion(addRep(s, -6), -5), -4), 6),
          logs: ["The screenshot spreads. Context doesn’t help. [[beat]] It never does.", "Rep -6. Cohesion -5. Morale -4. Volatility +6."],
        }),
      },
      {
        id: "hire-hr",
        text: "Hire a head of HR immediately.",
        apply: (s) => ({
          state: addStress(addCohesion({ ...s, cash: s.cash - 5000, team: { ...s.team, hr: s.team.hr + 1 } }, 2), 2),
          logs: ["You hire HR retroactively. Better late than never. [[beat]] That’s literally the tagline for HR.", "Cash -$5,000. +1 HR. Cohesion +2. Stress +2."],
        }),
      },
    ],
  },

  {
    id: "token-pivot",
    title: "Token Pivot Proposal",
    prompt: (s) =>
      `${s.cofounder.name} sends a deck at 2am: ‘What if we launched a token?’ The deck has 47 slides. [[beat]] All of them say ‘web3.’`,
    when: (s) => s.week >= 5 && s.cofounder.ego >= 55,
    weight: (s) => 2 + s.cofounder.ego / 25 + s.volatility / 20,
    choices: [
      {
        id: "do-it",
        text: "Do it. Pivot to crypto. WAGMI.",
        apply: (s) => ({
          state: addTrust(addRep(addVcRep(addVolatility(addCash(s, 30_000), 12), -4), -3), 2),
          logs: ["The token launches. It pumps. [[beat]] You learn what ‘rug pull anxiety’ feels like.", "Cash +$30,000. Volatility +12. VC rep -4. Rep -3. Trust +2."],
        }),
      },
      {
        id: "refuse",
        text: "No. We’re building a real company.",
        apply: (s) => ({
          state: addVcRep(addEgo(addTrust(s, -3), 4), 1),
          logs: [`${s.cofounder.name} sulks for a week. The deck goes in the archive folder. [[beat]] It stays there. Mostly.`, "Trust -3. Ego +4. VC rep +1."],
        }),
      },
      {
        id: "explore",
        text: "Let’s ‘explore’ it. Buy time.",
        apply: (s) => ({
          state: addStress(addEgo(s, -1), 2),
          logs: ["You agree to a ‘research sprint.’ [[beat]] Research sprints are where ideas go to die politely.", "Ego -1. Stress +2."],
        }),
      },
    ],
  },

  {
    id: "cereal-box-hustle",
    title: "Cereal Box Hustle",
    prompt: (s) =>
      `You’re broke. Really broke. ${s.cofounder.name} suggests selling custom cereal boxes to fund the next sprint. [[beat]] It’s either genius or a cry for help.`,
    when: (_s, ctx) => ctx.nearBankruptcy,
    weight: (_s, ctx) => 8 + (ctx.nearBankruptcy ? 3 : 0),
    choices: [
      {
        id: "hustle",
        text: "Do it. Hustle is hustle.",
        apply: (s) => ({
          state: addStress(addMorale(addRep(addCash(s, 5000), 2), 3), -2),
          logs: ["You sell 500 boxes. The story becomes legend. [[beat]] The cereal is terrible.", "Cash +$5,000. Rep +2. Morale +3. Stress -2."],
        }),
      },
      {
        id: "dignity",
        text: "No. We need real funding, not cereal.",
        apply: (s) => ({
          state: addStress(s, 3),
          logs: ["Dignity preserved. Runway unchanged. [[beat]] The two are increasingly in tension.", "Stress +3."],
        }),
      },
    ],
  },

  {
    id: "sleeping-in-office",
    title: "Sleeping in the Office",
    prompt: (s) =>
      `You wake up on the office couch. You’ve been here three days. ${s.cofounder.name} left a sticky note: ‘Go home.’ [[beat]] The sticky note is from yesterday.`,
    when: (s) => s.stress >= 65 && s.week >= 4,
    weight: (s) => 3 + (s.stress - 60) / 8,
    choices: [
      {
        id: "go-home",
        text: "Go home. Sleep. Come back human.",
        apply: (s) => ({
          state: addTrust(addMorale(addStress(s, -8), 2), 3),
          logs: ["You sleep for 14 hours. [[beat]] You dream about burn rate. But still -- progress.", "Stress -8. Morale +2. Trust +3."],
        }),
      },
      {
        id: "one-more",
        text: "One more all-nighter. Ship the feature.",
        apply: (s) => ({
          state: addMorale(addCohesion(addRep(addStress(s, 5), 1), -1), -2),
          logs: ["You ship at 4am. It works. [[beat]] You can’t remember if you ate today.", "Stress +5. Rep +1. Cohesion -1. Morale -2."],
        }),
      },
      {
        id: "cot",
        text: "Set up a proper cot. This is the life now.",
        apply: (s) => ({
          state: addVolatility(addMorale(addStress(s, 2), -3), 3),
          logs: ["You optimize the couch situation. [[beat]] This is not the optimization your investors meant.", "Stress +2. Morale -3. Volatility +3."],
        }),
      },
    ],
  },

  {
    id: "ted-talk-invite",
    title: "TED Talk Invitation",
    prompt: (s) =>
      `You’re invited to give a TED talk. The topic: ‘The Future of ${s.thesis}.’ The audience: people who fund futures. [[beat]] The timer says 18 minutes. You have 12 minutes of material.`,
    when: (s) => s.week >= 6 && s.reputation >= 25 && s.vcReputation >= 20,
    weight: (s) => 2 + s.reputation / 25 + s.vcReputation / 25,
    choices: [
      {
        id: "rehearse",
        text: "Accept. Rehearse obsessively. Nail it.",
        apply: (s) => ({
          state: addStress(addCash(addUsers(addVcRep(addRep(s, 6), 4), 150), -1500), 4),
          logs: ["You rehearse 40 times. The talk lands. [[beat]] Your inbox becomes a different animal.", "Rep +6. VC rep +4. Users +150. Cash -$1,500. Stress +4."],
        }),
      },
      {
        id: "wing-it",
        text: "Accept. Wing it. Authenticity > preparation.",
        apply: (s) => ({
          state: addStress(addVolatility(addVcRep(addRep(s, 2), 1), 5), 2),
          logs: ["You go off-script at minute 6. [[beat]] The audience can’t tell if it’s genius or a meltdown.", "Rep +2. VC rep +1. Volatility +5. Stress +2."],
        }),
      },
      {
        id: "decline",
        text: "Decline. The product speaks louder than a stage.",
        apply: (s) => ({
          state: addRep(addTrust(s, 2), -1),
          logs: ["You pass. The slot goes to someone with less product and more LinkedIn followers.", "Trust +2. Rep -1."],
        }),
      },
    ],
  },

  {
    id: "magazine-cover",
    title: "Magazine Cover",
    prompt: (s) =>
      `A business magazine wants ${s.founder.name} on the cover. The headline: ‘${s.companyName}: The Next Big Thing?’ [[beat]] The question mark is doing a lot of work.`,
    when: (s) => s.week >= 8 && s.reputation >= 30 && s.valuation >= 10_000_000,
    weight: (s) => 1.5 + s.reputation / 30,
    choices: [
      {
        id: "do-it",
        text: "Do it. Narrative is a weapon.",
        apply: (s) => ({
          state: addEgo(addVolatility(addVcRep(addRep(s, 5), 3), 6), 5),
          logs: ["The cover comes out. You look confident. [[beat]] Your cofounder looks at the masthead and sighs.", "Rep +5. VC rep +3. Volatility +6. Ego +5."],
        }),
      },
      {
        id: "decline",
        text: "Decline. Stay in the shadows.",
        apply: (s) => ({
          state: addVolatility(addTrust(addRep(s, -1), 2), -2),
          logs: ["You pass. The reporter writes about your competitor instead. [[beat]] They look great.", "Rep -1. Trust +2. Volatility -2."],
        }),
      },
      {
        id: "team-feature",
        text: "Only if the team is featured too.",
        apply: (s) => ({
          state: addEgo(addMorale(addCohesion(addRep(s, 3), 4), 3), -2),
          logs: ["The team photo runs. Everyone looks slightly uncomfortable. [[beat]] Morale has never been higher.", "Rep +3. Cohesion +4. Morale +3. Ego -2."],
        }),
      },
    ],
  },

  {
    id: "vision-fund-call",
    title: "Vision Fund Call",
    prompt: () =>
      "An investor calls. They manage ‘a hundred billion in dry powder.’ They say your valuation is ‘not thinking big enough.’ [[beat]] They want to invest 10x what you asked for.",
    when: (s) => s.stage !== "garage" && s.vcReputation >= 25 && s.valuation >= 5_000_000,
    weight: (s) => 1.5 + s.vcReputation / 20,
    choices: [
      {
        id: "mega-check",
        text: "Take the mega-check. Think bigger.",
        apply: (s) => ({
          state: addStress(addVcRep(addVolatility(addCash(s, 200_000), 10), 5), 5),
          logs: ["The wire hits. The zeros are real. [[beat]] So are the expectations.", "Cash +$200,000. Volatility +10. VC rep +5. Stress +5."],
        }),
      },
      {
        id: "smaller",
        text: "Take a smaller amount. Stay disciplined.",
        apply: (s) => ({
          state: addTrust(addVcRep(addCash(s, 50_000), 2), 2),
          logs: ["You take less. They’re confused. [[beat]] Discipline is confusing to people with unlimited capital.", "Cash +$50,000. VC rep +2. Trust +2."],
        }),
      },
      {
        id: "walk-away",
        text: "Walk away. That money comes with strings.",
        apply: (s) => ({
          state: addCohesion(addTrust(addVcRep(s, -3), 3), 2),
          logs: ["You decline a hundred billion dollars of opinions. [[beat]] Your cofounder buys you a beer.", "VC rep -3. Trust +3. Cohesion +2."],
        }),
      },
    ],
  },

  {
    id: "founder-twitter-meltdown",
    title: "Founder Twitter Meltdown",
    prompt: () =>
      "It’s 11pm. You’ve had two glasses of wine. Your phone is in your hand. The tweet writes itself. [[beat]] The draft is... honest.",
    when: (s) => s.stress >= 60 && s.week >= 4,
    weight: (s) => 3 + s.stress / 20 + s.volatility / 25,
    choices: [
      {
        id: "post",
        text: "Post it. Let them see the real you.",
        apply: (s) => ({
          state: addMorale(addVcRep(addVolatility(addUsers(addRep(s, -5), 80), 8), -3), -2),
          logs: ["It goes viral. [[beat]] For all the wrong reasons. And some of the right ones.", "Rep -5. Users +80. Volatility +8. VC rep -3. Morale -2."],
        }),
      },
      {
        id: "delete",
        text: "Delete draft. Go to bed.",
        apply: (s) => ({
          state: addTrust(addStress(s, -3), 1),
          logs: ["You put the phone down. [[beat]] The hardest ship of the day.", "Stress -3. Trust +1."],
        }),
      },
      {
        id: "show-cofounder",
        text: "Show it to your cofounder first.",
        apply: (s) => {
          const trusty = s.cofounder.trust > 40;
          return trusty
            ? { state: addStress(addTrust(s, 4), -1), logs: ["They talk you off the ledge. [[beat]] That’s what cofounders are for.", "Trust +4. Stress -1."] }
            : { state: addRep(addTrust(s, -5), -3), logs: [`They screenshot it. [[beat]] ${s.cofounder.name} has a different definition of ‘trust.’`, "Trust -5. Rep -3."] };
        },
      },
    ],
  },

  {
    id: "pivot-ultimatum",
    title: "The Pivot Ultimatum",
    prompt: () =>
      "Your biggest investor sends a one-line email: ‘Pivot or we pull support.’ [[beat]] The product is working. The numbers aren’t.",
    when: (s, ctx) => s.stage !== "garage" && ctx.mrrGrowthRate < 0.02 && s.week >= 8 && s.investors.pipeline.length > 0,
    weight: (_s, ctx) => 3 + (0.05 - ctx.mrrGrowthRate) * 20,
    choices: [
      {
        id: "pivot",
        text: "Pivot. They’re right. The market has spoken.",
        apply: (s) => ({
          state: addMorale(addCohesion(addVcRep(addVolatility(s, 8), 2), -5), -4),
          logs: ["You change everything. [[beat]] The product team stares at blank Figma files.", "Volatility +8. VC rep +2. Cohesion -5. Morale -4."],
        }),
      },
      {
        id: "refuse",
        text: "Refuse. Double down on the current path.",
        apply: (s) => ({
          state: addMorale(addTrust(addVcRep(s, -4), 3), 2),
          logs: ["You tell a billionaire ‘no.’ [[beat]] It’s the most expensive syllable of your life.", "VC rep -4. Trust +3. Morale +2."],
        }),
      },
      {
        id: "narrative-pivot",
        text: "Pivot the narrative, not the product.",
        apply: (s) => ({
          state: addVolatility(addRep(addVcRep(s, 1), 1), 3),
          logs: ["Same product. New deck. Different adjectives. [[beat]] Welcome to startup storytelling.", "VC rep +1. Rep +1. Volatility +3."],
        }),
      },
    ],
  },

  {
    id: "glassdoor-review",
    title: "The Glassdoor Review",
    prompt: () =>
      "A one-star review appears: ‘Leadership has no idea what they’re doing. The free snacks are fine.’ [[beat]] It has 47 ‘helpful’ votes.",
    when: (s) => ts(s) >= 5 && s.culture.morale <= 65,
    weight: (s) => 3 + (70 - s.culture.morale) / 12,
    choices: [
      {
        id: "address",
        text: "Address it publicly. Own the feedback.",
        apply: (s) => ({
          state: addStress(addCohesion(addMorale(addRep(s, 2), 3), 2), 2),
          logs: ["You write a response. It’s honest and slightly painful. [[beat]] People notice.", "Rep +2. Morale +3. Cohesion +2. Stress +2."],
        }),
      },
      {
        id: "ignore",
        text: "Ignore it. Focus on the people who stayed.",
        apply: (s) => ({
          state: addMorale(addRep(s, -2), -1),
          logs: ["The review sits there. Glowing. [[beat]] Candidates check Glassdoor before they check your product.", "Rep -2. Morale -1."],
        }),
      },
      {
        id: "investigate",
        text: "Figure out who wrote it.",
        apply: (s) => ({
          state: addTrust(addMorale(addCohesion(s, -6), -4), -3),
          logs: ["You find them. You also become the villain. [[beat]] The next review is worse.", "Cohesion -6. Morale -4. Trust -3."],
        }),
      },
    ],
  },

  {
    id: "all-hands-meltdown",
    title: "The All-Hands Meltdown",
    prompt: () =>
      "During the weekly all-hands, someone asks: ‘Are we going to make it?’ [[beat]] The room goes silent. Everyone is looking at you.",
    when: (s, ctx) => ctx.nearBankruptcy || (s.stress >= 65 && s.culture.morale <= 50),
    weight: (_s, ctx) => 5 + (ctx.nearBankruptcy ? 5 : 0),
    choices: [
      {
        id: "honest",
        text: "Be honest. Share the numbers. Ask for their best.",
        apply: (s) => ({
          state: addStress(addTrust(addCohesion(addMorale(s, 5), 4), 3), 2),
          logs: ["You show the real numbers. Someone cries. [[beat]] Then someone says: ‘Let’s fix it.’", "Morale +5. Cohesion +4. Trust +3. Stress +2."],
        }),
      },
      {
        id: "reassure",
        text: "Reassure them. ‘We’re fine.’ Smile.",
        apply: (s) => ({
          state: addStress(addMorale(addTrust(s, -4), 1), 1),
          logs: ["They want to believe you. [[beat]] The Slack DMs afterward suggest otherwise.", "Trust -4. Morale +1. Stress +1."],
        }),
      },
      {
        id: "cancel",
        text: "Cancel the all-hands. Email instead.",
        apply: (s) => ({
          state: addMorale(addCohesion(s, -4), -3),
          logs: ["You send a Notion doc titled ‘Update.’ [[beat]] Nobody reads past the subject line.", "Cohesion -4. Morale -3."],
        }),
      },
    ],
  },

  {
    id: "customer-zero",
    title: "Customer Zero",
    prompt: () =>
      "A stranger emails: ‘I found your product. I love it. I want to pay.’ [[beat]] No one told them about it. They just... found it.",
    when: (s) => s.week >= 3 && s.users >= 50 && s.users <= 500,
    weight: (s) => 3 + s.reputation / 20,
    choices: [
      {
        id: "call",
        text: "Get on a call. Learn everything.",
        apply: (s) => ({
          state: addAp(addTrust(addMorale(addRep(addUsers(s, 30), 2), 4), 2), 1),
          logs: ["You talk for an hour. They describe a use case you never imagined. [[beat]] This is the moment.", "Users +30. Rep +2. Morale +4. Trust +2. AP +1."],
        }),
      },
      {
        id: "premium",
        text: "Send them to the premium tier.",
        apply: (s) => ({
          state: addRep(addCash(s, 500), 1),
          logs: ["They upgrade without hesitation. [[beat]] First paying customer who wasn’t your mom.", "Cash +$500. Rep +1."],
        }),
      },
      {
        id: "testimonial",
        text: "Ask them to write a testimonial.",
        apply: (s) => ({
          state: addVcRep(addRep(addUsers(s, 50), 3), 1),
          logs: ["They write a glowing review. [[beat]] It’s better copy than anything your marketing team produced.", "Users +50. Rep +3. VC rep +1."],
        }),
      },
    ],
  },

  // ───── MORE EVENTS: Variety pack ─────

  {
    id: "open-source-pr",
    title: "Open Source PR",
    prompt: () =>
      "A stranger opens a pull request on your repo. The code is clean. The commit messages are poems. [[beat]] They want nothing in return.",
    when: (s) => s.week >= 3 && s.users >= 80,
    weight: () => 5,
    choices: [
      {
        id: "merge",
        text: "Merge it. Welcome them to the community.",
        apply: (s) => ({
          state: addRep(addMorale(addUsers(s, 40), 3), 2),
          logs: ["You merge. They stick around. [[beat]] Open source is weird like that.", "Users +40. Morale +3. Rep +2."],
        }),
      },
      {
        id: "hire",
        text: "Offer them a job on the spot.",
        apply: (s) => ({
          state: addCash(addRep(addMorale(addCohesion(s, 2), 2), 1), -3000),
          logs: ["They accept. You just recruited through code review. [[beat]] HR is confused.", "Cash -$3,000. Cohesion +2. Morale +2. Rep +1."],
        }),
      },
      {
        id: "close",
        text: "Close it. Too risky. We don't know this person.",
        apply: (s) => ({
          state: addRep(s, -2),
          logs: ["You close the PR. They tweet about it. [[beat]] The tweet has teeth.", "Rep -2."],
        }),
      },
    ],
  },

  {
    id: "partner-api-request",
    title: "Partner API Request",
    prompt: () =>
      "A mid-size company emails: 'We want to integrate your product into ours. Can we get API access?' [[beat]] They have 10x your users.",
    when: (s) => s.stage !== "garage" && s.reputation >= 15 && s.users >= 200,
    weight: (s) => 4 + s.reputation / 20,
    choices: [
      {
        id: "prioritize",
        text: "Prioritize it. Drop everything.",
        apply: (s) => ({
          state: addStress(addUsers(addVcRep(addRep(s, 3), 2), 180), 3),
          logs: ["You build the integration in a week. Your team sleeps under desks. [[beat]] Users pour in.", "Users +180. Rep +3. VC rep +2. Stress +3."],
        }),
      },
      {
        id: "charge",
        text: "Charge them for API access. Revenue first.",
        apply: (s) => ({
          state: addCash(addUsers(addRep(s, 1), 80), 8000),
          logs: ["They pay. You ship. Everybody wins. [[beat]] Except your roadmap.", "Cash +$8,000. Users +80. Rep +1."],
        }),
      },
      {
        id: "decline",
        text: "Decline. Stay focused on your own users.",
        apply: (s) => ({
          state: addTrust(addCohesion(s, 2), 1),
          logs: ["You say no to distribution. It hurts. It also protects focus.", "Cohesion +2. Trust +1."],
        }),
      },
    ],
  },

  {
    id: "team-hackathon",
    title: "Hack Week Proposal",
    prompt: () =>
      "The team wants a hack week. No roadmap. No standups. Just build whatever excites you. [[beat]] The Jira board weeps.",
    when: (s) => s.week >= 5 && ts(s) >= 4,
    weight: (s) => 4 + ts(s) / 5 + (s.culture.morale < 60 ? 2 : 0),
    choices: [
      {
        id: "full-week",
        text: "Full hack week. Creativity unleashed.",
        apply: (s) => ({
          state: addUsers(addCohesion(addMorale(addCash(s, -1200), 6), 5), 60),
          logs: ["Someone builds a feature you never imagined. [[beat]] It ships the next sprint.", "Cash -$1,200. Morale +6. Cohesion +5. Users +60."],
        }),
      },
      {
        id: "one-day",
        text: "One hack day. Contained chaos.",
        apply: (s) => ({
          state: addMorale(addCohesion(s, 2), 3),
          logs: ["One day of fun. The demos are surprisingly good. [[beat]] Someone built a Slack bot that roasts the CEO.", "Morale +3. Cohesion +2."],
        }),
      },
      {
        id: "no-time",
        text: "No. We ship features, not side projects.",
        apply: (s) => ({
          state: addMorale(addCohesion(s, -2), -3),
          logs: ["The team nods. The energy drains. [[beat]] The Jira board doesn't care.", "Morale -3. Cohesion -2."],
        }),
      },
    ],
  },

  {
    id: "viral-screenshot",
    title: "Viral Screenshot",
    prompt: () =>
      "Someone screenshots your product and posts it with: 'Why is nobody talking about this?' [[beat]] Suddenly everybody is talking about this.",
    when: (s) => s.week >= 3 && s.users >= 60,
    weight: (s) => 5 + s.volatility / 15,
    choices: [
      {
        id: "capitalize",
        text: "Retweet. Blog post. Landing page. Go.",
        apply: (s) => ({
          state: addVcRep(addRep(addUsers(s, 250), 3), 2),
          logs: ["You ride the wave perfectly. [[beat]] The signup graph goes vertical for 48 hours.", "Users +250. Rep +3. VC rep +2."],
        }),
      },
      {
        id: "improve",
        text: "Fix every bug first. Then capitalize.",
        apply: (s) => ({
          state: addStress(addRep(addUsers(s, 120), 2), 2),
          logs: ["You ship 14 hotfixes in 6 hours, then announce. [[beat]] The product holds.", "Users +120. Rep +2. Stress +2."],
        }),
      },
      {
        id: "quiet",
        text: "Stay quiet. Let the product speak.",
        apply: (s) => ({
          state: addUsers(addTrust(s, 1), 80),
          logs: ["You let organic growth do its thing. [[beat]] Less splash, more staying power.", "Users +80. Trust +1."],
        }),
      },
    ],
  },

  {
    id: "customer-case-study",
    title: "Customer Case Study",
    prompt: () =>
      "A customer publishes a blog post titled: 'How we 3x'd our workflow with this tool.' [[beat]] They tagged you. Their CTO has 40K followers.",
    when: (s) => s.week >= 5 && s.users >= 200 && s.reputation >= 15,
    weight: (s) => 4 + s.reputation / 25,
    choices: [
      {
        id: "amplify",
        text: "Amplify everywhere. This is marketing gold.",
        apply: (s) => ({
          state: addVcRep(addRep(addUsers(s, 120), 4), 2),
          logs: ["You share it on every channel. Investors forward it. [[beat]] Social proof > ad spend.", "Users +120. Rep +4. VC rep +2."],
        }),
      },
      {
        id: "deepen",
        text: "Reach out. Turn them into a design partner.",
        apply: (s) => ({
          state: addRep(addTrust(addUsers(s, 60), 2), 2),
          logs: ["You build a relationship, not just a retweet. [[beat]] They become your best beta tester.", "Users +60. Rep +2. Trust +2."],
        }),
      },
      {
        id: "nothing",
        text: "Do nothing. Let it happen organically.",
        apply: (s) => ({
          state: addUsers(s, 30),
          logs: ["You miss the moment. Some things need a push. [[beat]] The tweet fades into the timeline.", "Users +30."],
        }),
      },
    ],
  },

  {
    id: "conference-booth",
    title: "Conference Booth",
    prompt: () =>
      "You're offered a booth at the biggest conference in your space. The price is aggressive. The visibility is priceless. [[beat]] Or is it?",
    when: (s) => s.week >= 5 && s.cash >= 5000,
    weight: (s) => 4 + s.vcReputation / 25,
    choices: [
      {
        id: "full-booth",
        text: "Full booth. Swag. Demo stations. Go big.",
        apply: (s) => ({
          state: addStress(addVcRep(addRep(addUsers(addCash(s, -8000), 100), 3), 3), 3),
          logs: ["You own the conference. Three VCs stop by. [[beat]] One of them remembers your name.", "Cash -$8,000. Users +100. Rep +3. VC rep +3. Stress +3."],
        }),
      },
      {
        id: "attend-cheap",
        text: "Skip the booth. Attend. Work the hallways.",
        apply: (s) => ({
          state: addVcRep(addRep(addCash(s, -1500), 1), 1),
          logs: ["You network like your runway depends on it. [[beat]] Because it does.", "Cash -$1,500. Rep +1. VC rep +1."],
        }),
      },
      {
        id: "skip",
        text: "Skip it entirely. Ship instead.",
        apply: (s) => ({
          state: addCohesion(addMorale(s, 1), 1),
          logs: ["You stay home and ship. The conference tweets scroll past. [[beat]] You don't look.", "Morale +1. Cohesion +1."],
        }),
      },
    ],
  },

  {
    id: "feature-demand-wave",
    title: "Feature Demand Wave",
    prompt: () =>
      "Users are asking for the same feature. Loudly. In every channel. The request thread has 200 upvotes. [[beat]] It's not on the roadmap.",
    when: (s) => s.week >= 4 && s.users >= 100,
    weight: (s) => 5 + s.users / 200,
    choices: [
      {
        id: "build-it",
        text: "Build it. The people have spoken.",
        apply: (s) => ({
          state: addStress(addRep(addUsers(s, 100), 3), 3),
          logs: ["You ship it in a week. The thread erupts. [[beat]] 'Finally.'", "Users +100. Rep +3. Stress +3."],
        }),
      },
      {
        id: "roadmap",
        text: "Acknowledge it. Put it on the roadmap properly.",
        apply: (s) => ({
          state: addRep(addTrust(s, 2), 1),
          logs: ["You post a thoughtful response. People respect the process. [[beat]] Most of them.", "Rep +1. Trust +2."],
        }),
      },
      {
        id: "say-no",
        text: "Say no. It doesn't fit the vision.",
        apply: (s) => ({
          state: addUsers(addRep(addCohesion(s, 2), -2), -30),
          logs: ["You hold the line. Some users leave. The product stays focused. [[beat]] Focus has a price.", "Users -30. Rep -2. Cohesion +2."],
        }),
      },
    ],
  },

  {
    id: "cold-dm-talent",
    title: "Cold DM from a Star",
    prompt: () =>
      "A senior engineer from a top company DMs you: 'I've been using your product. I want to build it.' [[beat]] Their GitHub has more stars than your company.",
    when: (s) => s.week >= 4 && s.reputation >= 20,
    weight: (s) => 3 + s.reputation / 25,
    choices: [
      {
        id: "hire",
        text: "Hire them immediately. Whatever it costs.",
        apply: (s) => ({
          state: addCash(
            addRep(addMorale(addCohesion({ ...s, team: { ...s.team, engineering: s.team.engineering + 1 } }, 3), 4), 2),
            -5000
          ),
          logs: ["They start Monday. The team's energy shifts. [[beat]] Talent attracts talent.", "Cash -$5,000. +1 Eng. Cohesion +3. Morale +4. Rep +2."],
        }),
      },
      {
        id: "advisor",
        text: "Offer an advisor role. Equity, no salary.",
        apply: (s) => ({
          state: addVcRep(addRep(s, 2), 1),
          logs: ["They agree. You get credibility and office hours. [[beat]] Best deal you've closed.", "Rep +2. VC rep +1."],
        }),
      },
      {
        id: "later",
        text: "Not now. Ask them to check in next quarter.",
        apply: (s) => ({
          state: addRep(s, -1),
          logs: ["They move on. The window was smaller than you thought. [[beat]] Windows usually are.", "Rep -1."],
        }),
      },
    ],
  },
];
