#!/usr/bin/env node
/**
 * The browser check of the career: builds the app, serves `dist` with `vite preview`, and plays it in headless
 * Chromium at 1280x800.
 *
 *   node scripts/career-check.mjs [--no-build] [--shots <dir>] [--only <n,n,...>]
 *
 * In order: the race is unchanged (its on-screen text matches scripts/race-text.snapshot.json, and a fresh race
 * plays its first quarter); the first screen in Career; a whole career from 1990 to 2038 with seed 1, checking each
 * year's header, timeline, button, report and words, a reload, "Save and leave" and the end screen; then, from the
 * saves scripts/career-fixtures.ts makes, going public, the rescue, the board firing the founder and the rescue
 * keeping them on, the second failure, an office move and a full campus; no sideways scroll at 390 px; last (11), a
 * milestone's sound in the 2D screens: the office move's year ends and its sound is asked for once; (12) in a career,
 * + on Recruiting with everyone at work moves one person from Product, the row says so and the plan says how hiring
 * works, on a desktop and an iPhone; (13) the start tour at 1280x800, from the goal to Done through the real controls,
 * never covering its target, hidden while the summary is open, done after a reload, shown again by How to play and
 * skipped; (14) the same tour on an iPhone (Playwright's "iPhone 13"): the Plan tab pressed for the plan's steps, every
 * target on screen and above the bar, the card under 45% of the screen, nothing past the edges; (15) nothing cut off
 * on an iPhone over a played year, tooltips open, and every text box 16 px or more. Every
 * year, "you are here" must sit inside the timeline; on an end screen the timeline must fit with no sideways scroll,
 * every era named in full and no "you are here"; and a finished career beside a race save is offered by its ending.
 *
 * Every fresh page marks the start tour as seen (localStorage "startupworld:tour:v1"), unless asked for the tour.
 *
 * Every page fails on any console error or page error. "Forbidden words" are period words a career never uses,
 * looked for in the page's text and its title and aria-label attributes, leaving out every element that carries
 * `data-card-text` (a card's name and text come from the config as they are).
 *
 * Chromium runs with WebGL switched off (`--disable-3d-apis`): this script is the proof that a career is complete
 * without 3D, in the 2D screens; scripts/office-check.mjs covers the 3D office. So every career page must show the
 * "3D office" switch as unavailable, draw no canvas, never add a `[data-office]` or `[data-world]` element (counted by
 * a MutationObserver from the page's first script, across reloads) and never fetch the office's chunk. The race must
 * never fetch the office or the world either, load no script holding three's renderer, and show no "3D office" switch.
 *
 * Exits 1 on the first failed assertion, naming it. `--shots <dir>` saves 1990, 2007, 2023 and the end screen.
 * `--no-build` serves the `dist` that is there. `--only` runs only the steps named (2 and 3 are one: the whole
 * career). Not part of `npm test`: it needs a browser and takes minutes.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { raceText, stubAnalytics } from "./race-text.mjs";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
/** The phone the owner played on, as Playwright describes it: 390x664, touch, a mobile viewport. */
const IPHONE = devices["iPhone 13"];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4180;
const BASE = `http://localhost:${PORT}`;
const RACE_KEY = "startupworld:tb:save";
const CAREER_KEY = "startupworld:career:save";
const TOUR_KEY = "startupworld:tour:v1";
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const FIRST_YEAR = 1990;
const LAST_YEAR = 2038;
const YEARS = LAST_YEAR - FIRST_YEAR + 1;
/**
 * A dialog ignores a click this soon after it opens, and "End" one this soon after a dialog closes
 * (src/ui/useDialog.ts, SETTLE_MS), with a margin.
 */
const SETTLE_MS = 600;
const FORBIDDEN = /\b(quarters?|quarterly|turns?)\b|\bQ\d{1,2}\b/i;
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
const SHOT_YEARS = new Set([1990, 2007, 2023]);

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
let browser = null;
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

/** Whether something already listens on `port` at `host`. */
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
  server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout.on("data", (chunk) => (output += chunk));
  server.stderr.on("data", (chunk) => (output += chunk));
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    if (server.exitCode !== null) throw new Error(`vite preview exited:\n${output}`);
    if (output.includes("Local:")) {
      try {
        const response = await fetch(`${BASE}/`);
        if (response.ok) return;
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

/** Every console error and page error on a page; checked after every step. */
const pages = [];
const watch = (page) => {
  const bad = [];
  page.on("console", (message) => {
    if (message.type() === "error") bad.push(`console error: ${message.text()}`);
  });
  page.on("pageerror", (error) => bad.push(`page error: ${error.message}`));
  pages.push(bad);
  return bad;
};
const noErrors = () => {
  for (const bad of pages) assert(bad.length === 0, bad.join(" | "));
};

/** The tab's count of `[data-office]` and `[data-world]` elements ever added, kept in sessionStorage across reloads. */
const OFFICE_ADDS = "careerCheck:officeAdds";
const countOfficeAdds = (key) => {
  const seen = (node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return 0;
    const self = node.matches("[data-office], [data-world]") ? 1 : 0;
    return self + node.querySelectorAll("[data-office], [data-world]").length;
  };
  new MutationObserver((records) => {
    let found = 0;
    for (const record of records) for (const node of record.addedNodes) found += seen(node);
    if (found > 0) sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) ?? "0") + found));
  }).observe(document, { childList: true, subtree: true });
};
const officeAdds = (page) => page.evaluate((key) => Number(sessionStorage.getItem(key) ?? "0"), OFFICE_ADDS);

/** The office's lazy chunk, and the world's; neither is ever fetched with WebGL off, nor by a race. */
const OFFICE_CHUNK = /assets\/CareerOffice-/;
const OFFICE_OR_WORLD_CHUNK = /assets\/(CareerOffice|WorldView)-/;

/** Every URL a page requests. */
const requested = new WeakMap();
const requestsOf = (page) => requested.get(page) ?? [];

