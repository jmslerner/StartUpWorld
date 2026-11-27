#!/usr/bin/env node
/**
 * The browser check of the career's 3D office: builds the app, serves `dist` with `vite preview`, and plays the
 * career in headless Chromium at 1280x800 with WebGL 2 (through the software renderer), reading the office through
 * `window.__careerOffice` (src/ui/officeProbe.ts).
 *
 *   node scripts/office-check.mjs [--no-build] [--shots <dir>] [--only <n,n,...>]
 *
 * In order: (1) the race is unchanged and never loads the office; (2) the office opens as the career's main view,
 * beside the plan, above the bottom bar, in 1990 and on the nineties, noughties and twenties fixtures; (3) a year
 * plays out beat by beat, End is refused while it plays or a report is open, Skip ends it; (4) a person moved by
 * pointing; (5) an office move and the three looks, and a full campus; (6) the world taken down cleanly on every way
 * out; (7) a hidden tab and resizes; (8) reduced motion; (9) the "3D office" switch; (10) the fallbacks: no WebGL, the
 * office's chunk blocked, a context lost during a year; (11) a reload while a year plays out; (12) a whole career
 * through the 3D screen; (13) a narrow touch window; (15) the market view: the switch, the buildings, a company's card,
 * the year ending on the market, and Skip, a narrowed window or a lost context during that beat, and the labels over
 * the buildings and the bar (their words, the player's "You", none overlapping or under the card, none a target, opaque,
 * hidden from screen readers, gone with the market); (16) every era's look within its draw-call ceiling; (17) the market's draw calls and labels in
 * every era; (18) the career's sounds: the
 * milestone once as the summary opens, the market's stream, footsteps, nothing on a reload; (19) the start tour with the
 * 3D office: the team step says how to move a person there, a click on a person still starts a carry with the card
 * up, the card hides while the year plays out and its summary is open, and Done is remembered. Step 14, no console
 * errors on any page, runs last, always. Every page fails on any console error or page error, but the
 * software renderer's "GPU stall due to ReadPixels".
 *
 * Every fresh page marks the start tour as seen (localStorage "startupworld:tour:v1"), unless asked for the tour.
 *
 * Exits 1 on the first failed assertion, naming it. `--shots <dir>` saves screenshots into <dir>. `--no-build` serves
 * the `dist` that is there. `--only` runs only the steps named (for working on one). Not part of `npm test`: it
 * needs a browser and takes minutes. The fixtures come from `npx tsx scripts/career-fixtures.ts`.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { raceText, stubAnalytics } from "./race-text.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4181;
const BASE = `http://localhost:${PORT}`;
const CAREER_KEY = "startupworld:career:save";
const TOUR_KEY = "startupworld:tour:v1";
const OFFICE_KEY = "startupworld:office:v1";
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const FIRST_YEAR = 1990;
const LAST_YEAR = 2038;
const YEARS = LAST_YEAR - FIRST_YEAR + 1;
/** A dialog ignores a click this soon after it opens, and "End" one this soon after a dialog closes, with a margin. */
const SETTLE_MS = 600;
const FORBIDDEN = /\b(quarters?|quarterly|turns?)\b|\bQ\d{1,2}\b/i;
/** The one console message allowed: the software renderer logs it whenever the world draws. */
const ALLOWED_CONSOLE = /GPU stall due to ReadPixels/;
/** The world's caps on figures drawn (src/world/cast.ts). */
const MAX_STAFF_DRAWN = 50;
const MAX_WAITING_DRAWN = 6;
/** The world's second of grace before it rests (core/rest.ts); no frame for this long means it rests. */
const REST_AFTER_MS = 1000;
const QUIET_MS = 1500;
/** The look of each era id (src/world/core/colors.ts, ERA_LOOKS), copied: each era has the look of its own name; any other id is "classic". */
const ERA_LOOKS = {
  "dial-up": "dial-up",
  "gold-rush": "gold-rush",
  bust: "bust",
  phones: "phones",
  "cheap-money": "cheap-money",
  "winter-ai": "winter-ai",
  agents: "agents",
  ambient: "ambient",
};
const lookFor = (era) => (Object.hasOwn(ERA_LOOKS, era) ? ERA_LOOKS[era] : "classic");
/** The eras by first year, as the design fixes them. */
const ERAS = [
  [1990, "Dial-up dawn"],
  [1995, "Browser gold rush"],
  [2000, "Bust and broadband"],
  [2007, "Phones and cloud"],
  [2014, "Cheap money years"],
  [2022, "Winter and AI"],
  [2027, "Agent economy"],
  [2033, "Ambient age"],
];
const eraOf = (year) => ERAS.filter(([first]) => first <= year).pop()[1];
/** The words of the office's screen (src/ui/officeView.ts, src/ui/officeMoves.ts). */
const WORDS = {
  toggle: "3D office",
  unavailable: "The 3D office cannot be shown on this device. The game is complete without it.",
  narrow: "The 3D office needs a desktop browser window at least 1024 pixels wide.",
  reload: "Reload 3D view",
  skip: "Skip",
  keep: "Keep them",
  carry: "Move a person between teams",
};

// ---------------------------------------------------------------------------------------------------------------
// Arguments

const argValue = (name) => {
  const at = process.argv.indexOf(name);
  if (at === -1) return null;
  const value = process.argv[at + 1];
  if (value === undefined || value.startsWith("--")) {
    console.error(`${name} needs a value`);
    process.exit(2);
  }
  return value;
};
const shotsArg = argValue("--shots");
const shotsDir = shotsArg === null ? null : resolve(shotsArg);
const onlyArg = argValue("--only");
const only = onlyArg === null ? null : new Set(onlyArg.split(",").map(Number));
const build = !process.argv.includes("--no-build");
const runs = (step) => only === null || only.has(step);

// ---------------------------------------------------------------------------------------------------------------
// The server, killed on every way out

let server = null;
const browsers = [];
const stopServer = () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    try {
      server.kill("SIGTERM");
    } catch {
      // Already gone.
    }
  }
};
process.on("exit", stopServer);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    stopServer();
    process.exit(130);
  });
}

const answers = (host, port) =>
  new Promise((done) => {
    const socket = connect({ host, port });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      done(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      done(false);
    });
    socket.once("error", () => done(false));
  });

const startServer = async () => {
  for (const host of ["127.0.0.1", "::1"]) {
    if (await answers(host, PORT)) throw new Error(`port ${PORT} is already in use (on ${host}): stop whatever holds it and run again`);
  }
  server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: ROOT, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  server.stdout.on("data", (chunk) => (output += chunk));
  server.stderr.on("data", (chunk) => (output += chunk));
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    if (server.exitCode !== null) throw new Error(`vite preview exited:\n${output}`);
    if (output.includes("Local:")) {
      try {
        if ((await fetch(`${BASE}/`)).ok) return;
      } catch {
        // Not listening yet.
      }
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`vite preview did not answer on port ${PORT}:\n${output}`);
};

// ---------------------------------------------------------------------------------------------------------------
// Assertions: the first that fails ends the run, naming it

class Failed extends Error {}

let current = "";
const assert = (ok, what) => {
  if (!ok) throw new Failed(`${current}: ${what}`);
};
const passed = (what) => console.log(`  ok  ${what}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Every console error and page error on a page (but the software renderer's warning); checked after every step. */
const pages = [];
const watch = (page, allowed = null) => {
  const bad = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (ALLOWED_CONSOLE.test(text) || (allowed !== null && allowed.test(text))) return;
    bad.push(`console error: ${text}`);
  });
  page.on("pageerror", (error) => bad.push(`page error: ${error.message}`));
  pages.push(bad);
  return bad;
};
const noErrors = () => {
  for (const bad of pages) assert(bad.length === 0, bad.join(" | "));
};

/** The tab's count of `[data-office]` and `[data-world]` elements ever added, kept in sessionStorage across reloads. */
const OFFICE_ADDS = "officeCheck:officeAdds";
const countOfficeAdds = (key) => {
  const seen = (node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return 0;
    const self = node.matches("[data-office]") ? 1 : 0;
    return self + node.querySelectorAll("[data-office]").length;
  };
  const worlds = (node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return 0;
    const self = node.matches("[data-world]") ? 1 : 0;
    return self + node.querySelectorAll("[data-world]").length;
  };
  new MutationObserver((records) => {
    let offices = 0;
    let world = 0;
    for (const record of records)
      for (const node of record.addedNodes) {
        offices += seen(node);
        world += worlds(node);
      }
    const add = (name, count) => {
      if (count > 0) sessionStorage.setItem(`${key}:${name}`, String(Number(sessionStorage.getItem(`${key}:${name}`) ?? "0") + count));
    };
    add("office", offices);
    add("world", world);
  }).observe(document, { childList: true, subtree: true });
};
const officeAdds = (page) =>
  page.evaluate((key) => ({ office: Number(sessionStorage.getItem(`${key}:office`) ?? "0"), world: Number(sessionStorage.getItem(`${key}:world`) ?? "0") }), OFFICE_ADDS);

const OFFICE_OR_WORLD_CHUNK = /assets\/(CareerOffice|WorldView)-/;
const requested = new WeakMap();
const requestsOf = (page) => requested.get(page) ?? [];

/** A fresh context (fresh storage) and a page in it, its errors watched, its requests and office elements counted. */
const freshPage = async (browser, { size = DESKTOP, allowed = null, tour = false, ...options } = {}) => {
  const context = await browser.newContext({ viewport: size, ...options });
  if (!tour) {
    await context.addInitScript(([key]) => {
      try {
        if (localStorage.getItem(key) === null) localStorage.setItem(key, "done");
      } catch {
        // Blocked storage reads as seen.
      }
    }, [TOUR_KEY]);
  }
  await context.addInitScript(countOfficeAdds, OFFICE_ADDS);
  const page = await context.newPage();
  const urls = [];
  requested.set(page, urls);
  page.on("request", (request) => urls.push(request.url()));
  watch(page, allowed);
  await stubAnalytics(page);
  return { context, page };
};

const shot = async (page, name) => {
  if (shotsDir !== null) await page.screenshot({ path: join(shotsDir, name) });
};

// ---------------------------------------------------------------------------------------------------------------
// The page

const header = (page) => page.locator("main header h1");
const dialog = (page) => page.locator('[role="dialog"]');
const endButton = (page, year) => page.getByRole("button", { name: `End ${year}`, exact: true });
const toggle = (page) => page.locator("main header").getByRole("button", { name: WORDS.toggle, exact: true });
const reloadButton = (page) => page.locator("main header").getByRole("button", { name: WORDS.reload, exact: true });
const playBar = (page) => page.locator('[role="status"]', { has: page.getByRole("button", { name: WORDS.skip, exact: true }) });
const skipButton = (page) => page.getByRole("button", { name: WORDS.skip, exact: true });
const planPanel = (page) => page.locator('section[aria-label^="Plan for "]');
const officeCell = (page) => page.locator("[data-office]");
const carryStrip = (page) => page.getByRole("group", { name: WORDS.carry, exact: true });
const careerSave = (page) => page.evaluate((key) => localStorage.getItem(key), CAREER_KEY);

/** The office's probe, called by name with JSON arguments. */
const office = (page, method, ...args) =>
  page.evaluate(([method, args]) => {
    const probe = window.__careerOffice;
    if (probe === undefined) return method === "status" ? "none" : null;
    return probe[method](...args);
  }, [method, args]);

/** Waits for the office to be running, within `ms`. */
const running = async (page, ms = 30000) => {
  const until = Date.now() + ms;
  let status = null;
  while (Date.now() < until) {
    status = await office(page, "status");
    if (status === "running" && (await office(page, "stats")) !== null) return;
    await sleep(200);
  }
  assert(false, `the office's status is ${JSON.stringify(status)}, not "running", after ${ms / 1000} s`);
};

