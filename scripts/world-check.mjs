#!/usr/bin/env node
/**
 * The browser checks of the 3D office: builds the app, serves `dist` with `vite preview`, and drives the lab page
 * (`/office-lab.html`) in headless Chromium through `window.__officeLab`.
 *
 *   node scripts/world-check.mjs [--shots <dir>] [--json <file>] [--no-build]
 *
 * For each of the five offices, full, at 1280x800 and at 390x844: open it and fail on any console error or warning
 * (but the software renderer's "GPU stall due to ReadPixels"); read draw calls, triangles, people drawn and people
 * counted on the sign; check that no frame is drawn in the second of two quiet seconds; take a screenshot; play a
 * year with three hires and two layoffs and time how long it takes to come to rest, with and without reduced
 * motion. Then once: lose the graphics context and restore it through "Reload 3D view"; open the page without
 * WebGL; mount and unmount the view twenty times.
 *
 * `--shots <dir>` also saves each office at device scale 2 into <dir>, as office-<n>-<width>x<height>.png.
 * `--json <file>` writes the measurements. `--no-build` serves the `dist` that is there.
 * Exits with 1 when any check fails. Not part of `npm test`: it needs a browser and takes minutes.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4179;
const BASE = `http://localhost:${PORT}`;
const PAGE = "/office-lab.html";

/** The one console message allowed: headless Chromium's software renderer logs it whenever the world draws. */
const ALLOWED_CONSOLE = /GPU stall due to ReadPixels/;
/** The world's own second of grace: it stops drawing this long after the last thing stopped moving (core/rest.ts). */
const REST_AFTER_MS = 1000;
/** No frame for this long means the loop has stopped: longer than the grace and than any one software frame. */
const QUIET_MS = 1500;
const YEAR_LIMIT_S = 15;
const REDUCED_LIMIT_S = 1;
/** How long a year is watched before it counts as never coming to rest; long enough to measure a slow one. */
const WATCH_MS = 60000;
const SIZES = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
];
const CAPACITY = [4, 9, 22, 40, 150];
const TEAMS = ["product", "growth", "recruiting"];
/** The words the shell shows (src/world/ui/shellWords.ts). */
const UNAVAILABLE = "The 3D office cannot be shown on this device. The game is complete without it.";
const RELOAD = "Reload 3D view";

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
  return resolve(value);
};
const shotsDir = argValue("--shots");
const jsonFile = argValue("--json");
const build = !process.argv.includes("--no-build");

// ---------------------------------------------------------------------------------------------------------------
// Scenes, as the lab writes them (src/lab/labScene.ts)

/** `people` split 5 : 4 : 1 across the teams by largest remainder; a tie goes to the earlier team. */
const split = (people) => {
  const shares = [5, 4, 1].map((part) => (people * part) / 10);
  const counts = shares.map(Math.floor);
  const order = [0, 1, 2].sort((a, b) => shares[b] - counts[b] - (shares[a] - counts[a]) || a - b);
  for (let left = people - counts.reduce((a, b) => a + b, 0), i = 0; left > 0; left--, i++) counts[order[i]]++;
  return Object.fromEntries(TEAMS.map((team, i) => [team, counts[i]]));
};

const scene = (office, teams, extra = {}) => ({
  runId: "lab:0",
  seed: 0,
  year: 1990,
  office,
  capacity: CAPACITY[office],
  era: "flat",
  teams,
  away: 0,
  leaving: 0,
  arriving: 0,
  ending: null,
  ...extra,
});

const query = (of) =>
  `?office=${of.office}&product=${of.teams.product}&growth=${of.teams.growth}&recruiting=${of.teams.recruiting}` +
  `&away=${of.away}&leaving=${of.leaving}&arriving=${of.arriving}&year=${of.year}&era=${of.era}&seed=${of.seed}&panel=0`;

/** The same year with two people let go (one at a time from the largest team) and three hires expected. */
const layoffsAndHires = (of) => {
  const teams = { ...of.teams };
  for (let n = 0; n < 2; n++) {
    const largest = TEAMS.reduce((best, team) => (teams[team] > teams[best] ? team : best), TEAMS[0]);
    teams[largest]--;
  }
  return { ...of, teams, leaving: 2, arriving: 3 };
};