/** A fresh context (fresh storage) and a page in it, its errors watched, its requests and office elements counted. */
const freshPage = async (size = DESKTOP, { tour = false, device = null } = {}) => {
  // A device descriptor (its viewport, touch, scale and user agent) stands in for the plain viewport; Chromium plays it.
  const { defaultBrowserType: _browserType, ...asDevice } = device ?? {};
  const context = await browser.newContext(device === null ? { viewport: size } : asDevice);
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
  watch(page);
  await stubAnalytics(page);
  return { context, page };
};

/** The page shows the 2D screens only: no office element, ever added or there now, and no office chunk fetched. */
const stays2D = async (page, where) => {
  assert((await page.locator("[data-office]").count()) === 0, `${where}: a [data-office] element is on the page`);
  const adds = await officeAdds(page);
  assert(adds === 0, `${where}: ${adds} [data-office] or [data-world] elements were added to the page`);
  const chunk = requestsOf(page).find((url) => OFFICE_CHUNK.test(url));
  assert(chunk === undefined, `${where}: the office's chunk was requested: ${chunk}`);
};

/** The text under `root` that a player can read, leaving out card text: text nodes, titles and aria-labels. */
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
  if (found !== null) {
    const line = text.split("\n").find((each) => FORBIDDEN.test(each));
    assert(false, `${where} says "${found[0]}": ${JSON.stringify(line)}`);
  }
};

const storageKeys = (page) => page.evaluate(([race, career]) => ({ race: localStorage.getItem(race), career: localStorage.getItem(career) }), [RACE_KEY, CAREER_KEY]);

const header = (page) => page.locator("main header h1");
const dialog = (page) => page.locator('[role="dialog"]');
const endButton = (page, when) => page.getByRole("button", { name: `End ${when}`, exact: true });
const milestones = (page) => page.locator('ul[aria-label="Milestones"] li').allTextContents();

/** Opens the dialog that a click shows and waits until it takes clicks. */
const opened = async (page) => {
  await dialog(page).waitFor();
  await page.waitForTimeout(SETTLE_MS);
  return dialog(page);
};

/** Clicks a dialog's button that closes it, and waits until "End" takes clicks again. */
const closeWith = async (page, name) => {
  await dialog(page).getByRole("button", { name, exact: true }).click();
  await dialog(page).waitFor({ state: "detached" });
  await page.waitForTimeout(SETTLE_MS);
};

/** The summary's "Full report", and the full report once it takes clicks. */
const fullReport = async (page) => {
  await dialog(page).getByRole("button", { name: "Full report", exact: true }).click();
  await dialog(page).locator("h2", { hasText: "annual report" }).waitFor();
  await dialog(page).getByText("Annual", { exact: true }).waitFor();
  await page.waitForTimeout(SETTLE_MS);
  return dialog(page);
};

const eraOf = (year) => ERAS.filter(([first]) => first <= year).pop()[1];

/**
 * The timeline as laid out: whether its strip needs a sideways scroll, the era names that do not fit their box, and
 * where "you are here" sits against the strip's visible box (null when it is not drawn).
 */
const timelineLayout = (page, scope = "main") =>
  page.locator(`${scope} section[aria-label="Timeline"]`).first().evaluate((timeline) => {
    const strip = timeline.querySelector(".overflow-x-auto");
    const box = strip.getBoundingClientRect();
    const here = timeline.querySelector("[data-here]");
    const label = here === null ? null : here.getBoundingClientRect();
    const cut = [...timeline.querySelectorAll("[title] > div:first-child")].filter((name) => name.scrollWidth > name.clientWidth || name.scrollHeight > name.clientHeight + 1).map((name) => name.textContent);
    return {
      scrolls: strip.scrollWidth > strip.clientWidth + 1,
      cut,
      here: label === null ? null : { inside: label.left >= box.left - 0.5 && label.right <= box.right + 0.5, left: label.left, right: label.right, boxLeft: box.left, boxRight: box.right },
    };
  });

/** The end screen's timeline fits without a sideways scroll, with every era named in full and no "you are here". */
const endTimelineFits = async (page) => {
  const layout = await timelineLayout(page);
  assert(!layout.scrolls, "the end screen's timeline needs a sideways scroll at 1280 px");
  assert(layout.cut.length === 0, `the end screen's timeline cuts off era names: ${JSON.stringify(layout.cut)}`);
  assert(layout.here === null, 'the end screen\'s timeline draws "you are here"');
};

/** A race save, kept from the race played first, to set beside a career save. */
let raceSave = null;

/** A page with nothing but `save` under the career's key, loaded. */
const loadSave = async (save, size = DESKTOP) => {
  const { context, page } = await freshPage(size);
  await page.goto(`${BASE}/`);
  await page.getByLabel("Name your startup").waitFor();
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [CAREER_KEY, save]);
  await page.reload();
  await header(page).waitFor();
  await stays2D(page, "a loaded save");
  return { context, page };
};

// ---------------------------------------------------------------------------------------------------------------
// 1. The race unchanged

