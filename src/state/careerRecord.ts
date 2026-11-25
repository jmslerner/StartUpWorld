// The career's record: the milestones of a career, year by year, collected from each year's log. The
// player's own (seat 0) come from its report; rivals' exits and the newcomers that take their seats come
// from the other reports and the log's entrants. Saved with the career, so it is checked field by field
// when read back.

import type { CompanyId, GameState, OutReason, TurnLog } from "../engine/types";
import { isRecord } from "./shape";

export type Milestone =
  | { readonly kind: "launch"; readonly turn: number }
  | { readonly kind: "office"; readonly turn: number; readonly from: number; readonly to: number }
  | { readonly kind: "listed"; readonly turn: number; readonly amount: number }
  | { readonly kind: "rescued"; readonly turn: number; readonly reason: OutReason }
  | { readonly kind: "out"; readonly turn: number; readonly reason: OutReason }
  | { readonly kind: "rivalOut"; readonly turn: number; readonly seat: CompanyId; readonly name: string; readonly founded: number; readonly reason: OutReason }
  | { readonly kind: "rivalIn"; readonly turn: number; readonly seat: CompanyId; readonly name: string; readonly pitch: string };
export type CareerRecord = readonly Milestone[];

const PLAYER: CompanyId = 0;

/** The milestones one year adds: the player's (seat 0) from its report, rivals' exits and arrivals. */
export const milestonesOf = (before: GameState, log: TurnLog, after: GameState): Milestone[] => {
  const turn = log.turn;
  const milestones: Milestone[] = [];
  const player = log.companies[PLAYER];
  if (player) {
    if (player.quality.launchedNow) milestones.push({ kind: "launch", turn });
    const career = player.career;
    if (career?.office) milestones.push({ kind: "office", turn, from: career.office.from, to: career.office.to });
    if (career?.listing) milestones.push({ kind: "listed", turn, amount: career.listing.amount });
    if (career?.rescue) milestones.push({ kind: "rescued", turn, reason: career.rescue.reason });
    if (player.out) milestones.push({ kind: "out", turn, reason: player.out });
  }
  log.companies.forEach((report, seat) => {
    if (seat === PLAYER || !report?.out || !report.career) return;
    const company = before.companies[seat];
    if (!company.career) return;
    milestones.push({ kind: "rivalOut", turn, seat, name: company.name, founded: company.career.founded, reason: report.out });
  });
  for (const seat of [...(log.entrants ?? [])].sort((a, b) => a - b)) {
    const company = after.companies[seat];
    milestones.push({ kind: "rivalIn", turn: turn + 1, seat, name: company.name, pitch: company.pitch });
  }
  return milestones;
};

type Check = (value: unknown) => boolean;

const whole: Check = (value) => Number.isInteger(value) && (value as number) >= 0;
const positive: Check = (value) => Number.isInteger(value) && (value as number) >= 1;
const finite: Check = (value) => typeof value === "number" && Number.isFinite(value);
const text: Check = (value) => typeof value === "string";
const reason: Check = (value) => value === "bankrupt" || value === "fired";

/** The fields each kind holds besides `kind` and `turn`, and their checks. */
const fieldsOf = (seats: number): Readonly<Record<Milestone["kind"], Readonly<Record<string, Check>>>> => {
  const seat: Check = (value) => whole(value) && (value as number) < seats;
  return {
    launch: {},
    office: { from: whole, to: whole },
    listed: { amount: finite },
    rescued: { reason },
    out: { reason },
    rivalOut: { seat, name: text, founded: whole, reason },
    rivalIn: { seat, name: text, pitch: text },
  };
};

export const isCareerRecord = (value: unknown, seats: number): value is CareerRecord => {
  if (!Array.isArray(value)) return false;
  const fields = fieldsOf(seats);
  return value.every((entry) => {
    if (!isRecord(entry) || typeof entry.kind !== "string" || !Object.hasOwn(fields, entry.kind)) return false;
    const checks = fields[entry.kind as Milestone["kind"]];
    return positive(entry.turn) && Object.entries(checks).every(([key, check]) => check(entry[key]));
  });
};
