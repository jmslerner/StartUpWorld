// The career's own rules, as pure functions. They apply only to a config that has a `career` block; the race's
// config has none. The rules are recorded in docs/career-rules.md.

import type { CareerRules } from "./types";

/** The office for a team of this size: the smallest that holds it, or the last one when none does. */
export const officeFor = (headcount: number, career: CareerRules): number => {
  const smallest = career.offices.findIndex((office) => office.capacity >= headcount);
  return smallest === -1 ? career.offices.length - 1 : smallest;
};
