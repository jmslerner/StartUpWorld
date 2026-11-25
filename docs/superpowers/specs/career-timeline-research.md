# Career timeline: research notes

These are the research notes behind the era table in `2026-11-25-career-3d-design.md` (section 6). They are reference
material for whoever writes the career's config and the 3D era looks. They are not rules and not game text: where they
differ from the approved design, the design wins.

How to read them:

- The approved design changed some things after this research: the era boundaries (1990 to 1994, 1995 to 1999, 2000 to
  2006, 2007 to 2013, 2014 to 2021, 2022 to 2026, 2027 to 2032, 2033 to 2038), which cards are used, and the cards'
  effects. The design's table is the list of cards to build.
- "Game terms" are proposals in the race's units, per quarter, and were never simulated. The career's turn is a year,
  so they are starting points to convert and then tune.
- "Source" names the real event behind a card. Real names appear here and in a comment beside each card in the config,
  never in text a player reads.
- "Check" is the verdict of an independent fact-check of the 30 real cards: all 30 dates are right, 24 cards are
  correct as written and 6 needed a wording fix, given below. A card's text must be true of the year the design puts it
  in: where the design places an effect a year after the event (the chatbot was released in November 2022 and is the
  platform shift of 2023), the text has to describe that year.
- "Office props" are ideas for the era looks of the 3D office.

## Dial-up Dawn (1990-1994; real history)

Software is sold in boxes and people meet on dial-up services, until the web appears between 1991 and 1993 and gives a
small company a way to reach customers without a shop shelf.

Game terms: Proposal, not simulated; today's value first. market.newUsersTurn1 16K -> 4K and growthPerTurn 0.09 ->
0.12: a tiny market that compounds fast. salary 30K -> 12K per person per quarter (about $48K a year in the money of
the time; a guess). valuation.perUser 80 -> 40 with a standing climate near 0.8, raise.options [10, 20], cooldownTurns
2 -> 3: money comes from savings, customers and banks. pull.marketingCoefficient 0.3 -> 0.2: magazine adverts, trade
shows and disks in the post buy little. hiring.candidatesPerTurn 6 -> 3, fee 10K -> 4K: few programmers, cheap.
priceTiers 2/3/5 -> 8/12/20: few customers who each pay a lot. ipo.users 330K -> 60K.

Office props:

- A garage with an up-and-over door and a bare bulb over a workbench used as a desk
- A beige tower computer with a deep glass-tube monitor
- A modem with red blinking lights and a coiled phone cord trailing across the floor
- Stacks of floppy disks and shrink-wrapped software boxes ready to post
- A dot-matrix printer feeding striped continuous paper beside a fax machine

Cards:

- **Recession** (July 1990). The economy tips into an eight-month recession and banks tighten their lending.
  Effect as researched: fundingClimate x0.7 for 3 turns.
  Source: NBER business-cycle dates for the United States: peak July 1990, trough March 1991.
  Check: correct as written.
- **A web of pages** (August 1991). A researcher at a physics laboratory invites the public to try a new system of
  linked pages on the internet.
  Effect as researched: newUsers x1.25 this turn.
  Source: Tim Berners-Lee's post to the alt.hypertext newsgroup announcing the World Wide Web project, 6 August 1991
  (CERN).
  Check: correct as written.
- **Free for all** (April 1993). The laboratory that invented the web puts its software in the public domain, free for
  anyone to use or build on.
  Effect as researched: newUsers x1.5 this turn.
  Source: CERN statement of 30 April 1993. NCSA Mosaic 1.0 for X followed the same month (22 April 1993; that date is
  'likely', from memory).
  Check: correct as written.