/**
 * Watches `framesDrawn` (of the live world, or of the retired one) until no frame has been drawn for QUIET_MS, or
 * `watchMs` passes. Returns whether it rested, the page time from now to the last frame, the frames drawn, and the
 * world seconds of those frames up to a second before the last one (when the last thing stopped moving), measured
 * as the world measures a frame: the first after a stop counts 1/60 s, none more than 0.1 s.
 */
const watchRest = (page, { retired = false, watchMs = 30000 } = {}) =>
  page.evaluate(
    ({ retired, watchMs, quietMs, graceMs }) =>
      new Promise((done) => {
        const probe = window.__careerOffice;
        const read = () => (retired ? probe.retiredStats() : probe.stats())?.framesDrawn ?? null;
        const start = performance.now();
        const first = read();
        let frames = first;
        let previous = null;
        const drawn = [];
        const look = () => {
          const now = performance.now();
          const count = read();
          if (count !== frames) {
            frames = count;
            const seconds = previous === null ? 1 / 60 : Math.min(0.1, Math.max(0.001, (now - previous) / 1000));
            drawn.push({ at: now, seconds });
            previous = now;
          }
          const last = drawn.length > 0 ? drawn[drawn.length - 1].at : start;
          if (now - last >= quietMs || now - start > watchMs) {
            const settled = drawn.filter((frame) => frame.at <= last - graceMs).reduce((sum, frame) => sum + frame.seconds, 0);
            done({ rested: now - last >= quietMs, restMs: Math.round(last - start), frames: (frames ?? 0) - (first ?? 0), settledS: settled, at: drawn.map((frame) => Math.round(frame.at - start)) });
          } else setTimeout(look, 50);
        };
        setTimeout(look, 50);
      }),
    { retired, watchMs, quietMs: QUIET_MS, graceMs: REST_AFTER_MS },
  );

const rests = async (page, where, options) => {
  const rest = await watchRest(page, options);
  assert(rest.rested, `${where}: the office never came to rest`);
  return rest;
};

/** framesDrawn does not change over one second of page time. */
const stillForASecond = async (page, retired = false) => {
  const read = () => office(page, retired ? "retiredStats" : "stats");
  const before = await read();
  await sleep(1000);
  const after = await read();
  return before !== null && after !== null && before.framesDrawn === after.framesDrawn;
};

/** The people the office draws for a scene: staff capped at 50, those at the door at 6. */
const figures = (scene) =>
  Math.min(scene.teams.product + scene.teams.growth + scene.teams.recruiting + scene.away + scene.leaving, MAX_STAFF_DRAWN) +
  Math.min(scene.arriving, MAX_WAITING_DRAWN);
const ceiling = (stats) => Math.min(800, 80 + 14 * stats.figures);

/** Opens the dialog that shows and waits until it takes clicks. */
const opened = async (page, timeout = 30000) => {
  await dialog(page).waitFor({ timeout });
  await page.waitForTimeout(SETTLE_MS);
  return dialog(page);
};
const closeWith = async (page, name) => {
  await dialog(page).getByRole("button", { name, exact: true }).click();
  await dialog(page).waitFor({ state: "detached" });
  await page.waitForTimeout(SETTLE_MS);
};

const readableText = (locator) =>
  locator.evaluate((root) => {
    const parts = [];
    const skip = (element) => element.closest("[data-card-text]") !== null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let node = walker.currentNode; node !== null; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement;
        if (parent === null || skip(parent) || parent.closest("script, style") !== null) continue;
        parts.push(node.textContent);
      } else if (!skip(node)) {
        for (const name of ["title", "aria-label"]) {
          const value = node.getAttribute(name);
          if (value !== null) parts.push(value);
        }
      }
    }
    return parts.join("\n");
  });
const noForbiddenWords = async (locator, where) => {
  const text = await readableText(locator);
  const found = text.match(FORBIDDEN);
  if (found !== null) assert(false, `${where} says "${found[0]}": ${JSON.stringify(text.split("\n").find((each) => FORBIDDEN.test(each)))}`);
};

/** A new career, seed 1, named Check Co, on its first year. */
const startCareer = async (page) => {
  await page.goto(`${BASE}/`);
  await page.getByLabel("Name your startup").waitFor();
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: /Career/ }).click();
  await page.getByLabel("Name your startup").fill("Check Co");
  await page.getByText("Replay a game with its seed").click();
  await page.getByPlaceholder("for example 20417").fill("1");
  await page.locator("form button[type=submit]").click();
  await endButton(page, FIRST_YEAR).waitFor();
};

/** `save` under the career's key, loaded. */
const loadSave = async (page, save, year) => {
  await page.goto(`${BASE}/`);
  await page.getByLabel("Name your startup").waitFor();
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [CAREER_KEY, save]);
  await page.reload();
  await endButton(page, year).waitFor();
};

const box = async (locator) => {
  const found = await locator.boundingBox();
  assert(found !== null, "an element has no box");
  return found;
};

/** The planning panel's count for a team. */
const teamCount = async (page, name) => Number(await planPanel(page).locator(`[role="group"][aria-label="${name}"] output`).innerText());
/** The hires the planning panel expects this year: "expect N", "at least N", or 0 for "none for sure" or no hiring row. */
const expectedHires = async (page) => {
  const found = (await planPanel(page).innerText()).match(/\b(?:expect|at least) (\d+)\b/i);
  return found === null ? 0 : Number(found[1]);
};

/** The office is laid out as the career's main view, beside the plan, above the bottom bar, nothing scrolled. */
const mainView = async (page, year, where) => {
  const cell = await box(officeCell(page));
  const plan = await box(planPanel(page));
  const bar = await box(page.locator("div.fixed.inset-x-0.bottom-0").first());
  const scrolled = await page.evaluate(() => window.scrollY);
  assert(scrolled === 0, `${where}: the page is scrolled by ${scrolled} px`);
  assert(cell.x + cell.width <= plan.x + 0.5, `${where}: the office (${cell.x}..${cell.x + cell.width}) is not left of the plan (${plan.x})`);
  assert(cell.width >= 600, `${where}: the office is ${cell.width} px wide`);
  assert(cell.x >= 0 && cell.y >= 0 && cell.x + cell.width <= DESKTOP.width && cell.y + cell.height <= DESKTOP.height, `${where}: the office is not wholly in the viewport: ${JSON.stringify(cell)}`);
  assert(cell.y + cell.height <= bar.y + 0.5, `${where}: the office (bottom ${cell.y + cell.height}) runs under the bottom bar (top ${bar.y})`);
  const heading = await header(page).innerText();
  assert(heading.includes(`${year} · year ${year - FIRST_YEAR + 1} of ${YEARS}`), `${where}: the header reads ${JSON.stringify(heading)}`);
  const timeline = page.locator('main section[aria-label="Timeline"]');
  assert(await timeline.isVisible(), `${where}: the timeline is not visible`);
  assert((await timeline.innerText()).includes(eraOf(year)), `${where}: the timeline does not name ${eraOf(year)}`);
  const here = await timeline.evaluate((section) => {
    const strip = section.querySelector(".overflow-x-auto").getBoundingClientRect();
    const label = section.querySelector("[data-here]")?.getBoundingClientRect() ?? null;
    return label === null ? null : label.left >= strip.left - 0.5 && label.right <= strip.right + 0.5;
  });
  assert(here === true, `${where}: "you are here" is cut off by the timeline's edge or missing`);
  for (const label of ["Your career", "If this plan plays out", "Rivals"]) {
    assert((await page.locator(`main section[aria-label="${label}"]`).count()) === 1, `${where}: the "${label}" panel is not on the page`);
  }
};

/** The office's figures match the scene, it rests, and its draw calls are under the ceiling. Returns its stats. */
const officeFigures = async (page, where) => {
  await rests(page, where);
  assert(await stillForASecond(page), `${where}: the office draws frames at rest`);
  const stats = await office(page, "stats");
  const scene = await office(page, "scene");
  assert(stats.figures === figures(scene), `${where}: ${stats.figures} figures drawn, the scene has ${figures(scene)}`);
  assert(stats.drawCalls <= ceiling(stats), `${where}: ${stats.drawCalls} draw calls, over the ceiling of ${ceiling(stats)}`);
  return { stats, scene };
};

/** The draw calls measured on each office, for the report. */
const measured = [];

// ---------------------------------------------------------------------------------------------------------------
// 1. The race unchanged

const raceUnchanged = async (browser) => {
  current = "1. Race unchanged";
  const { context, page } = await freshPage(browser);
  const expected = JSON.parse(readFileSync(resolve(ROOT, "scripts/race-text.snapshot.json"), "utf8"));
  const texts = await raceText(page, BASE);
  assert(texts.length === expected.length, `the race gave ${texts.length} texts, the snapshot has ${expected.length}`);
  texts.forEach((text, n) => assert(text === expected[n], `the race's text ${n + 1} differs from scripts/race-text.snapshot.json`));
  assert((await page.locator("canvas").count()) === 0, "a canvas is on the race's page");
  const chunk = requestsOf(page).find((url) => OFFICE_OR_WORLD_CHUNK.test(url));
  assert(chunk === undefined, `the race requested the office or the world: ${chunk}`);
  const scripts = [...new Set(requestsOf(page).map((url) => new URL(url).pathname).filter((path) => /^\/assets\/[^/]+\.js$/.test(path)))];
  assert(scripts.length > 0, "the race requested no script under assets/");
  const renderer = scripts.filter((path) => readFileSync(resolve(ROOT, `dist${path}`), "utf8").includes("WebGLRenderer"));
  assert(renderer.length === 0, `the race loaded three's renderer in ${renderer.join(", ")}`);
  noErrors();
  passed(`the race's text matches its snapshot; no canvas, no office or world chunk, none of its ${scripts.length} scripts holds WebGLRenderer`);
  await context.close();
};

// ---------------------------------------------------------------------------------------------------------------
// 2. The office opens as the main view

const opens = async (browser, fixtures) => {
  current = "2. The office opens";
  const { context, page } = await freshPage(browser);
  await startCareer(page);
  await running(page);
  await mainView(page, FIRST_YEAR, "1990");
  const first = await officeFigures(page, "1990");
  assert(first.scene.year === FIRST_YEAR, `the scene's year is ${first.scene.year}`);
  measured.push({ where: "1990, garage (new career)", office: first.scene.office, figures: first.stats.figures, drawCalls: first.stats.drawCalls });
  const news = [(await page.locator('main section[aria-label="This year\'s event"]').count()) > 0];
  await shot(page, "1990-office.png");
  noErrors();
  passed(`1990: running, the office left of the plan and above the bar; ${first.stats.figures} figures as the scene says, ${first.stats.drawCalls} draw calls, at rest`);
  await context.close();

  for (const name of ["nineties", "noughties", "twenties"]) {
    const { save, year } = fixtures[name];
    const { context: other, page: there } = await freshPage(browser);
    await loadSave(there, save, year);
    await running(there);
    await mainView(there, year, `${name} (${year})`);
    const seen = await officeFigures(there, `${name} (${year})`);
    news.push((await there.locator('main section[aria-label="This year\'s event"]').count()) > 0);
    noErrors();
    passed(`${year} (${name}): the office is the main view; ${seen.stats.figures} figures, ${seen.stats.drawCalls} draw calls, at rest`);
    await other.close();
  }
  assert(news.some(Boolean) && news.some((shown) => !shown), `the four pages do not cover both a news card and none: ${JSON.stringify(news)}`);
  passed(`the news card shown on ${news.filter(Boolean).length} of the four pages and not on ${news.filter((shown) => !shown).length}`);
};

