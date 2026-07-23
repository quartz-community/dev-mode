import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:4173/test-base",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npx tsx e2e/helpers/serve-fixture.ts",
    cwd: "..",
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        launchOptions: {
          executablePath: process.env.CHROME_BIN || undefined,
        },
      },
    },
  ],
});