/** The lab's `endYear`, line for line: the hires each join the smallest team, the year goes up, the office never shrinks. */
const endYear = (of) => {
  const teams = { ...of.teams };
  for (let joining = of.away + of.arriving; joining > 0; joining--) {
    const smallest = TEAMS.reduce((best, team) => (teams[team] < teams[best] ? team : best), TEAMS[0]);
    teams[smallest]++;
  }
  const people = TEAMS.reduce((sum, team) => sum + teams[team], 0);
  let office = of.office;
  while (office < CAPACITY.length - 1 && CAPACITY[office] < people) office++;
  return { ...of, teams, away: 0, leaving: 0, arriving: 0, office, capacity: CAPACITY[office], year: of.year + 1 };
};

// ---------------------------------------------------------------------------------------------------------------
// The server, killed on every way out

let server = null;
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
process.on("uncaughtException", (error) => {
  console.error(error);
  stopServer();
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  console.error(error);
  stopServer();
  process.exit(1);
});

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
  // vite gives up on a taken port (--strictPort), but whatever holds it would still answer the polling below.
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
    // Only once vite says where it serves is an answer on the port vite's own.
    if (!output.includes("Local:")) {
      await new Promise((done) => setTimeout(done, 200));
      continue;
    }
    try {
      const response = await fetch(`${BASE}${PAGE}`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`vite preview did not answer on port ${PORT}:\n${output}`);
};

// ---------------------------------------------------------------------------------------------------------------
// Checks

const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
  return ok;
};

/** Every console error and warning, and every page error, but the allowed message. */
const watchConsole = (page) => {
  const bad = [];
  page.on("console", (message) => {
    const type = message.type();
    if ((type === "error" || type === "warning") && !ALLOWED_CONSOLE.test(message.text())) bad.push(`${type}: ${message.text()}`);
  });
  page.on("pageerror", (error) => bad.push(`page error: ${error.message}`));
  return bad;
};

const open = async (context, of) => {
  const page = await context.newPage();
  const bad = watchConsole(page);
  await page.goto(`${BASE}${PAGE}${query(of)}`);
  await page.waitForFunction(() => window.__officeLab !== undefined);
  await page.evaluate(() => window.__officeLab.ready);
  return { page, bad };
};

const stats = (page) => page.evaluate(() => window.__officeLab.stats());

/** Frames drawn in the second of the next two seconds. */
const framesInSecondQuietSecond = (page) =>
  page.evaluate(
    () =>
      new Promise((done) => {
        const lab = window.__officeLab;
        setTimeout(() => {
          const from = lab.stats().framesDrawn;
          setTimeout(() => done(lab.stats().framesDrawn - from), 1000);
        }, 1000);
      })
  );

/**
 * Show `next` and watch the frames until the loop stands still. Two clocks: the page's, and the world's own. The
 * world moves everything on by a frame's length but never by more than a tenth of a second (core/FrameLoop.ts),
 * so on a page that draws four frames a second its people walk at half speed. A frame's length in the world is
 * read here the same way, from the page's frame clock.
 *
 * - `restMs`: page time from the new scene to the last frame drawn, after which the loop stands still.
 * - `settledS`: world seconds until the last thing stopped moving. The loop rests a second of page time after
 *   that (core/rest.ts), so this counts the frames drawn up to a second before the last one.
 * - `restS`: `settledS` and the world's one second of grace: how long the year lasts on a page that keeps up.
 * Both are left unrounded: a limit is held against the measured value, and only the report rounds it.
 */