- **Endless September** (September 1993). Commercial online services start opening the internet's discussion groups to
  their subscribers, and the yearly autumn wave of newcomers never stops.
  Effect as researched: newUsers x1.5 this turn.
  Source: 'Eternal September' refers to September 1993. Checked on the web: the common claim that AOL opened Usenet
  access that month is disputed; other sources give March 1994. https://en.wikipedia.org/wiki/Eternal_September and
  https://www.flowjournal.org/2023/04/eternal-september/
  Check: imprecise. Keep the date: the phrase (coined January 1994) refers to September 1993. The cause is misstated:
  the largest online service opened its gateway to the discussion groups on 28 February 1994 (often given as March
  1994), not in September 1993, and older gateways from other services had run since the late 1980s. Suggested text:
  "The yearly autumn wave of student newcomers to the internet's discussion groups never ebbs; within months the big
  online services connect their subscribers too, and new users keep arriving all year."
- **First banner adverts** (October 1994). A web magazine launches with the first paid banner adverts; one is said to
  have been clicked by 44% of the people who saw it.
  Effect as researched: marketingEffect x1.5 this turn.
  Source: HotWired launched 27 October 1994 with banner adverts, AT&T's among them (date certain). The 44% click rate
  is the widely repeated figure, not independently checked.
  Check: imprecise. The date (27 October 1994) and the 44% recollection are right. "The first" is the usual credit but
  contested: a clickable paid advert was sold on an earlier commercial web publication in 1993, and a rival media site
  that opened three days earlier (24 October 1994) is also reported to have carried banner adverts. Suggested text: "A
  web magazine launches with what are usually counted as the first paid banner adverts; one is said to have been
  clicked by 44% of the people who saw it."

## Browser Gold Rush (1995-2000 (to the March 2000 peak); real history)

The browser turns the internet into a mass market and investors pay for visitors, not profits, until the technology
share index peaks in March 2000.

Game terms: Proposal, not simulated. market.newUsersTurn1 16K -> 8K, growthPerTurn 0.09 -> 0.15 (real anchor about
16.9% a quarter). salary 30K -> 18K, rising. hiring.candidatesPerTurn 6 -> 4 and poach.baseChance 0.5 -> 0.6: hiring
is a fight, staff leave for share options. valuation.perUser 80 -> 200 with a standing climate near 1.3,
raise.cooldownTurns 2 -> 1, raise.options up to 40. pull.marketingCoefficient 0.3 -> 0.25 and the 'ad prices spike'
card at weight 2: television and portal deals cost a lot. priceTiers 2/3/5 -> 1/2/4: free now, revenue later.
Companies of this era listed without profits; dropping the profitable-quarter condition would be a rule change (config
has only ipo.users), not a number.

Office props:

- A rented loft with exposed brick and bare ventilation ducts
- Rows of glass-tube monitors on folding tables, cables taped to the floor
- A server rack in a cupboard cooled by a household box fan
- Beanbags and a table-football table
- A scrolling red LED share-price ticker over the door, above boxes of launch-party T-shirts

Cards:

- **The backbone goes private** (April 1995). The government-funded backbone of the internet is switched off and
  commercial carriers take over the traffic.
  Effect as researched: newUsers x1.25 this turn.
  Source: NSFNET backbone service decommissioned 30 April 1995.
  Check: correct as written.
- **First-day pop** (August 1995). A sixteen-month-old browser maker with no profits yet sells shares to the public
  and the price more than doubles on the first day.
  Effect as researched: fundingClimate x1.5 for 3 turns.
  Source: Netscape IPO, 9 August 1995: priced at $28, closed at $58.25. Founded 4 April 1994.
  Check: correct as written.
- **Irrational exuberance** (December 1996). The head of the central bank asks in a speech whether 'irrational
  exuberance' has pushed share prices too high.
  Effect as researched: fundingClimate x0.9 for 1 turn.
  Source: Alan Greenspan, speech of 5 December 1996.
  Check: correct as written.