const raceUnchanged = async () => {
  current = "1. Race unchanged";
  const { context, page } = await freshPage();
  await page.goto(`${BASE}/`);
  await page.getByLabel("Name your startup").waitFor();
  const modes = page.getByRole("group", { name: "Mode" });
  const race = modes.getByRole("button", { name: /Quick race/ });
  const career = modes.getByRole("button", { name: /Career/ });
  assert((await race.count()) === 1 && (await career.count()) === 1, 'the first screen does not offer "Quick race" and "Career"');
  // A fresh first screen preselects Career (the owner's decision); choosing Quick race selects it.
  assert((await career.getAttribute("aria-pressed")) === "true", "a fresh first screen does not preselect Career");
  await race.click();
  assert((await race.getAttribute("aria-pressed")) === "true", "Quick race is not chosen after choosing it");

  const expected = JSON.parse(readFileSync(resolve(ROOT, "scripts/race-text.snapshot.json"), "utf8"));
  const texts = await raceText(page, BASE);
  assert(texts.length === expected.length, `the race gave ${texts.length} texts, the snapshot has ${expected.length}`);
  texts.forEach((text, n) => assert(text === expected[n], `the race's text ${n + 1} differs from scripts/race-text.snapshot.json`));
  passed("the race's on-screen text matches its snapshot");

  // Leave that race and play the first quarter of a new one.
  await page.getByRole("button", { name: "New game", exact: true }).click();
  await page.getByRole("button", { name: "Abandon game", exact: true }).click();
  await page.getByLabel("Name your startup").waitFor();
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: /Quick race/ }).click();
  await page.getByLabel("Name your startup").fill("Race Co");
  await page.locator("form button[type=submit]").click();
  await endButton(page, "Q1").waitFor();
  assert((await header(page).innerText()).includes("Q1 of 20"), 'the header does not say "Q1 of 20"');
  await endButton(page, "Q1").click();
  const report = await opened(page);
  assert((await report.locator("h2").first().innerText()) === "Race Co: Q1 report", 'the report is not titled "Race Co: Q1 report"');
  assert((await report.getByRole("button", { name: "Plan Q2", exact: true }).count()) === 1, 'the report has no "Plan Q2" button');
  await closeWith(page, "Plan Q2");
  assert((await page.locator("main header").getByRole("button", { name: "3D office" }).count()) === 0, 'the race\'s header has a "3D office" button');
  const officeOrWorld = requestsOf(page).find((url) => OFFICE_OR_WORLD_CHUNK.test(url));
  assert(officeOrWorld === undefined, `the race requested the office or the world: ${officeOrWorld}`);
  const scripts = [...new Set(requestsOf(page).map((url) => new URL(url).pathname).filter((path) => /^\/assets\/[^/]+\.js$/.test(path)))];
  assert(scripts.length > 0, "the race requested no script under assets/");
  // Read from dist: three may sit in a chunk shared with the lab, under another name.
  const renderer = scripts.filter((path) => readFileSync(resolve(ROOT, `dist${path}`), "utf8").includes("WebGLRenderer"));
  assert(renderer.length === 0, `the race loaded three's renderer in ${renderer.join(", ")}`);
  passed(`the race fetched neither the office nor the world, and none of its ${scripts.length} scripts holds WebGLRenderer; no "3D office" button`);
  raceSave = (await storageKeys(page)).race;
  await page.getByRole("button", { name: "New game", exact: true }).click();
  await page.getByRole("button", { name: "Abandon game", exact: true }).click();
  await page.getByLabel("Name your startup").waitFor();
  const keys = await storageKeys(page);
  assert(keys.race === null && keys.career === null, "storage still holds a save after the race was abandoned");
  noErrors();
  passed("a new race plays Q1 and leaves no save once abandoned");
  await context.close();
};

// ---------------------------------------------------------------------------------------------------------------
// 2 and 3. The first screen in Career, and a whole career