const playOut = (page, next) =>
  page.evaluate(
    ({ next, quietMs, watchMs, graceMs }) =>
      new Promise((done) => {
        const lab = window.__officeLab;
        const start = performance.now();
        const first = lab.stats().framesDrawn;
        let frames = first;
        let previous = null;
        const drawn = [];
        lab.setScene(next);
        const look = (now) => {
          const count = lab.stats().framesDrawn;
          if (count !== frames) {
            frames = count;
            // As the world measures a frame: the first after a stop counts 1/60 s, none counts more than 0.1 s.
            const seconds = previous === null ? 1 / 60 : Math.min(0.1, Math.max(0.001, (now - previous) / 1000));
            drawn.push({ at: now, seconds });
            previous = now;
          }
          const last = drawn.length > 0 ? drawn[drawn.length - 1].at : start;
          if (now - last >= quietMs || now - start > watchMs) {
            const settled = drawn.filter((frame) => frame.at <= last - graceMs).reduce((sum, frame) => sum + frame.seconds, 0);
            done({
              rested: now - last >= quietMs,
              frames: frames - first,
              restMs: Math.round(last - start),
              settledS: settled,
              restS: settled + graceMs / 1000,
            });
          } else requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
      }),
    { next, quietMs: QUIET_MS, watchMs: WATCH_MS, graceMs: REST_AFTER_MS }
  );

/**
 * A year with three hires and two layoffs. First the year as planned (two people let go and three expected, shown
 * at the door), left to come to rest; then the year ends, which is what is timed against `limitS` on `measure`.
 */
const playYear = async (page, full, label, limitS, measure) => {
  const marked = layoffsAndHires(full);
  const door = await playOut(page, marked);
  check(door.rested, `${label}: the layoffs and hires shown never came to rest within ${WATCH_MS / 1000} s`);
  const next = endYear(marked);
  const year = await playOut(page, next);
  check(year.rested, `${label}: the year never came to rest within ${WATCH_MS / 1000} s`);
  check(year.frames > 0, `${label}: the year drew no frame`);
  check(year[measure] <= limitS, `${label}: the year took ${year[measure].toFixed(3)} s (${measure}), over ${limitS} s`);
  return { door, year, next };
};

const officeRun = async (browser, office, size, shots, reportShots) => {
  const people = CAPACITY[office];
  const full = scene(office, split(people));
  const label = `office ${office} (${people}) at ${size.width}x${size.height}`;
  const row = { office, people, teams: full.teams, width: size.width, height: size.height };

  const context = await browser.newContext({ viewport: size });
  try {
    const { page, bad } = await open(context, full);
    const opened = await stats(page);
    check(opened.status === "running", `${label}: status ${opened.status}, not running`);
    row.quietFrames = await framesInSecondQuietSecond(page);
    check(row.quietFrames === 0, `${label}: ${row.quietFrames} frames drawn in the second quiet second`);
    const still = await stats(page);
    Object.assign(row, { drawCalls: still.drawCalls, triangles: still.triangles, figures: still.figures, hidden: still.hidden });
    check(still.figures + still.hidden === people, `${label}: ${still.figures} drawn and ${still.hidden} counted, not ${people}`);
    check(still.figures <= 56, `${label}: ${still.figures} figures drawn, over 56`);
    await page.screenshot({ path: join(reportShots, `office-${office}-${size.width}x${size.height}.png`) });

    const played = await playYear(page, full, label, YEAR_LIMIT_S, "restS");
    const after = await stats(page);
    const nextPeople = TEAMS.reduce((sum, team) => sum + played.next.teams[team], 0);
    check(after.figures + after.hidden === nextPeople, `${label}: after the year ${after.figures} drawn and ${after.hidden} counted, not ${nextPeople}`);
    row.door = played.door;
    row.year = { ...played.year, nextOffice: played.next.office, drawCalls: after.drawCalls, figures: after.figures, hidden: after.hidden };
    check(bad.length === 0, `${label}: console: ${bad.join(" | ")}`);
    row.console = bad;
  } finally {
    await context.close();
  }

  const reduced = await browser.newContext({ viewport: size, reducedMotion: "reduce" });
  try {
    const { page, bad } = await open(reduced, full);
    await framesInSecondQuietSecond(page);
    // Under reduced motion the loop cannot rest within a second of anything: it draws for a second after the last
    // movement. What has to be over within the second is the movement itself.
    const played = await playYear(page, full, `${label}, reduced motion`, REDUCED_LIMIT_S, "settledS");
    row.reducedDoor = played.door;
    row.reduced = played.year;
    check(bad.length === 0, `${label}, reduced motion: console: ${bad.join(" | ")}`);
  } finally {
    await reduced.close();
  }

  if (shots) {
    const sharp = await browser.newContext({ viewport: size, deviceScaleFactor: 2 });
    try {
      const { page, bad } = await open(sharp, full);
      const quiet = await framesInSecondQuietSecond(page);
      check(quiet === 0, `${label}, scale 2: ${quiet} frames drawn in the second quiet second`);
      await page.screenshot({ path: join(shots, `office-${office}-${size.width}x${size.height}.png`) });
      check(bad.length === 0, `${label}, scale 2: console: ${bad.join(" | ")}`);
    } finally {
      await sharp.close();
    }
  }
  return row;
};

const lostContext = async (browser) => {
  const label = "lost context";
  const context = await browser.newContext({ viewport: SIZES[0] });
  try {
    const { page, bad } = await open(context, scene(2, split(22)));
    await framesInSecondQuietSecond(page);
    await page.evaluate(() => window.__officeLab.loseContext());
    await page.waitForFunction(() => window.__officeLab.stats().status === "context-lost", null, { timeout: 10000 });
    const reload = page.getByRole("button", { name: RELOAD });
    await reload.waitFor({ state: "visible", timeout: 5000 });
    await reload.click();
    await page.waitForFunction(() => window.__officeLab.stats().status === "running", null, { timeout: 20000 });
    await page.waitForFunction(() => window.__officeLab.stats().figures > 0 && window.__officeLab.stats().framesDrawn > 0, null, { timeout: 20000 });
    const after = await stats(page);
    check(after.figures === 22, `${label}: ${after.figures} people drawn after the reload, not 22`);
    check(bad.length === 0, `${label}: console: ${bad.join(" | ")}`);
    return { status: after.status, figures: after.figures, drawCalls: after.drawCalls, console: bad };
  } catch (error) {
    check(false, `${label}: ${error.message.split("\n")[0]}`);
    return { error: error.message.split("\n")[0] };
  } finally {
    await context.close();
  }
};

const withoutWebGL = async () => {
  const label = "without WebGL";
  const browser = await chromium.launch({ args: ["--disable-3d-apis"] });
  try {
    const page = await browser.newPage({ viewport: SIZES[1] });
    const errors = [];
    const consoleLines = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") consoleLines.push(`${message.type()}: ${message.text()}`);
    });
    await page.goto(`${BASE}${PAGE}${query(scene(2, split(22)))}`);
    await page.waitForFunction(() => window.__officeLab !== undefined);
    await page.evaluate(() => window.__officeLab.ready);
    const status = (await stats(page)).status;
    const noteShown = await page.getByText(UNAVAILABLE).isVisible();
    check(status === "unsupported", `${label}: status ${status}, not unsupported`);
    check(noteShown, `${label}: the note is not shown`);
    check(errors.length === 0, `${label}: page errors: ${errors.join(" | ")}`);
    return { status, noteShown, pageErrors: errors, console: consoleLines };
  } finally {
    await browser.close();
  }
};