// ---------------------------------------------------------------------------------------------------------------
// 3. A year plays out, beat by beat; 4. moving a person by pointer

/** Raises Recruiting by one with its stepper, taking someone off Product first when nobody is unassigned. */
const raiseRecruiting = async (page) => {
  const more = planPanel(page).getByRole("button", { name: "More: Recruiting", exact: true });
  if (await more.isDisabled()) await planPanel(page).getByRole("button", { name: "Less: Product", exact: true }).click();
  const before = await teamCount(page, "Recruiting");
  await more.click();
  assert((await teamCount(page, "Recruiting")) === before + 1, "Recruiting did not go up by one");
};

/** The caption's number of people: "One hire walks in" is 1, "3 hires walk in" is 3. */
const countIn = (line) => (/^One /.test(line) ? 1 : Number(line.match(/^(\d+) /)?.[1] ?? NaN));

/**
 * Ends `year` and samples the bar and the scene every 200 ms while the bar shows. Returns the samples, the page time
 * until the summary opened, and how many dialogs were ever open at once while the bar showed.
 */
/** Skip pressed and timed in the page: from the press to the first moment a dialog is in the document. */
const skipTimed = (page) =>
  page.evaluate(
    () =>
      new Promise((done) => {
        const button = [...document.querySelectorAll("button")].find((each) => each.textContent === "Skip");
        const start = performance.now();
        const look = () => {
          if (document.querySelector('[role="dialog"]') !== null) done(performance.now() - start);
          else if (performance.now() - start > 10000) done(Infinity);
          else setTimeout(look, 10);
        };
        button?.click();
        look();
      }),
  );

const playYear = async (page, year, { skip = false } = {}) => {
  const started = Date.now();
  await endButton(page, year).click();
  await playBar(page).waitFor({ timeout: 5000 });
  const caption = await playBar(page).textContent();
  assert(caption.includes(`${year} plays out`), `the bar does not say "${year} plays out": ${JSON.stringify(caption)}`);
  const samples = [];
  let skipped = null;
  while ((await playBar(page).count()) > 0) {
    const sample = await page.evaluate(() => {
      const bar = [...document.querySelectorAll('[role="status"]')].find((each) => each.querySelector("button")?.textContent === "Skip");
      return { line: bar?.querySelector(".truncate")?.textContent ?? null, scene: window.__careerOffice.scene(), dialogs: document.querySelectorAll('[role="dialog"]').length };
    });
    samples.push(sample);
    if (skip && skipped === null) {
      // Skip does nothing for its first moments, so the second click of a double click on End cannot land on it.
      await sleep(Math.max(0, SETTLE_MS + 150 - (Date.now() - started)));
      skipped = await skipTimed(page);
      break;
    }
    if (Date.now() - started > 15000) break;
    await sleep(200);
  }
  await dialog(page).waitFor({ timeout: 8000 });
  const summaryAfterMs = skipped ?? Date.now() - started;
  return { samples, summaryAfterMs };
};

/** The samples agree with the beats: hires at the door while people leave or the company moves, none once they walk in. */
const beatsAgree = (samples, where) => {
  const shown = samples.filter((sample) => sample.line !== null && sample.scene !== null);
  assert(shown.every((sample) => sample.dialogs === 0), `${where}: a dialog was open while the year played out`);
  const arrive = shown.find((sample) => /walks? in$/.test(sample.line));
  const hires = arrive === undefined ? null : countIn(arrive.line);
  for (const sample of shown) {
    if (/leaves?$|moves to a bigger place/.test(sample.line)) {
      assert(hires !== null && hires > 0, `${where}: people leave or the company moves in a year with no hires walking in (${sample.line})`);
      assert(sample.scene.arriving === hires, `${where}: during "${sample.line}" ${sample.scene.arriving} wait at the door, not the year's ${hires} hires`);
    }
    if (/walks? in$/.test(sample.line)) assert(sample.scene.arriving === 0, `${where}: during "${sample.line}" ${sample.scene.arriving} still wait at the door`);
  }
  return { hires, lines: [...new Set(shown.map((sample) => sample.line))] };
};

const yearAndMoves = async (browser) => {
  current = "3. A year plays out";
  const { context, page } = await freshPage(browser);
  await startCareer(page);
  await running(page);
  await rests(page, "1990");
  await raiseRecruiting(page);
  const played = await playYear(page, FIRST_YEAR);
  const { hires, lines } = beatsAgree(played.samples, "1990");
  assert(hires !== null && hires > 0, `1990 showed no hires walking in: ${JSON.stringify(lines)}`);
  assert(played.summaryAfterMs <= 8000, `the summary opened ${played.summaryAfterMs} ms after End`);
  await page.waitForTimeout(SETTLE_MS);
  assert((await dialog(page).count()) === 1, `${await dialog(page).count()} dialogs are open`);
  assert((await office(page, "scene")).year === FIRST_YEAR + 1, "the scene's year is not 1991 once the year played out");
  passed(`End 1990 played out as ${JSON.stringify(lines)} (${played.samples.length} samples), then one summary within ${played.summaryAfterMs} ms`);
  await closeWith(page, `Plan ${FIRST_YEAR + 1}`);
  const expected = await expectedHires(page);
  const waiting = await office(page, "scene");
  assert(waiting.arriving === expected, `${waiting.arriving} wait at the door in 1991, the plan expects ${expected}`);
  passed(`once the summary closed, ${expected} expected hires wait at the door, as the plan says`);

  // A double click on End plays one year only, and opens one summary. The second click lands where Skip appears,
  // and must not skip the year it started.
  await endButton(page, 1991).dblclick();
  await page.waitForTimeout(150);
  assert((await playBar(page).count()) === 1 && (await dialog(page).count()) === 0, 'a double click on "End 1991" skipped the year as it started');
  passed('a double click on "End 1991" leaves the year playing: its second click does not skip it');

  // Skip (once past its first moments) ends the year at once, and the office rests soon after.
  await page.waitForTimeout(SETTLE_MS);
  assert((await playBar(page).count()) === 1, "1991 stopped playing before Skip was pressed");
  const skippedMs = await skipTimed(page);
  assert(skippedMs <= 1000, `the summary opened ${skippedMs} ms after Skip`);
  const rest = await rests(page, "after Skip");
  assert(rest.restMs <= 2000, `the office rested ${rest.restMs} ms after the summary opened, not within 2 s (frames at ${rest.at.join(", ")} ms)`);
  passed(`Skip opened the summary within ${Math.round(skippedMs)} ms and the office rested ${rest.restMs} ms later`);
  await page.waitForTimeout(1500);
  assert((await dialog(page).count()) === 1, `${await dialog(page).count()} dialogs are open after a double click`);
  assert((await office(page, "scene")).year === 1992, `a double click on "End 1991" left the scene in ${(await office(page, "scene")).year}`);
  // Enter on End while the summary is open: End cannot take focus (the page behind is inert), and even pressed
  // through the DOM it changes neither the year nor the save.
  const saveBefore = await careerSave(page);
  const focused = await endButton(page, 1992).evaluate((button) => {
    button.focus();
    return document.activeElement === button;
  });
  assert(!focused, '"End 1992" took the focus while the summary is open');
  await endButton(page, 1992).evaluate((button) => {
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    button.click();
  });
  await page.waitForTimeout(1500);
  assert((await careerSave(page)) === saveBefore, "pressing End while the summary is open changed the save");
  assert((await office(page, "scene")).year === 1992 && (await playBar(page).count()) === 0, "pressing End while the summary is open played a year");
  passed('a double click on "End 1991" played one year and opened one summary; End pressed under the summary changed nothing');
  await closeWith(page, "Plan 1992");

  // Seed 1's career with the Recruiting raised runs out of cash a second time in 1992 (see step 4): a year in which
  // the company goes out does not play out (its people do not leave one by one); the summary opens at once.
  const sawBar = page.evaluate(
    () =>
      new Promise((done) => {
        const start = performance.now();
        const look = () => {
          if ([...document.querySelectorAll("button")].some((each) => each.textContent === "Skip")) done(true);
          else if (document.querySelector('[role="dialog"]') !== null || performance.now() - start > 5000) done(false);
          else requestAnimationFrame(look);
        };
        look();
      }),
  );
  await endButton(page, 1992).click();
  assert(!(await sawBar), '"End 1992", in which the company goes out, played the year out');
  await dialog(page).waitFor({ timeout: 2000 });
  passed('"End 1992", the second failure, opens its summary at once with no playback');
  noErrors();
  await context.close();
};

/**
 * On the nineties fixture (1994, the shared office half full, cash for ten years): seed 1's new career, with the
 * Recruiting raised in 1990, runs out of cash in 1992, so the moves are made on a company that has years ahead.
 */
