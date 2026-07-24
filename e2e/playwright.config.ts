import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: 0,
  use: {
    trace: "on-first-retry",
    launchOptions: {
      executablePath: process.env.CHROME_BIN || undefined,
    },
  },
  webServer: [
    {
      command: "npx tsx e2e/helpers/serve-fixture.ts",
      cwd: "..",
      port: 4173,
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
      env: { FIXTURE: "base-url-site", BASE_PATH: "/test-base", PORT: "4173" },
    },
    {
      command: "npx tsx e2e/helpers/serve-fixture.ts",
      cwd: "..",
      port: 4174,
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
      env: {
        FIXTURE: "nested-base-url",
        BASE_PATH: "/Obsidian-TTRPG-Quartz",
        PORT: "4174",
      },
    },
    {
      command: "npx tsx e2e/helpers/serve-fixture.ts",
      cwd: "..",
      port: 4175,
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
      env: { FIXTURE: "bug-repro", BASE_PATH: "/bug-repro", PORT: "4175" },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