const mountTwenty = async (browser) => {
  const label = "twenty mounts";
  const context = await browser.newContext({ viewport: SIZES[0] });
  try {
    const { page, bad } = await open(context, scene(2, split(22)));
    const counts = await page.evaluate(async () => {
      const lab = window.__officeLab;
      const seen = [];
      for (let n = 0; n < 20; n++) {
        await lab.unmount();
        const { geometries, textures } = lab.stats();
        seen.push({ geometries, textures });
        // Driven back to back, the page runs none of its timers in between (drawing and React's own tasks go first),
        // so the timers that hand each disposed context back wait until the end, and past sixteen contexts the
        // browser evicts the oldest with a warning. Nobody clicks that fast: one timer's pause lets them run.
        await new Promise((next) => setTimeout(next, 0));
        await lab.mount();
      }
      return seen;
    });
    const first = counts[0];
    const last = counts[counts.length - 1];
    check(first.geometries === last.geometries && first.textures === last.textures,
      `${label}: geometries/textures ${first.geometries}/${first.textures} after the first unmount, ${last.geometries}/${last.textures} after the last`);
    const running = await stats(page);
    check(running.status === "running" && running.figures === 22, `${label}: after the last mount status ${running.status} with ${running.figures} people`);
    check(bad.length === 0, `${label}: console: ${bad.join(" | ")}`);
    return { first, last, console: bad };
  } finally {
    await context.close();
  }
};