const movingPeople = async (browser, fixtures) => {
  current = "4. Moving a person by pointer";
  const { context, page } = await freshPage(browser);
  const { save, year } = fixtures.nineties;
  await loadSave(page, save, year);
  await running(page);
  await rests(page, `${year}`);
  const canvas = page.locator("[data-office] canvas");
  // A person's projected anchor sits above their head, where a click finds whoever stands behind them: the click
  // goes to the middle of the box they are drawn in, under the anchor.
  const clickOn = async (personId) => {
    const point = await office(page, "project", { kind: "person", personId });
    assert(point !== null, `${personId} is not in the scene`);
    const drawn = await office(page, "screenBounds", { kind: "person", personId });
    assert(drawn !== null, `${personId} is not drawn`);
    const at = await box(canvas);
    await page.mouse.click(at.x + point.x, at.y + (drawn.top + drawn.bottom) / 2);
    await page.waitForTimeout(300);
  };
  const desks = async () => {
    const found = [];
    for (let desk = 0; desk < 60; desk++) {
      const personId = await office(page, "personAt", desk);
      if (personId === null) continue;
      found.push({ personId, team: await office(page, "teamOf", { kind: "person", personId }) });
    }
    return found;
  };
  if ((await teamCount(page, "Product")) < 1) {
    await planPanel(page).getByRole("button", { name: "Less: Growth", exact: true }).click();
    await planPanel(page).getByRole("button", { name: "More: Product", exact: true }).click();
    await rests(page, "a Product person added");
  }
  let people = await desks();
  const mover = people.find((person) => person.team === "product");
  assert(mover !== undefined, `no Product person sits at a desk: ${JSON.stringify(people)}`);
  const product = await teamCount(page, "Product");
  const growth = await teamCount(page, "Growth");
  await clickOn(mover.personId);
  assert((await carryStrip(page).count()) === 1, "no strip shows after clicking a Product person");
  assert((await carryStrip(page).innerText()).includes("Move one Product person to"), `the strip reads ${JSON.stringify(await carryStrip(page).innerText())}`);
  await carryStrip(page).getByRole("button", { name: "Growth", exact: true }).click();
  assert((await teamCount(page, "Product")) === product - 1 && (await teamCount(page, "Growth")) === growth + 1, "the plan's Product and Growth did not move by one");
  let scene = await office(page, "scene");
  assert(scene.teams.product === product - 1 && scene.teams.growth === growth + 1, `the scene's teams ${JSON.stringify(scene.teams)} do not agree with the plan`);
  await rests(page, "after the move");
  assert((await office(page, "teamOf", { kind: "person", personId: mover.personId })) === "growth", "the person picked does not work in Growth once the office rests");
  passed(`a Product person picked up and set down in Growth with the strip's button: the plan, the scene and the person agree`);

  await clickOn(mover.personId);
  const strip = (await carryStrip(page).count()) === 0 ? null : await carryStrip(page).innerText();
  assert(strip !== null && strip.includes("Move one Growth person to"), `the strip does not offer to move the Growth person: ${JSON.stringify(strip)}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  assert((await carryStrip(page).count()) === 0, "Escape did not put the person back");
  assert((await teamCount(page, "Growth")) === growth + 1 && (await teamCount(page, "Product")) === product - 1, "Escape changed the plan");
  await clickOn(mover.personId);
  assert((await carryStrip(page).count()) === 1, "the strip does not show after picking the person again");
  await clickOn(mover.personId);
  assert((await carryStrip(page).count()) === 0, "the same person clicked twice is not put back");
  assert((await teamCount(page, "Growth")) === growth + 1, "clicking the same person twice changed the plan");
  passed("Escape puts the person back; the same person clicked twice is picked up, then put back; neither changes the plan");

  // Pick a Product person and set them down on someone of another team: the same move as the button.
  await rests(page, "before the second move");
  people = await desks();
  const second = people.find((person) => person.team === "product");
  const other = people.find((person) => person.team !== null && person.team !== "product");
  if (second !== undefined && other !== undefined) {
    const before = { product: await teamCount(page, "Product"), to: await teamCount(page, other.team === "growth" ? "Growth" : "Recruiting") };
    await clickOn(second.personId);
    assert((await carryStrip(page).count()) === 1, "no strip after picking the second Product person");
    await clickOn(other.personId);
    assert((await carryStrip(page).count()) === 0, "the strip stays after setting the person down on another team");
    const toName = other.team === "growth" ? "Growth" : "Recruiting";
    assert((await teamCount(page, "Product")) === before.product - 1 && (await teamCount(page, toName)) === before.to + 1, `setting a Product person down on a ${toName} person did not move one`);
    await rests(page, "after the second move");
    assert((await office(page, "teamOf", { kind: "person", personId: second.personId })) === other.team, "the second person picked does not work in their new team");
    passed(`a Product person set down on a ${toName} person moved, as with the button`);
  } else {
    assert(false, `no second Product person and person of another team to move between: ${JSON.stringify(people)}`);
  }
  scene = await office(page, "scene");
  assert(Object.values(scene.teams).every((count) => count >= 0), "a team went below none");
  noErrors();
  await context.close();
};

// ---------------------------------------------------------------------------------------------------------------
// 5. An office move and the looks

const movesAndLooks = async (browser, fixtures) => {
  current = "5. An office move";
  {
    const { context, page } = await freshPage(browser);
    const { save, year } = fixtures.office;
    await loadSave(page, save, year);
    await running(page);
    await rests(page, "the office fixture");
    const before = (await office(page, "scene")).office;
    const played = await playYear(page, year);
    const { lines } = beatsAgree(played.samples, "the office move");
    assert(lines.some((line) => line.startsWith("The company moves to a bigger place")), `the office move's year shows no move: ${JSON.stringify(lines)}`);
    await rests(page, "after the move");
    const after = await office(page, "scene");
    assert(after.office === before + 1, `the office went from ${before} to ${after.office}`);
    await page.waitForTimeout(SETTLE_MS);
    await closeWith(page, `Plan ${year + 1}`);
    await rests(page, "the shared office");
    const stats = await office(page, "stats");
    measured.push({ where: `${year + 1}, shared office (office fixture)`, office: after.office, figures: stats.figures, drawCalls: stats.drawCalls });
    await shot(page, `${year + 1}-office-move.png`);
    noErrors();
    passed(`the office fixture's year played out as ${JSON.stringify(lines)} and moved the company from office ${before} to ${after.office}`);
    await context.close();
  }

  current = "5. The looks";
  for (const [name, look, file] of [["nineties", "dial-up", "1994-nineties.png"], ["noughties", "bust", "2004-noughties.png"], ["twenties", "winter-ai", "2023-twenties.png"]]) {
    const { context, page } = await freshPage(browser);
    const { save, year } = fixtures[name];
    await loadSave(page, save, year);
    await running(page);
    const { stats, scene } = await officeFigures(page, name);
    assert(lookFor(scene.era) === look, `${year} is the ${scene.era} era, look ${lookFor(scene.era)}, not ${look}`);
    measured.push({ where: `${year}, office ${scene.office} (${name} fixture)`, office: scene.office, figures: stats.figures, drawCalls: stats.drawCalls });
    await shot(page, file);
    noErrors();
    passed(`${year}: era ${scene.era} has the ${look} look; office ${scene.office}, ${stats.figures} figures, ${stats.drawCalls} draw calls`);
    await context.close();
  }
  {
    const { context, page } = await freshPage(browser);
    const { save, year } = fixtures.campus;
    await loadSave(page, save, year);
    await running(page);
    const { stats, scene } = await officeFigures(page, "the campus");
    assert(stats.figures <= MAX_STAFF_DRAWN + MAX_WAITING_DRAWN, `${stats.figures} figures on the campus`);
    assert(stats.hidden > 0, "the campus counts nobody on the sign");
    measured.push({ where: `${year}, campus (campus fixture)`, office: scene.office, figures: stats.figures, drawCalls: stats.drawCalls });
    await shot(page, `${year}-campus.png`);
    noErrors();
    passed(`the campus: ${stats.figures} figures (at most 56), ${stats.hidden} on the sign, ${stats.drawCalls} draw calls`);
    await context.close();
  }
};

// ---------------------------------------------------------------------------------------------------------------
// 6. Taken down cleanly

/** The last world taken down holds nothing and draws nothing. */
const freed = async (page, where, live) => {
  const gone = await office(page, "retiredStats");
  assert(gone !== null, `${where}: no world was taken down`);
  // The world taken down is the one that ran: it had drawn at least the frames counted before it went.
  if (live !== undefined) assert(gone.framesDrawn >= live, `${where}: the world taken down drew ${gone.framesDrawn} frames, the live one ${live}`);
  assert(gone.geometries === 0 && gone.textures === 0, `${where}: the world taken down holds ${gone.geometries} geometries and ${gone.textures} textures`);
  assert(await stillForASecond(page, true), `${where}: the world taken down still draws`);
};

const takenDown = async (browser) => {
  current = "6. Taken down cleanly";
  const { context, page } = await freshPage(browser);
  await startCareer(page);
  await running(page);
  let live = (await office(page, "stats")).framesDrawn;
  await page.getByRole("button", { name: "New game", exact: true }).click();
  await page.getByRole("button", { name: "Save and leave", exact: true }).click();
  await page.getByLabel("Name your startup").waitFor();
  await freed(page, '"Save and leave"', live);
  assert((await office(page, "status")) === "none", `after "Save and leave" the status is ${await office(page, "status")}`);
  passed('"Save and leave": the world freed, nothing drawn, status "none"');

  await page.getByRole("button", { name: `Resume your career (${FIRST_YEAR})`, exact: true }).click();
  await running(page);
  await rests(page, "resumed");
  live = (await office(page, "stats")).framesDrawn;
  await page.getByRole("button", { name: "New game", exact: true }).click();
  await page.getByRole("button", { name: "Abandon game", exact: true }).click();
  await page.getByLabel("Name your startup").waitFor();
  await freed(page, '"New game" then "Abandon"', live);
  assert((await office(page, "status")) === "none", `after "Abandon" the status is ${await office(page, "status")}`);
  passed('resumed, then "New game" and "Abandon": the world freed, status "none"');

  await startCareer(page);
  await running(page);
  await rests(page, "1990");
  const firstFrames = (await office(page, "stats")).framesDrawn;
  await toggle(page).click();
  await page.locator("[data-office]").waitFor({ state: "detached" });
  await freed(page, 'the "3D office" switch turned off', firstFrames);
  await toggle(page).click();
  await running(page);
  await rests(page, "the office back on");
  passed(`the switch turned off frees the world; turned on again, a new office runs (${firstFrames} frames before)`);

  live = (await office(page, "stats")).framesDrawn;
  await office(page, "loseContext");
  await reloadButton(page).waitFor({ timeout: 10000 });
  await reloadButton(page).click();
  await running(page);
  await freed(page, '"Reload 3D view" after a lost context', live);
  passed('"Reload 3D view" after a lost context: the lost world freed, a new office runs');
  noErrors();
  await context.close();
};

// ---------------------------------------------------------------------------------------------------------------
// 7. A hidden tab and resizes

