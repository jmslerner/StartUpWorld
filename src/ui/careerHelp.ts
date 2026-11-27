// How to play a career, in a few short sections. Every number comes from the config, so the text stays true after
// tuning; numbers that change with the era (salaries, prices, the bar for going public) are not given, and the text
// says the plan shows the year's. A race has no such sections: its text is in HowToPlay.tsx.

import { rulesForTurn, yearOf } from "../engine";
import type { RulesConfig } from "../engine/types";
import { percent } from "./format";
import { MARKET_WORDS } from "./marketView";
import { CARRY_WORDS } from "./officeMoves";
import { DESKTOP_QUERY, OFFICE_WORDS } from "./officeView";

/** The narrowest desktop window that shows the 3D office, read from the query that decides it. */
const desktopWidth = (): string => /min-width:\s*(\d+)px/.exec(DESKTOP_QUERY)?.[1] ?? "1024";

export interface HelpSection {
  readonly title: string;
  readonly text: string;
}

/** A span of years in words: "half a year", "a year", "2 years". */
const years = (value: number): string => (value === 0.5 ? "half a year" : value === 1 ? "a year" : `${value} years`);

/** A share kept in words: "half", or "40%". */
const share = (value: number): string => (value === 0.5 ? "half" : percent(value));

/** "1 seat", "2 seats". */
const seats = (value: number): string => `${value} ${value === 1 ? "seat" : "seats"}`;

/** The how-to-play sections for a career, in order; [] in a race. */
export const careerHelp = (config: RulesConfig): readonly HelpSection[] => {
  const rules = rulesForTurn(config, 1);
  const career = rules.career;
  if (career === undefined) return [];
  const firstYear = yearOf(1, career);
  const lastYear = yearOf(rules.game.maxTurns, career);
  const eras = career.eras;
  const firstInvented = eras.find((era) => era.invented);
  const history =
    firstInvented === undefined
      ? "Every year's news follows history."
      : `Up to ${firstInvented.firstYear - 1} the news follows history; from ${firstInvented.firstYear} it is invented.`;
  const { listing, rescue, offices, moving, replacement } = career;
  const sizes = offices.map((office) => `${office.name} ${office.capacity}`).join(", ");
  const largest = offices[offices.length - 1];
  const rescueHype = rescue.hype < 0 ? `you lose ${-rescue.hype} hype` : `you gain ${rescue.hype} hype`;

  return [
    {
      title: "The goal",
      text: `Build one company from ${firstYear} to ${lastYear}. When ${lastYear} ends, the founder whose stake (equity × valuation) is worth the most, among the companies still in the game, wins.`,
    },
    {
      title: "One year at a time",
      text: "Each year you and your rivals plan at the same time. Split your people between three jobs, set a marketing budget and a price, then end the year and read the annual report. A year may open with a news card; you see it before you plan.",
    },
    {
      title: "Eras and history",
      text: `The years are split into ${eras.length} eras, from ${eras[0].name} to ${eras[eras.length - 1].name}. Each era has its own salaries, prices, market and bar for going public; the plan always shows the year's. ${history} A platform shift, which caps every product's quality, is announced ${years(career.shiftNoticeYears)} ahead.`,
    },
    {
      title: "Product, Growth, Recruiting",
      text: "Product raises quality; once it is good enough you launch and start winning users, and higher quality keeps them. Growth adds pull: each year's new users are shared out by pull, which is quality lifted by growth work, marketing, a lower price and hype. Recruiting hires people, who start next year. Bigger teams lose a little to coordination.",
    },
    {
      title: "Cash and raising money",
      text: `Each person costs the year's salary and each user pays the year's price; the plan shows both. End a year below $0 and your company needs its one rescue. With enough users you can sell part of the company for cash, and each raise puts an investor on your board. Once investors outnumber founders, a year in which users fall or runway drops under ${years(rules.board.runwayTurns)} carries a ${percent(rules.board.fireChance)} chance they fire you.`,
    },
    {
      title: "Going public",
      text: `Once you reach the year's bar of users and end a year in profit, you may go public. You sell ${percent(listing.percent / 100)} of the company, gain ${listing.hype} hype, and investors gain ${seats(listing.investorSeats)} on your board. From then on your company is valued ${percent(listing.premium - 1)} above a private one with the same users and hype. A public company cannot raise privately, and going public drops that year's raise.`,
    },
    {
      title: "Offices",
      text: `Your team works in one office at a time. The offices, and the most people each holds: ${sizes}. A team that ends a year larger than its office moves to the smallest one that holds it, and pays a one-off bill of ${years(moving.salaryYears)} of salary for everyone on the team. The ${largest.name.toLowerCase()} cannot be outgrown: you cannot hire past ${largest.capacity}.`,
    },
    {
      title: "One rescue",
      text: `The first time your company would go out, below $0 or fired by its board, it is rescued instead. You keep ${share(rescue.equityKept)} of your stake, investors take the board, ${rescueHype}, and cash below $0 is reset to ${years(rescue.salaryYears)} of salaries. The year after, the board does not vote. A second failure ends your career.`,
    },
    {
      title: "Rivals come and go",
      text: `Your rivals play by the same rules, and each has one rescue too. A rival that goes out is replaced ${years(replacement.afterYears)} later by a new startup. The annual report says which rivals went public, were rescued or moved office.`,
    },
    {
      title: "The 3D office",
      text: `In a desktop browser window at least ${desktopWidth()} pixels wide, the career's main screen is your office, drawn in 3D; the "${OFFICE_WORDS.toggle}" switch shows or hides it. To move someone to another team, click a person, then a person of another team or that team's button; "${CARRY_WORDS.keep}" or Escape puts them back. After you end a year, it plays out for a few seconds with captions: people leave, hires walk in, the company moves. "${OFFICE_WORDS.skip}" ends it at once, and with reduced motion it does not play. If the office cannot be drawn, or stops drawing ("${OFFICE_WORDS.reload}" tries again), the 2D screens carry the whole game.`,
    },
    {
      title: "The market",
      text: `"${OFFICE_WORDS.market}" shows the four companies as buildings: the more users, the taller. Yours is the first, on the left. Each building is labelled with its name and users, yours marked "You". The bar of users for going public is a gold ring at its height round each lot, which a building grows into, and a public company flies a flag. Each year ends there, showing where its new users went. Click a building, or a rival's "${MARKET_WORDS.show}", to see its public numbers; "${OFFICE_WORDS.office}" goes back to your office.`,
    },
    {
      title: "Sound",
      text: "A short sound marks each year's main milestone, such as going public, a move or a new era, and people come and go with footsteps. The Sound menu mutes it or sets the volume.",
    },
  ];
};