- **Six-fold debut** (November 1998). An online community site's shares end their first day about 600% above the offer
  price, a record at the time.
  Effect as researched: fundingClimate x1.6 for 3 turns.
  Source: theGlobe.com IPO, 13 November 1998: priced at $9, closed at $63.50 (+606%).
  Check: imprecise. The date and text are right ($9 to $63.50 on 13 November 1998, up 606%, a record at the time).
  Only the card name is off: the shares closed at about seven times the offer price, so "six-fold" understates it.
  Rename to "Seven-fold debut" or "Up 600% in a day".
- **Dot-com ad break** (January 2000). More than a dozen internet startups buy adverts in the country's most-watched
  televised football final, at about $2 million for thirty seconds.
  Effect as researched: marketingEffect x0.5 this turn.
  Source: Super Bowl XXXIV, 30 January 2000 (date certain). Counts of dot-com advertisers vary from 14 to 17; average
  price about $2.1M per 30 seconds.
  Check: correct as written.

## Bust and Broadband (2000-2006; real history)

The bubble bursts and money vanishes for three years, while always-on broadband quietly builds the audience for search
advertising and the social web.

Game terms: Proposal, not simulated. market.newUsersTurn1 stays 16K, growthPerTurn 0.09 -> 0.05 (real anchor about
5.3% a quarter). salary 30K -> 21K, flat. hiring.candidatesPerTurn 6 -> 9 in 2000-2003 and 6 after, fee 10K -> 5K: the
easiest hiring of the whole timeline. valuation.perUser 80 -> 30 rising back to 80, standing climate 0.5 until 2003
and 1.0 by 2005, raise.cooldownTurns 2 -> 3: survive on revenue. pull.marketingCoefficient 0.3 -> 0.4 from 2003:
pay-per-click search adverts are cheap and measurable. priceTiers and churn unchanged. ipo.users 330K -> 230K, and the
profitable-quarter condition matters.

Office props:

- A half-empty floor with a 'to let' sign seen in reverse through the window
- Mesh-backed designer chairs bought at a liquidation auction
- The first flat screens standing beside old glass-tube monitors
- A whiteboard with a hand-drawn countdown of months of cash left
- A wireless router with stubby antennae and blue network cable stapled along the skirting board

Cards:

- **The worst week** (April 2000). The technology share index loses a quarter of its value in one week, a month after
  its record high.
  Effect as researched: fundingClimate x0.5 for 4 turns.
  Source: Nasdaq Composite fell 25.3% in the week ending 14 April 2000; record close 5,048.62 on 10 March 2000.
  Check: correct as written.
- **Mascot for sale** (November 2000). An online pet-supplies shop known for its television mascot closes down nine
  months after selling shares to the public.
  Effect as researched: candidates +4 this turn.
  Source: Pets.com announced its liquidation on 7 November 2000; IPO in February 2000.
  Check: correct as written.
- **The bottom** (October 2002). The technology share index hits its low, 78% below the peak.
  Effect as researched: fundingClimate x0.6 for 3 turns (same as the shipped 'funding winter' card).
  Source: Nasdaq Composite closed at 1,114.11 on 9 October 2002.
  Check: correct as written.
- **Broadband majority** (July 2004). For the first time more than half of the home internet users in the largest
  market connect by broadband instead of dial-up.
  Effect as researched: newUsers x1.5 this turn.
  Source: Nielsen//NetRatings, July 2004: 51% of active US home internet users (63M broadband, 61.3M dial-up),
  reported August 2004. Checked on the web; it is a share of users, not households.
  https://vindyarchives.com/news/2004/aug/21/high-speed-lines-equal-dial-up and
  https://icrontic.com/discussion/18626/us-broadband-connections-cross-50-percent-mark
  Check: correct as written.
- **Video site sale** (October 2006). A search company buys a twenty-month-old video-sharing site for $1.65 billion in
  shares.
  Effect as researched: fundingClimate x1.4 for 2 turns.
  Source: Google's purchase of YouTube, announced 9 October 2006. YouTube was founded in February 2005.
  Check: correct as written.