const hiddenAndResized = async (browser) => {
  current = "7. Hidden tab and resize";
  const { context, page } = await freshPage(browser);
  await startCareer(page);
  await running(page);
  await rests(page, "1990");
  await raiseRecruiting(page);
  await endButton(page, FIRST_YEAR).click();
  await playBar(page).waitFor({ timeout: 5000 });
  const setHidden = (hidden) =>
    page.evaluate((hidden) => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  await setHidden(true);
  await page.waitForTimeout(100);
  assert(await stillForASecond(page), "the office draws frames while the tab is hidden");
  await setHidden(false);
  await dialog(page).waitFor({ timeout: 10000 });
  passed("hidden, the office draws nothing during a year; visible again, the year finishes and the summary opens");
  await page.waitForTimeout(SETTLE_MS);
  await closeWith(page, "Plan 1991");

  const sameSize = async (where) => {
    await rests(page, where);
    // The view fills the cell, and the canvas fills the view inside its 1 px frame (world.css, .world-viewport).
    const sizes = await page.evaluate(() => {
      const cell = document.querySelector("[data-office]").getBoundingClientRect();
      const view = document.querySelector("[data-office] [data-world]");
      const frame = view.getBoundingClientRect();
      const border = parseFloat(getComputedStyle(view).borderLeftWidth) + parseFloat(getComputedStyle(view).borderRightWidth);
      const canvas = document.querySelector("[data-office] canvas").getBoundingClientRect();
      return { cell: [cell.width, cell.height], view: [frame.width, frame.height], border, canvas: [canvas.width, canvas.height] };
    });
    const near = (a, b) => Math.abs(a - b) <= 0.5;
    assert(near(sizes.view[0], sizes.cell[0]) && near(sizes.view[1], sizes.cell[1]), `${where}: the view is ${sizes.view.join("x")}, the cell ${sizes.cell.join("x")}`);
    assert(
      near(sizes.canvas[0], sizes.cell[0] - sizes.border) && near(sizes.canvas[1], sizes.cell[1] - sizes.border),
      `${where}: the canvas is ${sizes.canvas.join("x")}, the cell ${sizes.cell.join("x")} less its ${sizes.border} px frame`,
    );
  };
  await page.setViewportSize({ width: 1100, height: 800 });
  await sameSize("at 1100x800");
  await page.setViewportSize(DESKTOP);
  await sameSize("back at 1280x800");
  passed("resized to 1100 and back: the canvas fills the office cell each time");
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.locator("[data-office]").waitFor({ state: "detached" });
  assert((await page.locator("canvas").count()) === 0, "a canvas is on the page at 1000 px");
  await freed(page, "at 1000x800");
  await page.setViewportSize(DESKTOP);
  await running(page);
  passed("at 1000 px the 2D layout shows and the world is freed; back at 1280 px a new office runs");
  noErrors();
  await context.close();
};

// ---------------------------------------------------------------------------------------------------------------
// 8. Reduced motion

const reducedMotion = async (browser) => {
  current = "8. Reduced motion";
  const { context, page } = await freshPage(browser, { reducedMotion: "reduce" });
  await startCareer(page);
  await running(page);
  await rests(page, "1990");
  await raiseRecruiting(page);
  await endButton(page, FIRST_YEAR).click();
  await dialog(page).waitFor({ timeout: 2000 });
  assert((await playBar(page).count()) === 0, "a year plays out under reduced motion");
  const rest = await rests(page, "under reduced motion");
  assert(rest.settledS <= 1, `under reduced motion the office took ${rest.settledS.toFixed(2)} world seconds to settle`);
  noErrors();
  passed(`under reduced motion End opens the summary at once, no bar; the office settles in ${rest.settledS.toFixed(2)} world seconds`);
  await context.close();
};

// ---------------------------------------------------------------------------------------------------------------
// 9. The switch

const theSwitch = async (browser) => {
  current = "9. The switch";
  const { context, page } = await freshPage(browser);
  await startCareer(page);
  await running(page);
  const save = await careerSave(page);
  await toggle(page).click();
  await page.locator("[data-office]").waitFor({ state: "detached" });
  const grid2D = async (where) => {
    assert((await page.locator("canvas").count()) === 0, `${where}: a canvas is on the page`);
    for (const label of [`Plan for ${FIRST_YEAR}`, "If this plan plays out", "Rivals", "Timeline", "Your career"]) {
      assert(await page.locator(`main section[aria-label="${label}"]`).isVisible(), `${where}: "${label}" is not visible`);
    }
  };
  await grid2D("switched off");
  assert((await toggle(page).getAttribute("aria-pressed")) === "false", "the switch is not shown off");
  await page.reload();
  await endButton(page, FIRST_YEAR).waitFor();
  await page.waitForTimeout(1000);
  await grid2D("after a reload");
  assert((await page.evaluate((key) => localStorage.getItem(key), OFFICE_KEY)) === "off", `localStorage["${OFFICE_KEY}"] is not "off"`);
  assert((await careerSave(page)) === save, "switching the office off changed the career save");
  await toggle(page).click();
  await running(page);
  assert((await careerSave(page)) === save, "switching the office on changed the career save");
  noErrors();
  passed("the switch turns the office off into the 2D grid, stays off across a reload, and turns it back on; the save untouched");
  await context.close();
};

// ---------------------------------------------------------------------------------------------------------------
// 10. Fallbacks

const fallbacks = async (browser, noWebGL) => {
  current = "10. Fallbacks";
  {
    const { context, page } = await freshPage(noWebGL);
    await startCareer(page);
    assert(await toggle(page).isDisabled(), "with WebGL off the switch is enabled");
    assert((await toggle(page).getAttribute("title")) === WORDS.unavailable, "with WebGL off the switch does not say why");
    await page.waitForTimeout(5000);
    const adds = await officeAdds(page);
    assert(adds.office === 0 && adds.world === 0, `with WebGL off ${adds.office} [data-office] and ${adds.world} [data-world] elements were added`);
    assert((await page.locator("canvas").count()) === 0, "with WebGL off a canvas is on the page");
    noErrors();
    passed("WebGL off: the 2D grid from the first paint, the switch disabled, no office or world element ever added");
    await context.close();
  }
  {
    // The check aborts the chunk itself: the browser's "Failed to load resource" line for it, and React's report of
    // the import's failure that the office's boundary caught (React logs every caught error), are expected; only
    // those two, and only about this chunk.
    const { context, page } = await freshPage(browser, { allowed: /^Failed to load resource|Failed to fetch dynamically imported module: \S*\/assets\/CareerOffice-/ });
    await page.route(/assets\/CareerOffice-/, (route) => route.abort());
    await startCareer(page);
    await page.waitForTimeout(5000);
    assert((await page.locator("[data-office]").count()) === 0, "with the office's chunk blocked the office cell stays");
    assert(await toggle(page).isDisabled(), "with the office's chunk blocked the switch is enabled");
    const adds = await officeAdds(page);
    assert(adds.office <= 1, `with the office's chunk blocked [data-office] was added ${adds.office} times`);
    assert(await planPanel(page).isVisible(), "with the office's chunk blocked the plan is not shown");
    noErrors();
    passed(`the office's chunk blocked: the 2D grid, the switch disabled, the office cell added ${adds.office} time(s)`);
    await context.close();
  }
  {
    const { context, page } = await freshPage(browser);
    await startCareer(page);
    await running(page);
    await rests(page, "1990");
    await raiseRecruiting(page);
    await endButton(page, FIRST_YEAR).click();
    await playBar(page).waitFor({ timeout: 5000 });
    await office(page, "loseContext");
    await dialog(page).waitFor({ timeout: 2000 });
    assert((await playBar(page).count()) === 0, "the bar stays after the context was lost");
    await page.waitForTimeout(SETTLE_MS);
    await closeWith(page, "Plan 1991");
    for (let n = 0; n < 5; n++) {
      assert((await page.locator("[data-office]").count()) === 0, "the office came back by itself after a lost context");
      assert(await reloadButton(page).isVisible(), '"Reload 3D view" is not in the header');
      await page.waitForTimeout(1000);
    }
    assert(await planPanel(page).isVisible(), "the plan is not shown after a lost context");
    await reloadButton(page).click();
    await running(page);
    noErrors();
    passed('a context lost during a year: the summary at once, the 2D grid with "Reload 3D view" for 5 s; pressed, the office runs again');
    await context.close();
  }
};

// ---------------------------------------------------------------------------------------------------------------
// 11. A reload while a year plays out

const reloadMidYear = async (browser, noWebGL) => {
  current = "11. Reload mid-year";
  const { context, page } = await freshPage(browser);
  await startCareer(page);
  await running(page);
  await endButton(page, FIRST_YEAR).click();
  await playBar(page).waitFor({ timeout: 5000 });
  const save = await careerSave(page);
  await page.reload();
  await dialog(page).waitFor({ timeout: 10000 });
  assert((await playBar(page).count()) === 0, "a year plays out again after the reload");
  assert((await careerSave(page)) === save, "the save changed across the reload");
  // The same year ended without 3D writes the same save.
  const { context: flat, page: plain } = await freshPage(noWebGL);
  await startCareer(plain);
  await endButton(plain, FIRST_YEAR).click();
  await dialog(plain).waitFor();
  assert((await careerSave(plain)) === save, "the save differs from the one written with WebGL off");
  noErrors();
  passed("reloaded while 1990 played out: the summary is open, no bar, and the save is byte-identical, and the same as without 3D");
  await flat.close();
  await context.close();
};

// ---------------------------------------------------------------------------------------------------------------
// 12. A whole career through the 3D screen

const wholeCareer = async (browser) => {
  current = "12. A whole career";
  const { context, page } = await freshPage(browser);
  await startCareer(page);
  await running(page);
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
    current = `12. A whole career, ${year}`;
    await endButton(page, year).waitFor();
    const heading = await header(page).innerText();
    assert(heading.includes(`${year} · year ${year - FIRST_YEAR + 1} of ${YEARS}`), `the header reads ${JSON.stringify(heading)}`);
    await endButton(page, year).click();
    // Every year plays out, the last one too (src/ui/yearPlay.ts, yearPlaysOut): the turn does not move on after it,
    // but its report is new. The summary opens once it is skipped.
    const bar = await playBar(page).waitFor({ timeout: 5000 }).then(() => true, () => false);
    assert(bar, `no playback bar after "End ${year}"`);
    await noForbiddenWords(page.locator("body"), "the page while the year plays out");
    await page.waitForTimeout(SETTLE_MS + 150); // past the guard that keeps a double click on End off Skip
    await skipButton(page).click().catch(() => {});
    await opened(page);
    await noForbiddenWords(page.locator("body"), "the page with the summary open");
    await closeWith(page, year === LAST_YEAR ? "See how it ended" : `Plan ${year + 1}`);
    noErrors();
  }
  current = "12. A whole career, the end screen";
  await page.getByRole("heading", { name: "Final standings" }).waitFor();
  await noForbiddenWords(page.locator("body"), "the end screen");
  noErrors();
  passed(`every year from ${FIRST_YEAR} to ${LAST_YEAR} through the 3D screen, each played out and skipped, the last year too; no forbidden words; the end screen`);
  await context.close();
};

// ---------------------------------------------------------------------------------------------------------------
// 13. Narrow

const narrow = async (browser, fixtures) => {
  current = "13. Narrow";
  const { context, page } = await freshPage(browser, { size: PHONE, hasTouch: true });
  const { save, year } = fixtures.office;
  await loadSave(page, save, year);
  await page.waitForTimeout(2000);
  assert((await page.locator("canvas").count()) === 0, "a canvas is on the page at 390 px");
  assert((await page.locator("[data-office]").count()) === 0, "the office cell is on the page at 390 px");
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  assert(width <= PHONE.width, `the page is ${width} px wide at ${PHONE.width} px`);
  assert(await toggle(page).isDisabled(), "the switch is enabled at 390 px");
  assert((await toggle(page).getAttribute("title")) === WORDS.narrow, `the switch's title at 390 px is ${JSON.stringify(await toggle(page).getAttribute("title"))}`);
  noErrors();
  passed("390x844 with touch: no canvas, no office, no sideways scroll; the switch disabled with the narrow-window title");
  await context.close();
};

// ---------------------------------------------------------------------------------------------------------------
// 15 to 18: the market, every era's look, the market's draw calls, the career's sounds

/** The market's ceiling on draw calls (src/world/market/marketLayout.ts, MARKET_DRAW_CEILING), copied. */
const MARKET_DRAW_CEILING = 60;
/** The caption of the year's last beat (src/ui/officeView.ts, beatLine). */
const MARKET_LINE = "Where the year's new users went";
const views = (page) => page.getByRole("group", { name: "Show the office or the market", exact: true });
const viewButton = (page, name) => views(page).getByRole("button", { name, exact: true });
const marketCardOf = (page) => page.locator('section[aria-label="Company in the market"]');
const showInMarket = (page) => page.getByRole("button", { name: "Show in market", exact: true });
const countOf = (list, name) => list.filter((each) => each === name).length;
const marketLabelsOf = (page) => page.locator("[data-market-label]");

/**
 * The labels over the market (src/ui/marketLabels.ts): one over each building still standing, its name and users,
 * the player's marked "You" and drawn apart; one on the bar in the rivals' panel's words. None overlap, none leave the
 * canvas, none is under `covers` (the company's card), none can be pointed at or focused, and the canvas is under each.
 */