const wholeCareer = async () => {
  current = "2. The first screen in Career";
  const { context, page } = await freshPage();
  await page.goto(`${BASE}/`);
  await page.getByLabel("Name your startup").waitFor();
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: /Career/ }).click();
  await page.getByRole("button", { name: "Start in 1990", exact: true }).waitFor();
  await noForbiddenWords(page.locator("body"), "the first screen");
  const help = page.locator("section", { has: page.getByRole("heading", { name: "How to play" }) });
  assert((await help.locator("dt").count()) > 0, "How to play shows no rules");
  await noForbiddenWords(help, "How to play");
  noErrors();
  passed("the first screen and How to play in Career have no forbidden words");

  current = "3. A whole career";
  await page.getByLabel("Name your startup").fill("Check Co");
  await page.getByText("Replay a game with its seed").click();
  await page.getByPlaceholder("for example 20417").fill("1");
  await page.locator("form button[type=submit]").click();

  let seenMilestones = await milestones(page);
  let aheadSeen = false;
  let rivalWentOut = false;
  let rivalEntered = false;
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
    current = `3. A whole career, ${year}`;
    await endButton(page, year).waitFor();

    if (year === FIRST_YEAR) {
      // At once: the WebGL 2 probe says no before the first paint.
      const toggle = page.locator("main header").getByRole("button", { name: "3D office", exact: true });
      assert((await toggle.count()) === 1, 'the header has no "3D office" button');
      assert(await toggle.isDisabled(), 'the "3D office" button is enabled with WebGL off');
      const why = "The 3D office cannot be shown on this device. The game is complete without it.";
      assert((await toggle.getAttribute("title")) === why, `the "3D office" button's title is ${JSON.stringify(await toggle.getAttribute("title"))}`);
      assert((await page.locator("canvas").count()) === 0, "a canvas is on the page with WebGL off");
      for (const [name, label] of [["the plan", `Plan for ${year}`], ["the projection", "If this plan plays out"], ["the rivals", "Rivals"]]) {
        assert(await page.locator(`section[aria-label="${label}"]`).isVisible(), `${name} is not visible at 1280x800`);
      }
      await stays2D(page, "the first year");
      await page.waitForTimeout(5000);
      await stays2D(page, "the first year after 5 s");
      passed('with WebGL off the "3D office" button is disabled and says why; no canvas, no office; the plan, the projection and the rivals are shown');
    }

    if (year === 2005) {
      await page.reload();
      await endButton(page, year).waitFor();
      assert((await header(page).innerText()).includes("2005"), "the header does not read 2005 after a reload");
      passed("2005 is still the year after a reload");
    }
    if (year === 2010) {
      await page.getByRole("button", { name: "New game", exact: true }).click();
      await page.getByRole("button", { name: "Save and leave", exact: true }).click();
      const resume = page.getByRole("button", { name: "Resume your career (2010)", exact: true });
      await resume.waitFor();
      await resume.click();
      await endButton(page, year).waitFor();
      assert((await header(page).innerText()).includes("2010"), "the header does not read 2010 after resuming");
      passed('"Save and leave" in 2010, then "Resume your career (2010)"');
    }

    const heading = await header(page).innerText();
    assert(heading.includes(`${year} · year ${year - FIRST_YEAR + 1} of ${YEARS}`), `the header reads ${JSON.stringify(heading)}`);
    const timeline = page.locator('section[aria-label="Timeline"]');
    assert(await timeline.isVisible(), "the timeline is not visible");
    const timelineText = await timeline.innerText();
    assert(timelineText.includes(eraOf(year)), `the timeline does not name ${eraOf(year)}`);
    const layout = await timelineLayout(page);
    assert(layout.here !== null && layout.here.inside, `"you are here" in ${year} is cut off by the timeline's edge: ${JSON.stringify(layout.here)}`);
    const status = await page.locator('section[aria-label="Your career"]').innerText();
    assert(status.startsWith(eraOf(year)), `the year's status does not open with ${eraOf(year)}: ${JSON.stringify(status)}`);
    assert(/history ends/i.test(timelineText), 'the timeline has no "history ends" line');
    if (year === 2021 || year === 2022) assert(timelineText.includes("A platform shift comes in 2023 (The chatbot)"), 'the timeline does not say "A platform shift comes in 2023 (The chatbot)"');

    const event = page.locator('section[aria-label="This year\'s event"]');
    const label = (await event.count()) === 0 ? null : (await event.locator("span").first().textContent()).trim();
    if (year === 1995) assert(label !== null && label === "History 1995", `the event card's label in 1995 is ${JSON.stringify(label)}`);
    if (label !== null && /^(History|Invented) /.test(label)) {
      const want = `${year >= 2027 ? "Invented" : "History"} ${year}`;
      assert(label === want, `a dated card is labelled ${JSON.stringify(label)}, not ${JSON.stringify(want)}`);
      if (year >= 2027) aheadSeen = true;
    }
    await noForbiddenWords(page.locator("body"), "the game screen");
    if (shotsDir !== null && SHOT_YEARS.has(year)) await page.screenshot({ path: join(shotsDir, `career-${year}.png`), fullPage: true });

    await endButton(page, year).click();
    const summary = await opened(page);
    assert((await summary.getByText("The year in brief", { exact: true }).count()) > 0, 'the summary is not labelled "The year in brief"');
    assert((await summary.getByRole("button", { name: "Full report", exact: true }).count()) === 1, 'the summary has no "Full report"');
    await noForbiddenWords(summary, "the summary");
    const report = await fullReport(page);
    const title = await report.locator("h2").first().innerText();
    assert(title === `Check Co: ${year} annual report`, `the full report is titled ${JSON.stringify(title)}`);
    await noForbiddenWords(report, "the full report");
    const next = year === LAST_YEAR ? "See how it ended" : `Plan ${year + 1}`;
    assert((await report.getByRole("button", { name: next, exact: true }).count()) === 1, `the full report has no "${next}" button`);
    await closeWith(page, next);

    const now = await milestones(page);
    for (const line of now.filter((each) => !seenMilestones.includes(each))) {
      if (/ (went bankrupt|'s founder was fired)$/.test(line)) rivalWentOut = true;
      const entered = line.match(/^\d{4}: (.+) entered$/);
      if (entered === null) continue;
      rivalEntered = true;
      const rival = page.locator('section[aria-label="Rivals"] li', { has: page.locator("span", { hasText: entered[1] }) });
      assert((await rival.count()) > 0 && (await rival.first().innerText()).includes("(new)"), `the rivals panel does not mark ${entered[1]} as new`);
    }
    seenMilestones = now;
    noErrors();
  }
  current = "3. A whole career";
  assert(aheadSeen, 'no year from 2027 showed a dated card labelled "Invented"');
  passed('every year from 1990 to 2038: header, timeline ("you are here" not cut off), era, button, summary, full report, no forbidden words');
  await stays2D(page, "the whole career");
  passed("the whole career stayed in the 2D screens: no office or world element ever added, no office chunk fetched");

  // The end screen.
  current = "3. A whole career, the end screen";
  await page.getByRole("heading", { name: "Final standings" }).waitFor();
  const checkEnd = async () => {
    assert((await page.locator("main ol > li").count()) === 4, "the final standings do not have four entries");
    assert((await page.getByRole("heading", { name: "Your career" }).count()) === 1, 'the end screen has no "Your career"');
    assert(await page.locator('main section[aria-label="Timeline"]').isVisible(), "the end screen shows no timeline");
    await endTimelineFits(page);
    if (rivalWentOut && rivalEntered) assert((await page.getByRole("heading", { name: "Gone", exact: true }).count()) === 1, 'the end screen has no "Gone"');
    assert((await milestones(page)).some((line) => line.endsWith(": Product launched")), 'the milestones do not include "Product launched"');
    await noForbiddenWords(page.locator("body"), "the end screen");
  };
  await checkEnd();
  if (shotsDir !== null) await page.screenshot({ path: join(shotsDir, "career-end.png"), fullPage: true });
  await page.reload();
  await page.getByRole("heading", { name: "Final standings" }).waitFor();
  await checkEnd();
  passed("the end screen: four standings, your career on a timeline that fits with no \"you are here\", still there after a reload");

  await page.getByRole("button", { name: "Last year's report", exact: true }).click();
  const last = await opened(page);
  assert((await last.locator("h2").first().innerText()) === `Check Co: ${LAST_YEAR} annual report`, `"Last year's report" does not open the ${LAST_YEAR} report`);
  await closeWith(page, "See how it ended");
  await page.getByRole("heading", { name: "Final standings" }).waitFor();
  await page.getByRole("button", { name: "Play again", exact: true }).click();
  await page.getByLabel("Name your startup").waitFor();
  const career = page.getByRole("group", { name: "Mode" }).getByRole("button", { name: /Career/ });
  assert((await career.getAttribute("aria-pressed")) === "true", 'after "Play again" Career is not chosen');
  assert((await storageKeys(page)).career === null, 'storage still holds the career after "Play again"');
  noErrors();
  passed('"Last year\'s report" opens 2038; "Play again" goes back to the first screen with Career chosen and no save');
  await context.close();
};

// ---------------------------------------------------------------------------------------------------------------
// 4 to 9. The saves

