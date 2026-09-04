import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium",
      },
    },
  ],
  webServer: {
    command: "bun run dev --hostname 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/scenarios/zombie-arena-3d/",
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      GITHUB_ACTIONS: "false",
    },
  },
});