const labelsReadable = async (page, market, where, covers = null) => {
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll("[data-market-label]")].map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const layer = element.parentElement;
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const under = document.elementFromPoint(x, y);
      return {
        key: element.getAttribute("data-market-label"),
        text: element.textContent,
        box: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        clipped: element.scrollWidth > element.clientWidth + 1,
        background: style.backgroundColor,
        pointer: getComputedStyle(layer).pointerEvents,
        focusable: element.querySelectorAll("a, button, input, select, textarea, [tabindex]").length + (element.hasAttribute("tabindex") ? 1 : 0),
        underIs: under === null ? null : under.tagName.toLowerCase(),
        readerHidden: element.closest('[aria-hidden="true"]') !== null,
      };
    })
  );
  const standing = market.companies.filter((c) => c.state !== "out");
  const canvas = await box(page.locator("[data-office] canvas"));
  const companyLabels = labels.filter((label) => label.key.startsWith("company:"));
  const visible = covers === null ? standing : standing.filter((c) => companyLabels.some((label) => label.key === `company:${c.seat}`));
  if (covers === null) assert(companyLabels.length === standing.length, `${where}: ${companyLabels.length} company labels for ${standing.length} buildings: ${JSON.stringify(labels.map((l) => l.text))}`);
  for (const each of visible) {
    const label = companyLabels.find((l) => l.key === `company:${each.seat}`);
    assert(label !== undefined, `${where}: ${each.name} has no label`);
    const you = each.state === "player";
    assert(label.text.includes(each.name) && / users?$/.test(label.text), `${where}: ${each.name}'s label reads ${JSON.stringify(label.text)}`);
    assert(label.text.startsWith("You") === you, `${where}: ${each.name}'s label ${you ? "is not" : "is"} marked You: ${JSON.stringify(label.text)}`);
    assert(!label.clipped, `${where}: ${each.name}'s label is cut off: ${JSON.stringify(label.text)}`);
  }
  const yours = companyLabels.find((l) => l.text.startsWith("You"));
  if (yours !== undefined) {
    for (const other of companyLabels.filter((l) => l !== yours)) assert(other.background !== yours.background, `${where}: the "You" label looks like ${other.text}'s`);
  }
  const bar = labels.find((l) => l.key === "bar");
  if (covers === null) assert(bar !== undefined, `${where}: the bar has no label`);
  if (bar !== undefined) {
    assert(/^Bar to go public: [\d.,]+[KM]? users$/.test(bar.text), `${where}: the bar's label reads ${JSON.stringify(bar.text)}`);
    assert(!bar.clipped, `${where}: the bar's label is cut off`);
  }
  const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  for (const label of labels) {
    const b = label.box;
    assert(b.x >= canvas.x - 0.5 && b.y >= canvas.y - 0.5 && b.x + b.width <= canvas.x + canvas.width + 0.5 && b.y + b.height <= canvas.y + canvas.height + 0.5, `${where}: the label ${JSON.stringify(label.text)} leaves the canvas`);
    for (const other of labels) if (other !== label) assert(!overlaps(b, other.box), `${where}: the labels ${JSON.stringify(label.text)} and ${JSON.stringify(other.text)} overlap`);
    if (covers !== null) assert(!overlaps(b, covers), `${where}: the card covers the label ${JSON.stringify(label.text)}`);
    assert(label.pointer === "none", `${where}: the label ${JSON.stringify(label.text)} takes the pointer (${label.pointer})`);
    assert(label.focusable === 0, `${where}: the label ${JSON.stringify(label.text)} can be focused`);
    assert(label.underIs === "canvas", `${where}: under the label ${JSON.stringify(label.text)} is a ${label.underIs}, not the canvas`);
    // The rivals' panel reads the same out properly; the labels' badge and name run together ("YouCheck Co").
    assert(label.readerHidden, `${where}: the label ${JSON.stringify(label.text)} is read out by a screen reader`);
    // Opaque: a ring of the bar drawn behind a label never shows through it.
    assert(/^rgb\(/.test(label.background), `${where}: the label ${JSON.stringify(label.text)} lets the canvas through (${label.background})`);
  }
  return labels;
};

/** Each company's label stands over its building as the world draws it now: above the building's top, and beside it. */
const labelsOverLots = async (page, where) => {
  const marks = await office(page, "marketMarks");
  assert(marks !== null, `${where}: the market's marks are not given`);
  const canvas = await box(page.locator("[data-office] canvas"));
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('[data-market-label^="company:"]')].map((element) => {
      const rect = element.getBoundingClientRect();
      return { seat: Number(element.getAttribute("data-market-label").slice("company:".length)), left: rect.left, right: rect.right, bottom: rect.bottom, text: element.textContent };
    })
  );
  assert(labels.length > 0, `${where}: no company labels`);
  for (const label of labels) {
    const top = marks.lots.find((lot) => lot.seat === label.seat)?.top;
    assert(top !== undefined, `${where}: the label ${JSON.stringify(label.text)} has no building`);
    const x = canvas.x + top.x;
    const y = canvas.y + top.y;
    const width = label.right - label.left;
    assert(label.bottom <= y + 1, `${where}: the label ${JSON.stringify(label.text)} is not above its building (bottom ${label.bottom}, the top at ${y})`);
    assert(label.left - width <= x && x <= label.right + width, `${where}: the label ${JSON.stringify(label.text)} is not beside its building (${label.left}..${label.right}, the top at ${x})`);
  }
};

/**
 * Ends `year` and waits for its market beat (the caption reads MARKET_LINE), sampling the sounds asked for and the
 * caption meanwhile. Returns the lines seen and the sounds heard up to the last moment before the market beat.
 */
const toMarketBeat = async (page, year) => {
  await endButton(page, year).click();
  await playBar(page).waitFor({ timeout: 5000 });
  const lines = [];
  let heard = [];
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    // The caption and the sounds read in one go: the market beat's sound is asked for as its caption goes up.
    const [line, now] = await page.evaluate(() => {
      const bar = [...document.querySelectorAll('[role="status"]')].find((each) => each.querySelector("button")?.textContent === "Skip");
      return [bar === undefined ? null : (bar.querySelector(".truncate")?.textContent ?? null), window.__careerOffice?.sounds() ?? []];
    });
    if (line !== null && !lines.includes(line)) lines.push(line);
    if (line === MARKET_LINE) return { lines, heard };
    heard = now;
    assert(line !== null, `${year} stopped playing before its market beat: ${JSON.stringify(lines)}`);
    await sleep(50);
  }
  return assert(false, `${year} never reached its market beat: ${JSON.stringify(lines)}`);
};

/** The summary opens, and once open (past the settle), it is the only dialog. */
const oneSummary = async (page, where) => {
  await dialog(page).waitFor({ timeout: 8000 });
  await page.waitForTimeout(SETTLE_MS + 400);
  assert((await dialog(page).count()) === 1, `${where}: ${await dialog(page).count()} dialogs are open`);
};

/** Picks up the first Product (or any) person at a desk by clicking them; returns their id. */
const pickSomeone = async (page) => {
  const canvas = page.locator("[data-office] canvas");
  for (let desk = 0; desk < 60; desk++) {
    const personId = await office(page, "personAt", desk);
    if (personId === null) continue;
    const point = await office(page, "project", { kind: "person", personId });
    const drawn = await office(page, "screenBounds", { kind: "person", personId });
    if (point === null || drawn === null) continue;
    const at = await box(canvas);
    await page.mouse.click(at.x + point.x, at.y + (drawn.top + drawn.bottom) / 2);
    await page.waitForTimeout(300);
    if ((await carryStrip(page).count()) === 1) return personId;
  }
  return assert(false, "nobody at a desk could be picked up");
};

/** The plan's three teams as the planning panel counts them. */
const planTeams = async (page) => ({ product: await teamCount(page, "Product"), growth: await teamCount(page, "Growth"), recruiting: await teamCount(page, "Recruiting") });

/** The office fixture loaded at 1280x800, its office running and at rest. */
const officeFixturePage = async (browser, fixtures, options = {}) => {
  const { context, page } = await freshPage(browser, options);
  const { save, year } = fixtures.office;
  await loadSave(page, save, year);
  await running(page);
  await rests(page, "the office fixture");
  return { context, page, year };
};