## Phones and Cloud (2007-2013; real history)

The touchscreen phone and its app store put software in every pocket, rented cloud servers make starting up cheap, and
the 2008 financial crisis resets who gets funded.

Game terms: Proposal, not simulated. market.newUsersTurn1 16K -> 24K, growthPerTurn 0.09 -> 0.10: a second audience
arrives on phones. salary 30K -> 25K. hiring.candidatesPerTurn 6 -> 5 (mobile developers are scarce). Cloud has no
cost line in this game, so the nearest numbers are archetypes.startup.cash 900K -> 500K and quality.gainPerWork 4.5 ->
5.5: start on less, each builder ships more. valuation.perUser stays 80; climate 1.0 in 2007, 0.5 for about 4 turns
from late 2008, 1.1 by 2011. pull.growthCoefficient 0.3 -> 0.4: store charts and sharing make Growth work count more.
priceTiers 2/3/5 -> 1/3/5 with the budget pullFactor 1.05 -> 1.15 (99-cent and free-to-start pricing); churn.base 0.12
-> 0.11 as subscriptions begin.

Office props:

- Long shared bench desks with sticker-covered laptops
- A shelf of test phones on a tangle of charging cables
- A wall of sticky notes in three columns
- A table-tennis table that doubles as the meeting table
- The old server cupboard, now empty and used to park bicycles

Cards:

- **The touchscreen phone** (June 2007). A touchscreen phone with a full web browser goes on sale and buyers queue
  overnight.
  Effect as researched: newUsers x1.25 this turn.
  Source: The first iPhone went on sale in the United States on 29 June 2007.
  Check: correct as written.
- **The app shop opens** (July 2008). A phone maker opens a shop for other companies' apps with about 500 titles; 10
  million are downloaded in the first weekend.
  Effect as researched: newUsers x1.5 this turn.
  Source: Apple's App Store opened 10 July 2008; the 10 million figure is from its press release of 14 July 2008.
  Check: correct as written.
- **Bank collapse** (September 2008). A 158-year-old investment bank files the largest bankruptcy in the country's
  history and lending freezes worldwide.
  Effect as researched: fundingClimate x0.5 for 4 turns. Schedule it on the 2008 Q4 turn: it shares a quarter with the
  July card and the engine allows one event a turn..
  Source: Lehman Brothers filed for bankruptcy on 15 September 2008.
  Check: correct as written.
- **Cloud outage** (April 2011). A fault in one region of the largest cloud provider keeps many well-known startups
  offline for days.
  Effect as researched: targetUsers 0.1 plus targetHype -10; target random, launched, qualityBelow 50, minUsers 1 (the
  shipped 'security breach' shape).
  Source: Amazon Web Services US-East outage beginning 21 April 2011.
  Check: imprecise. The date is right (the fault began on 21 April 2011). "Offline for days" overstates it: the
  provider's own report says all but about 2.2% of the affected storage volumes were restored within about 36 hours,
  and the last were restored about four days after the start; the well-known sites were back within hours to a day and
  a half. Suggested text: "A fault in one region of the largest cloud provider knocks many well-known startups
  offline, some for more than a day; full recovery takes about four days."
- **Thirteen people, one billion** (April 2012). A social network pays $1 billion for a photo-sharing app that has 13
  employees and no revenue.
  Effect as researched: fundingClimate x1.4 for 2 turns.
  Source: Facebook's purchase of Instagram, announced 9 April 2012.
  Check: imprecise. The date and facts are right (announced 9 April 2012; 13 employees, no revenue). $1 billion was
  the agreed price in cash and shares; when the deal closed in September 2012 the buyer's shares had fallen and it was
  worth about $715 million. Suggested text: "A social network agrees to pay $1 billion for a photo-sharing app that
  has 13 employees and no revenue."

## Cheap Money Years (2014-2021; real history)

