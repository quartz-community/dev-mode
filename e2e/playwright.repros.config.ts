import { defineConfig } from "@playwright/test";
import { chromiumLaunchOptions } from "../scripts/lib/browser.js";

/**
 * Self-contained repros in e2e/repros/<slug>/. Each spec builds and serves its
 * own site via e2e/helpers/repro-fixture.ts — no webServer entries needed.
 *
 *   just repro-test            # all repros
 *   just repro-test <slug>     # one repro
 */
export default defineConfig({
  testDir: "./repros",
  testMatch: "**/*.spec.ts",
  outputDir: "../.dev/test-results/repros",
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  globalSetup: "./helpers/repro-global-setup.ts",
  reporter: process.env.CI ? "github" : [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: chromiumLaunchOptions(),
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
