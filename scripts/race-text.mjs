#!/usr/bin/env node
/**
 * The race's on-screen text, recorded once and checked after every change to the screens: the career must leave
 * the race exactly as it was.
 *
 *   node scripts/race-text.mjs [--no-build] [--write]
 *
 * Builds the app (`npx vite build`) unless `--no-build`, serves `dist` with `vite preview` on port 4181, and in
 * headless Chromium at 1280x800 with fresh storage starts a Quick race named "Race Co" with seed 20417. For three
 * quarters it collects the game screen's text, then the open report's text, then closes the report. "Text" is the
 * element's `innerText` plus, in document order, every `title` and `aria-label` attribute under it, one per line.
 * The first screen is not recorded: it offers the choice of mode.
 *
 * With `--write` it saves the six texts as `scripts/race-text.snapshot.json`. Without, it compares them with that
 * file and exits 1 naming the first line that differs.
 *
 * Exports `raceText(page)` for the career's browser check, which serves the app itself.
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = resolve(ROOT, "scripts/race-text.snapshot.json");
const PORT = 4181;
const BASE = `http://localhost:${PORT}`;
const NAME = "Race Co";
const SEED = "20417";
const QUARTERS = 3;
/**
 * The report ignores a click this soon after it opens, and "End" one this soon after the report closes
 * (src/ui/useDialog.ts, SETTLE_MS), with a margin.
 */
const SETTLE_MS = 600;

// ---------------------------------------------------------------------------------------------------------------
// Reading the race

/** An element's text: its innerText, then every title and aria-label under it (itself included), one per line. */
const textOf = (locator) =>
  locator.evaluate((root) => {
    const lines = [root.innerText];
    for (const element of [root, ...root.querySelectorAll("*")]) {
      for (const name of ["title", "aria-label"]) {
        const value = element.getAttribute(name);
        if (value !== null) lines.push(value);
      }
    }
    return lines.join("\n");
  });

/**
 * Plays the first three quarters of a Quick race named "Race Co" with seed 20417 on a page whose storage is fresh
 * and whose analytics script is stubbed, and returns the six texts: game screen, report, three times over.
 */
export const raceText = async (page) => {
  await page.goto(`${BASE}/`);
  await page.getByLabel("Name your startup").waitFor();
  // The first screen offers both modes; the race is the one recorded.
  const race = page.getByRole("button", { name: /Quick race/ });
  if ((await race.count()) > 0) await race.first().click();
  await page.getByLabel("Name your startup").fill(NAME);
  await page.getByText("Replay a game with its seed").click();
  await page.getByPlaceholder("for example 20417").fill(SEED);
  await page.locator("form button[type=submit]").click();

  const texts = [];
  for (let n = 1; n <= QUARTERS; n++) {
    const button = page.getByRole("button", { name: `End Q${n}`, exact: true });
    await button.waitFor();
    texts.push(await textOf(page.locator("main")));
    await button.click();
    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor();
    await page.waitForTimeout(SETTLE_MS);
    texts.push(await textOf(dialog));
    await dialog.getByRole("button", { name: `Plan Q${n + 1}`, exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    await page.waitForTimeout(SETTLE_MS);
  }
  return texts;
};

/** The analytics script a production build loads, which `vite preview` cannot serve. */
export const stubAnalytics = (page) =>
  page.route("**/_vercel/insights/**", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));

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
// Comparing

/** The first line that differs between the snapshot and this run, or null when they are the same. */
const firstDifference = (expected, actual) => {
  const screens = Math.max(expected.length, actual.length);
  for (let s = 0; s < screens; s++) {
    const want = (expected[s] ?? "").split("\n");
    const got = (actual[s] ?? "").split("\n");
    if (s >= expected.length || s >= actual.length) return `text ${s + 1}: ${s >= expected.length ? "not in the snapshot" : "missing from this run"}`;
    for (let l = 0; l < Math.max(want.length, got.length); l++) {
      if (want[l] !== got[l]) return `text ${s + 1}, line ${l + 1}: expected ${JSON.stringify(want[l] ?? null)}, got ${JSON.stringify(got[l] ?? null)}`;
    }
  }
  return null;
};

// ---------------------------------------------------------------------------------------------------------------
// Main, only when run as a script

const main = async () => {
  const write = process.argv.includes("--write");
  if (!process.argv.includes("--no-build")) {
    const built = spawnSync("npx", ["vite", "build"], { cwd: ROOT, stdio: "inherit" });
    if (built.status !== 0) {
      console.error("vite build failed");
      process.exit(1);
    }
  }
  const { chromium } = require("playwright");
  process.on("exit", stopServer);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      stopServer();
      process.exit(130);
    });
  }
  await startServer();
  const browser = await chromium.launch();
  let texts;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await stubAnalytics(page);
    texts = await raceText(page);
  } finally {
    await browser.close();
    stopServer();
  }

  if (write) {
    writeFileSync(SNAPSHOT, `${JSON.stringify(texts, null, 2)}\n`);
    console.log(`race-text: wrote ${texts.length} texts to scripts/race-text.snapshot.json`);
    return;
  }
  const expected = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  const difference = firstDifference(expected, texts);
  if (difference !== null) {
    console.error(`race-text: the race's text changed. First difference: ${difference}`);
    process.exit(1);
  }
  console.log(`race-text: all ${texts.length} texts match the snapshot`);
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    stopServer();
    process.exit(1);
  });
}