Near-zero interest rates push investors into startups for most of a decade, software is sold by subscription, and
growth is valued above profit right through the pandemic boom of 2020 and 2021.

Game terms: Proposal, not simulated. market.newUsersTurn1 16K -> 40K, growthPerTurn 0.09 -> 0.06: a huge market that
grows slowly, so users are won from rivals. salary 30K (today's value fits the start of this era) -> 36K by 2021.
hiring.candidatesPerTurn 6 -> 5, fee 10K -> 15K, poach.baseChance 0.5 -> 0.6; from 2020 candidatesPerTurn 8, because
remote work widens the pool. valuation.perUser 80 -> 130, standing climate 1.2 and 1.5 in 2021, raise.cooldownTurns 2
-> 1, raise.options up to 40. pull.marketingCoefficient 0.35 in 2014 falling to 0.25 by 2021: paid social works, then
gets crowded and privacy rules bite. churn.base 0.12 -> 0.10 (subscriptions hold users); priceTiers 2/3/5 -> 2/4/7.
ipo.users 330K -> 500K: companies stay private longer.

Office props:

- An open-plan floor with hanging plants over rows of standing desks
- A snack wall with a cold-coffee tap
- Glass meeting rooms with joke names and one-person phone booths
- A neon slogan sign on bare brick, and a gong for the sales team
- From 2020, the same floor half-empty, with a wall screen showing a grid of colleagues at home

Cards:

- **Nineteen billion** (February 2014). A social network agrees to pay $19 billion for a messaging app with about 55
  employees and 450 million users.
  Effect as researched: fundingClimate x1.5 for 3 turns.
  Source: Facebook's purchase of WhatsApp, announced 19 February 2014.
  Check: correct as written.
- **Privacy law** (May 2018). A data-protection law takes effect across a whole continent, with fines of up to 4% of a
  company's worldwide revenue.
  Effect as researched: marketingEffect x0.7 this turn.
  Source: The European Union's General Data Protection Regulation applied from 25 May 2018.
  Check: imprecise. The date (25 May 2018) and the 4% cap are right. "Across a whole continent" is too wide: the law
  applied in the 28 member countries of one political union, not in every country of the continent. Suggested text: "A
  data-protection law takes effect across a bloc of 28 countries, with fines of up to 4% of a company's worldwide
  revenue."
- **The pulled offering** (September 2019). An office-rental startup valued at $47 billion at the start of the year
  cancels its share offering after investors balk at its losses.
  Effect as researched: fundingClimate x0.7 for 2 turns.
  Source: WeWork (The We Company) withdrew its IPO filing on 30 September 2019; the $47 billion valuation dates from
  January 2019.
  Check: correct as written.
- **Everyone goes home** (March 2020). A pandemic is declared, offices close within days and daily life moves online.
  Effect as researched: newUsers x1.5 this turn.
  Source: The World Health Organization declared COVID-19 a pandemic on 11 March 2020.
  Check: correct as written.
- **Work from anywhere** (May 2020). A social-media company tells its staff they may work from home for good, and
  others follow.
  Effect as researched: candidates +4 this turn.
  Source: Twitter's announcement to employees, 12 May 2020.
  Check: correct as written.

## Winter and AI (2022-2026 (real history stops at mid-2026); real history)

Interest rates jump and funding and hiring freeze, and within months generative AI opens the next gold rush for the
few companies investors believe in.

Game terms: Proposal, not simulated. market.newUsersTurn1 16K -> 40K, growthPerTurn 0.09 -> 0.04 for ordinary
products, with newUsers x1.5 turns for AI launches. salary 30K -> 36K (the game has one salary for everyone, so the
far higher pay of AI specialists is not modelled). hiring.candidatesPerTurn 6 -> 9 in 2022-2023 (layoffs), then 5.
Funding: climate 0.6 through 2022-2023, which is exactly the shipped 'funding winter' card; after that hype decides,
and the only lever is the (1 + hype/100) term of valuation, so AI favour is given by targetHype cards.
quality.gainPerWork 4.5 -> 6 from 2023 (coding assistants) and quality.decay 2 -> 3 (features are copied in weeks).
pull.marketingCoefficient 0.3 -> 0.25. priceTiers 2/3/5 -> 2/4/8 (per-seat and usage pricing).

Office props:

- A small sublet floor, most desks unassigned, with a desk-booking screen at the door
- A ring light and webcam clipped to every monitor
- A workstation packed with graphics cards under a desk, a portable air-conditioner hose hanging out of the window
- A whiteboard headed 'runway' with the months crossed off
- A pile of returned laptops in courier boxes

Cards:

- **Rates rise** (March 2022). The central bank raises interest rates for the first time since 2018; eleven rises in
  sixteen months take them from near zero to above 5%.
  Effect as researched: fundingClimate x0.6 for 3 turns.
  Source: US Federal Reserve, first rise 16 March 2022; eleventh rise 26 July 2023, to 5.25-5.50%.
  Check: correct as written.
- **The chatbot** (November 2022). A research lab releases a free chatbot and a million people sign up in five days.
  Effect as researched: newUsers x1.5 this turn.
  Source: ChatGPT released 30 November 2022; one million users in five days according to OpenAI's chief executive (5
  December 2022).
  Check: correct as written.
