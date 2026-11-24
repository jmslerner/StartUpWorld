// Runs before every test file. Some tables are module-level and mutable on purpose (storyConfig: a proof script or a
// simulator sweep switches the story pack off in memory), so a test that changes one could leak into the next test, or
// into another file if the runner ever shares a module graph between files. Reset them before every test; a test or
// describe block that needs another value sets it in its own beforeEach.
import { beforeEach } from "vitest";
import { storyConfig } from "../engine/story/config";

beforeEach(() => {
  storyConfig.enabled = true;
});
