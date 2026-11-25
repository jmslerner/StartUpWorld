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

Most rulings only settle timing or an edge case. Five go further and add to what the design says, and one leaves a
question open for the owner (ruling 29):

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
    public results. The expected figure runs high more often than not, so the panel's warnings about the board
    and about going public also look at a cautious case, 25% fewer new users than expected: a quarter that is
    only bad in the cautious case is "a close call", and one that only lists on the expected figure "could" go
    public.
23. **Baseline bot details.** 40 / 40 / 20 is split in whole people by largest remainder (3 people → 1 / 1 / 1,
    5 → 2 / 2 / 1). When it raises, the fundraiser comes out first and the rest are split. It hires k people only
    if (cash − $10K × k) ÷ (last quarter's burn + $40K × k) stays at 3 turns or more. That is 3 turns at last
    quarter's burn, on the cash it starts the quarter with: it does not count this quarter's own burn, so after
    about four hiring quarters in ten it is left with less than 3 turns at its new payroll. This is the bot the
    targets were tuned on.
24. **Precision and rounding.** Quality and hype are kept to four decimals and effective work to six, and every
    threshold reads the stored figure: a product that works out at 9.99997 is stored, shown and launched as 10.
    Users and dollars are whole numbers, rounded to the nearest; a fraction of exactly one half may fall either
    way. Runway is never below 0.
25. **Refitting a split.** Leftover people go to the largest remainders; ties go to Product, then Growth, then
    Recruiting. A plan that places nobody puts everyone on Product.
26. **Default plan.** A new turn starts from last turn's split, marketing budget, price and "hire at most"
    setting. A raise, a poach and layoffs are one-off and start switched off. A marketing budget therefore stays
    in force until the player changes it; the planning panel shows it and counts it in projected cash. A number
    in "hire at most" is a limit and stays where the player put it; "No limit" follows what recruiting can find.
27. **Who the Incumbent poaches from.** The rival with the most users that is big enough to lose someone. Rivals
    that are level (every startup on turn 1) are picked between by the seeded RNG, never by seat, so the player is
    not the one who always gets raided first. It does not poach on the last turn: the person would start in a
    quarter that is never played. Its team cap limits recruiting only; the people it poaches come on top.
28. **Counts that are part of a rule.** One person runs a raise, a raise adds one investor seat, a poach takes one
    person, there is at most one event a turn, candidates are handed out one at a time, every company starts on
    Standard, and quality and hype run from 0 to 100. These are rules, not tunable numbers, and are not in the
    config. Events cannot start before turn 2: turn 1 is dealt before anything is rolled.
29. **The Blitzscaler raises on the last turn too.** "Raises 30% whenever eligible" is applied to the letter, so
    it sells 30% on turn 20 whenever its cooldown allows, although on that turn the sale only shrinks the
    founder's stake that decides the game. Over five 1,000-game batches this costs it 0.8 to 1.6 points of win
    rate (34.1% to 36.5% as shipped, 35.6% to 37.6% without the last-turn raise; the cap is 40%). Left as
    designed: it is a habit a player can read, and changing a habit is the owner's call.

### Numbers the design does not name

Added to `src/config.ts` because a rule needed them; all tunable like the rest.

- Poach floor: a target needs at least 2 people. (Now 4: see the Tuning log.) Whatever the config says, the
  engine never lets it drop below 2.
- Event weights: every card has weight 1.
- Largest marketing spend the planner accepts: $5M.
- The cautious case of the projection: 25% fewer new users than expected (ruling 22). In 400 simulated games the
  users actually won were at least 84% of the expected figure nine times in ten; at 25% every bad quarter under an
  investor-led board was announced, against 86% without it.

## Tuning log

Every number changed from the design's starting value, with the reason. `npm run sim` prints the same list straight
from the two config files, so it cannot drift from the game.

### Where the starting numbers stood

With the starting numbers, 1,000 simulated games gave: Baseline bot 0%, Blitzscaler 41%, Bootstrapper 0%, Incumbent
59%. Every game ended in an IPO, the median one on turn 13. All four targets failed. Three things caused it:

- The Incumbent's head start compounds, and at 250K users nothing stops it or the Blitzscaler listing early.
- Raising 30% at $150 a user every third turn brings in more cash than a company can spend, and cash buys users.
- On $500K with $40K salaries a startup cannot afford its first hires, so the baseline bot never grew past three
  people, and Premium was worse than Standard in every way that matters, so the Bootstrapper never won.

### Rules

| Number | Start | Now | Why |
|---|---|---|---|
| Users needed to go public | 250,000 | 330,000 | At 250K someone listed by turn 14 in every game. With the smaller market below, 330K is about 40% of all users: a clear lead, reached in about half of games and late. |
| New users in turn 1 | 20,000 | 16,000 | A smaller market, so that going public takes a real lead rather than an even share. |
| Market growth per turn | 10% | 9% | Same. |
| Startup cash | $500K | $900K | So a startup can afford to hire before its first raise. |
| Salary per person per quarter | $40K | $30K | Same, and so a team of normal size can pass the IPO profit test. |
| Valuation per user | $150 | $80 | Raises were so large that money stopped being a constraint for anyone who raised. |
| Marketing coefficient | 0.5 | 0.3 | Cash bought too many users: whoever raised most won. |
| Quality gain per unit of Product work | 5 | 4.5 | Slows the quality race a little. Three people on Product still launch in the first quarter (quality 10.1). |
| Budget pull factor | ×1.25 | ×1.05 | Budget was the best tier in everything but revenue. Its edge is now mostly its lower churn. |
| Premium churn penalty | +4 points | +1 point | Premium was dominated, so the Bootstrapper, which always charges it, could not win. |
| Incumbent's drag exponent | 0.8 | 0.625 | Its head start (8 people, 10K users, quality 30, $3M) won it 59% of games. A heavier drag keeps the head start and takes away the compounding. |
| Poach cost | $50K | $75K | The Incumbent poaches whenever it can afford to; at $50K that was almost every turn of the game. |
| Poach floor: a target needs a team of | 2 | 4 | A three-person startup could lose a third of its team on turn 1, before making a single decision. |
| Burnout needs a team of | 2 | 4 | The same protection against the burnout card. |

### Computer players

These are weights and limits in how each rival scores its options. The habits the design names are untouched, and
`src/config.test.ts` fails if tuning changes them: the Blitzscaler prices at Budget, raises 30% the moment it can and
spends the most on marketing; the Bootstrapper prices at Premium, raises only under 2 turns of runway and keeps the
smallest team; the Incumbent poaches whenever it can afford to. `src/ai/habits.test.ts` plays games on the shipped
numbers and checks that each rival still behaves that way.

| Number | Start | Now | Why |
|---|---|---|---|
| Blitzscaler: fear of its board | 3 | 0 | It ignores the board, as a blitzscaler would. Its founder is fired in about a quarter of games, and that is what keeps it under the 40% cap. |
| Blitzscaler: weight on runway | 0.5 | 0 | Same: it does not play safe. |
| Blitzscaler: runway it keeps when hiring | 2 turns | 1.5 turns | Same. |
| Blitzscaler: weight on users | 3 | 3.25 | Found by the search. |
| Blitzscaler: team cap | 14 | 11 | Keeps it from out-hiring everyone now that marketing does less per dollar. |
| Blitzscaler: share of cash it may spend on marketing | up to 50% | up to 25% | Marketing does less per dollar, so it stops burning half its cash on it. Still the heaviest spender of the three. |
| Bootstrapper: team cap | 6 | 7 | Still the smallest of the three. |
| Bootstrapper: share of cash it may spend on marketing | up to 6% | up to 16% | At 6% it could not grow at all. |
| Bootstrapper: weight on runway | 2 | 2.25 | Found by the search. |
| Incumbent: team cap | 16 | 14 | Found by the search. |
| Incumbent: share of cash it may spend on marketing | up to 10% | up to 15% | Found by the search. |
| Incumbent: fear of its board | 3 | 2 | Found by the search. |
| Incumbent: weight on users | 1.5 | 2.5 | Found by the search. |
| Incumbent: weight on quality | 2.5 | 3 | Found by the search. |

### How the numbers were found

A local search over about 45 numbers against the simulator (300-game batches on two sets of seeds per step), run
several times from hand-built starting points. The search may move numbers; it may not change a rule, a named habit,
the baseline bot or the targets. Besides the four targets it was asked to keep every company a working company (no
team bled down to one person, no 50-person baseline bot) and to stay close to the starting numbers. The chosen set
was then checked on fresh seeds:

| 1,000 games, seeds | Baseline | Blitzscaler | Bootstrapper | Incumbent | End in an IPO | Median turns |
|---|---|---|---|---|---|---|
| 1 to 1,000 (`npm run sim`) | 23.8% | 34.1% | 14.4% | 27.7% | 48.6% | 20 |
| 100,001 to 101,000 | 19.4% | 35.1% | 17.2% | 28.3% | 47.7% | 20 |
| 110,001 to 111,000 | 18.2% | 36.5% | 17.3% | 28.0% | 49.8% | 20 |
| 120,001 to 121,000 | 19.2% | 35.6% | 17.4% | 27.8% | 49.7% | 20 |
| 130,001 to 131,000 | 21.3% | 35.2% | 16.8% | 26.7% | 49.7% | 20 |

All four targets hold on all five. (Figures after the final review's one change to how a rival plays: the
Incumbent no longer poaches on the last turn. It moved no batch by more than half a point.)

### What the balance rests on

- The Blitzscaler wins only by going public, and stays under 40% because its board fires its founder in about a
  quarter of games. Make it careful (raise its fear of the board) and it wins far more.
- The baseline bot goes out in about one game in six (bankrupt 10%, fired 7.5%), usually around turn 7: it raises
  small amounts often, loses its board, and never lays anyone off.
- Games are long. The median game runs all 20 turns and the median IPO comes on turn 19.
- The Bootstrapper and the Incumbent almost never go out, so "last one standing" did not happen once in these 5,000
  games.
- The balance was found for these bots. A change to how a rival plans, or to a rule, calls for another
  `npm run sim` and probably another search.
- The targets measure one simple policy, and skill moves the result a long way. In the player's seat over 300 games:
  the baseline bot won 23%; a careful scripted player (keeps control of its board, keeps three quarters of cash,
  lays people off rather than go under, cuts spending to turn a profit at the IPO bar) won 83%; a player that
  copies the Bootstrapper won none and let the Blitzscaler go public in 80%. The rivals have no difficulty setting.