const theMarket = async (browser, fixtures) => {
  current = "15. The market view";
  {
    const { context, page, year } = await officeFixturePage(browser, fixtures);
    assert(await viewButton(page, "Market").isDisabled(), '"Market" is enabled before any year was played');
    const laterTitle = await viewButton(page, "Market").getAttribute("title");
    assert(laterTitle === "The market shows after your first year", `the disabled "Market" says ${JSON.stringify(laterTitle)}`);
    assert((await office(page, "market")) === null, "a market is given before any year was played");

    // The year ends on the market, then the summary opens once on the player's choice.
    const { lines } = await toMarketBeat(page, year);
    assert((await office(page, "view")) === "market", `during the market beat the view is ${await office(page, "view")}`);
    assert(await viewButton(page, "Office").isDisabled(), "the switch is enabled while the year plays");
    await sleep(300);
    const lot = await office(page, "screenBounds", { kind: "company", seat: 1 });
    assert(lot !== null, "during the market beat seat 1's building is not on the canvas (the camera went back to the office)");
    assert((await marketLabelsOf(page).count()) > 0, "during the market beat the buildings have no labels");
    await oneSummary(page, "after the market beat");
    assert((await office(page, "view")) === "office", `once the summary opened the view is ${await office(page, "view")}, not the choice`);
    passed(`End ${year} played ${JSON.stringify(lines)}, the last beat on the market with seat 1 in view; then one summary, back in the office`);
    await closeWith(page, `Plan ${year + 1}`);

    // The switch, the buildings, a company's card.
    await viewButton(page, "Market").click();
    assert((await office(page, "view")) === "market", `"Market" pressed, the view is ${await office(page, "view")}`);
    await rests(page, "the market");
    const market = await office(page, "market");
    assert(market !== null && market.companies.length === 4, `the market has ${market?.companies.length} companies`);
    const byUsers = [...market.companies].sort((a, b) => a.users - b.users);
    for (let n = 1; n < byUsers.length; n++) {
      assert(byUsers[n].height >= byUsers[n - 1].height, `heights do not order as users: ${JSON.stringify(market.companies.map((c) => [c.users, c.height]))}`);
    }
    const stats = await office(page, "stats");
    assert(stats.drawCalls <= MARKET_DRAW_CEILING, `the market draws ${stats.drawCalls} draw calls, over ${MARKET_DRAW_CEILING}`);
    measured.push({ where: `${year + 1}, the market (office fixture)`, office: "market", figures: stats.figures, drawCalls: stats.drawCalls, ceiling: MARKET_DRAW_CEILING });
    const labels = await labelsReadable(page, market, "the market at 1280x800");
    await labelsOverLots(page, "the market at rest");
    // At rest the labels ask for no frame: nothing runs while nothing can move them.
    const framesAsked = await page.evaluate(
      () =>
        new Promise((done) => {
          let asked = 0;
          const original = window.requestAnimationFrame;
          window.requestAnimationFrame = (callback) => {
            asked += 1;
            return original.call(window, callback);
          };
          setTimeout(() => {
            window.requestAnimationFrame = original;
            done(asked);
          }, 1000);
        })
    );
    assert(framesAsked === 0, `the market at rest asked for ${framesAsked} animation frames in a second`);
    // The world moves (a zoom): the labels follow it, and rest again with it.
    const zoomAt = await box(page.locator("[data-office] canvas"));
    const before = await page.evaluate(() => [...document.querySelectorAll("[data-market-label]")].map((each) => each.getBoundingClientRect().top));
    await page.mouse.move(zoomAt.x + zoomAt.width / 2, zoomAt.y + zoomAt.height / 2);
    await page.mouse.wheel(0, 240);
    await rests(page, "the market zoomed out");
    const after = await page.evaluate(() => [...document.querySelectorAll("[data-market-label]")].map((each) => each.getBoundingClientRect().top));
    assert(JSON.stringify(before) !== JSON.stringify(after), `zoomed out, the labels stayed where they were: ${JSON.stringify(after)}`);
    await labelsOverLots(page, "the market zoomed out");
    await labelsReadable(page, market, "the market zoomed out");
    await page.mouse.wheel(0, -240);
    await rests(page, "the market zoomed back in");
    await labelsOverLots(page, "the market zoomed back in");
    if (process.env.MARKS) console.log(JSON.stringify({ size: DESKTOP, canvas: await box(page.locator("[data-office] canvas")), marks: await office(page, "marketMarks"), market }));
    await shot(page, `${year + 1}-market.png`);
    const tallest = market.companies.filter((c) => c.state === "rival").sort((a, b) => b.height - a.height)[0];
    const bounds = await office(page, "screenBounds", { kind: "company", seat: tallest.seat });
    assert(bounds !== null, `the tallest rival, ${tallest.name}, is not on the canvas`);
    const canvasBox = await box(page.locator("[data-office] canvas"));
    await page.mouse.click(canvasBox.x + (bounds.left + bounds.right) / 2, canvasBox.y + (bounds.top + bounds.bottom) / 2);
    await marketCardOf(page).waitFor({ timeout: 3000 });
    const cardTitle = await marketCardOf(page).locator("h3").innerText();
    const cardText = await marketCardOf(page).innerText();
    assert(cardTitle === tallest.name, `the card is titled ${JSON.stringify(cardTitle)}, not ${JSON.stringify(tallest.name)}`);
    assert(/ users/.test(cardText) && cardText.includes("last year's new users"), `the card reads ${JSON.stringify(cardText)}`);
    await shot(page, `${year + 1}-market-card.png`);
    // With the card open, no building is under it, at each of the three desktop sizes: each can still be clicked.
    for (const size of [DESKTOP, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(400);
      await rests(page, `the market with a card open at ${size.width}x${size.height}`);
      const card = await box(marketCardOf(page));
      const at = await box(page.locator("[data-office] canvas"));
      await labelsReadable(page, market, `the market with a card open at ${size.width}x${size.height}`, card);
      for (const each of market.companies.filter((c) => c.state !== "out")) {
        const drawn = await office(page, "screenBounds", { kind: "company", seat: each.seat });
        assert(drawn !== null, `at ${size.width}x${size.height} ${each.name}'s building is not on the canvas`);
        const x = at.x + (drawn.left + drawn.right) / 2;
        const y = at.y + (drawn.top + drawn.bottom) / 2;
        const under = x >= card.x && x <= card.x + card.width && y >= card.y && y <= card.y + card.height;
        assert(!under, `at ${size.width}x${size.height} the card covers ${each.name}'s building`);
      }
      if (size.width === 1440) await shot(page, `${year + 1}-market-card-1440.png`);
      if (size.width === 1920) await shot(page, `${year + 1}-market-card-1920.png`);
    }
    await page.setViewportSize(DESKTOP);
    await page.waitForTimeout(400);
    await rests(page, "the market back at 1280x800");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    assert((await marketCardOf(page).count()) === 0, "Escape did not close the card");
    // Every label back, and tidy, at the three desktop sizes with no card open.
    for (const size of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }, DESKTOP]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(400);
      await rests(page, `the market at ${size.width}x${size.height}`);
      await labelsReadable(page, market, `the market at ${size.width}x${size.height}`);
      if (process.env.MARKS) console.log(JSON.stringify({ size, canvas: await box(page.locator("[data-office] canvas")), marks: await office(page, "marketMarks") }));
      if (size.width !== DESKTOP.width) await shot(page, `${year + 1}-market-${size.width}.png`);
    }
    await viewButton(page, "Office").click();
    assert((await office(page, "view")) === "office", `"Office" pressed, the view is ${await office(page, "view")}`);
    await page.waitForTimeout(100);
    assert((await marketLabelsOf(page).count()) === 0, "the market's labels stay over the office");
    passed(`"Market": four buildings ordered by users, ${stats.drawCalls} draw calls; ${labels.length} labels (${labels.map((l) => JSON.stringify(l.text)).join(", ")}), none overlapping, none on the canvas's edge, none a target, at 1280, 1440 and 1920; ${tallest.name}'s building clicked shows its card, which covers no building and no label; Escape closes it; "Office" goes back and the labels go`);

    // Nobody stays carried across the market.
    await rests(page, "back in the office");
    const plan = await planTeams(page);
    await pickSomeone(page);
    await viewButton(page, "Market").click();
    await page.waitForTimeout(300);
    await viewButton(page, "Office").click();
    await page.waitForTimeout(300);
    assert((await carryStrip(page).count()) === 0, "a person is still carried after the market was shown");
    assert(JSON.stringify(await planTeams(page)) === JSON.stringify(plan), "showing the market changed the plan");
    passed("a person picked up, then the market and the office shown: nobody carried, the plan unchanged");

    // "Show in market" on a rival's card.
    const rivalName = market.companies.find((c) => c.state === "rival").name;
    const rivalCard = page.locator('main section[aria-label="Rivals"] li', { has: page.locator("span", { hasText: rivalName }) }).first();
    await rivalCard.getByRole("button", { name: "Show in market", exact: true }).click();
    await page.waitForTimeout(300);
    assert((await office(page, "view")) === "market", `"Show in market" shows the ${await office(page, "view")}`);
    assert((await marketCardOf(page).count()) === 1 && (await marketCardOf(page).locator("h3").innerText()) === rivalName, `"Show in market" for ${rivalName} does not show its card`);
    passed(`"Show in market" on ${rivalName}'s card shows the market with it selected`);
    await viewButton(page, "Office").click();

    // The 2D layout has neither.
    await viewButton(page, "Market").click();
    await page.waitForTimeout(300);
    assert((await marketLabelsOf(page).count()) > 0, "the market shows no labels");
    await toggle(page).click();
    await page.locator("[data-office]").waitFor({ state: "detached" });
    assert((await showInMarket(page).count()) === 0 && (await views(page).count()) === 0, 'the 2D layout has a "Show in market" button or a "Market" switch');
    assert((await marketLabelsOf(page).count()) === 0, "the market's labels stay with the 3D view off");
    await toggle(page).click();
    await running(page);
    passed('the 2D layout has no "Show in market", no "Market" switch and no labels');
    noErrors();
    await context.close();
  }
  {
    // Skip during the market beat.
    const { context, page, year } = await officeFixturePage(browser, fixtures);
    await toMarketBeat(page, year);
    const skippedMs = await skipTimed(page);
    assert(skippedMs <= 1000, `the summary opened ${skippedMs} ms after Skip`);
    await oneSummary(page, "Skip during the market beat");
    assert((await office(page, "view")) === "office", `after Skip the view is ${await office(page, "view")}`);
    await closeWith(page, `Plan ${year + 1}`);
    assert(await viewButton(page, "Market").isEnabled(), 'after Skip "Market" is disabled');
    assert(await viewButton(page, "Office").isEnabled(), 'after Skip "Office" is disabled');
    noErrors();
    passed("Skip during the market beat: one summary, the office again, the switch enabled");
    await context.close();
  }
  {
    // A window narrowed during the market beat.
    const { context, page, year } = await officeFixturePage(browser, fixtures);
    await toMarketBeat(page, year);
    await page.setViewportSize({ width: 900, height: 800 });
    await oneSummary(page, "narrowed during the market beat");
    assert((await page.locator("[data-office]").count()) === 0 && (await page.locator("canvas").count()) === 0, "at 900 px the office is still on the page");
    await closeWith(page, `Plan ${year + 1}`);
    assert(await planPanel(page).isVisible(), "at 900 px the plan is not shown");
    const heard = await office(page, "sounds");
    assert(countOf(heard, "asset-office-upgrade") === 1, `narrowed during the market beat, the sounds are ${JSON.stringify(heard)}`);
    noErrors();
    passed("the window narrowed to 900 px during the market beat: one summary, the 2D screens, the office move heard once");
    await context.close();
  }
  {
    // A context lost during the market beat.
    const { context, page, year } = await officeFixturePage(browser, fixtures);
    await toMarketBeat(page, year);
    await office(page, "loseContext");
    await oneSummary(page, "a context lost during the market beat");
    await closeWith(page, `Plan ${year + 1}`);
    await reloadButton(page).waitFor({ timeout: 10000 });
    await reloadButton(page).click();
    await running(page);
    assert((await office(page, "view")) === "office", `after "Reload 3D view" the view is ${await office(page, "view")}, not the player's choice`);
    assert(await viewButton(page, "Market").isEnabled(), 'after "Reload 3D view" "Market" is disabled');
    noErrors();
    passed('a context lost during the market beat: one summary; "Reload 3D view" runs the office on the player\'s choice');
    await context.close();
  }
  {
    // Reduced motion: no year plays out; the market rests at once.
    const { context, page, year } = await officeFixturePage(browser, fixtures, { reducedMotion: "reduce" });
    await endButton(page, year).click();
    await dialog(page).waitFor({ timeout: 2000 });
    await page.waitForTimeout(SETTLE_MS);
    await closeWith(page, `Plan ${year + 1}`);
    await rests(page, "under reduced motion");
    await viewButton(page, "Market").click();
    assert((await office(page, "view")) === "market", `under reduced motion "Market" shows the ${await office(page, "view")}`);
    // Nothing moves (no dots stream, the camera cuts): the world settles within a frame or two, then draws only its
    // second of grace before it rests (core/rest.ts), as step 8 measures it.
    const rest = await rests(page, "the market under reduced motion");
    assert(rest.settledS <= 0.1, `under reduced motion the market moved for ${rest.settledS.toFixed(2)} world seconds (frames at ${rest.at.join(", ")} ms)`);
    assert(rest.restMs <= REST_AFTER_MS + 250, `under reduced motion the market drew frames for ${rest.restMs} ms (at ${rest.at.join(", ")} ms)`);
    noErrors();
    passed(`under reduced motion the market shows, settles in ${rest.settledS.toFixed(2)} world seconds and rests ${rest.restMs} ms after "Market" (its second of grace)`);
    await context.close();
  }
  {
    // A race has neither the button nor the switch.
    const { context, page } = await freshPage(browser);
    await page.goto(`${BASE}/`);
    await page.getByLabel("Name your startup").waitFor();
    await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: /Quick race/ }).click();
    await page.getByLabel("Name your startup").fill("Race Co");
    await page.locator("form button[type=submit]").click();
    await endButton(page, "Q1").waitFor();
    await endButton(page, "Q1").click();
    await opened(page);
    await closeWith(page, "Plan Q2");
    assert((await showInMarket(page).count()) === 0 && (await views(page).count()) === 0, 'a race has a "Show in market" button or a "Market" switch');
    assert((await office(page, "sounds")) === null, "a race page has the career's probe");
    noErrors();
    passed('a race, after its first quarter: no "Show in market", no "Market" switch, no career probe');
    await context.close();
  }
};

/** The eight era fixtures in order, with the era each opens in. */
const ERA_FIXTURES = [
  ["nineties", "dial-up"],
  ["goldRush", "gold-rush"],
  ["noughties", "bust"],
  ["phones", "phones"],
  ["cheapMoney", "cheap-money"],
  ["twenties", "winter-ai"],
  ["agents", "agents"],
  ["ambient", "ambient"],
];

const everyEraLook = async (browser, fixtures) => {
  current = "16. Every era's look";
  for (const [name, era] of ERA_FIXTURES) {
    const { context, page } = await freshPage(browser);
    const { save, year } = fixtures[name];
    await loadSave(page, save, year);
    await running(page);
    const { stats, scene } = await officeFigures(page, `${year} (${era})`);
    assert(scene.era === era, `the ${name} fixture's scene is in ${scene.era}, not ${era}`);
    assert(lookFor(scene.era) === era, `${year}: era ${scene.era} has the look ${lookFor(scene.era)}`);
    const row = { where: `${year}, office ${scene.office} (${era})`, office: scene.office, figures: stats.figures, drawCalls: stats.drawCalls, ceiling: ceiling(stats) };
    measured.push(row);
    await shot(page, `${year}-${era}.png`);
    noErrors();
    passed(`${year}: era ${era}, its own look; office ${scene.office}, ${stats.figures} figures, ${stats.drawCalls} of ${row.ceiling} draw calls`);
    if (era === "agents") console.log(`      the agents full floor: ${stats.drawCalls} draw calls, ceiling ${row.ceiling}, margin ${row.ceiling - stats.drawCalls}`);
    await context.close();
  }
};

