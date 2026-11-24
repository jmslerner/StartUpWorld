# StartUpWorld: turn-based design

This file is the source of truth for the turn-based game. The "Game design" section is the owner's design, verbatim.
Rulings on points it leaves open, and the log of tuned numbers, are appended below it as the build proceeds.

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