- **Forty thousand** (January 2023). In under three weeks, three of the largest technology companies announce 40,000
  job cuts between them.
  Effect as researched: candidates +4 this turn.
  Source: Amazon 18,000 (4 January 2023), Microsoft 10,000 (18 January), Alphabet 12,000 (20 January).
  Check: correct as written.
- **Nine-figure offers** (June 2025). The head of an AI lab says a rival has offered his researchers signing bonuses
  of up to $100 million.
  Effect as researched: targetHeadcount -1; target highestQuality, minHeadcount 4.
  Source: Sam Altman on Meta's offers to OpenAI staff, reported 17 June 2025. Checked on the web: certain that the
  claim was made; the amounts are his claim and were disputed.
  https://www.bloomberg.com/news/articles/2025-06-17/altman-says-meta-offered-openai-staffers-100-million-bonuses
  Check: correct as written.
- **Four trillion** (July 2025). A maker of graphics chips becomes the first company valued at $4 trillion.
  Effect as researched: fundingClimate x1.4 for 2 turns.
  Source: Nvidia passed $4 trillion during trading on 9 July 2025 and closed just under it that day. Checked on the
  web.
  https://www.nbcnews.com/business/business-news/nvidia-becomes-first-company-worth-4-trillion-what-to-know-rcna217721
  Check: correct as written.

## Agent Economy (2027-2033; invented)

Fiction: software agents do most routine work, so a company of five can serve millions, and people are hired for
judgement and sign-off.

Game terms: Fiction, proposal, not simulated. salary 30K -> 60K, hiring.candidatesPerTurn 6 -> 3, quality.gainPerWork
4.5 -> 9, CPU teamCap values halved: tiny, expensive teams that ship fast. market.newUsersTurn1 16K -> 60K,
growthPerTurn 0.08: many 'users' are agents buying for people. churn.base 0.12 -> 0.18 and churn.perQualityPoint
0.0008 -> 0.0015: agents switch to the better product at once, so quality decides. pull.marketingCoefficient 0.3 ->
0.15: agents do not watch adverts. valuation.perUser 80 -> 50, with climate cards that swing harder and shorter (x0.5
and x1.6 for 1 or 2 turns). priceTiers 2/3/5 -> 1/2/4: prices fall.

Office props:

- A quiet room with three desks facing a wall of status tiles, one per software agent
- A glass-fronted liquid-cooled compute cabinet with a visible coolant loop
- A sign-off desk with a large green approve lever and a paper logbook
- Rooftop solar panels and a battery wall seen through the window
- A parcel-drone hatch set into the outside wall