const goingPublic = async ({ save, year, amount }) => {
  current = "4. Going public";
  const { context, page } = await loadSave(save);
  const goPublic = page.getByRole("group", { name: "Go public" }).getByRole("button", { name: /Go public/ });
  assert(await goPublic.isEnabled(), '"Go public" is not enabled');
  assert((await goPublic.innerText()).includes(amount), `"Go public" does not show ${amount}`);
  await goPublic.click();
  assert((await goPublic.getAttribute("aria-pressed")) === "true", '"Go public" is not chosen after choosing it');
  await endButton(page, year).click();
  await opened(page);
  const report = await fullReport(page);
  const text = await report.innerText();
  assert(text.includes("You went public"), 'the full report does not say "You went public"');
  assert(text.includes(amount), `the full report does not show ${amount}`);
  await closeWith(page, `Plan ${year + 1}`);
  assert((await page.locator("main").innerText()).includes(`Public since ${year}`), `the plan does not show "Public since ${year}"`);
  const raises = page.getByRole("group", { name: "Raise money" }).getByRole("button", { name: /^Sell/ });
  assert((await raises.count()) > 0, "the plan offers no raise options");
  for (const option of await raises.all()) {
    assert(await option.isDisabled(), "a raise option is enabled after going public");
    assert((await option.getAttribute("title")) === "A public company cannot raise privately.", "a raise option does not say why it is disabled");
  }
  assert((await page.locator("main").innerText()).includes("A public company cannot raise privately."), 'the plan does not say "A public company cannot raise privately."');
  noErrors();
  passed(`going public in ${year} for ${amount}`);
  await context.close();
};

const theRescue = async ({ save, year }) => {
  current = "5. The rescue";
  const { context, page } = await loadSave(save);
  const bar = page.locator("div.fixed.inset-x-0.bottom-0");
  const warning = await bar.innerText();
  assert(warning.includes("rescued once"), `the bottom bar's warning does not mention "rescued once": ${JSON.stringify(warning)}`);
  await endButton(page, year).click();
  const summary = await opened(page);
  assert((await summary.innerText()).includes("Investors rescued the company"), 'the summary\'s headline does not say "Investors rescued the company"');
  await closeWith(page, `Plan ${year + 1}`);
  await endButton(page, year + 1).waitFor();
  const status = await page.locator('section[aria-label="Your career"]').innerText();
  assert(status.includes(`Rescue used in ${year}`), `the status does not say "Rescue used in ${year}"`);
  assert((await page.locator("main").innerText()).includes("After the rescue your board does not vote this year."), "the plan does not say the board does not vote this year");
  noErrors();
  passed(`the rescue in ${year}, and the game goes on`);
  await context.close();
};

const firedAndRescued = async ({ save, year }) => {
  current = "6. Fired and rescued";
  const { context, page } = await loadSave(save);
  await endButton(page, year).click();
  await opened(page);
  const report = await fullReport(page);
  assert((await report.innerText()).includes("Your board voted to fire you, and this time the rescue kept you on."), "the full report does not say the rescue kept the founder on");
  await closeWith(page, `Plan ${year + 1}`);
  await endButton(page, year + 1).waitFor();
  noErrors();
  passed(`the board fired the founder in ${year} and the rescue kept them on`);
  await context.close();
};

const secondFailure = async ({ save, year }) => {
  current = "7. The second failure";
  const { context, page } = await loadSave(save);
  await endButton(page, year).click();
  const summary = await opened(page);
  assert((await summary.getByText("The year in brief", { exact: true }).count()) > 0, "the summary is not shown first");
  assert((await summary.getByRole("button", { name: "See how it ended", exact: true }).count()) === 1, 'the summary\'s button does not read "See how it ended"');
  await closeWith(page, "See how it ended");
  const checkEnd = async () => {
    const title = page.locator("main h1");
    await title.waitFor();
    assert((await title.innerText()) === "Check Co ran out of cash again.", `the end screen is titled ${JSON.stringify(await title.innerText())}`);
    const text = await page.locator("main h1 + p").innerText();
    assert(text.includes(String(year)) && text.includes("1994"), `the end screen's text does not name ${year} and 1994: ${JSON.stringify(text)}`);
    await endTimelineFits(page);
  };
  await checkEnd();
  await page.reload();
  await checkEnd();
  noErrors();
  passed(`a second failure in ${year} ends the career, and the end screen (its timeline fits, no "you are here") stays after a reload`);

  // With a race save beside it, the first screen offers the finished career's ending, dated to its last year.
  if (raceSave === null && !runs(1)) raceSave = await aRaceSave();
  assert(raceSave !== null, "no race save was kept from the race played first");
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [RACE_KEY, raceSave]);
  await page.reload();
  await page.getByLabel("Name your startup").waitFor();
  const ended = page.getByRole("button", { name: `See how your career ended (${year})`, exact: true });
  assert((await ended.count()) === 1, `the first screen does not offer "See how your career ended (${year})"`);
  assert((await page.getByRole("button", { name: /^Resume your career/ }).count()) === 0, 'the first screen offers a finished career as "Resume your career"');
  await ended.click();
  await checkEnd();
  noErrors();
  passed(`beside a race save, the finished career is offered as "See how your career ended (${year})", and opens on its end screen`);
  await context.close();
};

/** A race save made on its own, for `--only` runs that leave out step 1: a new race with its first quarter played. */
const aRaceSave = async () => {
  const { context, page } = await freshPage();
  await page.goto(`${BASE}/`);
  await page.getByLabel("Name your startup").waitFor();
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: /Quick race/ }).click();
  await page.getByLabel("Name your startup").fill("Race Co");
  await page.locator("form button[type=submit]").click();
  await endButton(page, "Q1").waitFor();
  await endButton(page, "Q1").click();
  await opened(page);
  await closeWith(page, "Plan Q2");
  const save = (await storageKeys(page)).race;
  await context.close();
  return save;
};