// ---------------------------------------------------------------------------------------------------------------

const pad = (value, width) => String(value).padStart(width);

const main = async () => {
  if (build) {
    const built = spawnSync("npx", ["vite", "build"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
    if (built.status !== 0) throw new Error("vite build failed");
  }
  await startServer();
  const reportShots = mkdtempSync(join(tmpdir(), "world-check-"));
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });

  const browser = await chromium.launch();
  const rows = [];
  const once = {};
  /** A check run once: if it throws, that is one more failure, and the report goes on. */
  const runOnce = async (name, label, run) => {
    try {
      once[name] = await run();
    } catch (error) {
      const message = String(error?.message ?? error).split("\n")[0];
      check(false, `${label}: ${message}`);
      once[name] = { error: message };
    }
  };
  try {
    for (let office = 0; office < CAPACITY.length; office++) {
      for (const size of SIZES) {
        try {
          const row = await officeRun(browser, office, size, shotsDir, reportShots);
          rows.push(row);
          console.log(`office ${office} ${size.width}x${size.height}: ${row.drawCalls} calls, year ${row.year.restS.toFixed(1)} s`);
        } catch (error) {
          check(false, `office ${office} at ${size.width}x${size.height}: ${error.message.split("\n")[0]}`);
        }
      }
    }
    await runOnce("lostContext", "lost context", () => lostContext(browser));
    await runOnce("mounts", "twenty mounts", () => mountTwenty(browser));
  } finally {
    await browser.close();
  }
  await runOnce("withoutWebGL", "without WebGL", () => withoutWebGL());

  console.log("");
  console.log("                                                       |      year (s)       |  reduced motion (s)");
  console.log("office people  size      calls  triangles drawn counted | world  page  door* | moving  rest(page)");
  for (const row of rows) {
    console.log(
      `${pad(row.office, 6)} ${pad(row.people, 6)}  ${`${row.width}x${row.height}`.padEnd(8)} ${pad(row.drawCalls, 6)} ${pad(row.triangles, 10)} ${pad(row.figures, 5)} ${pad(row.hidden, 7)} |` +
        ` ${pad(row.year.restS.toFixed(1), 5)} ${pad((row.year.restMs / 1000).toFixed(1), 5)} ${pad((row.door.restMs / 1000).toFixed(1), 6)} |` +
        ` ${pad(row.reduced.settledS.toFixed(1), 6)} ${pad((row.reduced.restMs / 1000).toFixed(1), 6)}`
    );
  }
  console.log("world: world seconds until the loop rests; page: page seconds; door*: page seconds for the layoffs and hires");
  console.log("to be shown at the door before the year ends (not timed against a limit)");
  console.log("");
  console.log(`lost context, then "${RELOAD}": ${once.lostContext.error ?? `${once.lostContext.status}, ${once.lostContext.figures} people drawn`}`);
  const { withoutWebGL: bare, mounts } = once;
  console.log(`without WebGL: ${bare.error ?? `status ${bare.status}, note ${bare.noteShown ? "shown" : "missing"}, ${bare.pageErrors.length} page errors`}`);
  console.log(
    `twenty mounts: ${mounts.error ?? `geometries/textures ${mounts.first.geometries}/${mounts.first.textures} after the first unmount, ${mounts.last.geometries}/${mounts.last.textures} after the last`}`
  );
  console.log(`screenshots at scale 1: ${reportShots}`);
  if (shotsDir) console.log(`screenshots at scale 2: ${shotsDir}`);

  if (jsonFile) {
    mkdirSync(dirname(jsonFile), { recursive: true });
    writeFileSync(jsonFile, `${JSON.stringify({ rows, once, failures, reportShots, shotsDir }, null, 2)}\n`);
  }
  if (failures.length > 0) {
    console.log(`\n${failures.length} failed:`);
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  } else console.log("\nall checks passed");
};

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  stopServer();
}