Cards:

- **Agent outage** (March 2027 (fiction)). Fiction: a fault in a widely used agent platform stops automated work at
  thousands of firms for two days.
  Effect as researched: targetUsers 0.1 plus targetHype -10; target random, launched, qualityBelow 50, minUsers 1.
- **Compute crunch** (September 2028 (fiction)). Fiction: chip supply falls short and services ration new sign-ups for
  a quarter.
  Effect as researched: newUsers x0.7 this turn.
- **Sign-off law** (June 2029 (fiction)). Fiction: a new law requires a named person to approve every automated
  message sent to a customer.
  Effect as researched: marketingEffect x0.5 this turn.
- **The one-person billion** (February 2030 (fiction)). Fiction: a company with a single employee is valued at a
  billion.
  Effect as researched: fundingClimate x1.6 for 2 turns.
- **Back-office layoffs** (October 2031 (fiction)). Fiction: large firms replace whole departments with agents and
  experienced people flood the job market.
  Effect as researched: candidates +5 this turn.

## Ambient Age (2034-2040; invented)

Fiction: software leaves the screen for glasses, voices and home robots, a new mass market opens under strict safety
licences, and trust is worth more than advertising.

Game terms: Fiction, proposal, not simulated. market.newUsersTurn1 16K -> 80K, growthPerTurn 0.09 -> 0.10: a new
platform, like 1995 and 2008 again. salary 30K -> 75K, hiring.candidatesPerTurn 6 -> 4; a four-day week has no number
of its own (nearest: startup workExponent 0.9 -> 0.85). valuation.perUser stays 80 with a steady climate near 1.0
(pension and citizen funds); ipo.users 330K -> 1M. pull.marketingCoefficient 0.3 -> 0.1 and hype.launch 15 -> 25:
reputation moves users, adverts hardly do. Breach-style cards hit harder (targetUsers 0.2, qualityBelow 60): licences
and recalls. priceTiers 2/3/5 -> 3/5/9.

Office props:

- A timber-and-glass studio with a living moss wall
- Light-projected worktables with no monitors, and a rack of smart glasses by the door
- A mock kitchen where a home-helper robot is being tested
- A wall of stamped safety-licence plaques
- A greenhouse meeting room looking out on a wind turbine and the town's shared data hall

Cards:

- **Glasses outsell phones** (May 2034 (fiction)). Fiction: for the first time more smart glasses than handsets are
  sold in a quarter.
  Effect as researched: newUsers x1.5 this turn.
- **Home-helper recall** (November 2035 (fiction)). Fiction: a home-robot model is recalled after a software fault,
  and the weakest product in the market takes the blame.
  Effect as researched: targetUsers 0.2 plus targetHype -15; target random, launched, qualityBelow 60, minUsers 1.
- **Power rationing** (August 2036 (fiction)). Fiction: a hot summer forces data halls to ration electricity for a
  month.
  Effect as researched: newUsers x0.7 this turn.
- **Citizen funds** (March 2038 (fiction)). Fiction: public pension funds are allowed to back young companies
  directly.
  Effect as researched: fundingClimate x1.5 for 3 turns.
- **Trust mark** (September 2039 (fiction)). Fiction: the best-rated product is the first to earn a public trust mark.
  Effect as researched: targetHype +15; target highestQuality, launched.

## What the researcher was least sure of