const everyEraMarket = async (browser, fixtures) => {
  current = "17. The market's draw calls in every era";
  for (const [name, era] of ERA_FIXTURES) {
    const { context, page } = await freshPage(browser);
    const { save, year } = fixtures[name];
    await loadSave(page, save, year);
    await running(page);
    // The market is given once a year has been played: the year is ended and skipped.
    await endButton(page, year).click();
    if (await playBar(page).waitFor({ timeout: 5000 }).then(() => true, () => false)) {
      await page.waitForTimeout(SETTLE_MS + 150);
      await skipButton(page).click().catch(() => {});
    }
    await opened(page);
    await closeWith(page, `Plan ${year + 1}`);
    await viewButton(page, "Market").click();
    assert((await office(page, "view")) === "market", `${year + 1}: "Market" shows the ${await office(page, "view")}`);
    await rests(page, `${year + 1}, the market`);
    const stats = await office(page, "stats");
    const market = await office(page, "market");
    assert(stats.drawCalls <= MARKET_DRAW_CEILING, `${year + 1} (${market.era}): the market draws ${stats.drawCalls} draw calls, over ${MARKET_DRAW_CEILING}`);
    measured.push({ where: `${year + 1}, the market (${name} fixture, ${market.era})`, office: "market", figures: stats.figures, drawCalls: stats.drawCalls, ceiling: MARKET_DRAW_CEILING });
    const labels = await labelsReadable(page, market, `${year + 1} (${market.era}), the market`);
    await shot(page, `${year + 1}-${market.era}-market.png`);
    noErrors();
    passed(`${year + 1} (${market.era}): the market draws ${stats.drawCalls} draw calls, at most ${MARKET_DRAW_CEILING}; its ${labels.length} labels read, none overlapping`);
    await context.close();
  }
};

const theSounds = async (browser, fixtures) => {
  current = "18. Sounds fire";
  {
    const { context, page, year } = await officeFixturePage(browser, fixtures);
    const { heard: beforeMarket } = await toMarketBeat(page, year);
    assert(countOf(beforeMarket, "users-trickle") === 0, `users-trickle was heard before the market beat: ${JSON.stringify(beforeMarket)}`);
    assert(beforeMarket.includes("footsteps"), `no footsteps were heard while the hires walked in: ${JSON.stringify(beforeMarket)}`);
    assert(countOf(beforeMarket, "asset-office-upgrade") === 0, `the office move was heard before the summary: ${JSON.stringify(beforeMarket)}`);
    await sleep(400);
    const inMarket = await office(page, "sounds");
    assert(countOf(inMarket, "users-trickle") === 1, `the market beat's sounds are ${JSON.stringify(inMarket)}`);
    await dialog(page).waitFor({ timeout: 8000 });
    await page.waitForTimeout(SETTLE_MS);
    const atSummary = await office(page, "sounds");
    assert(countOf(atSummary, "asset-office-upgrade") === 1, `as the summary opened the sounds are ${JSON.stringify(atSummary)}`);
    passed(`End ${year}: footsteps as the hires walk in, users-trickle in the market beat, asset-office-upgrade once as the summary opens`);
    await page.reload();
    await dialog(page).waitFor({ timeout: 10000 });
    await running(page);
    await page.waitForTimeout(1500);
    const reloaded = await office(page, "sounds");
    assert(reloaded.length === 0, `reloaded with the report open, the sounds are ${JSON.stringify(reloaded)}`);
    noErrors();
    passed("reloaded with the report open: no sound asked for");
    await context.close();
  }
  {
    const { context, page, year } = await officeFixturePage(browser, fixtures, { reducedMotion: "reduce" });
    await endButton(page, year).click();
    await dialog(page).waitFor({ timeout: 2000 });
    const heard = await office(page, "sounds");
    assert(countOf(heard, "asset-office-upgrade") === 1, `under reduced motion, as the summary opened, the sounds are ${JSON.stringify(heard)}`);
    assert(countOf(heard, "users-trickle") === 0, `under reduced motion users-trickle was heard: ${JSON.stringify(heard)}`);
    noErrors();
    passed("under reduced motion: asset-office-upgrade as the summary opens, no users-trickle");
    await context.close();
  }
  {
    const { context, page } = await freshPage(browser);
    const { save, year } = fixtures.listing;
    await loadSave(page, save, year);
    await running(page);
    await page.getByRole("group", { name: "Go public" }).getByRole("button", { name: /Go public/ }).click();
    await endButton(page, year).click();
    await dialog(page).waitFor({ timeout: 10000 });
    await page.waitForTimeout(SETTLE_MS);
    const heard = await office(page, "sounds");
    assert(countOf(heard, "crowd-cheer") === 1, `going public in ${year}, the sounds are ${JSON.stringify(heard)}`);
    noErrors();
    passed(`going public in ${year}: crowd-cheer once`);
    await context.close();
  }
};

// ---------------------------------------------------------------------------------------------------------------
// 19. The start tour with the 3D office

const tourCard = (page) => page.locator('section[aria-label="Tour"]');
const tourButton = (page, name) => tourCard(page).getByRole("button", { name, exact: true });
const tourKey = (page) => page.evaluate((key) => localStorage.getItem(key), TOUR_KEY);
/** The card's box against the box of every visible target of the step. */
const cardClear = async (page, target, where) => {
  const card = await tourCard(page).boundingBox();
  const boxes = await page.locator(`[data-tutorial="${target}"]`).evaluateAll((els) => els.filter((el) => el.getClientRects().length > 0).map((el) => el.getBoundingClientRect().toJSON()));
  assert(card !== null && boxes.length > 0, `${where}: no card or no ${target}`);
  for (const b of boxes) {
    const overlap = card.x < b.right && b.left < card.x + card.width && card.y < b.bottom && b.top < card.y + card.height;
    assert(!overlap, `${where}: the tour card covers ${target}`);
  }
};
/** The card shows step `n` of 7 (its label is drawn in capitals, so its textContent is read). */
const onStep = async (page, n, where) => {
  await tourCard(page).waitFor();
  const text = await tourCard(page).textContent();
  assert(text.includes(`Step ${n} of 7`), `${where}: the card does not show "Step ${n} of 7": ${JSON.stringify(text)}`);
  await noForbiddenWords(tourCard(page), `the tour's step ${n}`);
};

const tourWithOffice = async (browser) => {
  current = "19. The start tour with the 3D office";
  const { context, page } = await freshPage(browser, { tour: true });
  await startCareer(page);
  await running(page);
  await onStep(page, 1, "1990 with the office");
  await tourButton(page, "Next").click();
  await onStep(page, 2, "the team step");
  const team = await tourCard(page).innerText();
  assert(team.includes("click a person, then another team"), `the team step does not say how to move a person in the office: ${JSON.stringify(team)}`);
  await cardClear(page, "team", "the team step");
  await rests(page, "the team step");
  await pickSomeone(page);
  assert((await carryStrip(page).count()) === 1, "with the card up, a click on a person does not start a carry");
  await carryStrip(page).getByRole("button", { name: "Keep them", exact: true }).click();
  await page.waitForTimeout(300);
  assert((await carryStrip(page).count()) === 0, '"Keep them" did not put the person back');
  passed("with the tour's card up, the team step says how to move a person in the office, and a click on a person still starts a carry");
  for (const n of [2, 3, 4]) {
    await tourButton(page, "Next").click();
    await onStep(page, n + 1, `Next from step ${n}`);
  }
  await cardClear(page, "end", "the end step");
  await endButton(page, FIRST_YEAR).click();
  await playBar(page).waitFor({ timeout: 5000 });
  assert((await tourCard(page).count()) === 0, "the tour card shows while the year plays out");
  await dialog(page).waitFor({ timeout: 30000 });
  await page.waitForTimeout(SETTLE_MS);
  assert((await tourCard(page).count()) === 0, "the tour card shows while the summary is open");
  await closeWith(page, `Plan ${FIRST_YEAR + 1}`);
  await onStep(page, 6, "the summary closed");
  await cardClear(page, "report", "the report step");
  await tourButton(page, "Next").click();
  await onStep(page, 7, "the closing card");
  await tourButton(page, "Done").click();
  await tourCard(page).waitFor({ state: "detached" });
  assert((await tourKey(page)) === "done", `after Done the tour's key is ${JSON.stringify(await tourKey(page))}`);
  noErrors();
  passed("the tour with the 3D office: hidden while 1990 plays out and its summary is open, on to the report step after, and Done remembered");
  await context.close();
};

// ---------------------------------------------------------------------------------------------------------------
// Main

const main = async () => {
  if (build) {
    const built = spawnSync("npx", ["vite", "build"], { cwd: ROOT, stdio: "inherit" });
    if (built.status !== 0) {
      console.error("office-check: vite build failed");
      process.exit(1);
    }
  }
  const made = spawnSync("npx", ["tsx", "scripts/career-fixtures.ts"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (made.status !== 0) {
    console.error(`office-check: the fixtures could not be made\n${made.stderr}`);
    process.exit(1);
  }
  const fixtures = JSON.parse(made.stdout);
  if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true });

  await startServer();
  const browser = await chromium.launch();
  browsers.push(browser);
  const noWebGL = await chromium.launch({ args: ["--disable-3d-apis"] });
  browsers.push(noWebGL);
  try {
    if (runs(1)) await raceUnchanged(browser);
    if (runs(2)) await opens(browser, fixtures);
    if (runs(3)) await yearAndMoves(browser);
    if (runs(4)) await movingPeople(browser, fixtures);
    if (runs(5)) await movesAndLooks(browser, fixtures);
    if (runs(6)) await takenDown(browser);
    if (runs(7)) await hiddenAndResized(browser);
    if (runs(8)) await reducedMotion(browser);
    if (runs(9)) await theSwitch(browser);
    if (runs(10)) await fallbacks(browser, noWebGL);
    if (runs(11)) await reloadMidYear(browser, noWebGL);
    if (runs(12)) await wholeCareer(browser);
    if (runs(13)) await narrow(browser, fixtures);
    if (runs(15)) await theMarket(browser, fixtures);
    if (runs(16)) await everyEraLook(browser, fixtures);
    if (runs(17)) await everyEraMarket(browser, fixtures);
    if (runs(18)) await theSounds(browser, fixtures);
    if (runs(19)) await tourWithOffice(browser);
    current = "14. No console errors";
    noErrors();
    passed("no console error or page error on any page");
  } finally {
    for (const each of browsers) await each.close();
    stopServer();
  }
  if (measured.length > 0) {
    console.log("office-check: draw calls at 1280x800");
    for (const row of measured) {
      const margin = row.ceiling === undefined ? "" : ` (ceiling ${row.ceiling}, margin ${row.ceiling - row.drawCalls})`;
      console.log(`  ${row.where}: office ${row.office}, ${row.figures} figures, ${row.drawCalls} draw calls${margin}`);
    }
  }
  console.log("office-check: every assertion passed");
};

main().catch(async (error) => {
  if (error instanceof Failed) console.error(`office-check: FAILED ${error.message}`);
  else console.error(`office-check: FAILED ${current}: ${error.stack ?? error}`);
  for (const each of browsers) await each.close().catch(() => {});
  stopServer();
  process.exit(1);
});
