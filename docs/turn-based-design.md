# StartUpWorld: turn-based design

This file is the source of truth for the turn-based game. The "Game design" section is the owner's design, verbatim.
Rulings on points it leaves open, and the log of tuned numbers, are appended below it as the build proceeds.

The numbers in the "Game design" section are the design's starting values. Where one differs from `src/config.ts`,
config is what the game runs; the Tuning log at the end lists every difference.

## Game design

### Core loop
Three resources: Cash (run out and you're bankrupt), Talent (how much work gets done each turn) and Users (revenue, valuation and the win). Cash pays talent, talent builds the product and drives growth, and users bring in cash and unlock bigger raises. The core tension is burn rate: every hire costs cash every turn, so each turn is a choice between building, growing and surviving. One turn = one quarter. A game lasts up to 20 turns.

### Starting state
- Player, Blitzscaler, Bootstrapper: $500K cash, 3 people, 0 users, product quality 0, hype 10, 100% founder equity, 2 founder board seats.
- Incumbent: $3M cash, 8 people, 10K users, product quality 30, hype 20, 60% founder equity, 2 founder seats, 1 investor seat.

### Player actions each turn
- Assign each person to Product, Growth or Recruiting (default: last turn's split).
- Set marketing spend (in $25K steps) and price: Budget $2, Standard $3 or Premium $5 per user per quarter.
- Optional: Raise, Poach one person from a rival, Lay off people.

### Rules
- Coordination drag: effective work = headcount^0.9 (Incumbent: ^0.8), split across departments in proportion to the people in each.
- Salaries: $40K per person per quarter.
- Product quality (0–100): each turn +5 × Product effective work × (1 − quality/100), then −2 decay. A product launches at quality 10; no users before launch. The Incumbent gets +50% product output while it trails the quality leader (copying features).
- Market: 20,000 new users arrive in turn 1, growing 10% per turn. Each turn's pool = new users + everyone's churned users + users of bankrupt companies, split among launched companies in proportion to pull.
- Pull = quality × (1 + 0.3 × Growth effective work + 0.5 × √(marketing ÷ $25K)) × price factor (Budget 1.25, Standard 1, Premium 0.75) × (1 + hype/100).
- Churn per turn = 12% − 0.08 × quality, +4 points on Premium, −2 on Budget, minimum 2%.
- Revenue = users × price. Costs = salaries + marketing + hiring, poaching and severance costs. A company that ends a turn below $0 is bankrupt and out.
- Hiring: 6 candidates per turn, plus anyone laid off or freed by a bankruptcy. Hiring capacity = 2 × Recruiting effective work, rounded. Companies pick one candidate at a time in hype order. $10K fee per hire; hires start next turn.
- Raise: needs 1,000+ users and no raise in the previous 2 turns. Takes 1 person off other work that turn. Sell 10%, 20% or 30%; cash raised = valuation × percent; founder equity shrinks accordingly; adds 1 investor board seat.
- Valuation = users × $150 × (1 + hype/100) × funding-climate multiplier (normally 1).
- Board: once investor seats outnumber founder seats, a bad quarter (users fell, or runway under 2 turns) carries a 30% chance the founder is fired and out.
- Poach: $50K, success chance = 50% + (your hype − their hype) ÷ 2, clamped to 10–90%. One attempt per turn.
- Layoffs: $20K severance each, −10 hype.
- Hype (0–100): decays 20% per turn. +15 at launch, +10 when a raise closes, +5 when users grow 25%+ in a turn, plus events.

### Events
From turn 3, 50% chance each turn, revealed at the start of the turn so everyone can react. Starting deck: funding winter (valuations ×0.6 for 3 turns), hot market (×1.4 for 2 turns), viral moment (random company +20 hype), burnout (random company loses 1 person), press feature (best product +15 hype), security breach (random company under quality 50 loses 10% of users and 10 hype), talent glut (+4 candidates), market boom (new users ×1.5 this turn), ad prices spike (marketing half as effective this turn). Keep the deck in config so I can add events.

### Winning and losing
- IPO: the first company with 250K+ users and a profitable quarter (revenue ≥ costs) wins immediately. Ties go to the higher valuation.
- If nobody IPOs by the end of turn 20, the highest founder stake (founder equity × valuation) wins.
- The player loses on bankruptcy or getting fired, and wins if every CPU is out.

### CPU rivals
- Same rules and the same public info as the player: users, team size, hype, product quality, last raise. Cash stays private.
- Each CPU should play a recognizable strategy the player can learn to read and exploit.
- Each turn, generate a few dozen candidate plans, project each one turn ahead (estimating rivals from last turn), score them with personality weights (users, runway, product quality, hype, equity kept, with a heavy penalty for projected negative cash) and pick the best, with a little randomness.
- Blitzscaler: chases users, raises 30% whenever eligible, Budget price, heavy marketing.
- Bootstrapper: protects runway and equity, raises only when runway drops under 2 turns, Premium price, small team, product first.
- Incumbent: product-heavy, poaches whenever it can afford to, copies the leader (catch-up bonus above).
- Any CPU past 250K users switches to an IPO push: cut costs to turn a profit.
- Give each CPU a random startup name and one-line pitch each game.

### Screens
- Resource bar: Cash (with runway in turns), Talent (headcount and effective work), Users (with this turn's change). Also hype, product quality, valuation, equity and who controls the board.
- Planning panel with allocation, marketing, price and optional actions, showing projected end-of-turn cash and a warning if it goes negative.
- Quarterly report after each turn: revenue, costs, users won and lost, hires, rival moves, event.
- Rivals panel with their public stats.
- New-game screen where the player names their startup, with a short how-to-play; end screen (IPO, bankrupt, fired or turn-20 result) with Play again.
- Desktop and mobile. Autosave the game in progress so a refresh doesn't lose it.

### Not in v1
Online multiplayer, a map or multiple markets, talent roles, difficulty levels, accounts, leaderboards.

---

## Rulings on open points

These fill gaps the design leaves open. Where a ruling and the design disagree, the design wins. Items marked
(owner) were decided by the owner; the rest are the implementer's calls and can be changed.

Most rulings only settle timing or an edge case. Five go further and add to what the design says:

- Users lost to a security breach rejoin the pool, like churned users (ruling 1).
- A poach or a burnout can never take a company's last person, and the poach floor is a tunable number (rulings 10, 11).
- The planning panel has a "hire at most N" control (ruling 9).
- More is public about rivals than the design lists: price tier, equity and board seats (ruling 18).
- A marketing budget, a price and a hire limit stay as set from one turn to the next; the design gives a default only
  for the team split (ruling 26).

### Owner decisions

- The old weekly terminal game is removed; this game replaces it. (owner)
- A fired founder's company shuts down like a bankrupt one: its users return to the pool next turn and its staff
  become candidates. (owner)
- The simulator's baseline bot keeps everyone on Product until it launches, and hires only while it keeps 3+ turns
  of runway. As written (40/40/20 from turn 1, always recruiting) it was bankrupt by turn 3–5. (owner)

### Order of a turn

Before planning, already part of the state a turn starts from:

- The event for this turn is revealed (from turn 3) and its instant effects are applied.

Resolution, in this order:

1. Plans are checked. Anything illegal is fixed up or dropped at no cost, and the report says so.
2. Layoffs.
3. The raise closes.
4. Work is done.
5. Product quality: gain, then decay, then the launch test.
6. Market: churn, then the pool is split by pull.
7. Poach attempts, in hype order.
8. Hiring, one candidate at a time in hype order.
9. Revenue and costs.
10. Hype.
11. IPO check. An IPO ends the game at once.
12. Bankruptcy, then the board vote. Companies that go out release their users and staff.
13. Last company standing, then the turn-20 ranking.
14. The funding climate ticks down and next turn's event is drawn.

### Rulings

1. **Users are conserved.** Churned users, users lost to a security breach and the users of companies that go out
   all join the pool (breach losses and exits join the next market split). The pool is split in whole users by
   largest remainder. If no launched company has any pull, the pool waits for the next turn.
2. **Team split.** A plan places every available person in Product, Growth or Recruiting. Available = headcount −
   layoffs − 1 if raising. A split that does not add up is refitted in proportion.
3. **Effective work** = (people on payroll this turn) ^ exponent; each department gets the share of its people over
   the payroll. The fundraiser is on payroll, so their share of the work is simply lost.
4. **Quality.** Gain, then decay, then clamp to 0–100. A product launches when it is at 10 or above after the decay,
   competes in that same turn's market, and stays launched. Decay applies before launch too.
5. **Catch-up.** The Incumbent's +50% applies only on turns it starts strictly below the best launched rival still
   in the game.
6. **Market inputs.** Churn and pull use the quality after this turn's work, this turn's price and marketing, and
   start-of-turn hype (after the event).
7. **Raise.** Needs 1,000+ users at the start of the turn and no raise in the previous two turns (a raise on turn 5
   allows the next on turn 8). Priced on start-of-turn users, hype and funding climate. Cash arrives the same turn.
   Founder equity is multiplied by (1 − percent). One investor seat is added. Raise proceeds are not revenue.
8. **Money.** Revenue = end-of-turn users × price. Costs = salaries for everyone on payroll this turn (laid-off
   people get severance instead) + marketing + $10K per hire made + $50K per poach attempt + severance.
   Profitable = revenue ≥ costs. Runway = cash ÷ (costs − revenue) for the latest quarter, with no limit when that
   quarter was profitable. The resource bar, the board and the bots all read this one number. Before a company's
   first quarter its burn is its payroll. Every cost counts, one-off ones included, so a quarter that burns more
   than a third of its opening cash plus money raised ends with under 2 turns of runway.
9. **Hiring.** Candidates = 6 + event bonus + staff freed by companies that went out last turn + everyone laid off
   this turn. Each company wants min(capacity, its "hire at most" setting). Candidates are handed out one at a time
   in start-of-turn hype order, highest first; equal hype is ordered by the seeded RNG. The fee is charged per hire
   made. Unhired candidates leave. Hires start next turn.
10. **Poach.** One attempt per turn, $50K whether or not it works. Chance = 50% + (your hype − their hype) ÷ 2
    points, clamped to 10–90%, on start-of-turn hype. Attempts resolve in hype order; equal hype is ordered by the
    seeded RNG, on a stream of its own. The person changes company
    from next turn. A target must have at least 2 people at that moment (after its own layoffs and any earlier
    poach that turn); an attempt on a smaller team is dropped at no cost. Several companies may each take one person
    from the same target in a turn, down to that floor.
11. **Layoffs.** At most headcount − 1. −10 hype once per turn with any layoffs, not per person. Nobody falls below
    1 person through layoffs, poaching or burnout.
12. **Hype** each turn = hype × 0.8, then +15 if it launched this turn, +10 if a raise closed, +5 if users grew 25%+
    over last quarter's close (needs users at that close), −10 if anyone was laid off; clamped to 0–100.
13. **Bad quarter.** "Users fell" compares end-of-turn users with last quarter's close, so a breach counts.
    "Runway under 2 turns" uses the runway of ruling 8. The board votes once per bad quarter, and only while
    investor seats outnumber founder seats (a seat added by this turn's raise counts). With the starting seats a
    startup's founder can be fired from its third raise on (turn 8 at the earliest) and the Incumbent's from its
    second (turn 4 at the earliest).
14. **Endings**, in order: IPO (250K+ users and a profitable quarter; ties go to the higher valuation, then the
    higher founder stake); bankruptcy (cash strictly below $0); board firing; last company standing wins; after turn
    20 the highest founder stake (equity × valuation) among surviving companies wins. If every remaining company
    goes out in the same turn, nobody wins.
15. **Going out.** A bankrupt or fired company's users join next turn's pool, and its staff (including people it
    hired or poached that turn) join next turn's candidates.
16. **Events.** At most one per turn, from turn 3. Cards with no valid target are left out of that turn's draw.
    A "this turn" effect lasts for the turn it is revealed in. A funding climate lasts N turns including the one it
    is revealed in, and a new climate card replaces the running one. "Ad prices spike" halves the marketing term of
    pull. Burnout needs a team of 2+. The breach needs a launched company under quality 50 that has users.
17. **Price and marketing.** Price changes are free and immediate. Marketing is paid in the turn it is set and only
    affects that turn.
18. **Public information.** As listed in the design (users, team size, hype, quality, last raise: its turn, percent
    and amount), plus launch status, last quarter's users won and lost with the quality and hype the company
    started that quarter on, equity and board seats (they follow from the public raises) and price tier. Price tier
    is new information, and the clearest tell of how a rival plays. Cash, team split, marketing and plans are
    private. CPUs plan from exactly this view.
19. **No special player.** The engine treats all four companies alike. The app ends the session when the human's
    company is out; the simulator plays on until there is a winner.
20. **Randomness.** Every roll comes from a stream keyed by (seed, turn, purpose, company), so a game replays
    exactly from its seed and plans, and one company's choices never shift another's rolls.
21. **Rival types.** The rivals panel does not label a rival as Blitzscaler, Bootstrapper or Incumbent. Its pitch,
    its price tier and how it plays show it, and the end screen names it. Rivals are seated in a random order.
22. **Projected cash.** The planning panel cannot know how many users a quarter will bring, so it shows two figures:
    a floor (no users won, every wanted hire made), which is exact, and an expected figure built from rivals'
    public results.
23. **Baseline bot details.** 40 / 40 / 20 is split in whole people by largest remainder (3 people → 1 / 1 / 1,
    5 → 2 / 2 / 1). When it raises, the fundraiser comes out first and the rest are split. It hires k people only
    if (cash − $10K × k) ÷ (last quarter's burn + $40K × k) stays at 3 turns or more.
24. **Precision and rounding.** Quality and hype are kept to four decimals and effective work to six, and every
    threshold reads the stored figure: a product that works out at 9.99997 is stored, shown and launched as 10.
    Users and dollars are whole numbers, rounded to the nearest; a fraction of exactly one half may fall either
    way. Runway is never below 0.
25. **Refitting a split.** Leftover people go to the largest remainders; ties go to Product, then Growth, then
    Recruiting. A plan that places nobody puts everyone on Product.
26. **Default plan.** A new turn starts from last turn's split, marketing budget, price and "hire at most"
    setting. A raise, a poach and layoffs are one-off and start switched off. A marketing budget therefore stays
    in force until the player changes it; the planning panel shows it and counts it in projected cash.
27. **Who the Incumbent poaches from.** The rival with the most users that is big enough to lose someone. Rivals
    that are level (every startup on turn 1) are picked between by the seeded RNG, never by seat, so the player is
    not the one who always gets raided first.

### Numbers the design does not name

Added to `src/config.ts` because a rule needed them; all tunable like the rest.

- Poach floor: a target needs at least 2 people.
- Event weights: every card has weight 1.
- Largest marketing spend the planner accepts: $5M.

## Tuning log

Every number changed from the design's starting value, with the reason.

| Number | Start | Now | Why |
|---|---|---|---|
| (none yet) | | | |