- The September 1993 card: the web check found the month disputed (September 1993 or March 1994 for the dial-up
  service's gateway). It is marked unsure and worded without naming a service; drop it if every card must be exact to
  the month.
- Every era number (new users, growth, salary, valuation per user, candidates, marketing, prices, IPO bar) is a
  proposal. None was run through the simulator, and the four balance targets were tuned on today's numbers only. The
  salary levels in particular are guesses at the pay of the time.
- No card is dated 2026: I had no 2026 event I could state to the month with confidence, so the real deck ends in July
  2025 and the last real era has only 18 quarters to mid-2026.
- 'Certain' means confident from memory. Only four dates were checked on the web in this session (September 1993, July
  2004, June 2025, July 2025); the other 26 real cards should be checked against their source notes.
- Figures inside card texts are softer than the dates: the 44% click rate, 'more than a dozen' advertisers, 'about 55
  employees', 'about 500 titles', and the June 2025 bonus amounts, which are one side's claim.
- The growth anchors rest on world internet-user counts from memory (16M in 1995, 361M in 2000, 1,018M in 2005, about
  2.0B, 3.2B and 4.9B later). Sources disagree most on 1995 (16M to about 40M), so the 16.9% a quarter for 1995-2000 is
  approximate.
- A newUsers multiplier below 1 (two fiction cards use x0.7) looks safe from reading formulas.ts L94-95, but no
  shipped card or test uses one: not checked.
- Cloud and subscriptions map badly onto cards because no effect changes costs, prices or product speed; I put them
  into era numbers (starting cash, quality.gainPerWork, churn.base, priceTiers). Whether that reads as 'cloud' to a
  player is a design question.
- Era lengths are uneven (18 to 32 quarters), so the fit to a 20-turn race is loose for every era after the second.
  The split points (2000, 2007, 2014, 2022) are my judgement; 2008 or 2020 would also be defensible boundaries.
- Two cards rest on real harm (the 2008 bank collapse and the 2020 pandemic). The wording is neutral, but whether to
  include them is the owner's call.

## The fact-check, in its own words


All 30 real cards have the right date. 24 are correct as written, 6 are imprecise in their wording, none is wrong and
none was left unverifiable. No card name or card text, real or fiction, names a real company, product or person; the
era names, shift lines and office props are clean too.

The six imprecise cards (the fix for each is in its verdict):
- Endless September (September 1993): the stated cause is off. The largest online service opened its gateway to the
  discussion groups on 28 February 1994, not in September 1993.
- First banner adverts (October 1994): "the first" is the usual credit but contested, so it should be hedged.
- Six-fold debut (November 1998): the name only. The shares closed at about seven times the offer price.
- Cloud outage (April 2011): "offline for days" is too strong. Most affected storage was back in about 36 hours and
  full recovery took about four days.
- Thirteen people, one billion (April 2012): "pays" should be "agrees to pay". The deal was worth about $715 million
  when it closed.
- Privacy law (May 2018): "a whole continent" should be a bloc of 28 countries.

Looked up on the web this run (13 cards): Endless September, First banner adverts, First-day pop, Six-fold debut,
Dot-com ad break, The worst week, Mascot for sale, Broadband majority, Cloud outage, Thirteen people one billion,
Nineteen billion, Forty thousand, Nine-figure offers. For Endless September and Cloud outage I also read the primary
article and the provider's own post-mortem.

Checked from memory only (17 cards): Recession, A web of pages, Free for all, The backbone goes private, Irrational
exuberance, The bottom, Video site sale, The touchscreen phone, The app shop opens, Bank collapse, Privacy law, The
pulled offering, Everyone goes home, Work from anywhere, Rates rise, The chatbot, Four trillion. These are
well-documented dates and I am confident of them.

Three things outside the brief:
- The "Free for all" source note says the browser release "followed" on 22 April 1993, but that is before the 30 April
  statement. The card text is unaffected.
- The "Cheap Money Years" shift line says near-zero rates lasted most of a decade. The US policy rate rose to
  2.25-2.50% by the end of 2018, so "very low" is safer.
- In "The app shop opens", "10 million downloads" reads more clearly than "10 million are downloaded".

The 10 fiction cards are not in the verdict list; they were only scanned for real names and none was found. "Trust
mark" is a generic term that also happens to be the name of real bodies, which I judge low risk.