const officeMove = async ({ save, year }) => {
  current = "8. An office move";
  const { context, page } = await loadSave(save);
  const main = await page.locator("main").innerText();
  assert(main.includes("Office move"), 'the projection does not show "Office move"');
  const line = main.split("\n").find((each) => each.includes("→") && each.includes("Garage")) ?? null;
  assert(main.includes("Garage → Shared office"), `the projection does not show "Garage → Shared office": ${JSON.stringify(line)}`);
  await endButton(page, year).click();
  await opened(page);
  const report = await fullReport(page);
  assert((await report.getByText("Moving", { exact: true }).count()) > 0, 'the full report has no "Moving" line');
  await closeWith(page, `Plan ${year + 1}`);
  const status = await page.locator('section[aria-label="Your career"]').innerText();
  assert(status.includes("Shared office:"), `the status does not name the shared office: ${JSON.stringify(status)}`);
  noErrors();
  passed("an office move from the garage to the shared office, with its bill");
  await context.close();
};

const fullCampus = async ({ save }) => {
  current = "9. A full campus";
  const { context, page } = await loadSave(save);
  const options = page.getByRole("group", { name: "Poach from a rival" }).getByRole("button");
  const rivals = (await options.all()).slice(1);
  assert(rivals.length > 0, "the plan offers no poach options");
  for (const option of rivals) assert(await option.isDisabled(), "a poach option is enabled on a full campus");
  const full = "Your campus is full: nobody more can join.";
  const shown = await page.evaluate((text) => document.body.innerText.includes(text) || [...document.querySelectorAll("[title]")].some((element) => element.getAttribute("title").includes(text)), full);
  assert(shown, `"${full}" is not on the page`);
  noErrors();
  passed("a full campus: every poach option disabled, and the page says why");
  await context.close();
};

const narrow = async ({ save }) => {
  current = "10. No sideways scroll at a narrow width";
  const { context, page } = await loadSave(save, PHONE);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  assert(width <= PHONE.width, `the page is ${width} px wide at ${PHONE.width} px`);
  noErrors();
  passed(`a career in progress fits ${PHONE.width} px`);
  await context.close();
};

const milestoneSound = async ({ save, year }) => {
  current = "11. A milestone's sound in 2D";
  const { context, page } = await loadSave(save);
  const before = await page.evaluate(() => window.__careerOffice?.sounds() ?? null);
  assert(before !== null && before.length === 0, `before End the sounds asked for are ${JSON.stringify(before)}`);
  await endButton(page, year).click();
  await opened(page);
  const heard = await page.evaluate(() => window.__careerOffice.sounds());
  assert(heard.filter((each) => each === "asset-office-upgrade").length === 1, `as the summary opened the sounds asked for are ${JSON.stringify(heard)}`);
  assert(!heard.includes("users-trickle"), `the 2D screens streamed the market's users: ${JSON.stringify(heard)}`);
  await closeWith(page, `Plan ${year + 1}`);
  const after = await page.evaluate(() => window.__careerOffice.sounds());
  assert(JSON.stringify(after) === JSON.stringify(heard), `closing the summary asked for more sounds: ${JSON.stringify(after)}`);
  await stays2D(page, "the office move's year");
  noErrors();
  passed(`the office move of ${year} heard once as its summary opens, in the 2D screens; nothing more as it closes`);
  await context.close();
};

// ---------------------------------------------------------------------------------------------------------------
// 12 to 15. The career's "+", its hiring words, the start tour, and nothing cut off on an iPhone

const planPanel = (page) => page.locator('section[aria-label^="Plan for "]');
const teamCount = async (page, name) => Number(await planPanel(page).locator(`[role="group"][aria-label="${name}"] output`).innerText());
const teamButton = (page, which, name) => planPanel(page).getByRole("button", { name: `${which}: ${name}`, exact: true });
const priceButton = (page, name) => planPanel(page).getByRole("group", { name: "Price", exact: true }).getByRole("button", { name: new RegExp(`^${name}`) });

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

