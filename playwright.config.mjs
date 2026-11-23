import { defineConfig } from "@playwright/test";

// Real-browser E2E for the unpacked extension. API is mocked at the network
// layer (context.route), so runs are deterministic and offline-safe.
// The shared fixture uses the full Chromium channel in headless mode.
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/browser",
  testMatch: "**/*.spec.js",
  timeout: 90000,
  globalTimeout: 12 * 60 * 1000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [["line"], ["html", { open: "never" }], ["json", { outputFile: "test-results/browser-results.json" }]],
});