/** Sideways overflow, and elements past either edge that no scrolling or clipping box holds (1px boxes left out). */
const edges = (page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    const width = root.clientWidth;
    const held = (el) => {
      for (let p = el.parentElement; p !== null && p !== document.body; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") return true;
      return false;
    };
    const out = [...document.body.querySelectorAll("*")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1 && (r.left < -0.5 || r.right > width + 0.5) && !held(el);
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()} ${JSON.stringify(String(el.className).slice(0, 60))}`);
    return { scrollWidth: root.scrollWidth, clientWidth: width, scrollX: window.scrollX, out };
  });
const fitsEdges = async (page, where) => {
  const e = await edges(page);
  assert(e.scrollWidth === e.clientWidth && e.scrollX === 0, `${where}: the page is ${e.scrollWidth} px wide in ${e.clientWidth} px, scrolled ${e.scrollX}`);
  assert(e.out.length === 0, `${where}: past the edge: ${e.out.join(" | ")}`);
};
/** The tour card, and its box against the box of every visible target of the step. */
const tourCard = (page) => page.locator('section[aria-label="Tour"]');
const cardClear = async (page, target, where) => {
  const card = await tourCard(page).boundingBox();
  const boxes = await page.locator(`[data-tutorial="${target}"]`).evaluateAll((els) => els.filter((el) => el.getClientRects().length > 0).map((el) => el.getBoundingClientRect().toJSON()));
  assert(card !== null && boxes.length > 0, `${where}: no card or no ${target}`);
  for (const b of boxes) {
    const overlap = card.x < b.right && b.left < card.x + card.width && card.y < b.bottom && b.top < card.y + card.height;
    assert(!overlap, `${where}: the tour card covers ${target}`);
  }
};
const tourKey = (page) => page.evaluate((key) => localStorage.getItem(key), TOUR_KEY);
/** The card shows step `n` of 7, and says no forbidden word. */
const onStep = async (page, n, where) => {
  await tourCard(page).waitFor();
  // textContent: the label is drawn in capitals.
  const text = await tourCard(page).textContent();
  assert(text.includes(`Step ${n} of 7`), `${where}: the card does not show "Step ${n} of 7": ${JSON.stringify(text)}`);
  await noForbiddenWords(tourCard(page), `the tour's step ${n}`);
};
const tourButton = (page, name) => tourCard(page).getByRole("button", { name, exact: true });

const careerPlus = async () => {
  current = '12. A career\'s "+" and its hiring words';
  const MOVED = /none is certain|At least \d+ joins?|expect \d+\./;
  {
    const { context, page } = await freshPage();
    await startCareer(page);
    const more = teamButton(page, "More", "Recruiting");
    assert(await more.isEnabled(), '"More: Recruiting" is not enabled in 1990');
    const product = await teamCount(page, "Product");
    assert((await teamCount(page, "Recruiting")) === 0, "Recruiting is not 0 in a fresh 1990");
    assert((await planPanel(page).innerText()).includes("Nobody is recruiting. Put one person on Recruiting to hire"), 'the plan does not say "Nobody is recruiting. Put one person on Recruiting to hire"');
    await more.click();
    assert((await teamCount(page, "Product")) === 2 && product === 3 && (await teamCount(page, "Recruiting")) === 1, `the counts after the click are Product ${await teamCount(page, "Product")} (was ${product}) and Recruiting ${await teamCount(page, "Recruiting")}`);
    const plan = await planPanel(page).innerText();
    assert(plan.includes("1 moved from Product"), 'the plan does not say "1 moved from Product"');
    const hire = planPanel(page).getByRole("group", { name: "Hire at most", exact: true });
    assert((await hire.count()) === 1, 'the "Hire at most" group does not show');
    assert(plan.includes("Hires join next year"), 'the plan does not say "Hires join next year"');
    assert(MOVED.test(plan), `the plan says no expected hires in the new words: ${JSON.stringify(plan.split("\n").find((line) => /expect/i.test(line)) ?? null)}`);
    await noForbiddenWords(planPanel(page), "the plan");
    await teamButton(page, "Less", "Recruiting").click();
    assert(!(await planPanel(page).innerText()).includes("moved from"), '"Less: Recruiting" does not take the note away');
    noErrors();
    await context.close();
  }
  {
    const { context, page } = await freshPage(PHONE, { device: IPHONE });
    await startCareer(page);
    await teamButton(page, "More", "Recruiting").click();
    assert((await teamCount(page, "Product")) === 2 && (await teamCount(page, "Recruiting")) === 1, "on an iPhone, + on Recruiting did not move one person from Product");
    assert((await planPanel(page).innerText()).includes("1 moved from Product"), 'on an iPhone the plan does not say "1 moved from Product"');
    await fitsEdges(page, "an iPhone after + on Recruiting");
    noErrors();
    await context.close();
  }
  passed("in a career + on Recruiting with everyone at work moves one person from Product, the row says so, and the plan says how hiring works");
};

/** The start tour, from step 1 to Done: `check(n, target)` runs at every step. Leaves the page on 1991. */
const tourThrough = async (page, check) => {
  await onStep(page, 1, "1990");
  await check(1, "status");
  await tourButton(page, "Next").click();
  await onStep(page, 2, "the team step");
  await check(2, "team");
  await teamButton(page, "More", "Recruiting").click();
  await onStep(page, 3, '"More: Recruiting" pressed');
  await check(3, "money");
  await priceButton(page, "Premium").click();
  await onStep(page, 4, 'Price "Premium" pressed');
  await check(4, "cash");
  await tourButton(page, "Next").click();
  await onStep(page, 5, "the end step");
  await check(5, "end");
  await endButton(page, FIRST_YEAR).click();
  await opened(page);
  assert((await tourCard(page).count()) === 0, "the tour card shows while the summary is open");
  await closeWith(page, `Plan ${FIRST_YEAR + 1}`);
  await onStep(page, 6, "the summary closed");
  await check(6, "report");
  await tourButton(page, "Next").click();
  await onStep(page, 7, "the closing card");
  await tourButton(page, "Done").click();
  await tourCard(page).waitFor({ state: "detached" });
  assert((await tourKey(page)) === "done", `after Done the tour's key is ${JSON.stringify(await tourKey(page))}`);
};

const tourDesktop = async () => {
  current = "13. The start tour at 1280x800 in 2D";
  const { context, page } = await freshPage(DESKTOP, { tour: true });
  await startCareer(page);
  await tourThrough(page, async (n, target) => {
    await cardClear(page, target, `step ${n}`);
  });
  await page.reload();
  await endButton(page, FIRST_YEAR + 1).waitFor();
  await page.waitForTimeout(SETTLE_MS);
  assert((await tourCard(page).count()) === 0, "the tour shows again after a reload once done");
  passed("the tour walks from the goal to Done through the real controls, never covers its target, hides while the summary is open, and stays done after a reload");

  await page.getByRole("button", { name: "How to play", exact: true }).click();
  await opened(page);
  await closeWith(page, "Show me around");
  await onStep(page, 1, '"Show me around"');
  await tourButton(page, "Skip the tour").click();
  await tourCard(page).waitFor({ state: "detached" });
  assert((await tourKey(page)) === "skipped", `after Skip the tour's key is ${JSON.stringify(await tourKey(page))}`);
  await stays2D(page, "the tour");
  noErrors();
  passed('How to play\'s "Show me around" shows step 1 again, and "Skip the tour" hides it and remembers "skipped"');
  await context.close();
};

const tourPhone = async () => {
  current = "14. The start tour on an iPhone";
  const { context, page } = await freshPage(PHONE, { tour: true, device: IPHONE });
  await startCareer(page);
  await onStep(page, 1, "1990");
  await page.getByRole("group", { name: "Show", exact: true }).getByRole("button", { name: "Rivals", exact: true }).click();
  await tourThrough(page, async (n, target) => {
    const where = `step ${n} on an iPhone`;
    if (n === 2) {
      const plan = page.getByRole("group", { name: "Show", exact: true }).getByRole("button", { name: "Plan", exact: true });
      assert((await plan.getAttribute("aria-pressed")) === "true", `${where}: the Plan tab is not pressed`);
    }
    const look = await page.evaluate((target) => {
      const bar = document.querySelector("div.fixed.inset-x-0.bottom-0");
      const barTop = window.innerHeight - (bar?.offsetHeight ?? 0);
      const els = [...document.querySelectorAll(`[data-tutorial="${target}"]`)].filter((el) => el.getClientRects().length > 0);
      return {
        barTop,
        height: window.innerHeight,
        width: window.innerWidth,
        boxes: els.map((el) => ({ ...el.getBoundingClientRect().toJSON(), inBar: bar !== null && bar.contains(el) })),
      };
    }, target);
    assert(look.boxes.length > 0, `${where}: no ${target} is shown`);
    for (const b of look.boxes) {
      assert(b.top >= -0.5 && b.left >= -0.5 && b.right <= look.width + 0.5 && b.bottom <= look.height + 0.5, `${where}: ${target} lies outside the screen: ${JSON.stringify(b)}`);
      // The cash and End live in the bar itself; anything else must sit above it.
      if (!b.inBar) assert(b.bottom <= look.barTop + 0.5, `${where}: ${target} is under the bar (${b.bottom} > ${look.barTop})`);
    }
    await cardClear(page, target, where);
    const card = await tourCard(page).boundingBox();
    assert(card.height <= 0.45 * look.height + 0.5, `${where}: the card is ${card.height} px high on a ${look.height} px screen`);
    await fitsEdges(page, where);
  });
  noErrors();
  passed("on an iPhone the tour presses the Plan tab, keeps every target on screen and above the bar, never covers it, stays under 45% of the screen, and nothing passes the edges");
  await context.close();
};

const iphoneEdges = async () => {
  current = "15. Nothing cut off on an iPhone over a played year";
  const { context, page } = await freshPage(PHONE, { device: IPHONE });
  await page.goto(`${BASE}/`);
  await page.getByLabel("Name your startup").waitFor();
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: /Career/ }).click();
  await page.getByText("Replay a game with its seed").click();
  const sizes = await page.locator("input[type=text]").evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
  assert(sizes.length >= 2 && sizes.every((size) => size >= 16), `the text boxes' font sizes are ${JSON.stringify(sizes)}`);
  await startCareer(page);
  await fitsEdges(page, "1990");
  const anchors = page.locator('section[aria-label="Your company"] [tabindex="0"]');
  const count = await anchors.count();
  assert(count === 8, `the company bar has ${count} anchors, not 8`);
  for (let n = 0; n < count; n++) {
    await anchors.nth(n).tap();
    await page.waitForTimeout(150);
    await fitsEdges(page, `the company bar's anchor ${n + 1} tapped`);
  }
  await endButton(page, FIRST_YEAR).click();
  await opened(page);
  await fitsEdges(page, "the summary of 1990");
  await fullReport(page);
  await fitsEdges(page, "the full report of 1990");
  await closeWith(page, `Plan ${FIRST_YEAR + 1}`);
  await endButton(page, FIRST_YEAR + 1).waitFor();
  await fitsEdges(page, "1991");
  const marketing = planPanel(page).getByRole("button", { name: "More: Marketing", exact: true });
  for (let n = 0; n < 200 && (await marketing.isEnabled()); n++) await marketing.click();
  assert(await marketing.isDisabled(), '"More: Marketing" never reached its maximum');
  await fitsEdges(page, "marketing at its maximum");
  await priceButton(page, "Premium").click();
  await fitsEdges(page, 'Price "Premium"');
  const sell = planPanel(page).getByRole("group", { name: "Raise money", exact: true }).getByRole("button", { name: /^Sell 10%/ });
  if ((await sell.count()) > 0 && (await sell.isEnabled())) {
    await sell.click();
    await fitsEdges(page, '"Sell 10%"');
  }
  const tabs = page.getByRole("group", { name: "Show", exact: true });
  await tabs.getByRole("button", { name: "Rivals", exact: true }).click();
  await fitsEdges(page, "the Rivals tab");
  await tabs.getByRole("button", { name: "Plan", exact: true }).click();
  await fitsEdges(page, "the Plan tab");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(150);
  await fitsEdges(page, "the page scrolled to the bottom");
  noErrors();
  passed("at iPhone width the page never scrolls sideways and nothing passes the edges over a played year, tooltips open; every text box is 16 px or more");
  await context.close();
};

// ---------------------------------------------------------------------------------------------------------------
// Main

const main = async () => {
  if (build) {
    const built = spawnSync("npx", ["vite", "build"], { cwd: ROOT, stdio: "inherit" });
    if (built.status !== 0) {
      console.error("career-check: vite build failed");
      process.exit(1);
    }
  }
  const made = spawnSync("npx", ["tsx", "scripts/career-fixtures.ts"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (made.status !== 0) {
    console.error(`career-check: the fixtures could not be made\n${made.stderr}`);
    process.exit(1);
  }
  const fixtures = JSON.parse(made.stdout);
  if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true });

  await startServer();
  // WebGL off: this check proves the career complete in the 2D screens (scripts/office-check.mjs covers the 3D office).
  browser = await chromium.launch({ args: ["--disable-3d-apis"] });
  try {
    if (runs(1)) await raceUnchanged();
    if (runs(2) || runs(3)) await wholeCareer();
    if (runs(4)) await goingPublic(fixtures.listing);
    if (runs(5)) await theRescue(fixtures.rescue);
    if (runs(6)) await firedAndRescued(fixtures.board);
    if (runs(7)) await secondFailure(fixtures.failure);
    if (runs(8)) await officeMove(fixtures.office);
    if (runs(9)) await fullCampus(fixtures.campus);
    if (runs(10)) await narrow(fixtures.office);
    if (runs(11)) await milestoneSound(fixtures.office);
    if (runs(12)) await careerPlus();
    if (runs(13)) await tourDesktop();
    if (runs(14)) await tourPhone();
    if (runs(15)) await iphoneEdges();
  } finally {
    await browser.close();
    stopServer();
  }
  console.log("career-check: every assertion passed");
};

main().catch((error) => {
  if (error instanceof Failed) console.error(`career-check: FAILED ${error.message}`);
  else console.error(`career-check: FAILED ${current}: ${error.stack ?? error}`);
  stopServer();
  process.exit(1);
});
